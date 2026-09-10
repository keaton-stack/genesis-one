/* GENESIS ONE · concept walkthrough client
   Real terrain (USGS 3DEP) + real aerial (NAIP) + real runway (OSM), stylised
   concept structures for the three stages, shared world over the room socket. */

// ───────────────────────────── net ─────────────────────────────
const room = new URLSearchParams(location.search).get("room") || "main";
function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(key, id); }
  return id;
}
const ME = playerId();
const PING = "__ping", PONG = "__pong";
let socket = null, retry = 0, view = null, connected = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  socket.addEventListener("open", () => { retry = 0; setStatus("connected"); send({ type: "join", playerId: ME }); });
  socket.addEventListener("message", (ev) => {
    if (ev.data === PONG) return;
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "state") onState(msg);
    else if (msg.type === "error") setStatus(msg.error, true);
  });
  socket.addEventListener("close", () => {
    retry = Math.min(retry + 1, 6);
    const wait = 500 * 2 ** (retry - 1);
    setStatus(`reconnecting in ${Math.round(wait / 1000)}s`, true);
    setTimeout(connect, wait);
  });
}
function send(msg) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); }
function act(action) { send({ type: "action", action }); }
setInterval(() => { if (socket && socket.readyState === WebSocket.OPEN) socket.send(PING); }, 30000);

const $ = (s) => document.querySelector(s);
function setStatus(t, err) { const el = $("#status"); el.textContent = t; el.classList.toggle("err", !!err); }

// ───────────────────────────── state from server ─────────────────────────────
const seen = new Map();          // playerId -> { t, at } for staleness
let namedOnce = false, introduced = false;
function onState(msg) {
  connected = msg.connected || 1;
  $("#online").textContent = String(connected);
  if (!msg.view) return;
  view = msg.view;
  const now = performance.now();
  for (const [id, p] of Object.entries(view.players)) {
    const s = seen.get(id);
    if (!s || s.t !== p.t) seen.set(id, { t: p.t, at: now });
  }
  if (!introduced && player) {
    introduced = true;
    const mine = view.players[ME];
    if (mine && (mine.x || mine.z)) { player.position.x = mine.x; player.position.z = mine.z; yaw = mine.ry; }
    else { player.position.x = 0; player.position.z = 48; }
    pushMove(true);
    const savedName = localStorage.getItem("g1:name");
    if (savedName) act({ t: "name", name: savedName });
  }
  if (gbOpen) renderGuestbook();
}

// ───────────────────────────── three.js scene ─────────────────────────────
const canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7d6bd);
scene.fog = new THREE.FogExp2(0xe7d6bd, 0.00042);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 6000);
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7d6b4c, 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 1.25); sun.position.set(-600, 500, 300); scene.add(sun);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0); moon.position.set(400, 500, -300); scene.add(moon);
// stars: a dome of points far out, faded in after dusk
const starGeo = new THREE.BufferGeometry(); { const a = []; for (let i = 0; i < 1800; i++) { const t = Math.random() * 6.283, u = Math.random() * 0.9 + 0.08; const r = 5200; a.push(Math.cos(t) * Math.sqrt(1 - u * u) * r, u * r, Math.sin(t) * Math.sqrt(1 - u * u) * r); } starGeo.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 9, transparent: true, opacity: 0, fog: false, sizeAttenuation: true })); scene.add(stars);
// One shared clock for every visitor: a full day is 24 real minutes, keyed to
// wall-clock UTC so everyone on the site sees the same sky. N previews the
// other half of the day locally.
const DAY_SECONDS = 24 * 60; let timeOffset = 0;
function dayT() { return ((((Date.now() / 1000 + timeOffset) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS; }  // 0 = midnight, .5 = noon
const C = (h) => new THREE.Color(h);
const SKY = [ [0.00, C(0x070b16)], [0.20, C(0x0b1327)], [0.27, C(0xd9895a)], [0.33, C(0xe7d6bd)], [0.66, C(0xdfcfb4)], [0.75, C(0xe28a55)], [0.81, C(0x1c1a33)], [0.88, C(0x070b16)], [1.00, C(0x070b16)] ];
function skyAt(t) { for (let i = 0; i < SKY.length - 1; i++) { if (t >= SKY[i][0] && t <= SKY[i + 1][0]) { const f = (t - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]); return SKY[i][1].clone().lerp(SKY[i + 1][1], f); } } return SKY[0][1].clone(); }
let night = 0;
function updateSky() {
  const t = dayT();
  const el = -Math.cos(t * 6.283);                       // sun elevation, -1..1
  const sky = skyAt(t); scene.background = sky; scene.fog.color = sky;
  const day = Math.max(0, Math.min(1, (el + 0.12) / 0.4));
  night = 1 - day;
  const az = t * 6.283;
  sun.position.set(Math.cos(az) * 700, Math.max(el, 0.02) * 700 + 40, Math.sin(az) * 300);
  sun.intensity = 1.25 * day; sun.color.setHSL(0.09, 0.55, 0.6 + 0.3 * Math.min(1, Math.max(0, el)));
  moon.intensity = 0.28 * night; hemi.intensity = 0.62 * day + 0.16;
  hemi.color.setHSL(0.6, 0.35, 0.55 + 0.35 * day);
  renderer.toneMappingExposure = 0.88 - 0.3 * night;
  stars.material.opacity = Math.max(0, night - 0.35) * 1.4;
  for (const m of nightGlow) m.emissiveIntensity = 0.4 + 2.2 * night;
  M.glass.emissive.setHex(0xffd08a); M.glass.emissiveIntensity = 0.9 * night;
  M.green.emissiveIntensity = 0.4 + 1.6 * night;
  const hh = Math.floor(t * 24), mm = Math.floor((t * 24 - hh) * 60);
  const clk = document.getElementById("clock"); if (clk) clk.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} site time`;
}

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

// ───────────────────────────── site data ─────────────────────────────
let SITE = null, H = null, T = null;              // site.json, heights, terrain meta
function getH(x, z) {
  if (!H) return 0;
  const u = ((x - T.xmin) / (T.xmax - T.xmin)) * (T.cols - 1);
  const v = ((z - T.zmin) / (T.zmax - T.zmin)) * (T.rows - 1);
  const c = Math.max(0, Math.min(T.cols - 2, Math.floor(u))), r = Math.max(0, Math.min(T.rows - 2, Math.floor(v)));
  const fu = Math.max(0, Math.min(1, u - c)), fv = Math.max(0, Math.min(1, v - r));
  const i = r * T.cols + c;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + T.cols], h11 = H[i + T.cols + 1];
  return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
}
// seeded RNG so every visitor sees the same layout
let seed = 20260910; function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const loadbar = $("#loadbar"); const setLoad = (p) => (loadbar.style.width = Math.round(p * 100) + "%");

// ───────────────────────────── materials ─────────────────────────────
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.95 }),
  taxi:    new THREE.MeshStandardMaterial({ color: 0x4a4b4f, roughness: 0.95 }),
  apron:   new THREE.MeshStandardMaterial({ color: 0x5a5b5e, roughness: 0.95 }),
  dirt:    new THREE.MeshStandardMaterial({ color: 0xb99b6f, roughness: 1 }),
  stripe:  new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 }),
  stucco:  new THREE.MeshStandardMaterial({ color: 0xe6dac4, roughness: 0.9 }),
  stucco2: new THREE.MeshStandardMaterial({ color: 0xd8c7a6, roughness: 0.9 }),
  roof:    new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.8 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x1c3a2f, roughness: 0.2, metalness: 0.6 }),
  wood:    new THREE.MeshStandardMaterial({ color: 0x9b6f3c, roughness: 0.95 }),
  woodL:   new THREE.MeshStandardMaterial({ color: 0xc89a5b, roughness: 0.95 }),
  dome:    new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.55 }),
  tent:    new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.7, side: THREE.DoubleSide }),
  steel:   new THREE.MeshStandardMaterial({ color: 0x8e9aa4, roughness: 0.45, metalness: 0.7 }),
  hangar:  new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.5 }),
  chrome:  new THREE.MeshStandardMaterial({ color: 0xdfe6e4, roughness: 0.15, metalness: 1 }),
  green:   new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.5, emissive: 0x1b7a35, emissiveIntensity: 0.4 }),
  scrub:   new THREE.MeshStandardMaterial({ color: 0x6f7d4b, roughness: 1 }),
  mtn:     new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 1 }),
};

// ───────────────────────────── geometry helpers ─────────────────────────────
function ribbon(points, width, mat, lift, dashed) {
  // resample polyline every ~8 m and lay a strip that hugs the terrain
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 8));
    for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  pts.push(points[points.length - 1]);
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx, w = width / 2;
    const l = [p[0] + nx * w, p[1] + nz * w], r = [p[0] - nx * w, p[1] - nz * w];
    pos.push(l[0], getH(l[0], l[1]) + lift, l[1], r[0], getH(r[0], r[1]) + lift, r[1]);
    if (i < pts.length - 1 && (!dashed || i % 2 === 0)) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function polygon(points, mat, lift) {
  const tri = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p[0], p[1])), []);
  const pos = [], idx = [];
  const hAvg = points.reduce((s, p) => s + getH(p[0], p[1]), 0) / points.length;
  for (const p of points) pos.push(p[0], hAvg + lift, p[1]);
  for (const t of tri) idx.push(t[0], t[2], t[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function box(w, h, d, mat, x, z, rot, yoff) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, getH(x, z) + h / 2 + (yoff || 0), z); m.rotation.y = rot || 0; return m;
}
function place(group, x, z, rot) { group.position.set(x, getH(x, z), z); group.rotation.y = rot || 0; return group; }

// ───────────────────────────── generated 3D models ─────────────────────────────
// Each building type is an image-to-3D GLB (Higgsfield / Meshy). `size` is the
// real-world width in metres the model is scaled to; the procedural stand-ins
// below remain as fallbacks if a file is missing.
const MODEL_SPECS = {
  home:      { size: 15, rot: 0 },
  clubhouse: { size: 38, rot: 0 },
  hangar:    { size: 24, rot: 0 },
  dome:      { size: 13, rot: 0 },
  pavilion:  { size: 18, rot: 0 },
  store:     { size: 11, rot: 0 },
  saloon:    { size: 15, rot: 0 },
  tower:     { size: 16, rot: 0, height: 27 },
};
const MODELS = {};
const nightGlow = [];   // materials that light up after dark
async function loadModels() {
  if (!THREE.GLTFLoader) return;
  const loader = new THREE.GLTFLoader();
  await Promise.all(Object.keys(MODEL_SPECS).map((k) => new Promise((res) => {
    loader.load(`/models/${k}.glb`, (g) => {
      const root = g.scene;
      root.traverse((o) => { if (o.isMesh) { o.material.side = THREE.DoubleSide; o.material.transparent = false; o.material.depthWrite = true; if (o.material.map) o.material.map.encoding = THREE.sRGBEncoding; o.material.roughness = 0.85; o.material.metalness = 0; } });
      const box = new THREE.Box3().setFromObject(root); const sz = new THREE.Vector3(); box.getSize(sz); const c = new THREE.Vector3(); box.getCenter(c);
      const spec = MODEL_SPECS[k];
      const sc = spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
      const wrap = new THREE.Group();
      root.position.set(-c.x, -box.min.y, -c.z);
      wrap.add(root); wrap.scale.setScalar(sc); wrap.rotation.y = spec.rot;
      MODELS[k] = wrap; res();
    }, undefined, () => res());
  })));
}
function model(k, x, z, rot) {
  if (!MODELS[k]) return null;
  const g = new THREE.Group(); g.add(MODELS[k].clone()); return place(g, x, z, rot || 0);
}

// ───────────────────────────── structures ─────────────────────────────
function home(x, z, rot) {
  const m = model('home', x, z, rot); if (m) return m;
  const g = new THREE.Group();
  const w = 11 + rnd() * 6, d = 8 + rnd() * 5;
  const a = new THREE.Mesh(new THREE.BoxGeometry(w, 3.6, d), rnd() < 0.5 ? M.stucco : M.stucco2); a.position.y = 1.8; g.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 3.2, d * 0.7), M.stucco2); b.position.set(w * 0.15, 3.6 + 1.6, -d * 0.1); g.add(b);
  const r = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 0.35, d + 1.6), M.roof); r.position.y = 3.75; g.add(r);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55 + 1.2, 0.3, d * 0.7 + 1.2), M.roof); r2.position.set(w * 0.15, 6.95, -d * 0.1); g.add(r2);
  const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 1.6, 0.2), M.glass); win.position.set(0, 1.9, d / 2 + 0.05); g.add(win);
  return place(g, x, z, rot);
}
function clubhouse(x, z, rot) {
  const m = model('clubhouse', x, z, rot); if (m) return m;
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(34, 5, 18), M.stucco); a.position.y = 2.5; g.add(a);
  const r = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 24), M.roof); r.position.y = 5.3; g.add(r);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(30, 3.6, 0.3), M.glass); glass.position.set(0, 2.6, 9.1); g.add(glass);
  for (let i = -1; i <= 1; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5), M.wood); c.position.set(i * 14, 2.5, 11.6); g.add(c); }
  return place(g, x, z, rot);
}
function dome(x, z, r) {
  const mm = model('dome', x, z, rnd() * 6.28); if (mm) { mm.scale.setScalar(r / 6.5); return mm; }
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), M.dome); m.position.y = r * 0.28; g.add(m);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 1.05, r * 0.3, 24), M.stucco2); base.position.y = r * 0.15; g.add(base);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.4), M.glass); door.position.set(0, 1.3, r * 0.92); g.add(door);
  return place(g, x, z, rnd() * 6.28);
}
function pavilion(x, z, s) {
  const m = model('pavilion', x, z, rnd() * 6.28); if (m) { m.scale.setScalar(s / 8); return m; }
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(s, s * 0.85, 6, 1, true), M.tent); cone.position.y = s * 0.85 / 2 + 2.4; g.add(cone);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.6), M.steel); p.position.set(Math.cos(a) * s * 0.95, 1.3, Math.sin(a) * s * 0.95); g.add(p); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, s * 0.85 + 2.6), M.steel); mast.position.y = (s * 0.85 + 2.6) / 2; g.add(mast);
  return place(g, x, z, rnd() * 6.28);
}
function hangar(x, z, rot, w, d) {
  const m = model('hangar', x, z, rot); if (m) return m;
  const g = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 20, 1, false, 0, Math.PI), M.hangar);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2; arch.position.y = 2.5; g.add(arch);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), M.hangar); wall.position.y = 1.25; g.add(wall);
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, w / 2 + 1.6, 0.4), M.steel); door.position.set(0, (w / 2 + 1.6) / 2, d / 2 + 0.1); g.add(door);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.5, 0.5), M.green); stripe.position.set(0, w / 2 + 2.2, d / 2 + 0.1); g.add(stripe);
  return place(g, x, z, rot);
}
function storefront(x, z, rot) {
  const m = model(rnd() < 0.3 ? 'saloon' : 'store', x, z, rot); if (m) return m;
  const g = new THREE.Group();
  const w = 8 + rnd() * 4, d = 10 + rnd() * 4, h = 4 + rnd() * 1.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rnd() < 0.5 ? M.wood : M.woodL); body.position.y = h / 2; g.add(body);
  const front = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 2.2 + rnd() * 1.2, 0.4), rnd() < 0.5 ? M.stucco : M.woodL); front.position.set(0, (h + 2.2) / 2, d / 2 + 0.2); g.add(front);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.25, 3), M.roof); awning.position.set(0, 3, d / 2 + 1.7); g.add(awning);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3), M.wood); p.position.set(sx * (w / 2), 1.5, d / 2 + 3); g.add(p); }
  const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 1.8, 0.2), M.glass); win.position.set(0, 1.7, d / 2 + 0.45); g.add(win);
  return place(g, x, z, rot);
}
function sculpture(x, z, kind) {
  const g = new THREE.Group();
  let m;
  if (kind === 0) m = new THREE.Mesh(new THREE.TorusKnotGeometry(2.4, 0.7, 120, 16), M.chrome);
  else if (kind === 1) m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 32, 24), M.chrome);
  else if (kind === 2) m = new THREE.Mesh(new THREE.TorusGeometry(3, 0.55, 20, 48), M.chrome);
  else m = new THREE.Mesh(new THREE.OctahedronGeometry(2.8, 0), M.green);
  m.position.y = 4.2; g.add(m);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 1.2, 12), M.stucco2); ped.position.y = 0.6; g.add(ped);
  return place(g, x, z, 0);
}
function tower(x, z) {
  const m = model('tower', x, z, 0); if (m) { const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.16, 8, 32), M.green.clone()); ring.rotation.x = Math.PI / 2; ring.position.y = 21; nightGlow.push(ring.material); m.add(ring); return m; }
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 20, 12), M.stucco); shaft.position.y = 10; g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.2, 4.2, 8), M.glass); cab.position.y = 22.2; g.add(cab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 5.6, 0.6, 8), M.roof); cap.position.y = 24.6; g.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.8, 0.18, 8, 32), M.green); ring.rotation.x = Math.PI / 2; ring.position.y = 20.2; g.add(ring);
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 10), M.stucco2); base.position.set(0, 1.6, 0); g.add(base);
  return place(g, x, z, 0);
}

function distToRunway(x, z) {
  const rw = SITE.runway; let best = 1e9;
  for (let i = 0; i < rw.length - 1; i++) {
    const [ax, az] = rw[i], [bx, bz] = rw[i + 1]; const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}
function scatterIn(cx, cz, r, n, fn, minGap) {
  const placed = [];
  let tries = 0;
  while (placed.length < n && tries++ < n * 40) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (distToRunway(x, z) < 110) continue;
    if (x < T.xmin + 60 || x > T.xmax - 60 || z < T.zmin + 60 || z > T.zmax - 60) continue;
    if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < minGap)) continue;
    placed.push([x, z]); fn(x, z, rnd() * 6.283);
  }
  return placed;
}

// ───────────────────────────── build the world ─────────────────────────────
const hotspots = [];
const zoneRings = [];
async function buildWorld() {
  setLoad(0.05);
  const [site, hbuf] = await Promise.all([fetch("/site.json").then((r) => r.json()), fetch("/height.bin").then((r) => r.arrayBuffer())]);
  SITE = site; T = site.terrain; H = new Float32Array(hbuf);
  setLoad(0.2);
  await loadModels();
  setLoad(0.3);

  // terrain
  const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const geo = new THREE.PlaneGeometry(W, D, T.cols - 1, T.rows - 1);
  geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, H[i]);
  geo.computeVertexNormals();
  const tex = await new Promise((res) => new THREE.TextureLoader().load("/ground.jpg", res));
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.position.set((T.xmin + T.xmax) / 2, 0, (T.zmin + T.zmax) / 2); scene.add(ground);
  setLoad(0.5);
  // apron/beyond-terrain floor and distant mountains
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0xc2a97f, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; scene.add(floor);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rnd() * 0.3, R = 2600 + rnd() * 900, h = 320 + rnd() * 380;
    const m = new THREE.Mesh(new THREE.ConeGeometry(500 + rnd() * 500, h, 7), M.mtn); m.position.set(Math.cos(a) * R, h / 2 - 40, Math.sin(a) * R); scene.add(m);
  }

  // runway, centreline, taxiways, aprons
  scene.add(ribbon(site.runway, 30, M.asphalt, 0.35));
  scene.add(ribbon(site.runway, 0.9, M.stripe, 0.55, true));
  for (const tw of site.taxiways) scene.add(ribbon(tw, 12, M.taxi, 0.3));
  for (const ap of site.aprons) if (ap.length >= 3) scene.add(polygon(ap, M.apron, 0.28));
  setLoad(0.62);

  const Z = site.zones, u = site.runway_dir, n = [-u[1], u[0]];
  const along = (t, s) => [ (site.runway[0][0] + site.runway[site.runway.length - 1][0]) / 2 + u[0] * t + n[0] * s,
                            (site.runway[0][1] + site.runway[site.runway.length - 1][1]) / 2 + u[1] * t + n[1] * s ];
  const heading = Math.atan2(u[0], u[1]);

  // dirt roads linking the stages
  const roads = [[Z.tower.center, Z.flightline.center], [Z.tower.center, Z.landing.center], [Z.landing.center, Z.expanse.center], [Z.flightline.center, Z.expanse.center]];
  for (const r of roads) scene.add(ribbon(r, 7, M.dirt, 0.2));

  // THE TOWER (origin, on the real apron)
  scene.add(tower(0, 0));
  hotspots.push({ x: 0, z: 0, r: 30, t: "The Tower", k: "Genesis One · overlook", p: "The heart of the site, on the original airport apron. Press M anywhere for the tower view of all 430 acres. Everything you see is concept: the land is real, the buildings are illustrations of what the three stages could become." });

  // THE FLIGHT LINE: hangars along the runway near the apron, restaurant, pilot facilities
  for (let i = 0; i < 8; i++) { const [x, z] = along(-320 + i * 52, 118); scene.add(hangar(x, z, heading + Math.PI / 2, 22, 26)); }
  { const [x, z] = along(140, 150); scene.add(clubhouse(x, z, heading)); hotspots.push({ x, z, r: 40, t: "Flight Line Restaurant", k: "Stage 02 · The Flight Line · 52 acres", p: "Hangars, a restaurant and pilot facilities along the 6,000 ft runway. Fly in, park, walk to dinner. The Flight Line is where the site's aviation identity lives." }); }
  { const [x, z] = along(-100, 118); hotspots.push({ x, z, r: 60, t: "Hangar Row", k: "Stage 02 · The Flight Line", p: "Eight hangars line the runway's west side with direct taxiway access. Hangar homes, where you live above your aircraft, sit at the end of the row in later stages." }); }
  zoneRings.push({ ...Z.flightline, k: "Stage 02 · 52 acres" });

  // THE LANDING: residential lots, clubhouse, domes, pavilions
  { const c = Z.landing.center; scene.add(clubhouse(c[0], c[1], heading + 0.3)); hotspots.push({ x: c[0], z: c[1], r: 45, t: "The Landing Clubhouse", k: "Stage 01 · The Landing · 66 acres", p: "The first stage: themed residential lots around a clubhouse. Desert-modern homes on dirt roads, low and spread out so the desert stays visible between them." });
    scatterIn(c[0], c[1], 300, 26, (x, z, r) => scene.add(home(x, z, r)), 34);
    scatterIn(c[0] + 120, c[1] - 90, 120, 4, (x, z) => scene.add(dome(x, z, 5.5 + rnd() * 2)), 26);
    scatterIn(c[0] - 140, c[1] + 60, 90, 2, (x, z) => scene.add(pavilion(x, z, 7)), 30); }
  zoneRings.push({ ...Z.landing, k: "Stage 01 · 66 acres" });
  setLoad(0.78);

  // THE EXPANSE: Old West main street, domes, pavilions, design district
  { const c = Z.expanse.center; const dir = heading + Math.PI / 2;
    const sx = Math.cos(dir), sz = Math.sin(dir);        // street direction
    scene.add(ribbon([[c[0] - sx * 140, c[1] - sz * 140], [c[0] + sx * 140, c[1] + sz * 140]], 10, M.dirt, 0.22));
    for (let i = 0; i < 7; i++) { const t = -120 + i * 40;
      for (const side of [-1, 1]) { const ox = -sz * side * 14, oz = sx * side * 14; scene.add(storefront(c[0] + sx * t + ox, c[1] + sz * t + oz, dir + (side > 0 ? Math.PI : 0) + Math.PI / 2)); } }
    hotspots.push({ x: c[0], z: c[1], r: 60, t: "Main Street", k: "Stage 03 · The Expanse · 318 acres", p: "Old West frontier storefronts on a dirt main street: hospitality, commerce and gathering places for the community and its visitors." });
    scatterIn(c[0] + 220, c[1] + 40, 150, 6, (x, z) => scene.add(dome(x, z, 6 + rnd() * 3)), 30);
    scatterIn(c[0] - 200, c[1] - 120, 130, 3, (x, z) => scene.add(pavilion(x, z, 9)), 36);
    const art = [c[0] + 60, c[1] - 220];
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; scene.add(sculpture(art[0] + Math.cos(a) * 26, art[1] + Math.sin(a) * 26, i % 4)); }
    hotspots.push({ x: art[0], z: art[1], r: 50, t: "The Design District", k: "Stage 03 · The Expanse", p: "An artist design district: sculptures and installations placed on the land itself, with an immersive experience concept planned for the far edge of the site." }); }
  zoneRings.push({ ...Z.expanse, k: "Stage 03 · 318 acres" });

  hotspots.push({ x: (site.runway[0][0] + site.runway[6][0]) / 2, z: (site.runway[0][1] + site.runway[6][1]) / 2, r: 70, t: "Runway 03/21", k: "6,000 ft · Douglas Municipal", p: "The real runway, traced from survey data. Douglas Municipal opened in 1928 as one of the first international airports in the United States, and the runway returns to use as the spine of Genesis One." });
  setLoad(0.9);

  // desert scrub
  const scrubGeo = new THREE.IcosahedronGeometry(1, 0); scrubGeo.scale(1, 0.7, 1);
  const inst = new THREE.InstancedMesh(scrubGeo, M.scrub, 1400); const mtx = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 6000 && k < 1400; i++) {
    const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D;
    if (distToRunway(x, z) < 50) continue;
    if (Math.hypot(x, z) < 90) continue;
    const s = 0.8 + rnd() * 1.6;
    mtx.makeRotationY(rnd() * 6.283); mtx.scale(new THREE.Vector3(s, s, s)); mtx.setPosition(x, getH(x, z) + s * 0.5, z);
    inst.setMatrixAt(k++, mtx);
  }
  inst.count = k; scene.add(inst);
  setLoad(1);
}

// ───────────────────────────── player + controls ─────────────────────────────
let player = null, yaw = 0, pitch = 0.18, cart = false, towerView = false;
const keys = {};
const avatars = new Map();   // remote id -> { g, target:{x,z,ry}, cart, name, label }
function makeLabel(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d");
  x.font = "600 30px Space Grotesk, system-ui, sans-serif"; x.textAlign = "center"; x.fillStyle = "rgba(10,22,16,.55)";
  const w = Math.min(240, x.measureText(text).width + 28); x.beginPath(); x.roundRect ? x.roundRect(128 - w / 2, 10, w, 44, 12) : x.rect(128 - w / 2, 10, w, 44); x.fill();
  x.fillStyle = "#f5f1e6"; x.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(2.2, 0.55, 1); s.position.y = 2.3; return s;
}
function avatar(id, name) {
  const hue = (parseInt(id.slice(0, 6), 36) % 360) / 360;
  const col = new THREE.Color().setHSL(hue, 0.55, 0.5);
  const g = new THREE.Group();
  const walk = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 1.2, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }));
  body.position.y = 0.95; walk.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1d3b6, roughness: 0.8 })); head.position.y = 1.7; walk.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), M.green); cap.position.y = 1.93; walk.add(cap);
  g.add(walk);
  const cartG = new THREE.Group(); cartG.visible = false;
  const cb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 2.4), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); cb.position.y = 0.75; cartG.add(cb);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 2.2), M.roof); canopy.position.y = 2.1; cartG.add(canopy);
  for (const [sx, sz] of [[-0.7, 0.9], [0.7, 0.9], [-0.7, -0.9], [0.7, -0.9]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5), M.steel); p.position.set(sx, 1.4, sz); cartG.add(p); }
  for (const [sx, sz] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 12), M.roof); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.3, sz); cartG.add(w); }
  const rider = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1d3b6 })); rider.position.set(0.3, 1.45, 0.2); cartG.add(rider);
  g.add(cartG);
  const label = makeLabel(name); g.add(label);
  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, depthTest: false, transparent: true })); emote.scale.set(1.4, 1.4, 1); emote.position.y = 3.2; emote.visible = false; g.add(emote);
  g.userData = { walk, cartG, label, emote, name };
  scene.add(g); return g;
}
const EMOJI = { wave: "👋", cheer: "🎉", point: "👉", sit: "🪑" };
function emojiTexture(ch) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  x.font = "96px system-ui, Segoe UI Emoji, Apple Color Emoji, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}
const emojiTex = {}; for (const k in EMOJI) emojiTex[k] = emojiTexture(EMOJI[k]);
function setName(g, name) { if (g.userData.name === name) return; g.remove(g.userData.label); const l = makeLabel(name); g.add(l); g.userData.label = l; g.userData.name = name; }
function setCart(g, on) { g.userData.walk.visible = !on; g.userData.cartG.visible = on; }

addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  keys[e.code] = true;
  if (e.code === "KeyC") toggleCart();
  if (e.code === "KeyM") { towerView = !towerView; }
  if (e.code === "KeyN") { timeOffset += DAY_SECONDS / 2; }
  if (e.code === "KeyX") toggleSound();
  if (e.code === "KeyE") openNearest();
  if (e.code === "KeyG") toggleGuestbook();
  if (e.code === "Escape") { closeCards(); }
  const em = { Digit1: "wave", Digit2: "cheer", Digit3: "point", Digit4: "sit" }[e.code]; if (em) act({ t: "emote", e: em });
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
function toggleCart() { cart = !cart; if (player) setCart(player, cart); pushMove(true); }

// mouse look: pointer lock on desktop, drag on touch
let dragging = false, lastX = 0, lastY = 0, locked = false;
canvas.addEventListener("click", () => { if (!("ontouchstart" in window) && canvas.requestPointerLock) canvas.requestPointerLock(); });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === canvas; });
addEventListener("mousemove", (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-0.35, Math.min(0.9, pitch + e.movementY * 0.0018)); });
// touch: left half = joystick, right half = look
const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 }; const look = { id: null, x: 0, y: 0 };
const joyEl = $("#joy"), joyKnob = joyEl.querySelector("i");
if ("ontouchstart" in window) document.body.classList.add("touch");
canvas.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) { if (t.clientX < innerWidth / 2 && joy.id === null) { joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY; joy.active = true; } else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.cx) / 50)); joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.cy) / 50)); joyKnob.style.transform = `translate(${joy.dx * 30}px,${joy.dy * 30}px)`; } else if (t.identifier === look.id) { yaw -= (t.clientX - look.x) * 0.005; pitch = Math.max(-0.35, Math.min(0.9, pitch + (t.clientY - look.y) * 0.004)); look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchend", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; joyKnob.style.transform = ""; } if (t.identifier === look.id) look.id = null; } }, { passive: true });
document.querySelectorAll("#tbtns button").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.k; if (k === "KeyC") toggleCart(); else if (k === "KeyM") towerView = !towerView; else if (k === "KeyE") openNearest(); else if (k === "KeyG") toggleGuestbook(); else if (k === "Digit1") act({ t: "emote", e: "wave" }); else if (k === "KeyN") timeOffset += DAY_SECONDS / 2; }));

// ───────────────────────────── HUD: cards, guestbook, zones, minimap ─────────────────────────────
let gbOpen = false;
function closeCards() { $("#info").classList.remove("on"); $("#gb").classList.remove("on"); gbOpen = false; }
function openNearest() {
  if (!player) return;
  let best = null, bd = 1e9;
  for (const h of hotspots) { const d = Math.hypot(player.position.x - h.x, player.position.z - h.z); if (d < h.r && d < bd) { bd = d; best = h; } }
  if (!best) return;
  $("#info-h").textContent = best.t; $("#info-k").textContent = best.k; $("#info-p").textContent = best.p; $("#info").classList.add("on");
  if (document.exitPointerLock) document.exitPointerLock();
}
$("#info-x").addEventListener("click", closeCards);
function toggleGuestbook() { gbOpen = !gbOpen; $("#gb").classList.toggle("on", gbOpen); if (gbOpen) { renderGuestbook(); if (document.exitPointerLock) document.exitPointerLock(); $("#gb-in").focus(); } }
function renderGuestbook() {
  const list = $("#gb-list"); list.innerHTML = "";
  const entries = (view && view.guestbook) || [];
  if (!entries.length) { const d = document.createElement("div"); d.textContent = "Nobody has signed yet. Be the first."; list.append(d); }
  for (const e of [...entries].reverse()) { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = e.by + " "; d.append(b, document.createTextNode(e.text)); list.append(d); }
}
$("#gb-go").addEventListener("click", () => { const v = $("#gb-in").value.trim(); if (!v) return; act({ t: "sign", text: v }); $("#gb-in").value = ""; });
$("#gb-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gb-go").click(); });
$("#gb-x").addEventListener("click", closeCards);
// name
function askName() {
  const saved = localStorage.getItem("g1:name");
  if (saved) return;
  $("#name").classList.add("on"); $("#name-in").focus();
}
$("#name-go").addEventListener("click", () => {
  const v = $("#name-in").value.trim().replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 18);
  if (!v) return; localStorage.setItem("g1:name", v); act({ t: "name", name: v }); $("#name").classList.remove("on");
});
$("#name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-go").click(); });

let zoneShown = null, zoneTimer = 0;
function updateZone(dt) {
  if (!player) return;
  let inZone = null;
  for (const z of zoneRings) if (Math.hypot(player.position.x - z.center[0], player.position.z - z.center[1]) < z.r) inZone = z;
  if (inZone && inZone !== zoneShown) { zoneShown = inZone; $("#zone-n").textContent = inZone.name; $("#zone-k").textContent = inZone.k; $("#zone").classList.add("on"); zoneTimer = 3.5; }
  if (!inZone) zoneShown = null;
  if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) $("#zone").classList.remove("on"); }
  // hotspot prompt
  let near = null;
  for (const h of hotspots) if (Math.hypot(player.position.x - h.x, player.position.z - h.z) < h.r) near = h;
  $("#prompt").classList.toggle("on", !!near && !$("#info").classList.contains("on"));
  if (near) $("#prompt-t").innerHTML = `<b>E</b> &nbsp;${near.t}`;
}
const mmc = $("#mmc").getContext("2d"); const mmImg = new Image(); mmImg.src = "/minimap.jpg";
function drawMinimap() {
  if (!T || !player) return;
  const S = 368; mmc.clearRect(0, 0, S, S);
  if (mmImg.complete) mmc.drawImage(mmImg, 0, 0, S, S);
  const px = (x) => ((x - T.xmin) / (T.xmax - T.xmin)) * S, pz = (z) => ((z - T.zmin) / (T.zmax - T.zmin)) * S;
  mmc.strokeStyle = "rgba(20,20,22,.9)"; mmc.lineWidth = 5; mmc.beginPath();
  SITE.runway.forEach((p, i) => (i ? mmc.lineTo(px(p[0]), pz(p[1])) : mmc.moveTo(px(p[0]), pz(p[1])))); mmc.stroke();
  mmc.font = "600 15px system-ui, sans-serif"; mmc.fillStyle = "rgba(245,241,230,.95)"; mmc.textAlign = "center";
  for (const z of zoneRings) { mmc.strokeStyle = "rgba(77,222,111,.5)"; mmc.lineWidth = 2; mmc.beginPath(); mmc.arc(px(z.center[0]), pz(z.center[1]), (z.r / (T.xmax - T.xmin)) * S, 0, 6.283); mmc.stroke(); mmc.fillText(z.name.replace("The ", ""), px(z.center[0]), pz(z.center[1]) + 5); }
  if (view) for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; mmc.fillStyle = "rgba(245,241,230,.9)"; mmc.beginPath(); mmc.arc(px(p.x), pz(p.z), 4, 0, 6.283); mmc.fill(); }
  mmc.fillStyle = "#4DDE6F"; mmc.beginPath(); mmc.arc(px(player.position.x), pz(player.position.z), 6, 0, 6.283); mmc.fill();
  mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 2; mmc.stroke();
}

// ───────────────────────────── movement + net sync ─────────────────────────────
let lastSent = { x: 0, z: 0, ry: 0, at: 0 };
function pushMove(force) {
  if (!player) return;
  const now = performance.now();
  const moved = Math.hypot(player.position.x - lastSent.x, player.position.z - lastSent.z) > 0.08 || Math.abs(yaw - lastSent.ry) > 0.02;
  if (force || (moved && now - lastSent.at > 120) || now - lastSent.at > 3000) {
    if (!lastSent.at) { lastSent = { x: 0, z: 48, ry: 0, at: 0 }; }
    act({ t: "move", x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +yaw.toFixed(3), cart });
    lastSent = { x: player.position.x, z: player.position.z, ry: yaw, at: now };
  }
}
let lastT = performance.now(), bob = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!player) { renderer.render(scene, camera); return; }
  // input
  let fx = 0, fz = 0;
  if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1;
  if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1;
  if (joy.active) { fx += joy.dx; fz -= joy.dy; }
  const L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
  const speed = cart ? 22 : (keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5;
  const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
  let nx = player.position.x + (fwd[0] * fz + right[0] * fx) * speed * dt;
  let nz = player.position.z + (fwd[1] * fz + right[1] * fx) * speed * dt;
  nx = Math.max(T.xmin + 8, Math.min(T.xmax - 8, nx)); nz = Math.max(T.zmin + 8, Math.min(T.zmax - 8, nz));
  player.position.x = nx; player.position.z = nz;
  const gh = getH(nx, nz); bob += L * dt * (cart ? 0 : 9);
  player.position.y = gh + (L && !cart ? Math.abs(Math.sin(bob)) * 0.08 : 0);
  if (L > 0.01) player.rotation.y = Math.atan2(fwd[0] * fz + right[0] * fx, fwd[1] * fz + right[1] * fx);
  // camera
  if (towerView) {
    const tx = Math.sin(now * 0.00012) * 220, tz = Math.cos(now * 0.00012) * 220;
    camera.position.set(tx, getH(tx, tz) + 160, tz); camera.lookAt(player.position.x, gh + 20, player.position.z);
  } else {
    const dist = cart ? 13 : 9.5, h = 3.2 + pitch * 4;
    const cx = nx - fwd[0] * dist * Math.cos(pitch) , cz = nz - fwd[1] * dist * Math.cos(pitch);
    const cy = Math.max(getH(cx, cz) + 1.2, gh + h);
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.35);
    camera.lookAt(nx, gh + 1.6, nz);
  }
  $("#coords").textContent = `${Math.round(nx)} E · ${Math.round(nz)} S · ${Math.round(gh + (T.base_elev_m || 0))} m`;
  pushMove(false);
  // remote players
  if (view) {
    const nowMs = performance.now();
    for (const [id, p] of Object.entries(view.players)) {
      if (id === ME) { if (player.userData.name !== p.name) setName(player, p.name); showEmote(player, p); continue; }
      const s = seen.get(id); const stale = !s || nowMs - s.at > 12000;
      let a = avatars.get(id);
      if (!a) { a = { g: avatar(id, p.name), tx: p.x, tz: p.z, ry: p.ry }; a.g.position.set(p.x, getH(p.x, p.z), p.z); avatars.set(id, a); }
      a.g.visible = !stale;
      a.tx = p.x; a.tz = p.z; a.ry = p.ry; setName(a.g, p.name); setCart(a.g, !!p.cart); showEmote(a.g, p);
      a.g.position.x += (a.tx - a.g.position.x) * 0.12; a.g.position.z += (a.tz - a.g.position.z) * 0.12;
      a.g.position.y = getH(a.g.position.x, a.g.position.z);
      const dx = a.tx - a.g.position.x, dz = a.tz - a.g.position.z; if (dx * dx + dz * dz > 0.02) a.g.rotation.y = Math.atan2(dx, dz);
    }
    for (const [id, a] of avatars) if (!view.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  updateZone(dt); drawMinimap(); updateSky(); updateAudio(dt);
  renderer.render(scene, camera);
}
const emoteShown = new Map();
function showEmote(g, p) {
  const key = g.uuid; const prev = emoteShown.get(key);
  if (p.emote && p.emoteTick && (!prev || prev.tick !== p.emoteTick)) { emoteShown.set(key, { tick: p.emoteTick, at: performance.now() }); g.userData.emote.material.map = emojiTex[p.emote]; g.userData.emote.material.needsUpdate = true; g.userData.emote.visible = true; }
  const e = emoteShown.get(key); if (e && performance.now() - e.at > 3000) g.userData.emote.visible = false;
}

// ───────────────────────────── ambient audio ─────────────────────────────
const AUD = {}; let soundOn = false, audioReady = false, planeTimer = 40 + Math.random() * 60;
function mkAudio(src, vol, loop) { const a = new Audio(src); a.loop = loop; a.volume = 0; a.preload = "auto"; a.dataset.vol = vol; return a; }
AUD.music = mkAudio("/audio/music.m4a", 0.22, true);
AUD.wind = mkAudio("/audio/wind.mp3", 0.5, true);
AUD.night = mkAudio("/audio/night.mp3", 0.55, true);
AUD.plane = mkAudio("/audio/plane.mp3", 0.45, false);
function startAudio() {
  if (audioReady) return; audioReady = true;
  for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {});
  soundOn = localStorage.getItem("g1:sound") !== "off";
  updateSoundBtn();
}
function toggleSound() { soundOn = !soundOn; localStorage.setItem("g1:sound", soundOn ? "on" : "off"); if (!audioReady) { audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); } updateSoundBtn(); }
function updateSoundBtn() { const b = document.getElementById("snd"); if (b) b.textContent = soundOn ? "SOUND ON" : "SOUND OFF"; }
function updateAudio(dt) {
  if (!audioReady) return;
  const on = soundOn ? 1 : 0;
  const target = { music: 1, wind: 0.25 + 0.75 * (1 - night), night: night };
  for (const k in target) { const a = AUD[k], want = on * +a.dataset.vol * target[k]; a.volume += (want - a.volume) * Math.min(1, dt * 1.5); }
  planeTimer -= dt;
  if (planeTimer <= 0) { planeTimer = 70 + Math.random() * 90; if (soundOn && night < 0.6) { AUD.plane.volume = +AUD.plane.dataset.vol; AUD.plane.currentTime = 0; AUD.plane.play().catch(() => {}); } }
}
addEventListener("pointerdown", startAudio);
addEventListener("keydown", startAudio);
document.getElementById("snd").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });

// ───────────────────────────── boot ─────────────────────────────
buildWorld().then(() => {
  player = avatar(ME, localStorage.getItem("g1:name") || "You");
  player.position.set(0, getH(0, 48), 48);
  $("#load").classList.add("off");
  askName();
  connect();
  frame();
}).catch((err) => { setStatus("failed to load the site: " + err.message, true); console.error(err); });
