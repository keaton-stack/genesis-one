// The Crossing, the Flight Line Link and the arrival set pieces (planned, subject to City of Douglas and FAA approval).
// Loaded before client.js. Classic script: never declare top-level const/let/var here, register on window only.
//
// What this module builds (PLAN mode only, through window.PLAN_HOOKS):
//   The Crossing (Crossing Plaza to the Expanse Gate, under the City parallel taxiway and Runway 03/21) and the Flight Line
//   Link (Link Plaza to Propeller Plaza, under the main taxiway): open ramps at both ends (the ground mesh is cut away in its
//   shader over the ramps and the ramp deck is the walkable floor through window.PLAN_FLOOR, so no terrain is re-graded and
//   the 4.7 m terrain grid never shows as a slope in the trench), concrete retaining walls with planted tops, a portal at
//   every ramp head, the covered boxes as lit interiors (timber slat walls with a timeline mural, a moving walkway, the
//   shuttle lane, planted wall bays, trailblazer markers) and the Runway Hall at the middle of The Crossing with its LED
//   ceiling showing a jet rolling overhead. Walking into a portal boards the shuttle: fade, the ride, and you step out at the
//   other portal (at the Expanse Gate facing straight down Main Street at the Ring). SPACE on the ride skips ahead.
//   Arrival set pieces: the Sun Gate, the Welcome Fountain, the Club Walk arcade canopy and median kerbs, the Rabbit, the
//   1928 biplane on its plinth and a replica beacon at Crossing Plaza, the Frontier Arch, the Frontier Well, the Flight
//   Deck terrace.
// Client globals are reached by bare name at call time (never window.X for client consts). window.PLAN_CROSSING exposes
// the state and a debug API (debug.ride(id, end, fraction), debug.stop()).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  const HOOKS = window.PLAN_HOOKS;
  const APPROVAL = "Shuttles run every few minutes", APPROVAL_LC = "shuttles run every few minutes";
  // ids the core layout and the sign module leave to this module: the fountains rebuilt here as set pieces, the airfield
  // portal signs (they hang in the portals), every in-tunnel trailblazer and the Runway Hall kiosk (mounted on the walls)
  const SKIP = ["welcome", "rabbit", "frontier_well", "deck_f", "sg583", "sg584", "sg585", "sg586"];
  for (let i = 540; i <= 552; i++) SKIP.push("sg" + i);
  { let S = window.PLAN_SKIP; if (!S) S = window.PLAN_SKIP = new Set(); for (const id of SKIP) { if (typeof S.add === "function") S.add(id); else if (Array.isArray(S) && !S.includes(id)) S.push(id); } }
  // new model kinds this module places (loadModels loads a plan kind only when something declares or uses it)
  { const N = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || []; for (const k of ["sun_gate", "portal_arch", "frontier_arch", "frontier_well", "biplane", "agave_cluster", "yucca_cluster"]) if (N.indexOf(k) < 0) N.push(k); }

  const PC = window.PLAN_CROSSING = { tunnels: [], ramps: [], ride: null, built: {}, errors: [], redraw: [], set: {}, stats: {} };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const safe = (name, fn) => { try { return fn(); } catch (e) { PC.errors.push(name + ": " + (e && e.message)); console.warn("plan_crossing " + name + " failed", e); return null; } };
  const rnd2 = (() => { let s = 1234567; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();   // own RNG: never shifts the world's seeded sequence
  // the terrain without any plan interior floor (the ground mesh height)
  function grade(x, z) { if (H && T && x > T.xmin && x < T.xmax && z > T.zmin && z < T.zmax) return sampleGrid(H, T, x, z); const f = window.PLAN_FLOOR; window.PLAN_FLOOR = null; try { return getH(x, z); } finally { window.PLAN_FLOOR = f; } }
  // the walkable surface outside the trenches (ground plus ribbon lift); valid once the ribbons are built (defer)
  function surface(x, z) { return planGroundAt(x, z); }
  const hasModel = (k) => typeof MODELS !== "undefined" && !!MODELS[k] && !!MODELS[k].parts && MODELS[k].parts.length > 0;

  // ───────────────────────── geometry kit (merged per material, world coordinates) ─────────────────────────
  function Geo() { this.p = []; this.u = []; this.n = []; this.i = []; }
  Geo.prototype.quad = function (a, b, c, d, ua, ub, uc, ud) {
    const o = this.p.length / 3; this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]);
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = d[0] - a[0], fy = d[1] - a[1], fz = d[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    for (let k = 0; k < 4; k++) this.n.push(nx, ny, nz); this.i.push(o, o + 1, o + 2, o, o + 2, o + 3); return this; };
  // an oriented box: centre c [x, y, z], half sizes, yaw about y; uv in metres per `tile`
  Geo.prototype.box = function (c, hx, hy, hz, yaw, tile) { const cs = Math.cos(yaw || 0), sn = Math.sin(yaw || 0), k = tile || 1;
    const P = (lx, ly, lz) => [c[0] + lx * cs + lz * sn, c[1] + ly, c[2] - lx * sn + lz * cs];
    const x0 = -hx, x1 = hx, y0 = -hy, y1 = hy, z0 = -hz, z1 = hz; const W = 2 * hx / k, Hh = 2 * hy / k, D = 2 * hz / k;
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0], [W, 0], [W, Hh], [0, Hh]);
    this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [0, 0], [W, 0], [W, Hh], [0, Hh]);
    this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [0, 0], [D, 0], [D, Hh], [0, Hh]);
    this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [0, 0], [D, 0], [D, Hh], [0, Hh]);
    this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [0, 0], [W, 0], [W, D], [0, D]);
    this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, 0], [W, 0], [W, D], [0, D]); return this; };
  // any three.js geometry, transformed by a matrix
  Geo.prototype.add = function (geo, m) { const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m) g.applyMatrix4(m); if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv; const o = this.p.length / 3;
    for (let i = 0; i < p.count; i++) { this.p.push(p.getX(i), p.getY(i), p.getZ(i)); this.n.push(n.getX(i), n.getY(i), n.getZ(i)); this.u.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); this.i.push(o + i); } g.dispose(); geo.dispose(); return this; };
  // a round rod between two points
  Geo.prototype.rod = function (a, b, r, seg) { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const L = Math.hypot(dx, dy, dz); if (L < 1e-4) return this; const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L)); const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)); return this.add(new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true), m); };
  Geo.prototype.mesh = function (mat, opts) { if (!this.i.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.userData.noInst = true; const o = opts || {}; m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false; if (o.noShadow) m.userData.noShadow = true; if (o.order) m.renderOrder = o.order; return m; };
  const mtx = (x, y, z, ry, rx, rz, s) => { const m = new THREE.Matrix4(); const sv = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s || 1, s || 1, s || 1); m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, "YXZ")), sv); return m; };
  function group(name, interior) { const g = new THREE.Group(); g.name = name; g.userData.noInst = true; g.userData.noCull = true; if (interior) g.userData.interior = true; return g; }

  // ───────────────────────── canvas textures (redrawn once the web fonts have loaded) ─────────────────────────
  function canvasTex(w, h, draw, o) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; const opt = o || {}; if (opt.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (opt.text) t.userData.text = true;
    if (opt.fonts) PC.redraw.push(() => { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, w, h); draw(x, w, h); t.needsUpdate = true; }); return t; }
  const FONT = { d: "Anton, Impact, sans-serif", b: "'Space Grotesk', system-ui, sans-serif", m: "'JetBrains Mono', ui-monospace, monospace" };
  function fitText(x, text, maxW, size, font, weight) { let s = Math.round(size); x.font = `${weight || 400} ${s}px ${font}`; while (s > 8 && x.measureText(text).width > maxW) { s -= 2; x.font = `${weight || 400} ${s}px ${font}`; } return s; }
  function wrapLines(x, text, maxW) { const words = String(text).split(" "); const out = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
  function speckle(x, w, h, n, cols) { for (let i = 0; i < n; i++) { x.fillStyle = cols[i % cols.length]; const r = 0.6 + rnd2() * 1.6; x.fillRect(rnd2() * w, rnd2() * h, r, r); } }
  function textMat(tex, o) { const opt = o || {}; const m = new THREE.MeshStandardMaterial({ map: tex, transparent: !!opt.transparent, roughness: opt.rough || 0.75, metalness: 0, side: opt.side || THREE.FrontSide, emissive: new THREE.Color(opt.glow ? 0xffffff : 0x000000), emissiveMap: opt.glow ? tex : null, emissiveIntensity: 0, depthWrite: !opt.transparent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); if (opt.glow) PC.glowMats.push([m, opt.glow]); return m; }
  PC.glowMats = [];

  const TX = {};
  function textures() {
    if (TX.ready) return TX; TX.ready = true;
    TX.concrete = canvasTex(512, 512, (x, w, h) => { x.fillStyle = "#bcb5aa"; x.fillRect(0, 0, w, h); const rows = 14, rh = h / rows;
      for (let r = 0; r < rows; r++) { const k = (rnd2() - 0.5) * 16; x.fillStyle = `rgb(${188 + k},${181 + k},${170 + k})`; x.fillRect(0, r * rh, w, rh); for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(60,50,40,${0.02 + rnd2() * 0.04})`; x.fillRect(rnd2() * w, r * rh + rnd2() * rh, 20 + rnd2() * 120, 1); } x.fillStyle = "rgba(40,34,28,.22)"; x.fillRect(0, r * rh, w, 1.5); }
      x.fillStyle = "rgba(40,34,28,.35)"; for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) { x.beginPath(); x.arc(40 + i * 86, 18 + j * rh * 2, 3, 0, 6.283); x.fill(); } speckle(x, w, h, 1400, ["rgba(0,0,0,.08)", "rgba(255,255,255,.08)"]); }, { repeat: true });
    TX.pavers = canvasTex(512, 512, (x, w, h) => { x.fillStyle = "#9e958a"; x.fillRect(0, 0, w, h); const pw = 128, ph = 64;
      for (let r = 0; r < h / ph; r++) for (let c = -1; c < w / pw + 1; c++) { const ox = (r % 2) * pw / 2; const k = (rnd2() - 0.5) * 18; x.fillStyle = `rgb(${214 + k},${202 + k},${184 + k})`; x.fillRect(c * pw + ox + 2, r * ph + 2, pw - 4, ph - 4); }
      speckle(x, w, h, 2200, ["rgba(90,70,50,.10)", "rgba(255,255,255,.10)"]); }, { repeat: true });
    TX.guide = canvasTex(256, 256, (x, w, h) => { x.fillStyle = "#7b766f"; x.fillRect(0, 0, w, h); x.fillStyle = "#615d58"; x.fillRect(w * 0.2, 0, w * 0.12, h); x.fillRect(w * 0.68, 0, w * 0.12, h); x.fillStyle = "rgba(30,28,26,.45)"; x.fillRect(0, 0, w, 2); speckle(x, w, h, 900, ["rgba(0,0,0,.12)", "rgba(255,255,255,.08)"]); }, { repeat: true });
    // warm timber slats with the cove light baked in: u = 2 m of wall, v = floor (0) to ceiling (1)
    TX.slats = canvasTex(512, 1024, (x, w, h) => { const n = 25, sw = w / n; for (let i = 0; i < n; i++) { const k = (rnd2() - 0.5) * 26; x.fillStyle = `rgb(${178 + k},${118 + k * 0.8},${68 + k * 0.5})`; x.fillRect(i * sw, 0, sw, h); for (let g = 0; g < 26; g++) { x.fillStyle = `rgba(80,45,20,${0.05 + rnd2() * 0.07})`; x.fillRect(i * sw + rnd2() * sw, rnd2() * h, 1, 30 + rnd2() * 160); } x.fillStyle = "rgb(34,22,14)"; x.fillRect(i * sw + sw - 3, 0, 3, h); }
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(0,0,0,.62)"); g.addColorStop(0.035, "rgba(0,0,0,.18)"); g.addColorStop(0.1, "rgba(0,0,0,0)"); g.addColorStop(0.55, "rgba(0,0,0,.12)"); g.addColorStop(0.9, "rgba(0,0,0,.34)"); g.addColorStop(1, "rgba(0,0,0,.55)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      const gl = x.createLinearGradient(0, 0, 0, h * 0.35); gl.addColorStop(0, "rgba(255,190,120,0)"); gl.addColorStop(0.12, "rgba(255,196,130,.34)"); gl.addColorStop(1, "rgba(255,196,130,0)"); x.globalCompositeOperation = "lighter"; x.fillStyle = gl; x.fillRect(0, 0, w, h * 0.35); x.globalCompositeOperation = "source-over"; }, { repeat: true });
    TX.floor = canvasTex(512, 512, (x, w, h) => { x.fillStyle = "#d8d1c3"; x.fillRect(0, 0, w, h); speckle(x, w, h, 5200, ["rgba(90,80,70,.35)", "rgba(255,255,255,.5)", "rgba(150,120,90,.35)", "rgba(40,40,40,.25)"]); x.fillStyle = "rgba(120,110,95,.55)"; x.fillRect(0, 0, w, 2); x.fillRect(0, h / 2, w, 1); x.fillRect(0, 0, 2, h); }, { repeat: true });
    TX.ceiling = canvasTex(256, 256, (x, w, h) => { x.fillStyle = "#34363a"; x.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "#2a2c2f" : "#3a3c40"; x.fillRect(i * w / 16, 0, w / 16 - 1, h); } x.fillStyle = "rgba(0,0,0,.4)"; x.fillRect(0, 0, w, 2); }, { repeat: true });
    TX.belt = canvasTex(128, 128, (x, w, h) => { x.fillStyle = "#262628"; x.fillRect(0, 0, w, h); for (let i = 0; i < 24; i++) { x.fillStyle = "#3b3b3f"; x.fillRect(i * w / 24, 0, 2, h); } x.fillStyle = "#18181a"; x.fillRect(0, 0, w, 3); x.fillRect(0, h * 0.4, w, 2); }, { repeat: true });
    TX.bay = canvasTex(128, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#fff0cc"); g.addColorStop(0.25, "#e8c48e"); g.addColorStop(1, "#6a4a30"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    TX.grate = canvasTex(128, 128, (x, w, h) => { x.fillStyle = "#2c2a27"; x.fillRect(0, 0, w, h); x.fillStyle = "#11100e"; for (let i = 0; i < 8; i++) x.fillRect(i * 16 + 4, 8, 8, h - 16); x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(0, 0, w, 3); }, { repeat: true });
    TX.timber = canvasTex(256, 256, (x, w, h) => { for (let i = 0; i < 8; i++) { const k = (rnd2() - 0.5) * 24; x.fillStyle = `rgb(${142 + k},${104 + k},${70 + k})`; x.fillRect(0, i * h / 8, w, h / 8 - 2); for (let g = 0; g < 30; g++) { x.fillStyle = "rgba(60,36,18,.12)"; x.fillRect(rnd2() * w, i * h / 8 + rnd2() * h / 8, 20 + rnd2() * 80, 1); } x.fillStyle = "#3a2616"; x.fillRect(0, (i + 1) * h / 8 - 2, w, 2); } }, { repeat: true });
    return TX;
  }

  // ───────────────────────── materials ─────────────────────────
  const MT = {};
  function mats() {
    if (MT.ready) return MT; MT.ready = true; const t = textures();
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide }, o));
    const basic = (o) => new THREE.MeshBasicMaterial(Object.assign({ side: THREE.DoubleSide }, o));
    MT.concrete = std({ map: t.concrete, color: 0xe9e0d2, roughness: 0.92 });
    MT.coping = std({ color: 0xd8d0c2, roughness: 0.8 });
    MT.pavers = std({ map: t.pavers, roughness: 0.88 });
    MT.guide = std({ map: t.guide, roughness: 0.9 });
    MT.steel = std({ color: 0x9aa3aa, roughness: 0.38, metalness: 0.75 });
    MT.dark = std({ color: 0x2a2d31, roughness: 0.55, metalness: 0.4 });
    MT.white = std({ color: 0xf2efe8, roughness: 0.45, metalness: 0.1 });
    MT.glass = std({ color: 0x9fbfd0, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.2 });
    MT.bronze = std({ color: 0x8f5d2c, roughness: 0.32, metalness: 0.85 });
    MT.timber = std({ map: t.timber, roughness: 0.85 });
    MT.grate = std({ map: t.grate, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MT.fabric = std({ color: 0xf6f3ea, roughness: 0.9 });
    MT.led = basic({ color: 0xffe6b8 });
    MT.bulb = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd89a, emissiveIntensity: 0, roughness: 0.4 }); PC.glowMats.push([MT.bulb, 2.2]);
    // the interiors are their own lit world: unlit materials with the lighting baked into the textures
    MT.iSlats = basic({ map: t.slats });
    MT.iFloor = basic({ map: t.floor, color: 0xe6e0d4 });
    MT.iGuide = basic({ map: t.guide, color: 0x9a948b });
    MT.iCeil = basic({ map: t.ceiling });
    MT.iLight = basic({ color: 0xfff3dc });
    MT.iSteel = basic({ color: 0x9ea4a8 });
    MT.iSteelD = basic({ color: 0x5d6368 });
    MT.iRail = basic({ color: 0x151515 });
    MT.iBelt = basic({ map: t.belt, color: 0xb4b4b4 });
    MT.iBay = basic({ map: t.bay });
    MT.iPlanter = basic({ color: 0x4a4038 });
    MT.iSoil = basic({ color: 0x3a2a1c });
    MT.iBench = basic({ color: 0x8a5e3a });
    MT.iConc = basic({ map: t.concrete, color: 0xbdb6aa });
    return MT;
  }

  // ───────────────────────── polylines ─────────────────────────
  function resample(pts, step) {
    const out = []; let u = 0;
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; const n = Math.max(1, Math.ceil(L / step)); for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, u: u + L * t }); } u += L; }
    const e = pts[pts.length - 1]; out.push({ x: e[0], z: e[1], u });
    for (let i = 0; i < out.length; i++) { const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)]; let dx = q.x - p.x, dz = q.z - p.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; out[i].dx = dx; out[i].dz = dz; out[i].nx = -dz; out[i].nz = dx; }
    return out;
  }
  const polyLen = (pts) => { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; };
  function atLen(pts, u) { let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc + L >= u || i === pts.length - 2) { const t = L > 0 ? clamp((u - acc) / L, 0, 1) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)]; } acc += L; } const e = pts[pts.length - 1]; return [e[0], e[1], 1, 0]; }
  // nearest point on a polyline: { along, lat, d } (lat > 0 on the right of travel)
  function polyLocal(pts, x, z) { let acc = 0, best = null; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; const t = (x - a[0]) * ux + (z - a[1]) * uz; const tc = clamp(t, 0, L); const d = Math.hypot(x - (a[0] + ux * tc), z - (a[1] + uz * tc)); if (!best || d < best.d) best = { along: acc + t, lat: (x - a[0]) * -uz + (z - a[1]) * ux, d, ux, uz }; acc += L; } return best; }

  // ───────────────────────── the two tunnels (from the plan data) ─────────────────────────
  // A ramp runs from its mouth (u = 0, at the covered box) to its head (u = L, the portal at the plaza level).
  function makeRamp(id, pts, hw) { const L = polyLen(pts); const segs = []; let u0 = 0;
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a, b, len, u0, tMin: i === 0 ? 0 : -0.8 / len, tMax: i === pts.length - 2 ? 1 : 1 + 0.8 / len }); u0 += len; }
    let bb = [1e9, -1e9, 1e9, -1e9]; for (const p of pts) bb = [Math.min(bb[0], p[0] - hw - 3), Math.max(bb[1], p[0] + hw + 3), Math.min(bb[2], p[1] - hw - 3), Math.max(bb[3], p[1] + hw + 3)];
    const hd = atLen(pts, L); return { id, pts, hw, L, segs, bb, head: pts[pts.length - 1], out: [hd[2], hd[3]], fMouth: null, fHead: null }; }
  // (x, z) -> { u, t } in ramp coordinates when inside the trench (|t| <= hw + pad, 0 <= u <= L), else null
  function rampLocal(R, x, z, pad) { if (x < R.bb[0] || x > R.bb[1] || z < R.bb[2] || z > R.bb[3]) return null; const hw = R.hw + (pad || 0);
    for (const s of R.segs) { const vx = s.b[0] - s.a[0], vz = s.b[1] - s.a[1]; const t = ((x - s.a[0]) * vx + (z - s.a[1]) * vz) / (s.len * s.len); if (t < s.tMin || t > s.tMax) continue; const lat = ((x - s.a[0]) * -vz + (z - s.a[1]) * vx) / s.len; if (Math.abs(lat) > hw) continue; const u = s.u0 + t * s.len; if (u < -0.01 || u > R.L + 0.01) continue; return { u: clamp(u, 0, R.L), t: lat }; }
    return null; }
  const rampFloor = (R, u) => R.fMouth === null ? null : R.fMouth + (R.fHead - R.fMouth) * clamp(u / R.L, 0, 1);

  function defineTunnels() {
    const P = window.PLAN; const road = (id) => (P.roads || []).find((r) => r.id === id);
    const out = [];
    // The Crossing: the plan road runs Crossing Plaza, north mouth, south mouth, the curved south ramp, south ramp head, Expanse Gate
    { const r = road("the_crossing"); const pts = r && r.pts && r.pts.length >= 5 ? r.pts : null; const hw = (r ? r.width : 14) / 2;
      const mN = pts ? pts[1] : along(-450, 112), mS = pts ? pts[2] : along(-450, -112);
      const plaza = pts ? pts[0] : along(-450, 240), gate = pts ? pts[pts.length - 1] : [613.5, 40.3];
      const dN = [plaza[0] - mN[0], plaza[1] - mN[1]]; const lN = Math.hypot(dN[0], dN[1]); const headN = [mN[0] + dN[0] / lN * 85, mN[1] + dN[1] / lN * 85];
      const rampS = pts ? pts.slice(2, pts.length - 1) : [mS, along(-450, -197)];
      out.push({ id: "crossing", name: "The Crossing", hw, clear: 5.0, hall: { w0: 100, w1: 124, hw2: 15, clear2: 6.2 }, A: mN, B: mS, plazaA: plaza, plazaB: gate, cartScale: 1,
        ramps: [makeRamp("crossing_n", [mN, headN], hw), makeRamp("crossing_s", rampS, hw)], vmax: 16.5, lanes: { guide: 2.8, belt: [-6.15, -3.55] }, bays: [40, 70, 154, 184],
        title: "THE CROSSING SHUTTLE", ends: ["Crossing Plaza", "the Expanse Gate"], faceTo: [null, gate] }); }
    // The Flight Line Link: the plan road runs ramp head to ramp head; the covered box is the middle 60 m under the main taxiway
    { const r = road("flight_line_link"); const pts = r && r.pts && r.pts.length >= 2 ? r.pts : [[-118, -55], [-118, 175]]; const hw = (r ? r.width : 10) / 2;
      const a = pts[0], b = pts[pts.length - 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L; const rl = Math.min(85, (L - 30) / 2);
      const mN = [a[0] + dx * rl, a[1] + dz * rl], mS = [b[0] - dx * rl, b[1] - dz * rl];
      const lp = planPlace("link_plaza"), pp = planPlace("propeller_plaza");
      out.push({ id: "link", name: "The Flight Line Link", hw, clear: 4.2, hall: null, A: mN, B: mS, plazaA: lp ? [lp.x, lp.z] : [a[0] - dx * 15, a[1] - dz * 15], plazaB: pp ? [pp.x, pp.z] : [b[0] + dx * 50, b[1] + dz * 50], cartScale: 0.86,
        ramps: [makeRamp("link_n", [mN, a], hw), makeRamp("link_s", [mS, b], hw)], vmax: 11, lanes: { guide: 2.2, belt: [-4.55, -2.75] }, bays: [30],
        title: "THE FLIGHT LINE LINK", ends: ["Link Plaza", "Propeller Plaza"], faceTo: [null, null] }); }
    for (const T0 of out) { const dx = T0.B[0] - T0.A[0], dz = T0.B[1] - T0.A[1]; T0.Lb = Math.hypot(dx, dz); T0.d = [dx / T0.Lb, dz / T0.Lb]; T0.r = [-T0.d[1], T0.d[0]]; for (const R of T0.ramps) R.T = T0; PC.ramps.push(...T0.ramps); }
    return out;
  }
  // box-local (w along A -> B, t to the right, y up) -> world [x, y, z]
  const boxP = (T0, w, t, y) => [T0.A[0] + T0.d[0] * w + T0.r[0] * t, y, T0.A[1] + T0.d[1] * w + T0.r[1] * t];
  const boxFloor = (T0, w) => T0.FA + (T0.FB - T0.FA) * clamp(w / T0.Lb, 0, 1);

  // the floor inside a trench: getH (walking, the camera floor) reads it through PLAN_FLOOR; the last 0.3 m of each head stays
  // on the ground so the approach ribbons and the ramp heads meet without a step
  function trenchFloor(x, z) { for (const R of PC.ramps) { if (R.fMouth === null) continue; const l = rampLocal(R, x, z); if (l && l.u <= R.L - 0.3) return rampFloor(R, l.u); } return null; }
  function installFloor() { const prev = window.PLAN_FLOOR; if (prev && prev.b3) return; const f = function (x, z) { const v = trenchFloor(x, z); if (v !== null) return v; return prev ? prev(x, z) : null; }; f.b3 = true; window.PLAN_FLOOR = f; }

  // final floor heights: each ramp head meets its approach surface, 1 in 13 where the cover allows it, the box under the
  // runway and taxiway with at least its clear height plus 0.9 m of slab and cover
  function profiles() {
    for (const T0 of PC.tunnels) { const need = T0.clear + 0.9, needHall = T0.hall ? T0.hall.clear2 + 0.7 : need;
      const [rA, rB] = T0.ramps; for (const R of [rA, rB]) { const hx = R.head[0] + R.out[0] * 1.2, hz = R.head[1] + R.out[1] * 1.2; R.fHead = Math.max(grade(R.head[0], R.head[1]), surface(hx, hz)); }
      let FA = Math.min(rA.fHead - rA.L / 13, grade(T0.A[0], T0.A[1]) - need), FB = Math.min(rB.fHead - rB.L / 13, grade(T0.B[0], T0.B[1]) - need);
      for (let it = 0; it < 4; it++) { let worst = 0; for (let w = 0; w <= T0.Lb; w += 4) { const f = FA + (FB - FA) * w / T0.Lb; const inHall = T0.hall && w > T0.hall.w0 - 1 && w < T0.hall.w1 + 1; let gmin = 1e9; for (const t of [-T0.hw - 0.5, 0, T0.hw + 0.5].concat(inHall ? [-T0.hall.hw2 - 0.5, T0.hall.hw2 + 0.5] : [])) { const q = boxP(T0, w, t, 0); gmin = Math.min(gmin, grade(q[0], q[2])); } const v = f - (gmin - (inHall ? needHall : need)); if (v > worst) worst = v; } if (worst <= 0.01) break; FA -= worst; FB -= worst; }
      T0.FA = FA; T0.FB = FB; rA.fMouth = FA; rB.fMouth = FB;
      PC.stats[T0.id] = { floorA: +FA.toFixed(2), floorB: +FB.toFixed(2), headA: +rA.fHead.toFixed(2), headB: +rB.fHead.toFixed(2), slopeA: +((rA.fHead - FA) / rA.L).toFixed(3), slopeB: +((rB.fHead - FB) / rB.L).toFixed(3), box: +T0.Lb.toFixed(1) }; } }

  // ───────────────────────── the ground cut (shader discard over the open ramps) ─────────────────────────
  const CUT = { uni: null };
  function cutUniforms() { if (CUT.uni) return CUT.uni; const seg = [], par = []; for (const R of PC.ramps) for (const s of R.segs) { seg.push(new THREE.Vector4(s.a[0], s.a[1], s.b[0], s.b[1])); par.push(new THREE.Vector4(R.hw + 0.2, s.tMin, s.tMax, 0)); } while (seg.length < 16) { seg.push(new THREE.Vector4(0, 0, 0, 0)); par.push(new THREE.Vector4(0, 0, 0, 0)); }
    let bb = [1e9, -1e9, 1e9, -1e9]; for (const R of PC.ramps) bb = [Math.min(bb[0], R.bb[0]), Math.max(bb[1], R.bb[1]), Math.min(bb[2], R.bb[2]), Math.max(bb[3], R.bb[3])];
    CUT.uni = { uB3Seg: { value: seg.slice(0, 16) }, uB3Par: { value: par.slice(0, 16) }, uB3BB: { value: new THREE.Vector4(bb[0], bb[1], bb[2], bb[3]) } }; return CUT.uni; }
  const CUT_GLSL = "uniform vec4 uB3Seg[16]; uniform vec4 uB3Par[16]; uniform vec4 uB3BB; varying vec2 vB3W;\nbool b3Cut(vec2 p) { if (p.x < uB3BB.x || p.x > uB3BB.y || p.y < uB3BB.z || p.y > uB3BB.w) return false; for (int i = 0; i < 16; i++) { vec4 s = uB3Seg[i]; vec4 q = uB3Par[i]; if (q.x <= 0.0) continue; vec2 a = s.xy; vec2 v = s.zw - s.xy; float L2 = max(dot(v, v), 1e-4); float t = dot(p - a, v) / L2; if (t < q.y || t > q.z) continue; float lat = abs((p.x - a.x) * -v.y + (p.y - a.y) * v.x) / sqrt(L2); if (lat <= q.x) return true; } return false; }";
  function cutShader(sh) { Object.assign(sh.uniforms, cutUniforms()); if (sh.vertexShader.indexOf("vB3W") >= 0) return;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vB3W;").replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 b3w = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n b3w = instanceMatrix * b3w;\n#endif\n vB3W = (modelMatrix * b3w).xz; }");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + CUT_GLSL).replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n if (b3Cut(vB3W)) discard;"); }
  function installCut() {
    const gm = typeof GROUND_MATS !== "undefined" ? GROUND_MATS : []; let n = 0;
    gm.forEach((m, i) => { if (!m || m.userData.b3cut) return; m.userData.b3cut = true; chainObc(m, cutShader); m.customProgramCacheKey = () => "b3ground" + i; m.needsUpdate = true; n++; });
    // the ground casts shadows on the cascaded tiers: its shadow gets the same hole
    scene.traverse((o) => { if (!o.isMesh || gm.indexOf(o.material) < 0 || o.customDepthMaterial) return; const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dm.onBeforeCompile = cutShader; dm.customProgramCacheKey = () => "b3grounddepth"; o.customDepthMaterial = dm; });
    PC.stats.cutMats = n; return n; }

  // ───────────────────────── world hook: footprints, keep-outs, clearing, approaches, planting ─────────────────────────
  function trenchPoly(R, pad) { const S = resample(R.pts, 4); const L = [], Rr = []; for (const s of S) { L.push([s.x - s.nx * (R.hw + pad), s.z - s.nz * (R.hw + pad)]); Rr.push([s.x + s.nx * (R.hw + pad), s.z + s.nz * (R.hw + pad)]); } return L.concat(Rr.reverse()); }
  function inAnyTrench(x, z, pad) { for (const R of PC.ramps) if (rampLocal(R, x, z, pad)) return R; return null; }
  // remove anything the core layout set down where a trench now is (furniture, allee trees, bollards); plan buildings stay
  function clearWhere(test) { let removed = 0; const gone = [];
    for (const kind in PLACE) { const L = PLACE[kind]; for (let i = L.length - 1; i >= 0; i--) { const e = L[i]; if (e.plan) continue; if (test(e[0], e[2], kind)) { gone.push([e[0], e[2]]); L.splice(i, 1); removed++; } } }
    if (gone.length) for (let i = COLLIDERS.length - 1; i >= 0; i--) { const c = COLLIDERS[i]; if (gone.some((g) => Math.abs(g[0] - c[0]) < 0.01 && Math.abs(g[1] - c[1]) < 0.01)) COLLIDERS.splice(i, 1); }
    if (typeof SOLAR !== "undefined") for (let i = SOLAR.pts.length - 1; i >= 0; i--) { const p = SOLAR.pts[i]; if (test(p[0], p[1], "solar")) { SOLAR.pts.splice(i, 1); removed++; } }
    return removed; }
  // the paved approach from each portal plaza centre to its ramp head (the first and last legs of the plan's tunnel roads)
  function approaches() { const PMs = planMats(); for (const T0 of PC.tunnels) { for (const [R, pz] of [[T0.ramps[0], T0.plazaA], [T0.ramps[1], T0.plazaB]]) { const d = Math.hypot(pz[0] - R.head[0], pz[1] - R.head[1]); if (d < 3 || d > 70) continue; const mid = [(pz[0] + R.head[0]) / 2, (pz[1] + R.head[1]) / 2]; if (planNearRoad(mid[0], mid[1], -1)) continue; planRibbon([[pz[0], pz[1]], [R.head[0], R.head[1]]], R.hw * 2, { mat: PMs.stone, lift: 0.36, tile: 4.5 }, R.id + "_approach"); R.approach = true; } } }
  // portal gardens: agave, yucca and ocotillo along the planted tops of the ramp walls
  function gardens() { let n = 0; const kinds = ["agave_cluster", "yucca_cluster", "agave_cluster", "ocotillo", "bush2"].filter((k) => hasModel(k)); if (!kinds.length) return 0; let k = 0;
    for (const R of PC.ramps) { const S = resample(R.pts, 4.5); for (const s of S) { if (s.u < 7 || s.u > R.L - 14) continue; for (const sd of [-1, 1]) { const off = R.hw + 1.75 + (k % 3) * 0.35; const x = s.x + s.nx * off * sd, z = s.z + s.nz * off * sd; k++; if (!planSpotOK(x, z, 0.7)) continue; const kind = kinds[k % kinds.length]; put(kind, x, z, rnd2() * 6.283, (kind === "ocotillo" ? 0.7 : 0.85) + rnd2() * 0.3); PLACE[kind][PLACE[kind].length - 1].keep = true; n++; } } }
    return n; }
  function worldHook() {
    PC.tunnels = defineTunnels(); installFloor();
    PC.cleared = clearWhere((x, z) => !!inAnyTrench(x, z, 1.6));
    approaches();
    for (const R of PC.ramps) planKeepout(trenchPoly(R, 1.2));
    for (const T0 of PC.tunnels) for (const m of [T0.A, T0.B]) KEEPOUT.push([m[0], m[1], T0.hw + 3]);
    PC.gardens = gardens();
    safe("setpieces (world)", setpiecesWorld);
    safe("hotspots", hotspotsWorld);
    PC.built.world = true;
  }

  // ───────────────────────── ramps: deck, lanes, walls, coping, headwalls, planted beds, solids ─────────────────────────
  function buildRamps() {
    const m = mats(); const g = { deck: new Geo(), guide: new Geo(), wall: new Geo(), coping: new Geo(), steel: new Geo(), led: new Geo(), bed: new Geo() };
    for (const T0 of PC.tunnels) { const gw = T0.lanes.guide;
      for (const R of T0.ramps) { const S = resample(R.pts, 2.0); const hw = R.hw;
        const Y = (s) => rampFloor(R, s.u); const P = (s, t, y) => [s.x + s.nx * t, y, s.z + s.nz * t];
        const topAt = (s, sd) => { const a = P(s, sd * (hw + 0.05), 0), b = P(s, sd * (hw + 0.5), 0); return Math.max(grade(a[0], a[2]), grade(b[0], b[2]) + 0.2, Y(s)) + 1.05; };
        for (let i = 0; i < S.length - 1; i++) { const s0 = S[i], s1 = S[i + 1]; const y0 = Y(s0) + 0.02, y1 = Y(s1) + 0.02;
          for (const [ta, tb] of [[-hw, -gw], [gw, hw]]) g.deck.quad(P(s0, ta, y0), P(s0, tb, y0), P(s1, tb, y1), P(s1, ta, y1), [ta / 4, s0.u / 4], [tb / 4, s0.u / 4], [tb / 4, s1.u / 4], [ta / 4, s1.u / 4]);
          g.guide.quad(P(s0, -gw, y0 - 0.06), P(s0, gw, y0 - 0.06), P(s1, gw, y1 - 0.06), P(s1, -gw, y1 - 0.06), [0, s0.u / 4], [1.4, s0.u / 4], [1.4, s1.u / 4], [0, s1.u / 4]);
          for (const sd of [-1, 1]) g.steel.quad(P(s0, sd * gw, y0 - 0.06), P(s1, sd * gw, y1 - 0.06), P(s1, sd * gw, y1), P(s0, sd * gw, y0), [0, 0], [1, 0], [1, 1], [0, 1]);
          g.steel.quad(P(s0, -0.07, y0 + 0.04), P(s0, 0.07, y0 + 0.04), P(s1, 0.07, y1 + 0.04), P(s1, -0.07, y1 + 0.04), [0, 0], [1, 0], [1, 1], [0, 1]);
          for (const sd of [-1, 1]) { const tIn = sd * hw, tOut = sd * (hw + 0.45); const top0 = topAt(s0, sd), top1 = topAt(s1, sd); const b0 = Y(s0) - 0.4, b1 = Y(s1) - 0.4;
            g.wall.quad(P(s0, tIn, b0), P(s1, tIn, b1), P(s1, tIn, top1), P(s0, tIn, top0), [s0.u / 4, b0 / 4], [s1.u / 4, b1 / 4], [s1.u / 4, top1 / 4], [s0.u / 4, top0 / 4]);
            const po0 = P(s0, tOut, 0), po1 = P(s1, tOut, 0); const go0 = grade(po0[0], po0[2]) - 0.5, go1 = grade(po1[0], po1[2]) - 0.5;
            g.wall.quad(P(s0, tOut, go0), P(s1, tOut, go1), P(s1, tOut, top1), P(s0, tOut, top0), [s0.u / 4, go0 / 4], [s1.u / 4, go1 / 4], [s1.u / 4, top1 / 4], [s0.u / 4, top0 / 4]);
            g.coping.quad(P(s0, tIn - sd * 0.06, top0), P(s1, tIn - sd * 0.06, top1), P(s1, tOut + sd * 0.06, top1), P(s0, tOut + sd * 0.06, top0), [0, 0], [1, 0], [1, 1], [0, 1]);
            g.coping.quad(P(s0, tIn - sd * 0.06, top0 - 0.12), P(s1, tIn - sd * 0.06, top1 - 0.12), P(s1, tIn - sd * 0.06, top1), P(s0, tIn - sd * 0.06, top0), [0, 0], [1, 0], [1, 1], [0, 1]);
            g.coping.quad(P(s0, tOut + sd * 0.06, top0 - 0.12), P(s1, tOut + sd * 0.06, top1 - 0.12), P(s1, tOut + sd * 0.06, top1), P(s0, tOut + sd * 0.06, top0), [0, 0], [1, 0], [1, 1], [0, 1]);
            if (top0 - Y(s0) > 1.7) { const ly0 = Math.min(top0 - 0.35, Y(s0) + 3.2), ly1 = Math.min(top1 - 0.35, Y(s1) + 3.2); g.led.quad(P(s0, tIn - sd * 0.03, ly0), P(s1, tIn - sd * 0.03, ly1), P(s1, tIn - sd * 0.03, ly1 + 0.06), P(s0, tIn - sd * 0.03, ly0 + 0.06), [0, 0], [1, 0], [1, 1], [0, 1]); }
            if (s0.u > 5 && s1.u < R.L - 1) { const ta = sd * (hw + 0.55), tb = sd * (hw + 3.3); const pa0 = P(s0, ta, 0), pb0 = P(s0, tb, 0), pa1 = P(s1, ta, 0), pb1 = P(s1, tb, 0); g.bed.quad([pa0[0], grade(pa0[0], pa0[2]) + 0.07, pa0[2]], [pb0[0], grade(pb0[0], pb0[2]) + 0.07, pb0[2]], [pb1[0], grade(pb1[0], pb1[2]) + 0.07, pb1[2]], [pa1[0], grade(pa1[0], pa1[2]) + 0.07, pa1[2]], [pa0[0] / 3, pa0[2] / 3], [pb0[0] / 3, pb0[2] / 3], [pb1[0] / 3, pb1[2] / 3], [pa1[0] / 3, pa1[2] / 3]); } } }
        // solids: both walls per straight run (tall enough that nobody jumps in), and a stop across the mouth
        for (let i = 0; i < R.pts.length - 1; i++) { const a = R.pts[i], b = R.pts[i + 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.5) continue; const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len; const ry = Math.atan2(ux, uz); const la = rampLocal(R, a[0], a[1]), lb = rampLocal(R, b[0], b[1]); const yb = Math.min(rampFloor(R, la ? la.u : 0), rampFloor(R, lb ? lb.u : R.L)) - 1; const yt = Math.max(grade(a[0], a[1]), grade(b[0], b[1])) + 2.6;
          for (const sd of [-1, 1]) { const off = sd * (R.hw + 0.22); addSolid((a[0] + b[0]) / 2 - uz * off, (a[1] + b[1]) / 2 + ux * off, ry, 0.46, len + 0.9, yb, Math.max(yt, yb + 3), "world"); } }
        { const m0 = R.pts[0], m1 = R.pts[1]; const len = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]); const ux = (m1[0] - m0[0]) / len, uz = (m1[1] - m0[1]) / len; addSolid(m0[0] - ux * 0.4, m0[1] - uz * 0.4, Math.atan2(ux, uz), R.hw * 2 + 1, 0.8, R.fMouth - 1, R.fMouth + T0.clear + 1, "world"); } }
      // headwalls over both mouths: from the box ceiling up to the parapet line, 1.2 m thick over the box
      for (const [R, sgn] of [[T0.ramps[0], -1], [T0.ramps[1], 1]]) { const f = R.fMouth; const yb = f + T0.clear; const w0 = sgn < 0 ? 0 : T0.Lb; const tops = [-T0.hw - 0.45, 0, T0.hw + 0.45].map((t) => { const p = boxP(T0, w0, t, 0); return grade(p[0], p[2]); }); const yt = Math.max(...tops) + 1.05;
        const Q = (w, t, y) => boxP(T0, w, t, y); const wa = w0, wb = w0 - sgn * 1.2; const hw2 = T0.hw + 0.45;
        g.wall.quad(Q(wa, -hw2, yb), Q(wa, hw2, yb), Q(wa, hw2, yt), Q(wa, -hw2, yt), [0, yb / 4], [hw2 / 2, yb / 4], [hw2 / 2, yt / 4], [0, yt / 4]);
        g.coping.quad(Q(wa + sgn * 0.06, -hw2, yt), Q(wa + sgn * 0.06, hw2, yt), Q(wb, hw2, yt), Q(wb, -hw2, yt), [0, 0], [1, 0], [1, 1], [0, 1]);
        g.wall.quad(Q(wb, -hw2, yb), Q(wb, hw2, yb), Q(wb, hw2, yt), Q(wb, -hw2, yt), [0, 0], [1, 0], [1, 1], [0, 1]);
        for (const sd of [-1, 1]) g.wall.quad(Q(wa, sd * hw2, yb), Q(wb, sd * hw2, yb), Q(wb, sd * hw2, yt), Q(wa, sd * hw2, yt), [0, 0], [1, 0], [1, 1], [0, 1]);
        g.led.quad(Q(wa + sgn * 0.02, -T0.hw, yb + 0.02), Q(wa + sgn * 0.02, T0.hw, yb + 0.02), Q(wa + sgn * 0.02, T0.hw, yb + 0.12), Q(wa + sgn * 0.02, -T0.hw, yb + 0.12), [0, 0], [1, 0], [1, 1], [0, 1]);
        R.headWall = { yb, yt, w: wa, sgn }; } }
    const grp = group("crossing_ramps");
    for (const [k, mat, cast] of [["deck", m.pavers, false], ["guide", m.guide, false], ["wall", m.concrete, true], ["coping", m.coping, true], ["steel", m.steel, false], ["led", m.led, false], ["bed", planMats().bed, false]]) { const me = g[k].mesh(mat, { cast }); if (me) grp.add(me); }
    scene.add(grp); PC.rampGroup = grp;
  }
  // lettering on the ramp side of each headwall: where the tunnel takes you
  function headwallText() { const grp = group("crossing_headwall_text");
    for (const T0 of PC.tunnels) { for (const [R, sgn, far] of [[T0.ramps[0], -1, 1], [T0.ramps[1], 1, 0]]) { const hwl = R.headWall; if (!hwl) continue; const h = Math.min(2.4, hwl.yt - hwl.yb - 0.4); if (h < 0.7) continue; const Wd = Math.min(T0.hw * 2 - 1.2, h * 6.5);
        const title = T0.id === "crossing" ? (far ? "THE EXPANSE" : "THE LANDING") : (far ? "THE FLIGHT LINE" : "ARRIVALS COURT");
        const sub = T0.id === "crossing" ? (far ? "STAGE THREE  ·  MAIN STREET AND THE GENESIS RING" : "STAGE ONE  ·  CROSSING PLAZA AND THE TERMINAL") : (far ? "STAGE TWO  ·  PROPELLER PLAZA" : "THE TERMINAL AND GENESIS PARK");
        const ch = Math.max(96, Math.round(1024 * h / Wd));
        const tex = canvasTex(1024, ch, (x, w, hh) => { x.textAlign = "center"; x.textBaseline = "middle"; const s = fitText(x, title, w * 0.92, hh * 0.6, FONT.d); x.fillStyle = "#2e2721"; x.font = `400 ${s}px ${FONT.d}`; x.fillText(title, w / 2, hh * 0.4); const s2 = fitText(x, sub, w * 0.9, hh * 0.15, FONT.b, 600); x.font = `600 ${s2}px ${FONT.b}`; x.fillStyle = "#4a3f33"; x.fillText(sub, w / 2, hh * 0.85); }, { text: true, fonts: true });
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(Wd, h), textMat(tex, { transparent: true })); const c = boxP(T0, hwl.w + sgn * 0.03, 0, hwl.yb + 0.2 + h / 2); pl.position.set(c[0], c[1], c[2]); pl.rotation.y = Math.atan2(T0.d[0] * sgn, T0.d[1] * sgn); pl.renderOrder = 2; grp.add(pl); } }
    scene.add(grp); }

  // ───────────────────────── the timeline mural and the markers ─────────────────────────
  const PANELS = [
    // The Crossing, north half: from the founding of Douglas to the 1928 airfield (read from Crossing Plaza toward the hall)
    { y: "FOUNDING", t: "A TOWN ON THE BORDER", s: "A town is laid out on the open flats of the wide valley, beside the border.", i: "town", th: "sepia" },
    { y: "COPPER", t: "THE SMELTER YEARS", s: "Copper from the mines up the road is smelted here, and the young town grows fast.", i: "smelter", th: "sepia" },
    { y: "RAIL", t: "RAILS AND RANCHES", s: "Trains, cattle and cotton tie the valley to the rest of the country.", i: "rail", th: "sepia" },
    { y: "1920s", t: "BARNSTORMERS", s: "Open cockpits and packed-earth strips: the first flyers land on the valley floor.", i: "biplane", th: "sepia" },
    { y: "1928", t: "WHEELS DOWN", s: "The airfield opens, and the town takes to the air.", i: "hangar", th: "sepia" },
    { y: "1928", t: "THE WINDSOCK AND THE HANGAR", s: "A packed-earth field, a hangar and a windsock: where this runway began.", i: "windsock", th: "sepia" },
    { y: "TODAY", t: "SUNFIELD", s: "The old airfield flies on as Sunfield, with Runway 03/21 at its heart.", i: "runway", th: "flight" },
    { y: "AHEAD", t: "THE RUNWAY HALL", s: "Look up in the hall: the LED ceiling shows the jets rolling overhead.", i: "jet", th: "flight" },
    // The Crossing, south half: the frontier ahead (read from the hall toward the Expanse Gate)
    { y: "NEXT", t: "THE FRONTIER AHEAD", s: "Stage Three, The Expanse: the Old West, desert modern and the off-world frontier.", i: "sun", th: "dusk" },
    { y: "OLD WEST", t: "MAIN STREET", s: "False fronts, timber boardwalks and the stagecoach, straight down to Four Corners.", i: "storefronts", th: "dusk" },
    { y: "RANCH", t: "THE FRONTIER RANCH", s: "Horses, a working ranch and the rodeo at The Corral, where the town meets open range.", i: "windmill", th: "dusk" },
    { y: "DESIGN", t: "THE DESIGN DISTRICT", s: "The Seven Gates, the galleries, the Field of Light and the Genesis Lodge.", i: "gates", th: "dusk" },
    { y: "AFTER DARK", t: "THE LAUNCH COMPLEX", s: "The Crater Bowl, the Star Cinema and the countdown clock under the stars.", i: "clock", th: "night" },
    { y: "10 TO 1", t: "THE OUTPOST", s: "Ten numbered rings count down along the Launch Walk to the Genesis Ring.", i: "rings", th: "night" },
    { y: "RING", t: "THE GENESIS RING", s: "When you surface, it stands at the far end of Main Street. Follow the brass line.", i: "ring", th: "night" },
    { y: "NOW", t: "GENESIS", s: "The Awakening: from the old airfield to the next frontier.", i: "sun", th: "dusk" },
    // The Flight Line Link (read from Link Plaza toward Propeller Plaza)
    { y: "STAGE TWO", t: "THE FLIGHT LINE", s: "Hangars, a flight school, the Pilot House and the Flight Line Diner.", i: "hangar", th: "flight" },
    { y: "1928", t: "WHEELS DOWN", s: "The airfield opens, and the flyers come in over the border country.", i: "biplane", th: "sepia" },
    { y: "ABOVE", t: "THE MAIN TAXIWAY", s: "Aircraft taxi overhead between the runway and the aprons.", i: "jet", th: "flight" },
    { y: "AHEAD", t: "PROPELLER PLAZA", s: "The Propeller Fountain, the Pilot House and the market street.", i: "prop", th: "flight" },
  ];
  const THEME = { sepia: ["#efe3c8", "#d9c49e", "#3a2716", "#6a4a2a", "#8a5a2c"], dusk: ["#f2b67a", "#3c2f52", "#fff3e0", "#ffe2bf", "#ffd08a"], night: ["#1d2748", "#060a18", "#e8f6ff", "#bfe6f5", "#6fd6e8"], flight: ["#e8eef0", "#b7c9d1", "#1d2a31", "#34464f", "#2fae57"] };
  function drawIcon(x, kind, cx, cy, s, col) {
    x.save(); x.translate(cx, cy); x.scale(s, s); x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 0.035; x.lineJoin = "round"; x.lineCap = "round";
    const R = (a, b, c, d) => x.fillRect(a, b, c, d); const line = (pts) => { x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.stroke(); };
    if (kind === "town") { R(-0.9, 0.1, 1.8, 0.04); [[-0.85, 0.35, 0.3], [-0.5, 0.5, 0.35], [-0.1, 0.28, 0.3], [0.25, 0.45, 0.28], [0.58, 0.32, 0.3]].forEach(([a, h, w]) => { R(a, 0.1 - h, w, h); x.clearRect(a + w * 0.3, -0.04, w * 0.25, 0.14); }); }
    else if (kind === "smelter") { R(-0.9, 0.12, 1.8, 0.04); R(-0.6, -0.1, 0.9, 0.22); R(0.2, -0.75, 0.12, 0.87); R(-0.35, -0.5, 0.1, 0.4); x.globalAlpha = 0.55; for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(0.3 + i * 0.12, -0.85 - i * 0.05, 0.08 + i * 0.03, 0, 6.283); x.fill(); } x.globalAlpha = 1; }
    else if (kind === "rail") { R(-0.95, 0.2, 1.9, 0.03); for (let i = 0; i < 10; i++) R(-0.9 + i * 0.19, 0.23, 0.08, 0.03); R(-0.7, -0.15, 0.8, 0.3); R(0.1, -0.35, 0.35, 0.5); R(-0.55, -0.4, 0.1, 0.25); [-0.55, -0.25, 0.25].forEach((a) => { x.beginPath(); x.arc(a, 0.17, 0.08, 0, 6.283); x.fill(); }); }
    else if (kind === "biplane") { R(-0.8, -0.28, 1.6, 0.06); R(-0.7, 0.05, 1.4, 0.06); line([-0.45, -0.22, -0.45, 0.05]); line([0.45, -0.22, 0.45, 0.05]); x.beginPath(); x.ellipse(0, -0.08, 0.55, 0.09, 0, 0, 6.283); x.fill(); line([0.6, -0.2, 0.6, 0.05]); R(-0.62, -0.18, 0.05, 0.16); line([-0.1, 0.05, -0.18, 0.25]); line([0.1, 0.05, 0.18, 0.25]); }
    else if (kind === "hangar") { R(-0.95, 0.25, 1.9, 0.04); x.beginPath(); x.moveTo(-0.7, 0.25); x.quadraticCurveTo(-0.7, -0.55, 0, -0.55); x.quadraticCurveTo(0.7, -0.55, 0.7, 0.25); x.fill(); x.clearRect(-0.35, -0.1, 0.7, 0.35); line([0.85, 0.25, 0.85, -0.55]); x.beginPath(); x.moveTo(0.85, -0.55); x.lineTo(1.1, -0.5); x.lineTo(1.1, -0.42); x.lineTo(0.85, -0.44); x.fill(); }
    else if (kind === "windsock") { R(-0.95, 0.3, 1.9, 0.03); line([-0.4, 0.3, -0.4, -0.7]); x.beginPath(); x.moveTo(-0.4, -0.7); x.lineTo(0.35, -0.6); x.lineTo(0.35, -0.48); x.lineTo(-0.4, -0.5); x.fill(); [-0.2, 0.1].forEach((a) => x.clearRect(a, -0.7, 0.1, 0.25)); }
    else if (kind === "runway") { x.beginPath(); x.moveTo(-0.25, -0.7); x.lineTo(0.25, -0.7); x.lineTo(0.8, 0.35); x.lineTo(-0.8, 0.35); x.fill(); x.fillStyle = "rgba(255,255,255,.85)"; for (let i = 0; i < 5; i++) { const y0 = -0.62 + i * 0.2; R(-0.02 - i * 0.004, y0, 0.04 + i * 0.008, 0.1); } }
    else if (kind === "jet") { x.beginPath(); x.ellipse(0, 0, 0.85, 0.1, 0, 0, 6.283); x.fill(); x.beginPath(); x.moveTo(-0.1, 0); x.lineTo(-0.45, -0.55); x.lineTo(-0.3, -0.55); x.lineTo(0.25, 0); x.lineTo(-0.3, 0.55); x.lineTo(-0.45, 0.55); x.fill(); x.beginPath(); x.moveTo(-0.7, 0); x.lineTo(-0.85, -0.25); x.lineTo(-0.75, -0.25); x.lineTo(-0.6, 0); x.lineTo(-0.75, 0.25); x.lineTo(-0.85, 0.25); x.fill(); }
    else if (kind === "sun") { x.beginPath(); x.arc(0, 0.2, 0.42, Math.PI, 0); x.fill(); for (let i = 0; i < 9; i++) { const a = Math.PI + (i + 0.5) / 9 * Math.PI; line([Math.cos(a) * 0.52, 0.2 + Math.sin(a) * 0.52, Math.cos(a) * 0.8, 0.2 + Math.sin(a) * 0.8]); } R(-0.95, 0.22, 1.9, 0.04); }
    else if (kind === "storefronts") { R(-0.95, 0.3, 1.9, 0.04); [[-0.9, 0.6], [-0.45, 0.8], [0.0, 0.55], [0.45, 0.75]].forEach(([a, h]) => { R(a, 0.3 - h, 0.4, h); x.clearRect(a + 0.1, 0.05, 0.2, 0.25); x.clearRect(a + 0.08, 0.3 - h + 0.12, 0.24, 0.08); }); }
    else if (kind === "windmill") { R(-0.95, 0.35, 1.9, 0.03); line([-0.25, 0.35, 0, -0.35, 0.25, 0.35]); line([-0.15, 0.1, 0.15, 0.1]); for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; line([0, -0.45, Math.cos(a) * 0.35, -0.45 + Math.sin(a) * 0.35]); } }
    else if (kind === "gates") { R(-0.95, 0.35, 1.9, 0.03); for (let i = 0; i < 4; i++) { const a = -0.8 + i * 0.45, h = 0.75 - i * 0.12; R(a, 0.35 - h, 0.06, h); R(a + 0.26, 0.35 - h, 0.06, h); R(a, 0.35 - h, 0.32, 0.06); } }
    else if (kind === "clock") { x.lineWidth = 0.05; x.beginPath(); x.arc(0, -0.05, 0.5, 0, 6.283); x.stroke(); x.font = "700 0.28px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("T-10", 0, -0.05); R(-0.95, 0.5, 1.9, 0.03); }
    else if (kind === "rings") { x.lineWidth = 0.045; for (let i = 0; i < 5; i++) { x.beginPath(); x.ellipse(-0.7 + i * 0.35, 0.05, 0.1 + i * 0.03, 0.3 + i * 0.08, 0, 0, 6.283); x.stroke(); } }
    else if (kind === "ring") { R(-0.95, 0.4, 1.9, 0.03); x.lineWidth = 0.09; x.beginPath(); x.arc(0, -0.15, 0.5, 0, 6.283); x.stroke(); x.beginPath(); x.moveTo(-0.3, 0.4); x.lineTo(0, 0.3); x.lineTo(0.3, 0.4); x.fill(); }
    else if (kind === "prop") { x.beginPath(); x.arc(0, 0, 0.1, 0, 6.283); x.fill(); for (let i = 0; i < 3; i++) { x.save(); x.rotate(i / 3 * 6.283); x.beginPath(); x.ellipse(0, -0.42, 0.1, 0.36, 0, 0, 6.283); x.fill(); x.restore(); } }
    x.restore(); }
  function drawPanel(x, X0, Y0, W, Hh, P) { const th = THEME[P.th] || THEME.sepia; const g = x.createLinearGradient(X0, Y0, X0 + W, Y0 + Hh); g.addColorStop(0, th[0]); g.addColorStop(1, th[1]); x.fillStyle = g; x.fillRect(X0, Y0, W, Hh);
    x.fillStyle = "rgba(0,0,0,.12)"; for (let i = 0; i < 120; i++) x.fillRect(X0 + rnd2() * W, Y0 + rnd2() * Hh, 1 + rnd2() * 3, 1);
    x.strokeStyle = th[4]; x.lineWidth = 5; x.strokeRect(X0 + 5, Y0 + 5, W - 10, Hh - 10); x.lineWidth = 1.5; x.strokeRect(X0 + 12, Y0 + 12, W - 24, Hh - 24);
    x.textBaseline = "middle"; x.textAlign = "left"; const ys = fitText(x, P.y, W * 0.24, Hh * 0.46, FONT.d); x.fillStyle = th[4]; x.font = `400 ${ys}px ${FONT.d}`; x.fillText(P.y, X0 + 26, Y0 + Hh * 0.5);
    drawIcon(x, P.i, X0 + W * 0.39, Y0 + Hh * 0.5, Hh * 0.36, th[3]);
    const tx = X0 + W * 0.52; const tw = W * 0.45; const ts = fitText(x, P.t, tw, Hh * 0.2, FONT.d); x.fillStyle = th[2]; x.font = `400 ${ts}px ${FONT.d}`; x.fillText(P.t, tx, Y0 + Hh * 0.3);
    x.font = `500 ${Math.round(Hh * 0.1)}px ${FONT.b}`; x.fillStyle = th[3]; const lines = wrapLines(x, P.s, tw); lines.slice(0, 3).forEach((l, i) => x.fillText(l, tx, Y0 + Hh * (0.55 + i * 0.13))); }
  let MURAL = null;
  function mural() { if (MURAL) return MURAL; const W = 2048, Hh = 2048, rows = 10, pw = W / 2, ph = Hh / rows;
    const tex = canvasTex(W, Hh, (x) => { PANELS.forEach((P, k) => drawPanel(x, (k % 2) * pw, Math.floor(k / 2) * ph, pw, ph, P)); }, { fonts: true });
    MURAL = { tex, mat: new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), uv: (k, flip) => { const u0 = (k % 2) * 0.5, u1 = u0 + 0.5, r = Math.floor(k / 2); const v1 = 1 - r / rows, v0 = 1 - (r + 1) / rows; return flip ? [[u1, v0], [u0, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; } }; return MURAL; }
  // trailblazer wall markers (the plan's in-tunnel signs) in one atlas of 256 x 128 slots
  let MARK = null;
  function markers() { if (MARK) return MARK; const P = window.PLAN; const list = (P.signs || []).filter((s) => s.in_tunnel && s.type === "trailblazer"); const cols = 4, rows = 8;
    const tex = canvasTex(1024, 1024, (x, w, h) => { list.slice(0, cols * rows).forEach((s, k) => { const X0 = (k % cols) * 256, Y0 = Math.floor(k / cols) * 128; x.fillStyle = "#1c1a17"; x.fillRect(X0, Y0, 256, 128); x.strokeStyle = "#c9a45a"; x.lineWidth = 3; x.strokeRect(X0 + 4, Y0 + 4, 248, 120); x.textAlign = "center"; x.textBaseline = "middle"; const f = s.faces || [];
      x.fillStyle = "#e9c46a"; x.font = `400 ${fitText(x, f[0] || "", 230, 34, FONT.d)}px ${FONT.d}`; x.fillText(f[0] || "", X0 + 128, Y0 + 32); x.fillStyle = "#f5f1e6"; x.font = `600 ${fitText(x, f[1] || "", 232, 22, FONT.b, 600)}px ${FONT.b}`; x.fillText(f[1] || "", X0 + 128, Y0 + 70); x.fillStyle = "#bfb39c"; x.font = `500 ${fitText(x, f[2] || "", 236, 17, FONT.b, 500)}px ${FONT.b}`; x.fillText(f[2] || "", X0 + 128, Y0 + 100); }); }, { fonts: true });
    MARK = { list, tex, mat: new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), uv: (k, flip) => { const u0 = (k % cols) / cols, u1 = u0 + 1 / cols, r = Math.floor(k / cols); const v1 = 1 - r / rows, v0 = 1 - (r + 1) / rows; return flip ? [[u1, v0], [u0, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; } }; return MARK; }
  function bigText(lines, w, h, bg) { return canvasTex(w, h, (x, W, Hh) => { if (bg) { x.fillStyle = bg; x.fillRect(0, 0, W, Hh); } x.textAlign = "center"; x.textBaseline = "middle"; for (const l of lines) { const s = fitText(x, l.text, W * (l.w || 0.92), Hh * l.size, l.font || FONT.d, l.weight || 400); x.font = `${l.weight || 400} ${s}px ${l.font || FONT.d}`; x.fillStyle = l.color; x.fillText(l.text, W / 2, Hh * l.y); } }, { text: true, fonts: true }); }

  // ───────────────────────── the LED ceiling of the Runway Hall ─────────────────────────
  const LED = { uni: null, t0: -1e9, next: 0 };
  function ledMaterial(size) {
    LED.uni = { uT: { value: 0 }, uJet: { value: -100 }, uNight: { value: 0 }, uSize: { value: new THREE.Vector2(size[0], size[1]) } };
    return new THREE.ShaderMaterial({ uniforms: LED.uni, side: THREE.DoubleSide, toneMapped: false, fog: false,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform float uT; uniform float uJet; uniform float uNight; uniform vec2 uSize; varying vec2 vUv;",
        "float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }",
        "float sdSeg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }",
        "float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }",
        // swept trapezoid wing: root chord x in [r0, r1] at |y| = 0, tip chord [t0, t1] at |y| = span; negative inside
        "float sdWing(vec2 p, float r0, float r1, float t0, float t1, float span) { float s = abs(p.y) / span; float a = mix(r0, t0, s), b = mix(r1, t1, s); float dx = max(a - p.x, p.x - b); float dy = abs(p.y) - span; return max(dx, dy); }",
        "void main() {",
        " vec2 p = (vUv - 0.5) * uSize;",
        " vec2 q = p * 0.05 + vec2(uT * 0.012, uT * 0.004);",
        " float cl = vn(q) * 0.55 + vn(q * 2.3 + 4.1) * 0.3 + vn(q * 5.1) * 0.15;",
        " vec3 day = mix(vec3(0.33, 0.58, 0.86), vec3(0.2, 0.42, 0.76), vUv.y);",
        " day = mix(day, vec3(0.96, 0.97, 1.0), smoothstep(0.52, 0.8, cl) * 0.85);",
        " vec3 nite = vec3(0.02, 0.03, 0.08) + vec3(0.9) * step(0.9975, h21(floor(p * 3.0))) * (0.6 + 0.4 * sin(uT * 3.0 + h21(floor(p * 3.0)) * 40.0));",
        " vec3 col = mix(day, nite, uNight);",
        // the runway centreline, faint, as if the pavement above were glass
        " float cz = step(abs(p.y), 0.45) * step(fract(p.x / 36.0 + 0.1), 0.55); col = mix(col, vec3(1.0), cz * 0.18);",
        // the jet: a business jet seen from below, rolling along the runway (+x)
        " vec2 j = (p - vec2(uJet, 0.0)) / 0.27;",
        " float body = smin(sdSeg(j, vec2(-9.2, 0.0), vec2(6.5, 0.0), 1.2), sdSeg(j, vec2(6.5, 0.0), vec2(10.0, 0.0), 0.42), 1.6);",
        " body = smin(body, sdSeg(j, vec2(-9.2, 0.0), vec2(-11.0, 0.0), 0.35), 0.8);",
        " float wing = sdWing(j, -2.6, 2.9, -6.3, -4.6, 9.8);",
        " float tail = sdWing(j - vec2(-9.4, 0.0), -1.4, 0.6, -2.9, -2.0, 3.7);",
        " float eng = min(sdSeg(j, vec2(-8.0, 1.95), vec2(-4.6, 1.95), 0.62), sdSeg(j, vec2(-8.0, -1.95), vec2(-4.6, -1.95), 0.62));",
        " float jet = min(min(body, wing), min(tail, eng));",
        " float aa = 0.12;",
        " col = mix(col, col * 0.55, (1.0 - smoothstep(0.0, 1.6, jet)) * 0.5);",
        " vec3 jc = vec3(0.9, 0.91, 0.92); jc = mix(jc, vec3(0.78, 0.8, 0.82), step(wing, body) * 0.8); jc = mix(jc, vec3(0.62, 0.64, 0.66), step(eng, 0.0)); jc = mix(jc, vec3(0.18, 0.68, 0.34), step(abs(j.y), 0.22) * step(body, 0.0) * step(-7.0, j.x) * step(j.x, 7.5));",
        " jc = mix(jc, vec3(0.08), step(eng, 0.0) * step(-5.2, j.x));",
        " jc *= mix(1.0, 0.35, uNight);",
        " col = mix(col, jc, 1.0 - smoothstep(-aa, aa, jet));",
        " float blink = step(0.8, fract(uT * 1.1));",
        " col += vec3(1.0, 0.95, 0.85) * exp(-dot(j - vec2(1.6, 1.9), j - vec2(1.6, 1.9)) * 3.0) * (0.8 + uNight);",
        " col += vec3(1.0, 0.95, 0.85) * exp(-dot(j - vec2(1.6, -1.9), j - vec2(1.6, -1.9)) * 3.0) * (0.8 + uNight);",
        " col += vec3(1.0, 0.1, 0.08) * exp(-dot(j - vec2(-5.1, 9.8), j - vec2(-5.1, 9.8)) * 6.0) * 1.2;",
        " col += vec3(0.1, 1.0, 0.3) * exp(-dot(j - vec2(-5.1, -9.8), j - vec2(-5.1, -9.8)) * 6.0) * 1.2;",
        " col += vec3(1.0) * blink * (exp(-dot(j - vec2(-5.3, 9.9), j - vec2(-5.3, 9.9)) * 9.0) + exp(-dot(j - vec2(-5.3, -9.9), j - vec2(-5.3, -9.9)) * 9.0)) * 1.5;",
        " col += vec3(1.0, 0.15, 0.1) * step(0.5, fract(uT * 0.9)) * exp(-dot(j, j) * 1.2) * 0.9;",
        // the LED pixel grid, fading out with distance so it never shimmers
        " vec2 cell = fract(p / 0.06) - 0.5; float dotm = smoothstep(0.5, 0.3, length(cell)); float fw = clamp(fwidth(p.x) / 0.06, 0.0, 1.0);",
        " col *= mix(0.72 + 0.38 * dotm, 0.92, fw);",
        " gl_FragColor = vec4(col * 1.08, 1.0);",
        "}"].join("\n") });
  }

  // ───────────────────────── the covered boxes (interiors) ─────────────────────────
  function buildInterior(T0) {
    const m = mats(); const K = {}; const G = (k) => K[k] || (K[k] = new Geo());
    const hw = T0.hw, Lb = T0.Lb, cl = T0.clear, hall = T0.hall, gw = T0.lanes.guide; const F = (w) => boxFloor(T0, w); const Q = (w, t, y) => boxP(T0, w, t, y);
    const quadH = (geo, w0, w1, ta, tb, dy, tile) => { const k = tile || 4; geo.quad(Q(w0, ta, F(w0) + dy), Q(w0, tb, F(w0) + dy), Q(w1, tb, F(w1) + dy), Q(w1, ta, F(w1) + dy), [ta / k, w0 / k], [tb / k, w0 / k], [tb / k, w1 / k], [ta / k, w1 / k]); };
    const quadV = (geo, w0, w1, t, y0, y1, slat) => { const v0 = slat ? 0 : y0 / 4, v1 = slat ? 1 : y1 / 4; const k = slat ? 2 : 4; geo.quad(Q(w0, t, F(w0) + y0), Q(w1, t, F(w1) + y0), Q(w1, t, F(w1) + y1), Q(w0, t, F(w0) + y1), [w0 / k, v0], [w1 / k, v0], [w1 / k, v1], [w0 / k, v1]); };
    const quadX = (geo, w, t0, t1, y0, y1, slat) => { const f = F(w); const k = slat ? 2 : 4; geo.quad(Q(w, t0, f + y0), Q(w, t1, f + y0), Q(w, t1, f + y1), Q(w, t0, f + y1), [t0 / k, slat ? 0 : y0 / 4], [t1 / k, slat ? 0 : y0 / 4], [t1 / k, slat ? 1 : y1 / 4], [t0 / k, slat ? 1 : y1 / 4]); };
    const runs = hall ? [[0, hall.w0], [hall.w1, Lb]] : [[0, Lb]];
    const bays = (T0.bays || []).filter((w) => w > 7 && w < Lb - 7 && !(hall && w > hall.w0 - 6 && w < hall.w1 + 6)); const bh = 3.0, bd = 0.9;
    // floors: the two walkways and the shuttle guideway (5 cm lower); the hall walkways widen to the hall walls
    quadH(G("floor"), 0, Lb, -hw, -gw, 0); quadH(G("floor"), 0, Lb, gw, hw, 0); quadH(G("guide"), 0, Lb, -gw, gw, -0.05, 5.6);
    for (const sd of [-1, 1]) G("steelD").quad(Q(0, sd * gw, F(0) - 0.05), Q(Lb, sd * gw, F(Lb) - 0.05), Q(Lb, sd * gw, F(Lb)), Q(0, sd * gw, F(0)), [0, 0], [1, 0], [1, 1], [0, 1]);
    G("steel").quad(Q(0, -0.07, F(0) + 0.06), Q(0, 0.07, F(0) + 0.06), Q(Lb, 0.07, F(Lb) + 0.06), Q(Lb, -0.07, F(Lb) + 0.06), [0, 0], [1, 0], [1, 1], [0, 1]);
    if (hall) { quadH(G("floor"), hall.w0, hall.w1, hw, hall.hw2, 0); quadH(G("floor"), hall.w0, hall.w1, -hall.hw2, -hw, 0); }
    for (const b of bays) quadH(G("floor"), b - bh, b + bh, hw, hw + bd, 0);
    // walls: warm timber slats; the +t wall opens into the planted bays
    for (const [w0, w1] of runs) { quadV(G("slats"), w0, w1, -hw, 0, cl, true);
      let cur = w0; for (const b of bays.filter((b) => b > w0 && b < w1).sort((a, c) => a - c)) { quadV(G("slats"), cur, b - bh, hw, 0, cl, true); cur = b + bh; } quadV(G("slats"), cur, w1, hw, 0, cl, true);
      quadH(G("ceil"), w0, w1, -hw, hw, cl);
      for (const tc of [-hw * 0.42, hw * 0.42]) quadH(G("light"), w0 + 0.5, w1 - 0.5, tc - 0.18, tc + 0.18, cl - 0.02); }
    for (const b of bays) { G("bay").quad(Q(b - bh, hw + bd, F(b - bh)), Q(b + bh, hw + bd, F(b + bh)), Q(b + bh, hw + bd, F(b + bh) + cl), Q(b - bh, hw + bd, F(b - bh) + cl), [0, 0], [1, 0], [1, 1], [0, 1]);
      for (const e of [b - bh, b + bh]) quadX(G("slats"), e, hw, hw + bd, 0, cl, true); quadH(G("ceil"), b - bh, b + bh, hw, hw + bd, cl);
      const pc = Q(b, hw + bd - 0.36, F(b) + 0.32); G("planter").box(pc, bh - 0.25, 0.32, 0.32, Math.atan2(T0.d[0], T0.d[1]) + Math.PI / 2); const sc = Q(b, hw + bd - 0.36, F(b) + 0.645); G("soil").box(sc, bh - 0.35, 0.01, 0.26, Math.atan2(T0.d[0], T0.d[1]) + Math.PI / 2);
      G("light").quad(Q(b - bh + 0.2, hw + bd - 0.05, F(b) + cl - 0.25), Q(b + bh - 0.2, hw + bd - 0.05, F(b) + cl - 0.25), Q(b + bh - 0.2, hw + bd - 0.05, F(b) + cl - 0.12), Q(b - bh + 0.2, hw + bd - 0.05, F(b) + cl - 0.12), [0, 0], [1, 0], [1, 1], [0, 1]); }
    // the Runway Hall: taller, wider, the LED ceiling over it
    if (hall) { const c2 = hall.clear2, h2 = hall.hw2;
      for (const sd of [-1, 1]) { quadV(G("slats"), hall.w0, hall.w1, sd * h2, 0, c2, true); for (const e of [hall.w0, hall.w1]) quadX(G("slats"), e, sd * hw, sd * h2, 0, c2, true); }
      for (const e of [hall.w0, hall.w1]) quadX(G("conc"), e, -hw, hw, cl, c2, false);
      const inset = 0.5; const led = new Geo(); const w0 = hall.w0 + inset, w1 = hall.w1 - inset, t0 = -h2 + inset, t1 = h2 - inset;
      led.quad(Q(w0, t0, F(w0) + c2), Q(w0, t1, F(w0) + c2), Q(w1, t1, F(w1) + c2), Q(w1, t0, F(w1) + c2), [0, 0], [1, 0], [1, 1], [0, 1]);
      const lm = led.mesh(ledMaterial([t1 - t0, w1 - w0]), { receive: false }); lm.userData.noShadow = true; T0.ledMesh = lm;
      quadH(G("ceil"), hall.w0, hall.w1, -h2, t0, c2 + 0.01); quadH(G("ceil"), hall.w0, hall.w1, t1, h2, c2 + 0.01); quadH(G("ceil"), hall.w0, w0, t0, t1, c2 + 0.01); quadH(G("ceil"), w1, hall.w1, t0, t1, c2 + 0.01);
      // benches along the hall walkways
      for (const sd of [-1, 1]) for (const wc of [hall.w0 + 6, hall.w1 - 6]) { const c = Q(wc, sd * (h2 - 1.6), F(wc) + 0.45); G("bench").box(c, 0.3, 0.05, 1.6, Math.atan2(T0.d[0], T0.d[1])); for (const e of [-1.3, 1.3]) { const lg = Q(wc + e, sd * (h2 - 1.6), F(wc) + 0.22); G("steelD").box(lg, 0.25, 0.22, 0.04, Math.atan2(T0.d[0], T0.d[1])); } } }
    // the moving walkway beside the shuttle lane (each run, stepping off at the hall)
    if (T0.lanes.belt) { const [b0, b1] = T0.lanes.belt;
      for (const [w0, w1] of runs) { const a = w0 + 4, e = w1 - 4; if (e - a < 10) continue; const top = 0.15;
        quadH(G("belt"), a, e, b0, b1, top, 1);
        for (const [tt, sd] of [[b0 - 0.1, -1], [b1 + 0.1, 1]]) { G("steel").quad(Q(a, tt, F(a) + top), Q(e, tt, F(e) + top), Q(e, tt, F(e) + 0.95), Q(a, tt, F(a) + 0.95), [0, 0], [1, 0], [1, 1], [0, 1]); G("steel").quad(Q(a, tt - sd * 0.12, F(a)), Q(e, tt - sd * 0.12, F(e)), Q(e, tt - sd * 0.12, F(e) + 0.95), Q(a, tt - sd * 0.12, F(a) + 0.95), [0, 0], [1, 0], [1, 1], [0, 1]);
          G("rail").quad(Q(a, tt - sd * 0.15, F(a) + 0.97), Q(e, tt - sd * 0.15, F(e) + 0.97), Q(e, tt + sd * 0.03, F(e) + 0.97), Q(a, tt + sd * 0.03, F(a) + 0.97), [0, 0], [1, 0], [1, 1], [0, 1]); G("rail").quad(Q(a, tt + sd * 0.03, F(a) + 0.9), Q(e, tt + sd * 0.03, F(e) + 0.9), Q(e, tt + sd * 0.03, F(e) + 0.97), Q(a, tt + sd * 0.03, F(a) + 0.97), [0, 0], [1, 0], [1, 1], [0, 1]); }
        for (const ww of [a, e]) { G("steelD").quad(Q(ww, b0 - 0.22, F(ww)), Q(ww, b1 + 0.22, F(ww)), Q(ww, b1 + 0.22, F(ww) + 1.0), Q(ww, b0 - 0.22, F(ww) + 1.0), [0, 0], [1, 0], [1, 1], [0, 1]); } } }
    // the timeline mural: 9 m panels at eye height on both walls
    const MU = mural(); const mg = new Geo(); const base = T0.id === "crossing" ? 0 : 16; let k = 0;
    const panelsFor = (w0, w1, count) => { const pitch = (w1 - w0) / count; const out = []; for (let i = 0; i < count; i++) out.push(w0 + pitch * (i + 0.5)); return out; };
    const slots = T0.id === "crossing" ? [[runs[0], 8, 0], [runs[1], 8, 8]] : [[runs[0], 4, 16]];
    for (const [[w0, w1], count, first] of slots) { const cs = panelsFor(w0, w1, count); cs.forEach((c, i) => { const idx = first + i; if (idx >= PANELS.length) return; for (const sd of [-1, 1]) { if (sd > 0 && bays.some((b) => Math.abs(b - c) < bh + 4.7)) continue; const t = sd * (hw - 0.03); const w0p = c - 4.4, w1p = c + 4.4; const uv = MU.uv(idx, sd > 0);
          mg.quad(Q(w0p, t, F(w0p) + 1.2), Q(w1p, t, F(w1p) + 1.2), Q(w1p, t, F(w1p) + 2.95), Q(w0p, t, F(w0p) + 2.95), uv[0], uv[1], uv[2], uv[3]); k++; } }); }
    // the trailblazer markers inside the box (the ramp ones go on the ramp walls)
    const MK = markers(); const kg = new Geo();
    MK.list.forEach((s, i) => { let hit = null; for (const [T1, w, t] of [[T0, ...boxLocal(T0, s.x, s.z)]]) { if (w > 1 && w < Lb - 1 && Math.abs(t) < (hall && w > hall.w0 && w < hall.w1 ? hall.hw2 + 2 : hw + 3)) hit = [w, t]; } if (!hit) return; let w = hit[0]; if (hall && w > hall.w0 - 1 && w < hall.w1 + 1) w = hall.w1 + 3; if (bays.some((b) => Math.abs(b - w) < bh + 0.9)) w += bh + 1.5;
      const t = hw - 0.035; const uv = MK.uv(i, true); kg.quad(Q(w - 0.7, t, F(w) + 1.55), Q(w + 0.7, t, F(w) + 1.55), Q(w + 0.7, t, F(w) + 2.25), Q(w - 0.7, t, F(w) + 2.25), uv[0], uv[1], uv[2], uv[3]); });
    const grp = group(T0.id + "_interior", true);
    for (const [key, mat] of [["floor", m.iFloor], ["guide", m.iGuide], ["slats", m.iSlats], ["ceil", m.iCeil], ["light", m.iLight], ["steel", m.iSteel], ["steelD", m.iSteelD], ["rail", m.iRail], ["belt", m.iBelt], ["bay", m.iBay], ["planter", m.iPlanter], ["soil", m.iSoil], ["bench", m.iBench], ["conc", m.iConc]]) { if (!K[key]) continue; const me = K[key].mesh(mat, { receive: false }); if (me) { me.userData.noShadow = true; grp.add(me); } }
    { const me = mg.mesh(MU.mat, { receive: false }); if (me) grp.add(me); } { const me = kg.mesh(MK.mat, { receive: false }); if (me) grp.add(me); }
    if (T0.ledMesh) grp.add(T0.ledMesh);
    // plants in the bays (unlit copies of the agave and yucca clusters)
    safe("bay plants", () => { const kinds = ["agave_cluster", "yucca_cluster"].filter(hasModel); if (!kinds.length || !bays.length) return; kinds.forEach((kind, ki) => { const mo = MODELS[kind]; const spots = []; for (const b of bays) for (let j = -1; j <= 1; j++) if ((j + 1) % 2 === ki || kinds.length === 1) spots.push([b + j * 1.8, hw + bd - 0.36]); if (!spots.length) return;
      for (const part of mo.parts) { const pm = part.material; const bm = new THREE.MeshBasicMaterial({ map: pm.map || null, color: 0x9aa482, side: THREE.DoubleSide, alphaTest: pm.alphaTest || 0, transparent: false }); const im = new THREE.InstancedMesh(part.geometry, bm, spots.length); spots.forEach(([w, t], i) => { const p = Q(w, t, F(w) + 0.64); im.setMatrixAt(i, mtx(p[0], p[1], p[2], i * 1.7, 0, 0, 0.75)); }); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.userData.noShadow = true; grp.add(im); } }); });
    // the Runway Hall lettering and kiosk
    if (hall) safe("hall text", () => { const h2 = hall.hw2; const wc = (hall.w0 + hall.w1) / 2; const L = hall.w1 - hall.w0 - 3;
      const texA = bigText([{ text: "THE RUNWAY HALL", y: 0.24, size: 0.34, color: "#3a2412" }, { text: "RUNWAY 03/21 IS DIRECTLY ABOVE YOU", y: 0.6, size: 0.16, color: "#5a3a1e", font: FONT.b, weight: 700 }, { text: APPROVAL, y: 0.85, size: 0.085, color: "#6a4a2a", font: FONT.b, weight: 600 }], 2048, 380, null);
      const texB = bigText([{ text: "LOOK UP", y: 0.24, size: 0.34, color: "#3a2412" }, { text: "THE JETS ROLL OVERHEAD ON THE LED CEILING", y: 0.6, size: 0.15, color: "#5a3a1e", font: FONT.b, weight: 700 }, { text: "1928: the timeline ends here and the frontier begins", y: 0.85, size: 0.09, color: "#6a4a2a", font: FONT.b, weight: 600 }], 2048, 380, null);
      for (const [sd, tex] of [[1, texA], [-1, texB]]) { const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }); const g = new Geo(); const t = sd * (h2 - 0.04); const a = sd > 0 ? wc + L / 2 : wc - L / 2, b = sd > 0 ? wc - L / 2 : wc + L / 2; g.quad(Q(a, t, F(a) + 2.2), Q(b, t, F(b) + 2.2), Q(b, t, F(b) + 5.6), Q(a, t, F(a) + 5.6), [0, 0], [1, 0], [1, 1], [0, 1]); const me = g.mesh(mat, { receive: false, order: 2 }); if (me) grp.add(me); }
      const ks = (window.PLAN.signs || []).find((s) => s.id === "sg552"); const faces = ks ? ks.faces : ["YOU ARE HERE: the Runway Hall, under Runway 03/21"];
      const kt = canvasTex(512, 1024, (x, w, h) => { x.fillStyle = "#1c1a17"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9c46a"; x.fillRect(0, 0, w, 90); x.fillStyle = "#1c1a17"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = `400 ${fitText(x, "THE CROSSING", w * 0.9, 60, FONT.d)}px ${FONT.d}`; x.fillText("THE CROSSING", w / 2, 46);
        x.textAlign = "left"; let y = 150; for (const f of faces) { x.fillStyle = y < 200 ? "#f5f1e6" : "#d8cfbd"; x.font = `600 ${y < 200 ? 30 : 26}px ${FONT.b}`; for (const l of wrapLines(x, f, w - 60)) { x.fillText(l, 30, y); y += 38; } y += 26; }
        x.fillStyle = "#e9c46a"; x.font = `600 22px ${FONT.b}`; wrapLines(x, APPROVAL, w - 60).forEach((l, i) => x.fillText(l, 30, h - 110 + i * 30)); }, { fonts: true });
      const km = new THREE.MeshBasicMaterial({ map: kt, side: THREE.DoubleSide }); const kc = Q(hall.w0 + 3.2, h2 - 2.2, F(hall.w0 + 3.2) + 1.25); const kb = new Geo(); kb.box(kc, 0.75, 1.25, 0.12, Math.atan2(T0.d[0], T0.d[1])); const kbm = kb.mesh(m.iSteelD, { receive: false }); if (kbm) grp.add(kbm);
      const kp = new Geo(); const yaw = Math.atan2(T0.d[0], T0.d[1]); for (const sd of [-1, 1]) { const off = 0.125 * sd; const P = (lx, ly) => { const c = [kc[0] + Math.cos(yaw) * lx + T0.d[0] * off, kc[1] + ly, kc[2] - Math.sin(yaw) * lx + T0.d[1] * off]; return c; }; kp.quad(P(-0.7, -1.2), P(0.7, -1.2), P(0.7, 1.2), P(-0.7, 1.2), sd > 0 ? [0, 0] : [1, 0], sd > 0 ? [1, 0] : [0, 0], sd > 0 ? [1, 1] : [0, 1], sd > 0 ? [0, 1] : [1, 1]); } const kpm = kp.mesh(km, { receive: false }); if (kpm) grp.add(kpm); });
    grp.visible = false; scene.add(grp); T0.interior = grp; return grp;
  }
  // world point -> [w, t] in a tunnel's box frame
  function boxLocal(T0, x, z) { const dx = x - T0.A[0], dz = z - T0.A[1]; return [dx * T0.d[0] + dz * T0.d[1], dx * T0.r[0] + dz * T0.r[1]]; }
  // trailblazer markers that stand on a ramp: mounted on the ramp's right wall
  function rampMarkers() { const MK = markers(); const kg = new Geo(); let n = 0;
    MK.list.forEach((s, i) => { for (const R of PC.ramps) { const l = rampLocal(R, s.x, s.z, 3); if (!l || l.u < 2 || l.u > R.L - 2) continue; const f = rampFloor(R, l.u); const at = atLen(R.pts, l.u); const nx = -at[3], nz = at[2]; const t = R.hw - 0.035; const P = (du, y) => { const q = atLen(R.pts, l.u + du); return [q[0] + nx * t, y, q[1] + nz * t]; }; const top = Math.min(f + 2.25, grade(at[0] + nx * R.hw, at[1] + nz * R.hw) + 0.9); if (top - f < 1.1) return; const uv = MK.uv(i, false); kg.quad(P(0.7, top - 0.7), P(-0.7, top - 0.7), P(-0.7, top), P(0.7, top), uv[0], uv[1], uv[2], uv[3]); n++; return; } });
    const me = kg.mesh(new THREE.MeshStandardMaterial({ map: MK.tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: MK.tex, emissiveIntensity: 0.25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), {}); if (me) { const g = group("crossing_ramp_markers"); g.add(me); scene.add(g); } return n; }

  // the brass Horizon Line through The Crossing: from the end of the Club Walk line, down the approach and the north ramp,
  // along the stationary walkway of the box and up the curved ramp to the Expanse Gate, a brass star every 25 m
  function buildBrass() { const T0 = PC.tunnels[0]; if (!T0 || !T0.route) return 0; const Rt = T0.route; const XP = T0.plazaA, G0 = T0.plazaB; const off = T0.lanes.guide + 1.4;
    const cw = window.PLAN.promenades.find((q) => q.id === "hl1_club_walk"); const hA = T0.ramps[0].head; const m = [hA[0] - XP[0], hA[1] - XP[1]]; const ml = Math.hypot(m[0], m[1]); m[0] /= ml; m[1] /= ml;
    const pts = []; if (cw) { const a = cw.pts[cw.pts.length - 2], b = cw.pts[cw.pts.length - 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; pts.push([b[0] - uz * 2.6, b[1] + ux * 2.6]); }
    const line = [[XP[0], XP[1]]].concat(Rt.pts.map((p) => [p[0], p[1]])).concat([[G0[0], G0[1]]]); const S = resample(line, 1.0);
    for (const q of S) { if (q.u < 7) continue; pts.push([q.x + q.nx * off, q.z + q.nz * off]); }
    const outG = new Geo(), inG = new Geo(); const starOut = new Geo(), starIn = new Geo(); let run = 0; let n = 0;
    const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832 - Math.PI / 2, r = i % 2 ? 0.12 : 0.3; if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r); } star.closePath();
    const yAt = (x, z) => { const f = trenchFloor(x, z); if (f !== null) return { y: f + 0.015, box: false }; const [w, t] = boxLocal(T0, x, z); if (w >= -0.2 && w <= T0.Lb + 0.2 && Math.abs(t) < (T0.hall ? T0.hall.hw2 : T0.hw) + 1) return { y: boxFloor(T0, w) + 0.012, box: true }; return { y: surface(x, z) + 0.013, box: false }; };
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue; const nx = -(b[1] - a[1]) / L * 0.05, nz = (b[0] - a[0]) / L * 0.05; const ya = yAt(a[0], a[1]), yb = yAt(b[0], b[1]); const G1 = ya.box && yb.box ? inG : outG;
      G1.quad([a[0] - nx, ya.y, a[1] - nz], [a[0] + nx, ya.y, a[1] + nz], [b[0] + nx, yb.y, b[1] + nz], [b[0] - nx, yb.y, b[1] - nz], [0, 0], [1, 0], [1, 1], [0, 1]);
      run += L; if (run >= 25) { run -= 25; const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); const sg = new THREE.ShapeGeometry(star); sg.rotateX(-Math.PI / 2); (G1 === inG ? starIn : starOut).add(sg, mtx(b[0] - nz * 12, yb.y + 0.004, b[1] + nx * 12, yaw)); n++; } }
    const brassStd = new THREE.MeshStandardMaterial({ color: 0xc19a52, roughness: 0.3, metalness: 0.85, emissive: 0x7a5418, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); PC.glowMats.push([brassStd, 0.4]); /* D2: a warm glint after dark like B4's line (bare metal reflected the night sky as a black stripe) */ const brassIn = new THREE.MeshBasicMaterial({ color: 0xd4ae62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const og = group("crossing_brass"); for (const [G1, mat] of [[outG, brassStd], [starOut, brassStd]]) { const me = G1.mesh(mat, {}); if (me) og.add(me); } scene.add(og);
    if (T0.interior) for (const [G1, mat] of [[inG, brassIn], [starIn, brassIn]]) { const me = G1.mesh(mat, { receive: false }); if (me) T0.interior.add(me); }
    PC.stats.brassStars = n; return n; }

  // ───────────────────────── the Crossing Shuttle ─────────────────────────
  let SHUTTLE = null;
  function shuttleParts() {
    if (SHUTTLE) return SHUTTLE; const m = mats(); const g = { body: new Geo(), stripe: new Geo(), trim: new Geo(), glass: new Geo(), seat: new Geo(), dark: new Geo(), lamp: new Geo(), tail: new Geo() };
    const sh = new THREE.Shape(); const L = 4.2, y0 = 0.22, y1 = 0.98;
    sh.moveTo(-L + 0.3, y0); sh.lineTo(L - 0.7, y0); sh.quadraticCurveTo(L, y0, L, y0 + 0.4); sh.lineTo(L, y1 - 0.22); sh.quadraticCurveTo(L, y1, L - 0.28, y1); sh.lineTo(-L + 0.28, y1); sh.quadraticCurveTo(-L, y1, -L, y1 - 0.22); sh.lineTo(-L, y0 + 0.3); sh.quadraticCurveTo(-L, y0, -L + 0.3, y0);
    const ex = new THREE.ExtrudeGeometry(sh, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 6 }); ex.rotateY(-Math.PI / 2); ex.translate(1.2, 0, 0); g.body.add(ex);
    for (const z of [3.98, 1.3, -1.3, -3.98]) for (const x of [-1.17, 1.17]) g.trim.box([x, 1.95, z], 0.055, 0.97, 0.07);
    for (const x of [-1.17, 1.17]) g.trim.box([x, 2.94, 0], 0.07, 0.05, 4.08); for (const z of [-4.04, -1.3, 1.3, 4.04]) g.trim.box([0, 2.94, z], 1.2, 0.05, 0.06);
    g.body.box([0, 2.97, -3.65], 1.22, 0.05, 0.45);
    g.glass.quad([-1.18, 2.96, -3.2], [1.18, 2.96, -3.2], [1.18, 2.96, 4.02], [-1.18, 2.96, 4.02], [0, 0], [1, 0], [1, 1], [0, 1]);
    for (const x of [-1.19, 1.19]) g.glass.quad([x, 1.0, -4.0], [x, 1.0, 4.0], [x, 2.9, 4.0], [x, 2.9, -4.0], [0, 0], [1, 0], [1, 1], [0, 1]);
    g.glass.quad([-1.15, 1.02, 4.12], [1.15, 1.02, 4.12], [1.15, 2.88, 3.98], [-1.15, 2.88, 3.98], [0, 0], [1, 0], [1, 1], [0, 1]); g.glass.quad([1.15, 1.02, -4.12], [-1.15, 1.02, -4.12], [-1.15, 2.88, -3.98], [1.15, 2.88, -3.98], [0, 0], [1, 0], [1, 1], [0, 1]);
    g.dark.box([0, 1.12, 3.78], 1.1, 0.14, 0.26); g.lamp.box([0.55, 1.27, 3.7], 0.18, 0.012, 0.1);
    for (const z of [2.4, 0.6, -1.2, -3.0]) { g.seat.box([0, 1.42, z], 1.02, 0.07, 0.28); g.seat.box([0, 1.82, z - 0.3], 1.02, 0.36, 0.05); g.dark.box([0, 1.18, z], 0.9, 0.2, 0.2); }
    for (const x of [-1.27, 1.27]) g.stripe.box([x, 0.67, 0], 0.012, 0.05, 3.95);
    for (const x of [-0.82, 0.82]) { g.lamp.box([x, 0.56, 4.24], 0.2, 0.07, 0.02); g.tail.box([x, 0.56, -4.24], 0.2, 0.06, 0.02); }
    g.dark.box([0, 0.25, 0], 1.18, 0.04, 4.05); for (const x of [-1.0, 1.0]) for (const z of [-2.9, 2.9]) g.dark.add(new THREE.CylinderGeometry(0.3, 0.3, 0.26, 16), mtx(x, 0.3, z, 0, 0, Math.PI / 2));
    const txt = canvasTex(1024, 96, (x, w, h) => { x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#1d4a2c"; x.font = `400 ${fitText(x, "THE CROSSING SHUTTLE", w * 0.96, 70, FONT.d)}px ${FONT.d}`; x.fillText("THE CROSSING SHUTTLE", w / 2, h / 2 + 2); }, { text: true, fonts: true });
    const tm = new THREE.MeshStandardMaterial({ map: txt, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); const tg = new Geo();
    tg.quad([1.262, 0.34, 1.9], [1.262, 0.34, -1.9], [1.262, 0.54, -1.9], [1.262, 0.54, 1.9], [0, 0], [1, 0], [1, 1], [0, 1]); tg.quad([-1.262, 0.34, -1.9], [-1.262, 0.34, 1.9], [-1.262, 0.54, 1.9], [-1.262, 0.54, -1.9], [0, 0], [1, 0], [1, 1], [0, 1]);
    const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, side: THREE.DoubleSide }, o || {}));
    const matOf = { body: std(0xf1ead8, { roughness: 0.42, metalness: 0.05, emissive: 0x3a3730 }), stripe: std(0x2fae57, { roughness: 0.4, emissive: 0x0c2a14 }), trim: std(0xb4bbc0, { roughness: 0.35, metalness: 0.6, emissive: 0x2c3034 }), glass: new THREE.MeshStandardMaterial({ color: 0x6f8c9b, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }), seat: std(0x7a4b30, { roughness: 0.7, emissive: 0x241810 }), dark: std(0x22262a, { roughness: 0.6, emissive: 0x0c0d0e }), lamp: new THREE.MeshBasicMaterial({ color: 0xfff4d8 }), tail: new THREE.MeshBasicMaterial({ color: 0xff3a30 }) };
    SHUTTLE = { parts: [] }; for (const k in g) { const me = g[k].mesh(matOf[k], { cast: k === "body" }); if (me) { if (k === "glass") me.renderOrder = 3; SHUTTLE.parts.push(me); } } { const me = tg.mesh(tm, {}); if (me) SHUTTLE.parts.push(me); }
    return SHUTTLE; }
  function makeShuttle(scale) { const P = shuttleParts(); const outer = group("crossing_shuttle"); const inner = new THREE.Group(); inner.scale.setScalar(scale || 1); for (const p of P.parts) { const c = new THREE.Mesh(p.geometry, p.material); c.castShadow = p.castShadow; c.receiveShadow = true; c.renderOrder = p.renderOrder; c.userData.noInst = true; inner.add(c); } outer.add(inner); outer.userData.inner = inner; outer.userData.scale = scale || 1; scene.add(outer); return outer; }

  // ───────────────────────── the ride route and speed profile ─────────────────────────
  function buildRoute(T0) { const [rA, rB] = T0.ramps; const pts = rA.pts.slice().reverse().concat(rB.pts.slice(1)); const LA = rA.L, LB = rB.L, Lb = T0.Lb;
    const floorAt = (u) => u <= LA ? rampFloor(rA, LA - u) : u <= LA + Lb ? boxFloor(T0, u - LA) : rampFloor(rB, u - LA - Lb);
    const S = resample(pts, 1.0); const N = S.length; const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), Hd = new Float32Array(N), cap = new Float32Array(N);
    for (let i = 0; i < N; i++) { const s = S[i]; X[i] = s.x; Z[i] = s.z; Y[i] = floorAt(s.u); Hd[i] = Math.atan2(s.dx, s.dz); const w = s.u - LA; let c = T0.vmax; if (w < 0 || w > Lb) c = Math.min(c, 12); if (T0.hall && w > T0.hall.w0 - 6 && w < T0.hall.w1 + 6) c = Math.min(c, 5.5); if (T0.id === "crossing" && s.u > LA + Lb + 40) c = Math.min(c, 9.5); cap[i] = c; }
    const L = S[N - 1].u; const stop = 7; const iA = Math.round(stop), iB = N - 1 - Math.round(stop);
    const prof = (dir) => { const v = new Float32Array(N); const a = 2.6; const i0 = dir > 0 ? iA : iB, i1 = dir > 0 ? iB : iA; v[i0] = 0.8; for (let i = i0 + dir; dir > 0 ? i <= i1 : i >= i1; i += dir) v[i] = Math.min(cap[i], Math.sqrt(v[i - dir] * v[i - dir] + 2 * a)); v[i1] = Math.min(v[i1], 0.6); for (let i = i1 - dir; dir > 0 ? i >= i0 : i <= i0; i -= dir) v[i] = Math.min(v[i], Math.sqrt(v[i + dir] * v[i + dir] + 2 * a * 1.2)); for (let i = 0; i < N; i++) v[i] = Math.max(v[i], 0.6); return v; };
    T0.route = { pts, S, N, X, Y, Z, Hd, L, LA, LB, uA: iA, uB: iB, v: { 1: prof(1), "-1": prof(-1) } }; return T0.route; }
  function routeAt(Rt, u) { const f = clamp(u, 0, Rt.N - 1.001); const i = Math.floor(f), k = f - i; const j = Math.min(Rt.N - 1, i + 1); let dh = Rt.Hd[j] - Rt.Hd[i]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); return { x: Rt.X[i] + (Rt.X[j] - Rt.X[i]) * k, y: Rt.Y[i] + (Rt.Y[j] - Rt.Y[i]) * k, z: Rt.Z[i] + (Rt.Z[j] - Rt.Z[i]) * k, h: Rt.Hd[i] + dh * k }; }
  function speedAt(Rt, dir, u) { const v = Rt.v[dir > 0 ? 1 : "-1"]; const f = clamp(u, 0, Rt.N - 1.001); const i = Math.floor(f), k = f - i; return v[i] + (v[Math.min(Rt.N - 1, i + 1)] - v[i]) * k; }
  // place a shuttle on the route at u, facing its direction of travel
  function placeShuttle(sh, Rt, u, dir) { const p = routeAt(Rt, u), a = routeAt(Rt, u - 3), b = routeAt(Rt, u + 3); sh.position.set(p.x, p.y - 0.04, p.z); sh.rotation.set(0, p.h + (dir < 0 ? Math.PI : 0), 0); const slope = Math.atan2(b.y - a.y, 6) * (dir < 0 ? 1 : -1); sh.userData.inner.rotation.x = slope; sh.updateMatrixWorld(true); }

  // ───────────────────────── boarding, the ride and the arrival ─────────────────────────
  const fadeEl = () => document.getElementById("fade");
  function fadeTo(on, ms) { const f = fadeEl(); if (!f) return; f.style.transition = `opacity ${(ms || 450) / 1000}s`; f.style.opacity = on ? "1" : "0"; }
  function busy() { return (typeof FLY !== "undefined" && FLY.on) || riding || inside || (typeof golf !== "undefined" && golf.playing) || SITES.ride || SITES.park || SITES.bride || (typeof RIDE !== "undefined" && RIDE.on) || (typeof RIDE_ON !== "undefined" && RIDE_ON.id) || (typeof SIT !== "undefined" && SIT.on) || (typeof ARC !== "undefined" && ARC.on) || !player; }
  function startRide(T0, end, now, opts) {
    if (PC.ride || !T0.route) return false; const o = opts || {}; const Rt = T0.route; const dir = end === 0 ? 1 : -1;
    if (cartMode) { try { toggleCart(); } catch (e) {} }
    const u0 = o.u !== undefined ? o.u : dir > 0 ? Rt.uA : Rt.uB;
    const R = PC.ride = { T: T0, dir, u: u0, st: o.instant ? "run" : "board", at: now + 460, t0: now, last: now, yaw0: yaw, pitch0: pitch, seat: { g: PC.rideShuttle }, paused: !!o.paused, skip: false, hallDone: false };
    PC.rideShuttle.userData.inner.scale.setScalar(T0.cartScale); placeShuttle(PC.rideShuttle, Rt, R.u, dir); PC.rideShuttle.visible = true; for (const s of T0.parked) s.visible = false;
    SITES.ride = R.seat; if (T0.interior) T0.interior.visible = true;
    if (!o.instant) fadeTo(true, 420); else rideSetup(R, now);
    sfx("board"); setStatus(T0.id === "crossing" ? "The Crossing Shuttle · " + (dir > 0 ? "to the Expanse Gate" : "to Crossing Plaza") + " · SPACE to skip ahead" : "The Flight Line Link · " + (dir > 0 ? "to Propeller Plaza" : "to Link Plaza") + " · SPACE to skip ahead");
    return true; }
  function rideSetup(R, now) { R.st = "run"; R.last = now; fadeTo(false, 600); if (player && player.userData.walk) player.userData.walk.visible = false; if (player && player.userData.label) player.userData.label.visible = false; }
  function rideFinish(R) {
    const T0 = R.T; const end = R.dir > 0 ? 1 : 0; const Rm = T0.ramps[end]; const out = Rm.out; let face = out;
    if (T0.faceTo[end]) { const ft = T0.faceTo[end]; const dx = ft[0] - Rm.head[0], dz = ft[1] - Rm.head[1]; const l = Math.hypot(dx, dz); if (l > 1) face = [dx / l, dz / l]; }
    const px = Rm.head[0] + out[0] * 8, pz = Rm.head[1] + out[1] * 8;
    SITES.ride = null; PC.ride = null; PC.rideShuttle.visible = false; for (const s of T0.parked) s.visible = true;
    if (player) { player.userData.sit = false; if (player.userData.walk) player.userData.walk.visible = !FPV || true; if (player.userData.label) player.userData.label.visible = !FPV; }
    try { warpTo(px, pz); } catch (e) { player.position.set(px, getH(px, pz), pz); }
    yaw = Math.atan2(-face[0], -face[1]); pitch = 0.12; if (player) { player.rotation.y = Math.atan2(face[0], face[1]); const y = player.position.y; camera.position.set(px - face[0] * 9.5, y + 4.4, pz - face[1] * 9.5); camera.lookAt(px + face[0] * 20, y + 1.6, pz + face[1] * 20); }
    if (typeof CAM !== "undefined") { CAM.init = false; CAM.dist = 9.5; }
    const hud = document.getElementById("game-big"); if (hud) hud.textContent = ""; const hs = document.getElementById("game-s"); if (hs) hs.textContent = ""; const hn = document.getElementById("game-n"); if (hn) hn.textContent = "";
    setTimeout(() => fadeTo(false, 700), 140); sfx("board");
    setStatus(T0.id === "crossing" ? (end === 1 ? "The Expanse Gate · Main Street and the Genesis Ring straight ahead" : "Crossing Plaza · Stage One, The Landing") : (end === 1 ? "Propeller Plaza · Stage Two, The Flight Line" : "Link Plaza · the Terminal and Arrivals Court"));
    for (const k in TRIG) TRIG[k].cool = performance.now() + 1500; (TRIG[Rm.id] || (TRIG[Rm.id] = { prev: 99, cool: 0, hint: true })).hint = true;
    PC.lastRide = { id: T0.id, end, at: performance.now() };
  }
  // the ride camera: the front bench of the shuttle, looking down the route; the mouse looks around; the hall tilts it up
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  function rideCamera(R, now) { const T0 = R.T, Rt = T0.route, sh = PC.rideShuttle; const s = T0.cartScale;
    _eye.set(0, 2.2, 2.3); sh.userData.inner.localToWorld(_eye);
    const ahead = routeAt(Rt, R.u + R.dir * 14); let hx = ahead.x - _eye.x, hz = ahead.z - _eye.z; const hl = Math.hypot(hx, hz) || 1; const baseYaw = Math.atan2(hx, hz); let basePitch = Math.atan2(ahead.y + 1.9 * s - _eye.y, hl);
    const w = R.u - Rt.LA; const hall = T0.hall; let up = 0; if (hall) up = sstep(hall.w0 - 16, hall.w0 + 2, w) * (1 - sstep(hall.w1 - 2, hall.w1 + 14, w)); if (R.dir < 0 && hall) up = sstep(hall.w1 + 16, hall.w1 - 2, w) * (1 - sstep(hall.w0 + 2, hall.w0 - 14, w));
    const yo = clamp(yaw - R.yaw0, -2.2, 2.2), po = clamp(pitch - R.pitch0, -0.8, 0.8); const vy = baseYaw + yo, vp = clamp(basePitch + up * 1.02 - po * 0.9 + Math.sin(now * 0.0011) * 0.006, -0.9, 1.25);
    camera.position.copy(_eye); _look.set(_eye.x + Math.sin(vy) * Math.cos(vp) * 10, _eye.y + Math.sin(vp) * 10, _eye.z + Math.cos(vy) * Math.cos(vp) * 10); camera.lookAt(_look); }
  function rideHud(R) { const T0 = R.T, Rt = T0.route; if (typeof gameHud === "function") gameHud("crossing"); const n = document.getElementById("game-n"), b = document.getElementById("game-big"), s = document.getElementById("game-s"); if (!n || !b || !s) return;
    const w = R.u - Rt.LA; const toEnd = Math.max(0, Math.round((R.dir > 0 ? Rt.N - 1 - R.u : R.u) / 10) * 10); let next = T0.ends[R.dir > 0 ? 1 : 0] + "  " + toEnd + " m";
    if (T0.hall && ((R.dir > 0 && w < T0.hall.w1) || (R.dir < 0 && w > T0.hall.w0)) && Math.abs(w - (T0.hall.w0 + T0.hall.w1) / 2) < 70) next = Math.abs(w - (T0.hall.w0 + T0.hall.w1) / 2) < 14 ? "The Runway Hall · look up" : "Next: the Runway Hall";
    if (n.textContent !== T0.title) n.textContent = T0.title; if (b.textContent !== next) b.textContent = next; const line = "SPACE to skip ahead · " + APPROVAL_LC; if (s.textContent !== line) s.textContent = line; }
  function rideStep(dt, now) {
    const R = PC.ride; if (!R) return false; const T0 = R.T, Rt = T0.route; const rdt = clamp((now - R.last) / 1000, 0, 0.25); R.last = now;
    if (SITES.ride !== R.seat) { SITES.ride = R.seat; if (R.st === "run" && !R.paused) { R.st = "arrive"; R.at = now + 480; fadeTo(true, 420); setStatus("skipping ahead to " + T0.ends[R.dir > 0 ? 1 : 0]); } }
    if (R.st === "board") { if (now >= R.at) rideSetup(R, now); else { placeShuttle(PC.rideShuttle, Rt, R.u, R.dir); return false; } }
    if (R.st === "run" && !R.paused) { R.u += R.dir * speedAt(Rt, R.dir, R.u) * rdt; const end = R.dir > 0 ? Rt.uB : Rt.uA; if ((R.dir > 0 && R.u >= end) || (R.dir < 0 && R.u <= end)) { R.u = end; R.st = "arrive"; R.at = now + 520; fadeTo(true, 480); }
      if (T0.hall && !R.hallDone) { const w = R.u - Rt.LA; const enter = R.dir > 0 ? T0.hall.w0 - 12 : T0.hall.w1 + 12; if ((R.dir > 0 && w >= enter) || (R.dir < 0 && w <= enter)) { R.hallDone = true; LED.t0 = now - 1050; } } }
    placeShuttle(PC.rideShuttle, Rt, R.u, R.dir);
    if (player) { _eye.set(0, 1.5, 2.3); PC.rideShuttle.userData.inner.localToWorld(_eye); player.position.copy(_eye); player.rotation.y = PC.rideShuttle.rotation.y; if (player.userData.walk) player.userData.walk.visible = false; if (player.userData.label) player.userData.label.visible = false; }
    rideCamera(R, now); rideHud(R);
    if (R.st === "arrive" && now >= R.at) { rideFinish(R); return true; }
    return true; }

  // ───────────────────────── portal triggers and the trench camera ─────────────────────────
  const TRIG = {};
  function checkTriggers(now) { if (PC.ride || busy()) return; const px = player.position.x, pz = player.position.z;
    for (const T0 of PC.tunnels) { if (!T0.route) continue; T0.ramps.forEach((R, end) => { const key = R.id; const tr = TRIG[key] || (TRIG[key] = { prev: 99, cool: 0, hint: false }); const dx = px - R.head[0], dz = pz - R.head[1]; const al = dx * R.out[0] + dz * R.out[1], lat = dx * -R.out[1] + dz * R.out[0]; const prev = tr.prev; tr.prev = al;
      const inWidth = Math.abs(lat) < R.hw - 0.4; if (now < tr.cool) return;
      if (inWidth && prev > 0.15 && al <= 0.15 && al > -6) { startRide(T0, end, now); return; }
      if (!tr.hint && al > 1 && al < 22 && Math.abs(lat) < 14) { tr.hint = true; setStatus(T0.id === "crossing" ? "Walk into the portal to ride the Crossing Shuttle to " + T0.ends[1 - end] + " · " + APPROVAL_LC : "Walk into the portal to ride the Flight Line Link to " + T0.ends[1 - end] + " · " + APPROVAL_LC); } else if (tr.hint && (al > 40 || Math.abs(lat) > 30)) tr.hint = false;
      // someone who reached the bottom of a ramp on foot is picked up at the mouth
      const l = rampLocal(R, px, pz); if (l && l.u < 5) startRide(T0, end, now, { u: end === 0 ? T0.route.LA - 4 : T0.route.LA + T0.Lb + 4 }); }); } }
  function trenchCamera(dt) { if (!player || PC.ride || FPV) return false; const px = player.position.x, pz = player.position.z; let R = null, l = null; for (const q of PC.ramps) { const ll = rampLocal(q, px, pz); if (ll && ll.u < q.L - 4) { R = q; l = ll; break; } } if (!R) return false;
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)]; const dist = 7.5; let cx = px - fwd[0] * dist, cz = pz - fwd[1] * dist; const cl = rampLocal(R, cx, cz, 0.2);
    let local = cl; if (!local) { // clamp into the trench: walk back toward the player until inside
      for (let k = 0.9; k >= 0; k -= 0.1) { const tx = px - fwd[0] * dist * k, tz = pz - fwd[1] * dist * k; const q = rampLocal(R, tx, tz, -0.5); if (q) { cx = tx; cz = tz; local = q; break; } } }
    if (!local) { cx = px - fwd[0] * 1.5; cz = pz - fwd[1] * 1.5; }
    const baseY = player.position.y; const cy = baseY + 2.6 + pitch * 3; camTarget.set(cx, cy, cz); if (camera.position.distanceTo(camTarget) > 14) camera.position.copy(camTarget); else camera.position.lerp(camTarget, 1 - Math.exp(-dt * 12)); camera.lookAt(px, baseY + 1.5, pz); if (player.userData.walk) player.userData.walk.visible = true; return true; }
  function interiorHook(dt, now) { if (!PC.built.defer) return false; if (PC.camOverride && !PC.ride) { const c = PC.camOverride; camera.position.set(c.p[0], c.p[1], c.p[2]); camera.lookAt(c.l[0], c.l[1], c.l[2]); return true; } let took = false; try { took = rideStep(dt, now); } catch (e) { PC.errors.push("ride: " + e.message); console.warn("plan_crossing ride failed", e); endRideNow(); } if (took) return true; return trenchCamera(dt); }
  // leave a ride at once (an error, or the player travelling elsewhere): step out at the nearer portal, never underground
  function endRideNow() { const R = PC.ride; if (!R) return; PC.ride = null; SITES.ride = null; PC.rideShuttle.visible = false; for (const s of R.T.parked) s.visible = true; fadeTo(false, 300);
    const hud = ["game-big", "game-s", "game-n"]; for (const id of hud) { const el = document.getElementById(id); if (el) el.textContent = ""; }
    if (player) { player.userData.sit = false; if (player.userData.walk) player.userData.walk.visible = true; if (player.userData.label) player.userData.label.visible = !FPV;
      const Rt = R.T.route; const end = R.u > (Rt.N - 1) / 2 ? 1 : 0; const Rm = R.T.ramps[end]; const px = Rm.head[0] + Rm.out[0] * 8, pz = Rm.head[1] + Rm.out[1] * 8; try { warpTo(px, pz); } catch (e) { player.position.set(px, getH(px, pz), pz); } } }
  // travel buttons, the site map and the places list end a ride first, so the jump is never undone by the shuttle seat
  document.addEventListener("click", (e) => { if (!PC.ride) return; const t = e.target; if (t && t.closest && t.closest("#warp, #mm, #places, #info-nav, #nav, #tour, #plist, #talk, #replayfly, .places, [data-w]")) endRideNow(); }, true);

  // ───────────────────────── per-frame upkeep ─────────────────────────
  let NIGHT_AT = -1;
  function frameHook(dt, now) { if (!PC.built.defer || !player) return;
    try { checkTriggers(now); } catch (e) { PC.errors.push("trigger: " + e.message); }
    if ((FRAME_N % 6) === 0) { const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (const T0 of PC.tunnels) { if (!T0.interior) continue; let vis = !!(PC.ride && PC.ride.T === T0); if (!vis) for (const m of [T0.A, T0.B]) { const d = Math.hypot(cx - m[0], cz - m[1]); if (d < 110 && cy < grade(cx, cz) + 14) { vis = true; break; } } if (T0.interior.visible !== vis) T0.interior.visible = vis; }
      for (const T0 of PC.tunnels) for (const s of T0.parked || []) { if (PC.ride && PC.ride.T === T0) continue; const d = Math.hypot(cx - s.position.x, cz - s.position.z); const vis = d < 420; if (s.visible !== vis) s.visible = vis; } }
    // the LED ceiling: a jet rolls over on every ride and every 24 s while someone is in the hall
    const Tc = PC.tunnels[0]; if (Tc && Tc.interior && Tc.interior.visible && LED.uni) { LED.uni.uT.value = now / 1000; LED.uni.uNight.value = typeof night === "number" ? night * 0.85 : 0; if (now > LED.t0 + 9000 && now > LED.next) { LED.t0 = now + 800; LED.next = now + 24000; } const t = (now - LED.t0) / 1000; LED.uni.uJet.value = LED.fixed !== undefined && LED.fixed !== null ? LED.fixed : t >= 0 && t < 10 ? -19 + t * 4 : -100; }
    for (const T0 of PC.tunnels) if (T0.interior && T0.interior.visible && MT.iBelt && MT.iBelt.map) { MT.iBelt.map.offset.y -= dt * 0.65; }
    // lit signs, bulbs and the Rabbit's warm glow follow the night
    if (Math.abs((typeof night === "number" ? night : 0) - NIGHT_AT) > 0.02) { NIGHT_AT = typeof night === "number" ? night : 0; for (const [m, k] of PC.glowMats) m.emissiveIntensity = NIGHT_AT * k; for (const m of PC.nightFade || []) m.opacity = m.userData.base * sstep(0.25, 0.7, NIGHT_AT); }
    if (PC.spin) for (const s of PC.spin) if (s.visible !== false && Math.hypot(camera.position.x - s.x, camera.position.z - s.z) < 300) s.o.rotation[s.axis] += dt * s.speed;
  }

  // ───────────────────────── portals ─────────────────────────
  // an airfield-style portal sign: location sign (yellow on black), direction sign (black on yellow), approval band
  function portalSignTex(loc, dirText, sub) { return canvasTex(1024, 300, (x, w, h) => { x.fillStyle = "#111"; x.fillRect(0, 0, w, h); const hb = h * 0.66; const lw = w * 0.42;
    x.fillStyle = "#111"; x.fillRect(0, 0, lw, hb); x.strokeStyle = "#f2c230"; x.lineWidth = 8; x.strokeRect(14, 14, lw - 28, hb - 28); x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#f2c230"; x.font = `400 ${fitText(x, loc, lw - 60, hb * 0.5, FONT.d)}px ${FONT.d}`; x.fillText(loc, lw / 2, hb / 2 + 2);
    x.fillStyle = "#f2c230"; x.fillRect(lw + 8, 0, w - lw - 8, hb); x.fillStyle = "#111"; x.font = `400 ${fitText(x, dirText, w - lw - 50, hb * 0.42, FONT.d)}px ${FONT.d}`; x.fillText(dirText, lw + 8 + (w - lw - 8) / 2, hb / 2 + 2);
    x.fillStyle = "#1c1a17"; x.fillRect(0, hb, w, h - hb); x.fillStyle = "#f5f1e6"; x.font = `600 ${fitText(x, sub, w - 40, (h - hb) * 0.34, FONT.b, 600)}px ${FONT.b}`; x.fillText(sub, w / 2, hb + (h - hb) * 0.34); x.fillStyle = "#e9c46a"; x.font = `600 ${fitText(x, APPROVAL, w - 40, (h - hb) * 0.26, FONT.b, 600)}px ${FONT.b}`; x.fillText(APPROVAL, w / 2, hb + (h - hb) * 0.74); }, { text: true, fonts: true }); }
  function signBoard(grp, c, yaw, w, h, texFront, texBack) { const g = new Geo(); g.box(c, w / 2 + 0.08, h / 2 + 0.08, 0.09, yaw); const fr = g.mesh(mats().dark, { cast: true }); if (fr) grp.add(fr);
    for (const [tex, sd] of [[texFront, 1], [texBack, -1]]) { if (!tex) continue; const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), textMat(tex, { glow: 0.55 })); pl.position.set(c[0] + Math.sin(yaw) * 0.1 * sd, c[1], c[2] + Math.cos(yaw) * 0.1 * sd); pl.rotation.y = yaw + (sd < 0 ? Math.PI : 0); grp.add(pl); } }
  // the procedural steel and glass canopy (the Flight Line Link portals, and The Crossing if the arch model is missing)
  function canopy(grp, R, width, label) { const m = mats(); const g = { steel: new Geo(), glass: new Geo(), white: new Geo(), led: new Geo() }; const hw = width / 2;
    const at = (u, t) => { const q = atLen(R.pts, clamp(u, 0, R.L)); const nx = -q[3], nz = q[2]; return [q[0] + nx * t, q[1] + nz * t]; };
    const yaw = Math.atan2(R.out[0], R.out[1]); const frames = [R.L - 5.5, R.L - 12, R.L - 18.5]; const H0 = 5.4;
    const gy = (u, t) => { const p = at(u, t); return grade(p[0], p[1]); };
    for (const u of frames) { let top = -1e9; for (const sd of [-1, 1]) { const p = at(u, sd * hw); const y0 = gy(u, sd * hw) - 0.2; top = Math.max(top, y0 + H0); g.steel.box([p[0], y0 + H0 / 2, p[1]], 0.16, H0 / 2 + 0.2, 0.16, yaw); } const c = at(u, 0); g.steel.box([c[0], top + 0.12, c[1]], hw + 0.2, 0.18, 0.2, yaw); R.canopyTop = top; }
    const top = R.canopyTop + 0.3; const ua = R.L - 3.5, ub = R.L - 20.5;
    for (const [u0, u1] of [[ua, (ua + ub) / 2], [(ua + ub) / 2, ub]]) { const a0 = at(u0, -hw - 0.4), a1 = at(u0, hw + 0.4), b1 = at(u1, hw + 0.4), b0 = at(u1, -hw - 0.4); g.glass.quad([a0[0], top, a0[1]], [a1[0], top, a1[1]], [b1[0], top - 0.35, b1[1]], [b0[0], top - 0.35, b0[1]], [0, 0], [1, 0], [1, 1], [0, 1]); }
    for (let u = ua; u >= ub - 0.01; u -= 2.125) { const a = at(u, -hw - 0.4), b = at(u, hw + 0.4); const yy = top - 0.35 * (ua - u) / (ua - ub) - 0.06; g.steel.rod([a[0], yy, a[1]], [b[0], yy, b[1]], 0.05); }
    for (const sd of [-1, 1]) { const a = at(ua, sd * (hw + 0.4)), b = at(ub, sd * (hw + 0.4)); g.steel.rod([a[0], top - 0.05, a[1]], [b[0], top - 0.4, b[1]], 0.09); }
    // the fascia over the plaza end, with the portal name
    const fc = at(ua + 0.1, 0); const fy = top - 0.5; g.white.box([fc[0], fy, fc[1]], hw + 0.5, 0.55, 0.14, yaw);
    g.led.box([fc[0], fy - 0.62, fc[1]], hw + 0.3, 0.02, 0.1, yaw);
    for (const k in g) { const me = g[k].mesh(k === "steel" ? m.steel : k === "glass" ? m.glass : k === "white" ? m.white : m.led, { cast: k !== "glass" && k !== "led" }); if (me) { if (k === "glass") me.renderOrder = 3; grp.add(me); } }
    const lt = bigText([{ text: label, y: 0.52, size: 0.64, color: "#1d2a31" }], 1024, 128, "#f2efe8"); const pl = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 0.6, 0.9), textMat(lt, { glow: 0.35 })); pl.position.set(fc[0] + R.out[0] * 0.16, fy, fc[1] + R.out[1] * 0.16); pl.rotation.y = yaw; grp.add(pl);
    for (const u of frames) for (const sd of [-1, 1]) { const p = at(u, sd * hw); COLLIDERS.push([p[0], p[1], 0.3]); addSolid(p[0], p[1], yaw, 0.4, 0.4, gy(u, sd * hw) - 0.5, gy(u, sd * hw) + H0, "world"); }
    return { fascia: [fc[0], fy, fc[1]], yaw, top }; }
  function buildPortals() { const grp = group("crossing_portals");
    for (const T0 of PC.tunnels) { T0.ramps.forEach((R, end) => { const yaw = Math.atan2(R.out[0], R.out[1]);
      const sgn = PLAN_IDX && window.PLAN ? (window.PLAN.signs || []).find((s) => s.id === (T0.id === "crossing" ? (end === 0 ? "sg583" : "sg584") : (end === 0 ? "sg585" : "sg586"))) : null; const faces = sgn ? sgn.faces : [];
      const loc = T0.id === "crossing" ? "THE CROSSING" : "FLIGHT LINE LINK"; const dirText = T0.id === "crossing" ? (end === 0 ? "THE EXPANSE  STAGE THREE ->" : "<- THE LANDING  TERMINAL") : (end === 0 ? "STAGE TWO  THE FLIGHT LINE ->" : "<- TERMINAL  ARRIVALS COURT");
      const sub = T0.id === "crossing" ? "The Crossing Shuttle boards here · 460 m portal to portal · the Runway Hall at the middle" : "The Link cart boards here · 230 m ramp head to ramp head, under the main taxiway";
      const backDir = T0.id === "crossing" ? (end === 0 ? "<- CROSSING PLAZA" : "MAIN STREET AND THE RING ->") : (end === 0 ? "<- LINK PLAZA" : "PROPELLER PLAZA ->");
      const front = portalSignTex(loc, dirText, sub), back = portalSignTex(loc, backDir, end === 0 ? "Stage One · The Landing" : T0.id === "crossing" ? "Stage Three · The Expanse" : "Stage Two · The Flight Line");
      if (T0.id === "crossing" && hasModel("portal_arch")) { const c = atLen(R.pts, R.L - 6.5); const mo = MODELS.portal_arch; let y = 1e9; for (const lx of [-12.05, 12.05]) for (const lz of [-4.6, 4.6]) { const px = c[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), pz = c[1] - lx * Math.sin(yaw) + lz * Math.cos(yaw); y = Math.min(y, grade(px, pz)); } y -= 0.15;
        const arch = makeModel("portal_arch"); arch.position.set(c[0], y, c[1]); arch.rotation.y = yaw; arch.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); grp.add(arch);
        for (const lx of [-12.05, 12.05]) { const px = c[0] + lx * Math.cos(yaw), pz = c[1] - lx * Math.sin(yaw); addSolid(px, pz, yaw, 1.9, 10.0, y - 0.3, y + mo.height, "world"); COLLIDERS.push([px, pz, 0.95]); }
        const sc = [c[0], y + 4.95, c[1]]; signBoard(grp, sc, yaw, 7.6, 2.2, front, back); { const g = new Geo(); for (const sd of [-1, 1]) { const px = c[0] + sd * 3.2 * Math.cos(yaw), pz = c[1] - sd * 3.2 * Math.sin(yaw); g.rod([px, y + 6.05, pz], [px, y + 7.6, pz], 0.04); } const me = g.mesh(mats().steel, {}); if (me) grp.add(me); }
        R.portal = { kind: "arch", c, y }; }
      else { const info = canopy(grp, R, T0.id === "crossing" ? T0.hw * 2 + 2.8 : T0.hw * 2 + 2.6, loc); const c = atLen(R.pts, R.L - 12); const bh = T0.id === "crossing" ? 2.5 : 2.1; const y = info.top - 0.5 - bh / 2; signBoard(grp, [c[0], y, c[1]], yaw, T0.id === "crossing" ? 8.6 : 7.2, bh, front, back); R.portal = { kind: "canopy", c, y: info.top }; } }); }
    scene.add(grp); }
  // parked shuttles at both platforms and the one that rides
  function buildShuttles() { PC.rideShuttle = makeShuttle(1); PC.rideShuttle.visible = false;
    for (const T0 of PC.tunnels) { const Rt = buildRoute(T0); T0.parked = [makeShuttle(T0.cartScale), makeShuttle(T0.cartScale)]; placeShuttle(T0.parked[0], Rt, Rt.uA, 1); placeShuttle(T0.parked[1], Rt, Rt.uB, -1); } }

  // ───────────────────────── set pieces ─────────────────────────
  const SP = PC.set;
  const fount = (id) => (typeof PLAN_IDX !== "undefined" && PLAN_IDX.fount.get(id)) || null;
  function registerFountain(id, g, x, z) { const anim = []; g.traverse((o) => { if (o !== g && (o.isPoints || (o.material && o.material.isShaderMaterial))) anim.push(o); }); if (typeof PLAN_FOUNTAINS !== "undefined") PLAN_FOUNTAINS.push({ id, g, anim, x, z, near: true, vis: true }); }
  // world phase: where things go (colliders and keep-outs, and anything of the core layout standing where they go)
  function setpiecesWorld() {
    // Crossing Plaza frame: m toward the portal, l toward the Club Walk
    const Tc = PC.tunnels[0]; const RN = Tc.ramps[0]; const XP = Tc.plazaA; const mx = RN.head[0] - XP[0], mz = RN.head[1] - XP[1]; const ml = Math.hypot(mx, mz); const m = [mx / ml, mz / ml];
    const cw = window.PLAN.promenades.find((p) => p.id === "hl1_club_walk"); let l = [-m[1], m[0]]; if (cw) { const b = cw.pts[cw.pts.length - 2]; const lx = b[0] - XP[0], lz = b[1] - XP[1]; if (lx * l[0] + lz * l[1] < 0) l = [-l[0], -l[1]]; }
    SP.xp = { XP, m, l, ml };
    const at = (mm, ll) => [XP[0] + m[0] * mm + l[0] * ll, XP[1] + m[1] * mm + l[1] * ll];
    SP.biplane = { c: at(13, -15.5) }; COLLIDERS.push([SP.biplane.c[0], SP.biplane.c[1], 4.5]); KEEPOUT.push([SP.biplane.c[0], SP.biplane.c[1], 7]);
    SP.beacon = { c: at(19, 15) }; COLLIDERS.push([SP.beacon.c[0], SP.beacon.c[1], 1.2]);
    // the Sun Gate over the Sun Gate Walk: clear the allee trees under the shell and its four feet
    const sg = planPlace("sun_gate"), sw = window.PLAN.promenades.find((p) => p.id === "sun_gate_walk");
    if (sg && sw) { const pl = polyLocal(sw.pts, sg.x, sg.z); const a = atLen(sw.pts, clamp(pl.along - 6, 0, polyLen(sw.pts))), b = atLen(sw.pts, clamp(pl.along + 6, 0, polyLen(sw.pts))); let dx = b[0] - a[0], dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl; const yaw = Math.atan2(-dz, dx);
      SP.sungate = { c: [sg.x, sg.z], yaw, dir: [dx, dz] }; const mo = hasModel("sun_gate") ? MODELS.sun_gate : { sx: 22, sz: 15.7 }; const hx = mo.sx / 2 + 1.5, hz = mo.sz / 2 + 1.5; const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const local = (x, z) => { const ddx = x - sg.x, ddz = z - sg.z; return [ddx * cs - ddz * sn, ddx * sn + ddz * cs]; };
      SP.cleared = (SP.cleared || 0) + clearWhere((x, z, kind) => { if (kind === "solar") return false; const q = local(x, z); return Math.abs(q[0]) < hx && Math.abs(q[1]) < hz && !(kind === "lamp" && Math.abs(q[1]) < 5.2); });
      SP.sungate.feet = [[-9.6, -7.0], [9.7, -7.1], [-9.6, 7.05], [9.75, 7.05]].map(([lx, lz]) => [sg.x + lx * cs + lz * sn, sg.z - lx * sn + lz * cs]); for (const f of SP.sungate.feet) COLLIDERS.push([f[0], f[1], 0.95]); }
    // the Frontier Arch over the head of Main Street: the spot nearest the plan's that keeps its posts clear of lamps and trees
    const ms = window.PLAN.promenades.find((p) => p.id === "hl3_main_street"); const fa = planPlace("frontier_arch");
    if (ms) { const L0 = fa ? polyLocal(ms.pts, fa.x, fa.z).along : 62; const sc = 1.05; const postOff = 7.9 * sc; let best = null;
      for (let a = L0 - 12; a <= L0 + 6; a += 0.5) { const q = atLen(ms.pts, a); const nx = -q[3], nz = q[2]; let clear = 99; for (const sd of [-1, 1]) { const px = q[0] + nx * postOff * sd, pz = q[1] + nz * postOff * sd; for (const k in PLACE) for (const e of PLACE[k]) { const d = Math.hypot(e[0] - px, e[2] - pz); if (d < clear) clear = d; } if (typeof SOLAR !== "undefined") for (const p of SOLAR.pts) { const d = Math.hypot(p[0] - px, p[1] - pz); if (d < clear) clear = d; } } const score = Math.min(clear, 3.2) - Math.abs(a - L0) * 0.04; if (!best || score > best.score) best = { a, score, q, clear }; }
      const q = best.q; const D = [q[2], q[3]]; SP.arch = { c: [q[0], q[1]], along: best.a, clear: best.clear, D, sc, yaw: Math.atan2(-D[0], -D[1]), posts: [-1, 1].map((sd) => [q[0] - q[3] * postOff * sd, q[1] + q[2] * postOff * sd]) }; for (const p of SP.arch.posts) COLLIDERS.push([p[0], p[1], 0.75]); }
    // the Frontier Well at the Expanse Gate
    const fw = fount("frontier_well"); SP.well = { c: fw ? [fw.x, fw.z] : Tc.plazaB };
    // D2: 8 m to the right of the Main Street axis and 4 m on (clear of the paved approach, on the 1928 Strip), so the headframe
    // (the same angular size as the Frontier Arch from the arrival point) no longer hides the Arch, Main Street and the Ring you
    // surface facing; it is still in front of you on the gate plaza
    if (ms && ms.pts.length > 1) { const a = ms.pts[0], b = ms.pts[1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const fx = (b[0] - a[0]) / L, fz = (b[1] - a[1]) / L; SP.well.axisC = SP.well.c.slice(); SP.well.c = [SP.well.c[0] + fx * 4 - fz * 8, SP.well.c[1] + fz * 4 + fx * 8]; const wc = SP.well.c; SP.cleared = (SP.cleared || 0) + clearWhere((x, z) => Math.hypot(x - wc[0], z - wc[1]) < 4.6); }
    COLLIDERS.push([SP.well.c[0], SP.well.c[1], 2.9]); KEEPOUT.push([SP.well.c[0], SP.well.c[1], 6]);
    // the Welcome Fountain terrace
    const wf = fount("welcome"); SP.welcome = { c: wf ? [wf.x, wf.z] : [129.4, -141.7], R: 7.4 }; COLLIDERS.push([SP.welcome.c[0], SP.welcome.c[1], 3.0]); KEEPOUT.push([SP.welcome.c[0], SP.welcome.c[1], 8]);
    SP.cleared = (SP.cleared || 0) + clearWhere((x, z, kind) => kind !== "solar" && Math.hypot(x - SP.welcome.c[0], z - SP.welcome.c[1]) < SP.welcome.R + 0.8);
    // the Club Walk arcade: its columns (benches and bollards keep off them)
    SP.arcade = arcadePlan(); if (SP.arcade) { for (const c of SP.arcade.columns) COLLIDERS.push([c[0], c[1], 0.22]);
      // the arcade floor: cantera pavers from the walk edge to the shop fronts, under the canopy
      for (const sd of SP.arcade.sides) { const pts = []; const lat = sd.sd * (sd.edge - 0.35 + sd.back) / 2; const nseg = Math.max(2, Math.ceil((sd.b - sd.a) / 4)); for (let i = 0; i <= nseg; i++) { const q = atLen(SP.arcade.pts, sd.a + (sd.b - sd.a) * i / nseg); pts.push([q[0] - q[3] * lat, q[1] + q[2] * lat]); } if (pts.length >= 2) planRibbon(pts, sd.back - sd.edge + 0.35, { mat: planMats().stone, lift: 0.36, tile: 4.5 }, "clubwalk_arcade"); } }
    // the Flight Deck terrace
    const fd = typeof PLAN_BLD !== "undefined" ? PLAN_BLD.find((r) => /^the flight deck/i.test(r.b.name || "")) : null; if (fd) { SP.deck = { rec: fd }; const e = fd.e, f = [Math.sin(e[3]), Math.cos(e[3])]; const mo = MODELS[fd.kind]; const d0 = (mo ? mo.sz / 2 * e[4] : 6) + 0.6; SP.deck.d0 = d0; SP.deck.f = f; const c = [e[0] + f[0] * (d0 + 4.2), e[2] + f[1] * (d0 + 4.2)]; KEEPOUT.push([c[0], c[1], 9]); SP.deck.c = c; }
  }
  function hotspotsWorld() {
    for (const T0 of PC.tunnels) T0.ramps.forEach((R, end) => { const hx = R.head[0] + R.out[0] * 4, hz = R.head[1] + R.out[1] * 4;
      if (T0.id === "crossing") hotspots.push({ x: hx, z: hz, r: 14, t: "The Crossing", k: (end === 0 ? "the north portal · Stage One · The Landing" : "the south portal · Stage Three · The Expanse"), p: "Walk in under the arch to ride the Crossing Shuttle under the parallel taxiway and Runway 03/21 to " + T0.ends[1 - end] + ": 460 m portal to portal, 225 m of it covered, with the Runway Hall and its LED ceiling at the middle. The walls tell the story from the founding of the town to the old airfield and the frontier ahead. " + APPROVAL + "." });
      else hotspots.push({ x: hx, z: hz, r: 12, t: "The Flight Line Link", k: (end === 0 ? "the north portal · Link Plaza" : "the south portal · Propeller Plaza") + " · ride the Link cart", p: "Walk in under the canopy to ride the Link cart under the main taxiway to " + T0.ends[1 - end] + ": 230 m ramp head to ramp head, 60 m of it covered. " + APPROVAL + "." }); });
    if (SP.biplane) hotspots.push({ x: SP.biplane.c[0], z: SP.biplane.c[1], r: 9, t: "The 1928 Biplane", k: "Crossing Plaza · Stage One · The Landing", p: "A static replica of the open-cockpit biplanes that flew the valley when the airfield was new. The Rabbit's floor jets run from here to The Crossing." });
    if (SP.beacon) hotspots.push({ x: SP.beacon.c[0], z: SP.beacon.c[1], r: 6, t: "The replica beacon", k: "Crossing Plaza · static and unlit", p: "A replica of a 1920s airfield beacon tower. It stays dark: nothing on our land may look like an airfield light." });
    if (SP.welcome) hotspots.push({ x: SP.welcome.c[0], z: SP.welcome.c[1], r: 11, t: "The Welcome Fountain", k: "Arrivals Court · Stage One · The Landing", p: "The first water you see: a three-tier cantera fountain with a bronze propeller finial. The tiers are shallow spill lips over floor jets and a flush grated drain, so no water stands anywhere near the airfield." });
    if (SP.well) hotspots.push({ x: SP.well.c[0], z: SP.well.c[1], r: 8, t: "The Frontier Well", k: "Expanse Gate · Stage Three · The Expanse", p: "You come up out of The Crossing facing this: a stone well with a timber headframe spilling into a timber trough over a grated drain. Main Street runs straight on under the Frontier Arch to the Genesis Ring." });
  }

  // the Club Walk arcade: continuous canopies along both rows of streamline storefronts
  function arcadePlan() { const cw = window.PLAN.promenades.find((p) => p.id === "hl1_club_walk"); if (!cw || typeof PLAN_BLD === "undefined") return null; const pts = cw.pts; const Lw = polyLen(pts);
    const stores = PLAN_BLD.filter((r) => /streamline storefront/i.test(r.b.name || "") && r.b.street === "hl1_club_walk").map((r) => { const pl = polyLocal(pts, r.e[0], r.e[2]); const mo = MODELS[r.kind]; const half = mo ? mo.sx / 2 * r.e[4] : 3.6; const depth = mo ? mo.sz / 2 * r.e[4] : 5.5; return { along: pl.along, lat: pl.lat, half, front: Math.abs(pl.lat) - depth }; });
    if (!stores.length) return null; const sides = []; for (const sd of [-1, 1]) { const S = stores.filter((s) => Math.sign(s.lat) === sd).sort((a, b) => a.along - b.along); if (!S.length) continue; const runs = []; let cur = null; for (const s of S) { if (cur && s.along - s.half - cur.b < 12) { cur.b = s.along + s.half; cur.front = Math.min(cur.front, s.front); } else { cur = { a: s.along - s.half, b: s.along + s.half, front: s.front }; runs.push(cur); } } for (const r of runs) sides.push({ sd, a: Math.max(0.5, r.a - 0.6), b: Math.min(Lw - 0.5, r.b + 0.6), back: r.front - 0.05, edge: 11.55 }); }
    const own = new Set(ROADS.filter((q) => q.plan === "hl1_club_walk")); const columns = [];
    for (const s of sides) for (let a = s.a + 1.2; a <= s.b - 1.0; a += 6.8) { const q = atLen(pts, a); const nx = -q[3], nz = q[2]; const x = q[0] + nx * (s.edge + 0.3) * s.sd, z = q[1] + nz * (s.edge + 0.3) * s.sd; let ok = true; for (const k of ["lamp", "fanpalm", "paloverde", "agave_cluster", "bush1"]) for (const e of PLACE[k] || []) if (Math.hypot(e[0] - x, e[2] - z) < 1.3) ok = false; if (typeof SOLAR !== "undefined") for (const p of SOLAR.pts) if (Math.hypot(p[0] - x, p[1] - z) < 1.0) ok = false; if (ok) columns.push([x, z, a, s.sd]); }
    return { pts, sides, columns, own }; }

  function buildArcade() { const A = SP.arcade; if (!A) return; const m = mats(); const g = { slab: new Geo(), fascia: new Geo(), stripe: new Geo(), column: new Geo(), bulb: new Geo(), kerb: new Geo() }; const pts = A.pts; const grp = group("clubwalk_arcade");
    const P = (a, lat) => { const q = atLen(pts, a); return [q[0] - q[3] * lat, q[1] + q[2] * lat]; };
    const walkY = (x, z) => surface(x, z);
    for (const s of A.sides) { const n = Math.max(2, Math.ceil((s.b - s.a) / 3)); const y0 = walkY(...P((s.a + s.b) / 2, s.sd * 11)) + 4.05;
      for (let i = 0; i < n; i++) { const a0 = s.a + (s.b - s.a) * i / n, a1 = s.a + (s.b - s.a) * (i + 1) / n; const e0 = P(a0, s.sd * s.edge), e1 = P(a1, s.sd * s.edge), b0 = P(a0, s.sd * s.back), b1 = P(a1, s.sd * s.back);
        const ya = walkY(...P(a0, s.sd * 11)) + 4.05, yb = walkY(...P(a1, s.sd * 11)) + 4.05;
        g.slab.quad([e0[0], ya + 0.28, e0[1]], [e1[0], yb + 0.28, e1[1]], [b1[0], yb + 0.28, b1[1]], [b0[0], ya + 0.28, b0[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
        g.slab.quad([e0[0], ya, e0[1]], [e1[0], yb, e1[1]], [b1[0], yb, b1[1]], [b0[0], ya, b0[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
        g.fascia.quad([e0[0], ya - 0.22, e0[1]], [e1[0], yb - 0.22, e1[1]], [e1[0], yb + 0.36, e1[1]], [e0[0], ya + 0.36, e0[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
        const s0 = P(a0, s.sd * (s.edge - 0.01)), s1 = P(a1, s.sd * (s.edge - 0.01)); g.stripe.quad([s0[0], ya + 0.02, s0[1]], [s1[0], yb + 0.02, s1[1]], [s1[0], yb + 0.1, s1[1]], [s0[0], ya + 0.1, s0[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
        const bc = P((a0 + a1) / 2, s.sd * (s.edge + 1.6)); g.bulb.box([bc[0], (ya + yb) / 2 - 0.02, bc[1]], 0.16, 0.02, 0.16, 0); }
      for (const a of [s.a, s.b]) { const e = P(a, s.sd * s.edge), b = P(a, s.sd * s.back); const y = walkY(...P(a, s.sd * 11)) + 4.05; g.fascia.quad([e[0], y - 0.22, e[1]], [b[0], y - 0.22, b[1]], [b[0], y + 0.36, b[1]], [e[0], y + 0.36, e[1]], [0, 0], [1, 0], [1, 1], [0, 1]); } }
    for (const c of A.columns) { const y0 = walkY(c[0], c[1]); const s = A.sides.find((q) => q.sd === c[3] && c[2] >= q.a && c[2] <= q.b); const y1 = walkY(...P(c[2], c[3] * 11)) + 4.05; g.column.add(new THREE.CylinderGeometry(0.1, 0.12, y1 - y0 + 0.05, 10), mtx(c[0], (y0 + y1) / 2, c[1])); g.column.add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), mtx(c[0], y0 + 0.04, c[1])); if (!s) continue; }
    // the median: raised cantera kerbs either side of the fan palm bed, with crossings every 36 m and round the runnel
    { const Lw = polyLen(pts); const rn = fount("clubwalk_f"); const rnA = rn ? polyLocal(pts, rn.x, rn.z).along : -99; const gaps = []; for (let a = 30; a < Lw - 10; a += 36) gaps.push([a - 1.6, a + 1.6]); gaps.push([rnA - 4.2, rnA + 4.2]);
      for (const sd of [-1, 1]) { let a = 6; const endA = Lw - 3; const inGap = (x) => gaps.some(([p, q]) => x > p && x < q);
        while (a < endA) { if (inGap(a)) { a += 0.5; continue; } let b = a; while (b < endA && !inGap(b + 0.5) && b - a < 12) b += 0.5; if (b - a > 1) { const n = Math.ceil((b - a) / 3); for (let i = 0; i < n; i++) { const a0 = a + (b - a) * i / n, a1 = a + (b - a) * (i + 1) / n; const p0 = P(a0, sd * 2.05), p1 = P(a1, sd * 2.05); const ya = walkY(p0[0], p0[1]) , yb = walkY(p1[0], p1[1]); const ta = P(a0, sd * 2.2), tb = P(a1, sd * 2.2), ia = P(a0, sd * 1.9), ib = P(a1, sd * 1.9);
                g.kerb.quad([ta[0], ya + 0.42, ta[1]], [tb[0], yb + 0.42, tb[1]], [ib[0], yb + 0.42, ib[1]], [ia[0], ya + 0.42, ia[1]], [0, 0], [1, 0], [1, 1], [0, 1]); g.kerb.quad([ta[0], ya - 0.05, ta[1]], [tb[0], yb - 0.05, tb[1]], [tb[0], yb + 0.42, tb[1]], [ta[0], ya + 0.42, ta[1]], [0, 0], [1, 0], [1, 1], [0, 1]); g.kerb.quad([ia[0], ya - 0.05, ia[1]], [ib[0], yb - 0.05, ib[1]], [ib[0], yb + 0.42, ib[1]], [ia[0], ya + 0.42, ia[1]], [0, 0], [1, 0], [1, 1], [0, 1]); }
              for (const [x0, x1] of [[a, a], [b, b]]) { const p = P(x0, sd * 2.05); const y = walkY(p[0], p[1]); const ta = P(x0, sd * 2.2), ia = P(x0, sd * 1.9); g.kerb.quad([ta[0], y - 0.05, ta[1]], [ia[0], y - 0.05, ia[1]], [ia[0], y + 0.42, ia[1]], [ta[0], y + 0.42, ta[1]], [0, 0], [1, 0], [1, 1], [0, 1]); }
              const mid = P((a + b) / 2, sd * 2.05), q0 = atLen(pts, (a + b) / 2); addSolid(mid[0], mid[1], Math.atan2(q0[2], q0[3]), 0.3, b - a, walkY(mid[0], mid[1]) - 0.3, walkY(mid[0], mid[1]) + 0.42, "world"); }
          a = b + 0.5; } } }
    const matOf = { slab: m.white, fascia: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide }), stripe: new THREE.MeshStandardMaterial({ color: 0x2fae57, roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), column: new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.3, metalness: 0.7 }), bulb: MT.bulb, kerb: fountainMats().stone };
    for (const k in g) { const me = g[k].mesh(matOf[k], { cast: k === "slab" || k === "column" || k === "kerb" }); if (me) grp.add(me); }
    scene.add(grp); PC.stats.arcade = { sides: A.sides.length, columns: A.columns.length }; }

  function buildRabbit() { const Tc = PC.tunnels[0], RN = Tc.ramps[0]; const X0 = SP.xp; if (!X0) return; const m = X0.m, XP = X0.XP; const grp = group("the_rabbit"); const g = { grate: new Geo(), bronze: new Geo(), glow: new Geo() };
    const jets = []; for (let a = 3; a <= 30.1; a += 2.5) jets.push([XP[0] + m[0] * a, XP[1] + m[1] * a]);
    const nx = -m[1], nz = m[0];
    for (let a = 1.5; a < 31.5; a += 1.5) { const p0 = [XP[0] + m[0] * a, XP[1] + m[1] * a], p1 = [XP[0] + m[0] * (a + 1.5), XP[1] + m[1] * (a + 1.5)]; const y0 = surface(p0[0], p0[1]) + 0.012, y1 = surface(p1[0], p1[1]) + 0.012; g.grate.quad([p0[0] - nx * 0.45, y0, p0[1] - nz * 0.45], [p0[0] + nx * 0.45, y0, p0[1] + nz * 0.45], [p1[0] + nx * 0.45, y1, p1[1] + nz * 0.45], [p1[0] - nx * 0.45, y1, p1[1] - nz * 0.45], [0, a / 0.9], [1, a / 0.9], [1, (a + 1.5) / 0.9], [0, (a + 1.5) / 0.9]); }
    const base = [XP[0], surface(XP[0], XP[1]), XP[1]]; grp.position.set(base[0], base[1], base[2]);
    const loc = jets.map((j) => [j[0] - base[0], surface(j[0], j[1]) + 0.03 - base[1], j[1] - base[2]]);
    for (const p of loc) { g.bronze.add(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), mtx(p[0] + base[0], p[1] + base[1], p[2] + base[2])); g.glow.add(new THREE.CylinderGeometry(0.05, 0.16, 1.0, 10, 1, true), mtx(p[0] + base[0], p[1] + base[1] + 0.52, p[2] + base[2])); }
    const gtex = canvasTex(16, 128, (x, w, h) => { const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(255,240,210,0)"); gr.addColorStop(0.55, "rgba(255,240,210,0.35)"); gr.addColorStop(1, "rgba(255,244,222,1)"); x.fillStyle = gr; x.fillRect(0, 0, w, h); }); const gm = new THREE.MeshBasicMaterial({ color: 0xfff0d2, map: gtex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); gm.userData.base = 0.42; (PC.nightFade = PC.nightFade || []).push(gm);
    const inner = group("rabbit_world"); for (const [k, mat] of [["grate", mats().grate], ["bronze", mats().bronze], ["glow", gm]]) { const me = g[k].mesh(mat, {}); if (me) { if (k === "glow") me.renderOrder = 4; inner.add(me); } } scene.add(inner);
    const v = Math.sqrt(2 * 9.8 * 0.95); const jp = sprayPoints(loc.length * 120, (i) => { const p = loc[i % loc.length]; return { p: [p[0], p[1] + 0.02, p[2]], v, spread: 0.035, life: 2 * v / 9.8 }; }); jp.frustumCulled = false; grp.add(jp);
    scene.add(grp); registerFountain("rabbit", grp, XP[0], XP[1]); PC.stats.rabbitJets = jets.length; }

  function buildWelcome() { const W = SP.welcome; if (!W) return; const [cx, cz] = W.c; const FM = fountainMats(); const m = mats();
    let top = -1e9, low = 1e9; for (let i = 0; i < 24; i++) for (const rr of [0, 3.5, 6, W.R]) { const a = i / 24 * 6.283; const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr; top = Math.max(top, surface(x, z)); low = Math.min(low, grade(x, z)); }
    const y0 = top + 0.16; const g = new THREE.Group(); g.name = "welcome_fountain"; g.userData.noInst = true; g.position.set(cx, y0, cz); const R = W.R;
    const tstone = FM.stone.clone(); tstone.side = THREE.DoubleSide; const terrace = new THREE.Mesh(latheUV([[0, 0], [R - 0.2, 0], [R - 0.05, -0.03], [R + 0.02, -0.12], [R + 0.04, low - y0 - 0.3], [0, low - y0 - 0.3]], 96, Math.round(R * 6.28 / 1.4)), tstone); terrace.receiveShadow = true; terrace.castShadow = true; g.add(terrace);
    // flush grated drains: the jet ring lands on the outer one, the lowest spill lip on the inner one
    const grateMat = mats().grate; for (const [r0, r1] of [[5.42, 6.08], [2.75, 3.25]]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96, 1), grateMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; g.add(ring); }
    const nozzles = new Geo(); for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; nozzles.add(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 10), mtx(Math.cos(a) * 5.75, 0.02, Math.sin(a) * 5.75)); } { const me = nozzles.mesh(m.bronze, {}); if (me) g.add(me); }
    // three tiers: column, bowl, water, sheet and foam per tier
    let top2 = 0, br = 2.7; const heights = [1.0, 0.85, 0.75]; const surfaces = [{ y: 0.01, r: 3.0 }]; const emit = [];
    for (let t = 0; t < 3; t++) { const colH = heights[t]; const cr = Math.max(0.16, br * 0.18); const col = new THREE.Mesh(latheUV([[0, top2 - 0.05], [cr * 1.6, top2 - 0.05], [cr * 1.6, top2 + 0.08], [cr * 1.15, top2 + 0.16], [cr, top2 + colH * 0.3], [cr * 0.9, top2 + colH * 0.55], [cr * 1.12, top2 + colH * 0.68], [cr * 0.95, top2 + colH * 0.8], [cr * 1.05, top2 + colH * 0.93], [cr * 1.4, top2 + colH]], 48, 3), FM.stone); col.castShadow = true; g.add(col);
      const by = top2 + colH, lip = by + 0.26; const bowl = new THREE.Mesh(latheUV([[cr * 1.3, by], [br * 0.45, by + 0.05], [br * 0.85, by + 0.15], [br, lip - 0.03], [br + 0.03, lip], [br - 0.01, lip + 0.03], [br - 0.07, lip + 0.02], [br * 0.84, by + 0.21], [br * 0.4, by + 0.13], [0, by + 0.11]], 96, Math.round(br * 6.28 / 1.2)), FM.stone); bowl.castShadow = bowl.receiveShadow = true; g.add(bowl);
      const ws = new THREE.Mesh(new THREE.CircleGeometry(br - 0.07, 72)); ws.userData.rings = [new THREE.Vector4(br - 0.07, 0, 0, 0), new THREE.Vector4(br - 0.07, 0, t === 2 ? 0.14 : 0, t === 2 ? 0.8 : 0), new THREE.Vector4()]; ws.material = FM.water(ws.userData.rings); ws.rotation.x = -Math.PI / 2; ws.position.y = lip - 0.015; g.add(ws);
      const below = surfaces[surfaces.length - 1]; const fall = lip - below.y; const sg = latheUV([[br + 0.035, lip + 0.01], [br + 0.07, lip - fall * 0.2], [br + 0.13, lip - fall * 0.55], [br + 0.2, below.y + 0.01]], 96, 1); { const uv = sg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.floor(i / 4) / 96, (i % 4) / 3); }
      const sh = new THREE.Mesh(sg, FM.sheet); sh.renderOrder = 3; g.add(sh); const fr = new THREE.Mesh(new THREE.RingGeometry(br + 0.05, br + 0.5, 96, 1), FM.foam); { const uv = fr.geometry.attributes.uv, pa = fr.geometry.attributes.position; for (let i = 0; i < uv.count; i++) { const px = pa.getX(i), py = pa.getY(i); uv.setXY(i, (Math.atan2(py, px) / 6.2832 + 1) % 1, (Math.hypot(px, py) - (br + 0.05)) / 0.45); } } fr.rotation.x = -Math.PI / 2; fr.position.y = below.y + 0.012; fr.renderOrder = 2; g.add(fr);
      emit.push({ r: br + 0.2, y: below.y + 0.02, fall }); surfaces.push({ y: lip - 0.015, r: br }); top2 = lip; br *= 0.6; }
    // the bronze propeller finial on a nose cone above the top bowl, facing the Sun Gate Walk
    { const pg = new THREE.Group(); pg.position.y = top2 + 0.55; const face = SP.sungate ? Math.atan2(SP.sungate.c[0] - cx, SP.sungate.c[1] - cz) : 0; pg.rotation.y = face; const pb = new Geo();
      pb.add(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 16), mtx(0, -0.3, 0)); pb.add(new THREE.SphereGeometry(0.2, 20, 14), mtx(0, 0, 0.02, 0, 0, 0, [1, 1, 1.25])); pb.add(new THREE.ConeGeometry(0.17, 0.42, 20), mtx(0, 0, 0.36, 0, Math.PI / 2, 0));
      for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 0.3; const bl = new THREE.SphereGeometry(1, 16, 10); pb.add(bl, new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(0, 0.62, 0.06)).multiply(new THREE.Matrix4().makeRotationY(0.35)).multiply(new THREE.Matrix4().makeScale(0.13, 0.56, 0.035))); }
      const pm = pb.mesh(m.bronze, { cast: true }); if (pm) pg.add(pm); g.add(pg); }
    // the jets: a ring of 24 floor jets arcing onto the outer drain, the top bowl's centre jet, the spill at every lip
    g.add(sprayPoints(24 * 110, (i) => { const a = (i % 24) / 24 * 6.283; return { p: [Math.cos(a) * 5.75, 0.05, Math.sin(a) * 5.75], v: 4.6, spread: 0.12, life: 0.9 }; }));
    { const tb = surfaces[surfaces.length - 1]; const v = Math.sqrt(2 * 9.8 * 0.7); g.add(sprayPoints(900, () => ({ p: [0, top2 + 0.3, 0], v, spread: 0.08, life: 2 * v / 9.8 }))); }
    for (const e of emit) g.add(sprayPoints(Math.round(e.r * 220), () => { const a = Math.random() * 6.2832; return { p: [Math.cos(a) * e.r, e.y, Math.sin(a) * e.r], v: 0.9 + e.fall * 0.5, spread: 0.9, life: 0.35 + e.fall * 0.08 }; }));
    scene.add(g); registerFountain("welcome", g, cx, cz);
    // the terrace is one low step: strips of box solids approximate the disc
    for (let k = 0; k < 10; k++) { const dz0 = -R + (k + 0.5) * (2 * R / 10); const dzi = Math.abs(dz0) + R / 10; const half = Math.sqrt(Math.max(0, R * R - dzi * dzi)) + (dzi < R ? 0.35 : 0); if (half < 0.5) continue; addSolid(cx, cz + dz0, Math.PI / 2, 2 * R / 10, half * 2, low - 0.3, y0, "world"); }
    addSolid(cx, cz, 0, 3.4, 3.4, y0 - 0.2, y0 + 1.3, "world"); PC.stats.welcome = { y0: +y0.toFixed(2), lift: +(y0 - low).toFixed(2) }; }

  function buildBiplane() { const B = SP.biplane; if (!B) return; const m = mats(); const [cx, cz] = B.c; const X0 = SP.xp; const grp = group("crossing_biplane");
    const face = [X0.XP[0] + X0.l[0] * 12 - cx, X0.XP[1] + X0.l[1] * 12 - cz]; const fl = Math.hypot(face[0], face[1]) || 1; const yaw = Math.atan2(face[0] / fl, face[1] / fl);
    const hx = 5.3, hz = 4.3; const cs = Math.cos(yaw), sn = Math.sin(yaw); let low = 1e9, top = -1e9; for (const lx of [-hx, 0, hx]) for (const lz of [-hz, 0, hz]) { const x = cx + lx * cs + lz * sn, z = cz - lx * sn + lz * cs; low = Math.min(low, grade(x, z)); top = Math.max(top, surface(x, z)); }
    const pt = top + 0.95; const g = new Geo(); g.box([cx, (low - 0.2 + pt - 0.12) / 2, cz], hx, (pt - 0.12 - low + 0.2) / 2, hz, yaw, 1.4); const cap = new Geo(); cap.box([cx, pt - 0.06, cz], hx + 0.18, 0.06, hz + 0.18, yaw, 1.4);
    for (const me of [g.mesh(fountainMats().stone, { cast: true }), cap.mesh(fountainMats().stone, { cast: true })]) if (me) grp.add(me);
    let plane = null; if (hasModel("biplane")) { plane = makeModel("biplane"); } else if (hasModel("jet")) { plane = makeModel("jet"); plane.scale.setScalar(0.4); }
    if (plane) { plane.position.set(cx, pt, cz); plane.rotation.y = yaw; plane.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); grp.add(plane); }
    // the bronze plaque on the plinth face toward the plaza
    const pq = canvasTex(768, 400, (x, w, h) => { x.fillStyle = "#6e4a24"; x.fillRect(0, 0, w, h); x.strokeStyle = "#d9b36a"; x.lineWidth = 8; x.strokeRect(12, 12, w - 24, h - 24); x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#f3dcaa"; x.font = `400 ${fitText(x, "THE 1928 BIPLANE", w * 0.86, 78, FONT.d)}px ${FONT.d}`; x.fillText("THE 1928 BIPLANE", w / 2, 88); x.font = `600 30px ${FONT.b}`; x.fillStyle = "#f0d9a8"; const lines = wrapLines(x, "A static replica of the open-cockpit biplanes that flew the valley when the airfield was new.", w - 90); lines.forEach((l, i) => x.fillText(l, w / 2, 180 + i * 44)); }, { text: true, fonts: true });
    const toC = [X0.XP[0] - cx, X0.XP[1] - cz]; const tl = Math.hypot(toC[0], toC[1]) || 1; const fy = Math.atan2(toC[0] / tl, toC[1] / tl); let best = 0, bd = -2; for (let k = 0; k < 4; k++) { const a = yaw + k * Math.PI / 2; const d = Math.sin(a) * toC[0] / tl + Math.cos(a) * toC[1] / tl; if (d > bd) { bd = d; best = k; } } const fa = yaw + best * Math.PI / 2; const off = best % 2 === 0 ? hz + 0.02 : hx + 0.02;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.78), new THREE.MeshStandardMaterial({ map: pq, roughness: 0.35, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })); pl.position.set(cx + Math.sin(fa) * off, (low + pt) / 2 + 0.05, cz + Math.cos(fa) * off); pl.rotation.y = fa; grp.add(pl); void fy;
    addSolid(cx, cz, yaw, hx * 2 + 0.3, hz * 2 + 0.3, low - 0.3, pt + 2.6, "world"); scene.add(grp); }

  function buildBeacon() { const B = SP.beacon; if (!B) return; const [cx, cz] = B.c; const m = mats(); const g = { steel: new Geo(), dark: new Geo(), glass: new Geo() }; const y0 = surface(cx, cz) - 0.05; const Hh = 7.2; const b0 = 0.85, b1 = 0.32;
    const corner = (h, sx, sz) => { const k = lerp(b0, b1, h / Hh); return [cx + sx * k, y0 + h, cz + sz * k]; };
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.steel.rod(corner(0, sx, sz), corner(Hh, sx, sz), 0.06); g.steel.box([cx + sx * b0, y0 + 0.15, cz + sz * b0], 0.18, 0.15, 0.18, 0); }
    const levels = [0.3, 2.0, 3.7, 5.4, Hh]; const faces = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
    for (let i = 0; i < levels.length - 1; i++) for (const [[ax, az], [bx, bz]] of faces) { g.steel.rod(corner(levels[i], ax, az), corner(levels[i + 1], bx, bz), 0.025); g.steel.rod(corner(levels[i], bx, bz), corner(levels[i + 1], ax, az), 0.025); g.steel.rod(corner(levels[i + 1], ax, az), corner(levels[i + 1], bx, bz), 0.03); }
    g.steel.box([cx, y0 + Hh + 0.05, cz], 0.62, 0.05, 0.62, 0); g.dark.add(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 20), mtx(cx, y0 + Hh + 0.45, cz)); g.dark.add(new THREE.CylinderGeometry(0.18, 0.44, 0.26, 20), mtx(cx, y0 + Hh + 0.89, cz));
    for (const sd of [-1, 1]) g.glass.add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20), mtx(cx + sd * 0.43, y0 + Hh + 0.45, cz, 0, 0, Math.PI / 2));
    const grp = group("replica_beacon"); for (const [k, mat] of [["steel", new THREE.MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.45, metalness: 0.7 })], ["dark", new THREE.MeshStandardMaterial({ color: 0x1f3326, roughness: 0.5, metalness: 0.5 })], ["glass", new THREE.MeshStandardMaterial({ color: 0x4b5a60, roughness: 0.1, metalness: 0.4 })]]) { const me = g[k].mesh(mat, { cast: true }); if (me) grp.add(me); }
    addSolid(cx, cz, 0, 2.0, 2.0, y0 - 0.3, y0 + 3, "world"); scene.add(grp); }

  // procedural stand-ins, used only when a model did not load (same size and layout as the model)
  function proceduralSunGate() { const g = new THREE.Group(); const m = mats(); const G1 = new Geo(), G2 = new Geo(); const feet = [[-9.6, -7.0], [9.7, -7.1], [-9.6, 7.05], [9.75, 7.05]];
    for (const [x, z] of feet) { G1.box([x, 0.45, z], 0.85, 0.45, 0.8, 0); G1.rod([x, 0.9, z], [x * 0.55, 10.8, z * 0.1], 0.12, 10); }
    const top = [[-5.3, 10.8, -0.7], [5.3, 10.8, 0.7]]; const low = (x, z) => [x, 3.8, z];
    for (const pk of top) { const sx = Math.sign(pk[0]); const a = low(sx * 9.6, -7), b = low(sx * 9.6, 7), c = low(0, -7.6), d = low(0, 7.6); G2.quad(a, b, pk, pk, [0, 0], [1, 0], [0.5, 1], [0.5, 1]); G2.quad(a, c, pk, pk, [0, 0], [1, 0], [0.5, 1], [0.5, 1]); G2.quad(b, d, pk, pk, [0, 0], [1, 0], [0.5, 1], [0.5, 1]); G2.quad(c, d, pk, pk, [0, 0], [1, 0], [0.5, 1], [0.5, 1]); }
    const a1 = G1.mesh(m.white, { cast: true }), a2 = G2.mesh(m.fabric, { cast: true }); if (a1) g.add(a1); if (a2) g.add(a2); return g; }
  function proceduralArch() { const g = new THREE.Group(); const G1 = new Geo(), G2 = new Geo();
    for (const sd of [-1, 1]) { G2.box([sd * 7.9, 0.55, 0], 0.66, 0.55, 0.66, 0); G1.box([sd * 7.9, 4.6, 0], 0.32, 3.5, 0.32, 0); G1.rod([sd * 7.9, 6.6, 0], [sd * 6.3, 8.1, 0], 0.13); }
    G1.box([0, 8.25, 0], 9.0, 0.34, 0.42, 0); G1.box([0, 5.86, -0.44], 2.45, 0.72, 0.26, 0); for (const x of [-2.1, 2.1]) G1.rod([x, 6.58, -0.44], [x, 7.9, -0.3], 0.03);
    const a1 = G1.mesh(mats().timber, { cast: true }), a2 = G2.mesh(fountainMats().stone, { cast: true }); if (a1) g.add(a1); if (a2) g.add(a2); return g; }
  function proceduralWell() { const g = new THREE.Group(); const FM = fountainMats(); const ring = new THREE.Mesh(latheUV([[2.3, 0], [2.3, 1.02], [2.5, 1.1], [2.93, 1.1], [2.93, 0]], 40, 4), FM.stone); ring.castShadow = true; g.add(ring); const G1 = new Geo();
    for (const sd of [-1, 1]) G1.box([sd * 1.9, 3.3, 0], 0.18, 2.3, 0.18, 0); G1.box([0, 5.5, 0], 2.25, 0.16, 0.2, 0); G1.box([0, 4.3, 0], 1.7, 0.09, 0.09, 0); G1.box([0, 5.9, 0], 2.5, 0.06, 0.8, 0);
    const a1 = G1.mesh(mats().timber, { cast: true }); if (a1) g.add(a1); return g; }
  function buildSunGate() { const S = SP.sungate; if (!S) return; let y = 1e9; for (const f of S.feet) y = Math.min(y, grade(f[0], f[1])); const cy = surface(S.c[0], S.c[1]); y = Math.min(y, cy) - 0.04;
    const g = hasModel("sun_gate") ? makeModel("sun_gate") : proceduralSunGate(); g.position.set(S.c[0], y, S.c[1]); g.rotation.y = S.yaw; g.userData.noInst = true; g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); const grp = group("sun_gate"); grp.add(g); scene.add(grp);
    for (const f of S.feet) addSolid(f[0], f[1], S.yaw, 1.75, 1.65, y - 0.3, y + 1.0, "world"); }

  function buildArch() { const A = SP.arch; if (!A) return; let y = 1e9; for (const p of A.posts) y = Math.min(y, surface(p[0], p[1])); y -= 0.06; const s = A.sc;
    const g = hasModel("frontier_arch") ? makeModel("frontier_arch") : proceduralArch(); g.position.set(A.c[0], y, A.c[1]); g.rotation.y = A.yaw; g.scale.setScalar(s); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); const grp = group("frontier_arch"); grp.add(g);
    // the hanging board: MAIN STREET toward the Expanse Gate, THE CROSSING toward Main Street
    const tf = bigText([{ text: "MAIN STREET", y: 0.42, size: 0.56, color: "#f3e3c0" }, { text: "THE EXPANSE  ·  STAGE THREE", y: 0.83, size: 0.17, color: "#e9c46a", font: FONT.b, weight: 700 }], 1024, 300, null);
    const tb = bigText([{ text: "THE CROSSING", y: 0.42, size: 0.56, color: "#f3e3c0" }, { text: "TO THE TERMINAL AND STAGE ONE", y: 0.83, size: 0.17, color: "#e9c46a", font: FONT.b, weight: 700 }], 1024, 300, null);
    const W = 4.8 * s, Hh = 1.38 * s, yc = 5.86 * s; const cs = Math.cos(A.yaw), sn = Math.sin(A.yaw);
    for (const [tex, lz, flip] of [[tf, -0.14, 0], [tb, -0.74, 1]]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), textMat(tex, { transparent: true, glow: 0.3 })); const lzz = lz * s; pl.position.set(A.c[0] + lzz * sn, y + yc, A.c[1] + lzz * cs); pl.rotation.y = A.yaw + (flip ? Math.PI : 0); grp.add(pl); }
    for (const p of A.posts) addSolid(p[0], p[1], A.yaw, 1.3 * s, 1.3 * s, y - 0.3, y + 8.6 * s, "world"); scene.add(grp); }

  function buildWell() { const W = SP.well; if (!W) return; const [cx, cz] = W.c; const FM = fountainMats(); const m = mats(); const Tc = PC.tunnels[0]; const RS = Tc.ramps[1];
    const toward = [RS.head[0] - cx, RS.head[1] - cz]; const tl = Math.hypot(toward[0], toward[1]) || 1; const yaw = Math.atan2(toward[0] / tl, toward[1] / tl); const y = surface(cx, cz) - 0.03; const g = group("frontier_well"); const inner = new THREE.Group(); inner.position.set(cx, y, cz); inner.rotation.y = yaw; g.add(inner);
    if (hasModel("frontier_well")) { const w = makeModel("frontier_well"); w.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noInst = true; } }); inner.add(w); }
    else inner.add(proceduralWell());
    // the trough on the crank side: a timber trough, a flume from the rim, the spill and a flush grate under it
    const tr = new Geo(); const TX0 = -3.55, TL = 2.9, TW = 0.85, TH = 0.72; tr.box([TX0, TH / 2, 0], TW / 2, TH / 2, TL / 2, 0); const trm = tr.mesh(m.timber, { cast: true }); if (trm) inner.add(trm);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(TW - 0.16, TL - 0.16)); water.userData.rings = [new THREE.Vector4(0.3, 0, 0, 0), new THREE.Vector4(), new THREE.Vector4()]; water.material = FM.water(water.userData.rings); water.rotation.x = -Math.PI / 2; water.position.set(TX0, TH + 0.012, 0); inner.add(water);
    const fl = new Geo(); fl.box([-2.55, 1.08, 0], 0.62, 0.05, 0.14, 0); const flm = fl.mesh(m.timber, { cast: true }); if (flm) { flm.rotation.z = 0; inner.add(flm); }
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(TW + 0.7, TL + 0.7), m.grate); gr.rotation.x = -Math.PI / 2; gr.position.set(TX0, 0.035, 0); inner.add(gr);
    const sp = sprayPoints(260, () => ({ p: [-3.12, 1.05, (Math.random() - 0.5) * 0.18], v: 0.35, spread: 1.4, life: 0.5 })); inner.add(sp);
    scene.add(g); registerFountain("frontier_well", g, cx, cz);
    const tc = [cx + Math.cos(yaw) * TX0, cz - Math.sin(yaw) * TX0]; addSolid(tc[0], tc[1], yaw, TW + 0.1, TL + 0.1, y - 0.3, y + TH, "world"); PC.stats.well = { yaw: +yaw.toFixed(3) }; }

  function buildDeck() { const D = SP.deck; if (!D) return; const e = D.rec.e; const yaw = e[3]; const f = D.f, r = [Math.cos(yaw), -Math.sin(yaw)]; const m = mats(); const grp = group("flight_deck_terrace");
    const depth = 8.5, half = 10.2; const at = (lx, d) => [e[0] + r[0] * lx + f[0] * (D.d0 + d), e[2] + r[1] * lx + f[1] * (D.d0 + d)];
    let gmax = -1e9, gmin = 1e9; for (const lx of [-half, 0, half]) for (const d of [0, depth / 2, depth]) { const p = at(lx, d); gmax = Math.max(gmax, surface(p[0], p[1])); gmin = Math.min(gmin, grade(p[0], p[1])); }
    for (const lx of [-half, half]) for (const d of [0.5, depth]) { const p = at(lx, d); if (planNearRoad(p[0], p[1], 0.3) || distToRunway(p[0], p[1]) < 140) { PC.stats.deck = "skipped: " + (distToRunway(p[0], p[1]) < 140 ? "runway line" : "ribbon"); return; } }
    const top = gmax + 0.32; const c = at(0, depth / 2); const g = { deck: new Geo(), steel: new Geo(), timber: new Geo(), fabric: new Geo(), bulb: new Geo(), dark: new Geo() };
    g.deck.box([c[0], (top + gmin - 0.3) / 2, c[1]], half, (top - gmin + 0.3) / 2, depth / 2, yaw, 2.2);
    // the plane-spotting rail along the runway edge: posts, a timber cap and the mister line
    for (let lx = -half + 0.3; lx <= half - 0.29; lx += (2 * half - 0.6) / 10) { const p = at(lx, depth - 0.2); g.steel.box([p[0], top + 0.5, p[1]], 0.035, 0.5, 0.035, yaw); }
    { const p = at(0, depth - 0.2); g.timber.box([p[0], top + 1.04, p[1]], half - 0.2, 0.04, 0.09, yaw); g.steel.box([p[0], top + 0.55, p[1]], half - 0.3, 0.015, 0.015, yaw); }
    for (const sd of [-1, 1]) { const a = at(sd * (half - 0.2), 0.4), b = at(sd * (half - 0.2), depth - 0.2); const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; g.timber.box([mid[0], top + 1.04, mid[1]], 0.09, 0.04, (depth - 0.6) / 2, yaw); for (let d = 0.6; d < depth - 0.3; d += 1.6) { const p = at(sd * (half - 0.2), d); g.steel.box([p[0], top + 0.5, p[1]], 0.035, 0.5, 0.035, yaw); } }
    // high tables and stools
    for (let i = 0; i < 5; i++) { const lx = -half + 2.2 + i * (2 * half - 4.4) / 4; const p = at(lx, depth - 1.6); g.dark.add(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 8), mtx(p[0], top + 0.52, p[1])); g.timber.add(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), mtx(p[0], top + 1.07, p[1])); for (const sd of [-1, 1]) { const q = at(lx + sd * 0.7, depth - 1.9); g.dark.add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), mtx(q[0], top + 0.36, q[1])); g.timber.add(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 14), mtx(q[0], top + 0.74, q[1])); } }
    // two shade sails on masts and a festoon of bulbs between them
    const masts = [at(-half + 0.5, 0.6), at(half - 0.5, 0.6), at(-half + 0.5, depth - 0.6), at(half - 0.5, depth - 0.6)]; const mh = [4.6, 4.0, 3.6, 4.4]; masts.forEach((p, i) => g.steel.rod([p[0], top, p[1]], [p[0], top + mh[i] + 0.2, p[1]], 0.07));
    const sail = (a, b, cc) => { const pa = [masts[a][0], top + mh[a], masts[a][1]], pb = [masts[b][0], top + mh[b], masts[b][1]], pc = [masts[cc][0], top + mh[cc], masts[cc][1]]; g.fabric.quad(pa, pb, pc, pc, [0, 0], [1, 0], [1, 1], [1, 1]); };
    sail(0, 1, 3); sail(0, 3, 2);
    for (let i = 0; i <= 14; i++) { const t = i / 14; const a = at(-half + 0.5, depth - 0.6), b = at(half - 0.5, depth - 0.6); const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t); const yy = top + lerp(mh[2], mh[3], t) - 0.5 - Math.sin(t * Math.PI) * 0.6; g.bulb.add(new THREE.SphereGeometry(0.06, 8, 6), mtx(x, yy, z)); }
    const matOf = { deck: m.timber, steel: m.steel, timber: m.timber, fabric: m.fabric, bulb: MT.bulb, dark: m.dark };
    for (const k in g) { const me = g[k].mesh(matOf[k], { cast: k !== "bulb" }); if (me) grp.add(me); }
    // the Flight Deck Mister: a cooling mist along the rail
    const rl = at(-half + 0.4, depth - 0.2), rr = at(half - 0.4, depth - 0.2); const mist = sprayPoints(700, () => { const t = Math.random(); return { p: [lerp(rl[0], rr[0], t) - c[0], top + 1.12 - top, lerp(rl[1], rr[1], t) - c[1]], v: 0.25, spread: 2.2, life: 1.3 }; }); const mg = group("flight_deck_mister"); mg.position.set(c[0], top, c[1]); mist.frustumCulled = false; mg.add(mist); scene.add(mg); registerFountain("deck_f", mg, c[0], c[1]);
    addSolid(c[0], c[1], yaw, half * 2, depth, gmin - 0.3, top, "world"); addSolid(at(0, depth - 0.2)[0], at(0, depth - 0.2)[1], yaw, half * 2, 0.2, top, top + 1.1, "world"); for (const sd of [-1, 1]) { const p = at(sd * (half - 0.2), depth / 2 + 0.3); addSolid(p[0], p[1], yaw, 0.2, depth - 0.6, top, top + 1.1, "world"); }
    scene.add(grp); PC.stats.deck = { top: +top.toFixed(2), rise: +(top - gmin).toFixed(2) }; }

  // ───────────────────────── defer hook: build everything ─────────────────────────
  function deferHook() {
    if (!PC.built.world) return; textures(); mats();
    safe("profiles", profiles);
    safe("ground cut", installCut);
    safe("ramps", buildRamps);
    safe("headwall text", headwallText);
    for (const T0 of PC.tunnels) safe("interior " + T0.id, () => buildInterior(T0));
    safe("ramp markers", rampMarkers);
    safe("shuttles", buildShuttles);
    safe("brass line", buildBrass);
    safe("portals", buildPortals);
    safe("rabbit", buildRabbit); safe("welcome fountain", buildWelcome); safe("biplane", buildBiplane); safe("beacon", buildBeacon); safe("sun gate", buildSunGate);
    safe("club walk arcade", buildArcade); safe("frontier arch", buildArch); safe("frontier well", buildWell); safe("flight deck terrace", buildDeck);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const f of PC.redraw) try { f(); } catch (e) {} }).catch(() => {});
    PC.built.defer = true;
    console.log("plan_crossing: " + PC.tunnels.map((t) => t.id + " " + JSON.stringify(PC.stats[t.id])).join(", ") + (PC.errors.length ? " errors " + JSON.stringify(PC.errors) : ""));
  }

  // ───────────────────────── debug and test API ─────────────────────────
  PC.debug = {
    // start a ride on tunnel id from end (0 = the Stage One / Link Plaza end) and optionally freeze it at a fraction of the route
    ride(id, end, frac) { const T0 = PC.tunnels.find((t) => t.id === id); if (!T0 || !T0.route) return "no tunnel"; if (PC.ride) endRideNow(); const Rt = T0.route; const u = frac === undefined ? undefined : end === 0 ? lerp(Rt.uA, Rt.uB, frac) : lerp(Rt.uB, Rt.uA, frac); startRide(T0, end, performance.now(), { u, instant: frac !== undefined, paused: frac !== undefined }); return { u, N: Rt.N, L: Rt.L }; },
    resume() { if (PC.ride) { PC.ride.paused = false; PC.ride.last = performance.now(); } return !!PC.ride; },
    finish() { const R = PC.ride; if (!R) return false; R.paused = false; R.st = "arrive"; R.at = performance.now(); return true; },
    jet(delayMs) { LED.t0 = performance.now() + (delayMs || 0); return true; },
    jetAt(x) { LED.fixed = x; return true; },
    stop() { endRideNow(); return true; },
    cam(p, l) { PC.camOverride = p ? { p, l } : null; return true; },
    state() { const R = PC.ride; return R ? { id: R.T.id, dir: R.dir, u: +R.u.toFixed(1), st: R.st, N: R.T.route.N, at: Math.round(R.at), now: Math.round(performance.now()), last: Math.round(R.last), frame: FRAME_N } : null; },
  };
  PC.floorAt = trenchFloor;
  PC.fallbacks = { arch: () => proceduralArch(), well: () => proceduralWell(), sunGate: () => proceduralSunGate() };

  HOOKS.world.push({ name: "crossingWorld", fn: worldHook });
  HOOKS.defer.push({ name: "crossingDefer", fn: deferHook });
  HOOKS.interior.push({ name: "crossingRide", fn: interiorHook });
  HOOKS.frame.push({ name: "crossingFrame", fn: frameHook });
})();
