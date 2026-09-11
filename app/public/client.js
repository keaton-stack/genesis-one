/* GENESIS ONE · concept walkthrough client, v4
   Real terrain + 96 km of real Arizona, generated 3D buildings by the hundreds,
   structured stages with entry signs, shared carts and a flyable jet, a personal
   cart, jumping, a cart obstacle course and a six-hole desert golf course. */

// ───────────────────────────── net ─────────────────────────────
const room = new URLSearchParams(location.search).get("room") || "main";
function playerId() { const key = "hf:game:playerId"; let id = localStorage.getItem(key); if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(key, id); } return id; }
const ME = playerId();
const PING = "__ping", PONG = "__pong";
let socket = null, retry = 0, view = null, connected = 0;
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  socket.addEventListener("open", () => { retry = 0; setStatus("connected"); send({ type: "join", playerId: ME }); });
  socket.addEventListener("message", (ev) => { if (ev.data === PONG) return; let msg; try { msg = JSON.parse(ev.data); } catch { return; } if (msg.type === "state") onState(msg); else if (msg.type === "error") setStatus(msg.error, true); });
  socket.addEventListener("close", () => { retry = Math.min(retry + 1, 6); const wait = 500 * 2 ** (retry - 1); setStatus(`reconnecting in ${Math.round(wait / 1000)}s`, true); setTimeout(connect, wait); });
}
function send(msg) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); }
function act(action) { send({ type: "action", action }); }
setInterval(() => { if (socket && socket.readyState === WebSocket.OPEN) socket.send(PING); }, 30000);
const $ = (s) => document.querySelector(s);
function setStatus(t, err) { const el = $("#status"); el.textContent = t; el.classList.toggle("err", !!err); }

const seen = new Map(); let introduced = false, riding = null; const chatSeen = new Map();
function onState(msg) {
  connected = msg.connected || 1; $("#online").textContent = String(connected);
  if (!msg.view) return; view = msg.view;
  const now = performance.now();
  for (const [id, p] of Object.entries(view.players)) {
    const s = seen.get(id); if (!s || s.t !== p.t) seen.set(id, { t: p.t, at: now });
    if (p.say && p.sayTick && chatSeen.get(id) !== p.sayTick) { chatSeen.set(id, p.sayTick); if (introduced) logLine(p.name, p.say); }
  }
  if (!introduced && player) {
    introduced = true; const mine = view.players[ME];
    if (mine && (mine.x || mine.z)) { player.position.x = mine.x; player.position.z = mine.z; yaw = mine.ry; } else { player.position.x = 0; player.position.z = 48; }
    pushMove(true); const savedName = localStorage.getItem("g1:name"); if (savedName) act({ t: "name", name: savedName });
  }
  const mine = view.players[ME];
  if (mine) { const v = mine.veh && view.vehicles && view.vehicles[mine.veh]; if (v && (!riding || riding.id !== mine.veh)) enterVehicle(mine.veh, v); if (!v && riding) exitVehicle(); if (riding) riding.driver = v.driver === ME; }
  if (gbOpen) renderGuestbook(); if (boardOpen) renderBoard();
}
function logLine(name, text) { const log = $("#log"); const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = name + " "; d.append(b, document.createTextNode(text)); log.append(d); while (log.children.length > 6) log.removeChild(log.firstChild); setTimeout(() => { if (d.parentNode) d.remove(); }, 14000); }

// ───────────────────────────── scene ─────────────────────────────
const canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xe7d6bd, 0.000075);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 120000);
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7d6b4c, 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 1.25); sun.position.set(-600, 500, 300); scene.add(sun);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0); moon.position.set(400, 500, -300); scene.add(moon);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

// sky dome with gradient, sun glow and a cloud layer drawn from noise
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color(0x9fc4e8) }, mid: { value: new THREE.Color(0xc9dcef) }, horizon: { value: new THREE.Color(0xe7d6bd) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffd9a0) }, glow: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y, -0.05, 1.0); float t = pow(max(h, 0.0), 0.5); vec3 c = h < 0.18 ? mix(horizon, mid, smoothstep(0.0, 0.18, h)) : mix(mid, top, smoothstep(0.18, 1.0, h));
      float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0); c += sunCol * glow * (pow(s, 400.0) * 2.2 + pow(s, 6.0) * 0.32 * (1.0 - t)); gl_FragColor = vec4(c, 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(80000, 48, 24), skyMat));
const starGeo = new THREE.BufferGeometry(); { const a = []; for (let i = 0; i < 2600; i++) { const t = Math.random() * 6.283, u = Math.random() * 0.92 + 0.06; const r = 70000; a.push(Math.cos(t) * Math.sqrt(1 - u * u) * r, u * r, Math.sin(t) * Math.sqrt(1 - u * u) * r); } starGeo.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 90, transparent: true, opacity: 0, fog: false })); scene.add(stars);
function cloudTexture(size, cover) {
  const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d");
  const img = x.createImageData(size, size), d = img.data;
  // value noise, 5 octaves, tileable
  const oct = []; for (let o = 0; o < 5; o++) { const n = 4 << o; const g = new Float32Array(n * n); for (let i = 0; i < n * n; i++) g[i] = Math.random(); oct.push({ n, g }); }
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
    let v = 0, amp = 0.5;
    for (const { n, g } of oct) { const fx = xx / size * n, fy = y / size * n; const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0); const s = (i, j) => g[((j % n) + n) % n * n + ((i % n) + n) % n]; v += amp * ((s(x0, y0) * (1 - tx) + s(x0 + 1, y0) * tx) * (1 - ty) + (s(x0, y0 + 1) * (1 - tx) + s(x0 + 1, y0 + 1) * tx) * ty); amp *= 0.5; }
    const a = Math.max(0, Math.min(1, (v - cover) * 3.2)); const i = (y * size + xx) * 4; const shade = 235 + 20 * a; d[i] = shade; d[i + 1] = shade; d[i + 2] = shade + 8; d[i + 3] = a * a * 255;
  }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
}
const cloudA = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshBasicMaterial({ map: cloudTexture(256, 0.52), transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
cloudA.rotation.x = Math.PI / 2; cloudA.position.y = 2200; scene.add(cloudA);
const cloudB = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshBasicMaterial({ map: cloudTexture(256, 0.58), transparent: true, depthWrite: false, fog: false, opacity: 0.55 }));
cloudB.rotation.x = Math.PI / 2; cloudB.position.y = 3400; cloudB.material.map.repeat.set(4, 4); scene.add(cloudB);

// ───────────────────────────── terrain data ─────────────────────────────
let SITE = null, H = null, T = null, HR = null, TR = null;
function sampleGrid(h, t, x, z) {
  const u = ((x - t.xmin) / (t.xmax - t.xmin)) * (t.cols - 1), v = ((z - t.zmin) / (t.zmax - t.zmin)) * (t.rows - 1);
  const c = Math.max(0, Math.min(t.cols - 2, Math.floor(u))), r = Math.max(0, Math.min(t.rows - 2, Math.floor(v)));
  const fu = Math.max(0, Math.min(1, u - c)), fv = Math.max(0, Math.min(1, v - r)); const i = r * t.cols + c;
  return (h[i] * (1 - fu) + h[i + 1] * fu) * (1 - fv) + (h[i + t.cols] * (1 - fu) + h[i + t.cols + 1] * fu) * fv;
}
function getH(x, z) {
  if (H && x > T.xmin && x < T.xmax && z > T.zmin && z < T.zmax) return sampleGrid(H, T, x, z);
  if (HR) return sampleGrid(HR, TR, x, z);
  return 0;
}
let seed = 20260910; function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const loadbar = $("#loadbar"); const setLoad = (p, m) => { loadbar.style.width = Math.round(p * 100) + "%"; if (m) $("#loadmsg").textContent = m; };

// ───────────────────────────── materials ─────────────────────────────
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.95 }), taxi: new THREE.MeshStandardMaterial({ color: 0x4a4b4f, roughness: 0.95 }),
  apron: new THREE.MeshStandardMaterial({ color: 0x5a5b5e, roughness: 0.95 }), dirt: new THREE.MeshStandardMaterial({ color: 0xb99b6f, roughness: 1 }),
  track: new THREE.MeshStandardMaterial({ color: 0x9c7a52, roughness: 1 }), stripe: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.5, emissive: 0x1b7a35, emissiveIntensity: 0.4 }), scrub: new THREE.MeshStandardMaterial({ color: 0x6f7d4b, roughness: 1 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: 0xffd48a, emissive: 0xffb84d, emissiveIntensity: 0 }), rwLight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }),
  rwLightB: new THREE.MeshStandardMaterial({ color: 0x9fd7ff, emissive: 0x6ec2ff, emissiveIntensity: 0 }), steel: new THREE.MeshStandardMaterial({ color: 0x8e9aa4, roughness: 0.45, metalness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.95 }), cone: new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 }),
  coneW: new THREE.MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.7 }), tire: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.95 }),
  ramp: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 }), banner: new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.8, side: THREE.DoubleSide }),
  turf: new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 1 }), fringe: new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 1 }),
  sand: new THREE.MeshStandardMaterial({ color: 0xe6d3a3, roughness: 1 }), wall: new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 0.9 }),
  bumper: new THREE.MeshStandardMaterial({ color: 0xf4cd5a, roughness: 0.6 }), flag: new THREE.MeshStandardMaterial({ color: 0xff3b30, side: THREE.DoubleSide }),
  hole: new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), post: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95 }),
};
const buildingMats = [];

// ───────────────────────────── geometry helpers ─────────────────────────────
function ribbon(points, width, mat, lift, dashed) {
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) { const [ax, az] = points[i], [bx, bz] = points[i + 1]; const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 8)); for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  pts.push(points[points.length - 1]);
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx, w = width / 2; const l = [p[0] + nx * w, p[1] + nz * w], r = [p[0] - nx * w, p[1] - nz * w];
    pos.push(l[0], getH(l[0], l[1]) + lift, l[1], r[0], getH(r[0], r[1]) + lift, r[1]);
    if (i < pts.length - 1 && (!dashed || i % 2 === 0)) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return new THREE.Mesh(g, mat);
}
function polygon(points, mat, lift) {
  const tri = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p[0], p[1])), []); const pos = [], idx = [];
  const hAvg = points.reduce((s, p) => s + getH(p[0], p[1]), 0) / points.length;
  for (const p of points) pos.push(p[0], hAvg + lift, p[1]); for (const t of tri) idx.push(t[0], t[2], t[1]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return new THREE.Mesh(g, mat);
}
function box(w, h, d, mat, x, y, z, ry) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry || 0; return m; }
function textTexture(lines, w, h, opts) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); const o = opts || {};
  x.fillStyle = o.bg || "#2b2118"; x.fillRect(0, 0, w, h);
  if (o.planks) { for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.04)"; x.fillRect(0, i * h / 6, w, h / 6); x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, i * h / 6, w, 3); } }
  if (o.border) { x.strokeStyle = o.border; x.lineWidth = h * 0.02; x.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08); }
  x.textAlign = "center"; x.textBaseline = "middle";
  lines.forEach((ln, i) => { x.font = `${ln.weight || 400} ${ln.size}px ${ln.font || "Anton, Impact, sans-serif"}`; x.fillStyle = ln.color || "#f5f1e6"; if (ln.shadow) { x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 8; x.shadowOffsetY = 4; } x.fillText(ln.text, w / 2, ln.y * h); x.shadowBlur = 0; x.shadowOffsetY = 0; });
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
}
function sign(x, z, rot, title, sub, big) {
  const g = new THREE.Group(); const W = big ? 11 : 6.4, Hh = big ? 4 : 2.4;
  const tex = textTexture([{ text: title, size: big ? 150 : 110, y: 0.42, shadow: true }, { text: sub, size: big ? 52 : 42, y: 0.74, color: "#4DDE6F", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 1024, 384, { planks: true, border: "#4DDE6F" });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.18), [M.wood, M.wood, M.wood, M.wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })]);
  board.position.y = (big ? 3.2 : 2.2) + Hh / 2; g.add(board);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, board.position.y + Hh / 2, 0.3), M.post); p.position.set(s * (W / 2 - 0.4), (board.position.y + Hh / 2) / 2, 0); g.add(p); }
  g.position.set(x, getH(x, z), z); g.rotation.y = rot; scene.add(g); COLLIDERS.push([x, z, W / 2 * 0.6]); return g;
}

// ───────────────────────────── generated 3D models (instanced) ─────────────────────────────
const MODEL_SPECS = {
  home: { size: 15 }, clubhouse: { size: 38 }, hangar: { size: 24 }, dome: { size: 13 }, pavilion: { size: 18 }, store: { size: 11 }, saloon: { size: 15 }, tower: { height: 27, solid: 6 },
  bigtent: { size: 58 }, hangarhome: { size: 34 }, diner: { size: 30 }, chapel: { size: 16 }, hotel: { size: 26 }, barn: { size: 22 }, gallery: { size: 30 }, observatory: { size: 12 },
  amphitheater: { size: 40, solid: 0 }, windmill: { height: 14, solid: 2 }, solar: { size: 26, solid: 0 }, fbo: { size: 36 },
  saguaro: { height: 7, solid: 0.6, prop: true }, paloverde: { height: 8, solid: 0.6, prop: true }, sculpture: { height: 7, solid: 1.5, prop: true }, lamp: { height: 4.2, solid: 0.3, prop: true },
  cart: { size: 3.2, vehicle: true, rot: Math.PI / 2 }, jet: { size: 22, vehicle: true, rot: Math.PI / 2 }, gbjet: { size: 22, vehicle: true, rot: Math.PI / 2 },
};
const MODELS = {}, PLACE = {}, COLLIDERS = [];
async function loadModels() {
  if (!THREE.GLTFLoader) return; const loader = new THREE.GLTFLoader(); const kinds = Object.keys(MODEL_SPECS); let done = 0;
  await Promise.all(kinds.map((k) => new Promise((res) => {
    loader.load(`/models/${k}.glb`, (g) => {
      const root = g.scene; root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root); const sz = new THREE.Vector3(); box.getSize(sz); const c = new THREE.Vector3(); box.getCenter(c);
      const spec = MODEL_SPECS[k]; const s = spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
      const norm = new THREE.Matrix4().makeRotationY(spec.rot || 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const parts = [];
      root.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().copy(norm).multiply(o.matrixWorld)); const mat = o.material.clone(); mat.side = THREE.DoubleSide; mat.transparent = false; mat.depthWrite = true; mat.roughness = 0.85; mat.metalness = 0; if (mat.map) { mat.map.encoding = THREE.sRGBEncoding; mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffb870); mat.emissiveIntensity = 0; } if (!spec.prop && !spec.vehicle) buildingMats.push(mat); parts.push({ geometry: geo, material: mat }); });
      MODELS[k] = { parts, radius: Math.max(sz.x, sz.z) * s / 2, height: sz.y * s }; setLoad(0.15 + 0.4 * (++done / kinds.length)); res();
    }, undefined, () => { setLoad(0.15 + 0.4 * (++done / kinds.length)); res(); });
  })));
}
function put(kind, x, z, rot, scale) {
  const sc = scale || 1; (PLACE[kind] || (PLACE[kind] = [])).push([x, getH(x, z), z, rot || 0, sc]);
  const spec = MODEL_SPECS[kind], m = MODELS[kind]; const solid = spec.solid !== undefined ? spec.solid * sc : (m ? m.radius * 0.6 * sc : 4);
  if (solid > 0) COLLIDERS.push([x, z, solid]);
}
function buildInstances() {
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const kind in PLACE) { const m = MODELS[kind], list = PLACE[kind]; if (!m || !list.length) continue;
    for (const part of m.parts) { const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length); list.forEach((e, i) => { p.set(e[0], e[1], e[2]); q.setFromAxisAngle(up, e[3]); s.setScalar(e[4]); mtx.compose(p, q, s); inst.setMatrixAt(i, mtx); }); inst.frustumCulled = false; scene.add(inst); } }
}
function makeModel(kind) { const m = MODELS[kind]; const g = new THREE.Group(); if (!m) return g; for (const part of m.parts) g.add(new THREE.Mesh(part.geometry, part.material)); return g; }
function collide(x, z, r) { for (const c of COLLIDERS) { const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz), min = c[2] + r; if (d < min && d > 0.001) { x = c[0] + dx / d * min; z = c[1] + dz / d * min; } } return [x, z]; }

// ───────────────────────────── layout ─────────────────────────────
const hotspots = [], zoneRings = []; let runwayMid, U, Nn, heading;
function along(t, s) { return [runwayMid[0] + U[0] * t + Nn[0] * s, runwayMid[1] + U[1] * t + Nn[1] * s]; }
function distToRunway(x, z) { const rw = SITE.runway; let best = 1e9; for (let i = 0; i < rw.length - 1; i++) { const [ax, az] = rw[i], [bx, bz] = rw[i + 1]; const vx = bx - ax, vz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t))); } return best; }
const KEEPOUT = [];   // [x,z,r] areas (golf, course) where nothing is scattered
function free(x, z, gap) {
  if (distToRunway(x, z) < 95) return false;
  if (x < T.xmin + 40 || x > T.xmax - 40 || z < T.zmin + 40 || z > T.zmax - 40) return false;
  for (const k of KEEPOUT) if (Math.hypot(k[0] - x, k[1] - z) < k[2]) return false;
  for (const c of COLLIDERS) if (Math.hypot(c[0] - x, c[1] - z) < c[2] + gap) return false;
  return true;
}
function scatter(kind, cx, cz, r, n, gap, scaleFn, rotFn) { let placed = 0, tries = 0; while (placed < n && tries++ < n * 60) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (!free(x, z, gap)) continue; put(kind, x, z, rotFn ? rotFn(x, z) : rnd() * 6.283, scaleFn ? scaleFn() : 1); placed++; } }
// a road with buildings on both sides facing it
function street(cx, cz, dir, len, kinds, spacing, lamps, width) {
  const sx = Math.cos(dir), sz = Math.sin(dir);
  scene.add(ribbon([[cx - sx * (len / 2 + 20), cz - sz * (len / 2 + 20)], [cx + sx * (len / 2 + 20), cz + sz * (len / 2 + 20)]], width || 11, M.dirt, 0.22));
  let i = 0;
  for (let t = -len / 2; t <= len / 2; t += spacing) {
    for (const side of [-1, 1]) { const kind = kinds[(i++) % kinds.length]; if (!kind) continue; const off = (width || 11) / 2 + 3 + (MODELS[kind] ? MODELS[kind].radius : 6); const x = cx + sx * t - sz * side * off, z = cz + sz * t + sx * side * off; if (!free(x, z, 1)) continue; put(kind, x, z, Math.atan2(sz * side, -sx * side), kind === "home" ? 0.85 + rnd() * 0.35 : 1); }
    if (lamps && Math.round((t + len / 2) / spacing) % 2 === 0) for (const side of [-1, 1]) put("lamp", cx + sx * t - sz * side * ((width || 11) / 2 + 1), cz + sz * t + sx * side * ((width || 11) / 2 + 1), Math.atan2(sz * side, -sx * side));
  }
}
// a ring road with homes on both sides facing it
function ring(cx, cz, r, kinds, spacing, lamps) {
  const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 6.283; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  scene.add(ribbon(pts, 9, M.dirt, 0.22));
  const n = Math.floor(6.283 * r / spacing); let k = 0;
  for (let i = 0; i < n; i++) { const a = i / n * 6.283; for (const side of [-1, 1]) { const kind = kinds[(k++) % kinds.length]; if (!kind) continue; const off = r + side * (7 + (MODELS[kind] ? MODELS[kind].radius : 6)); const x = cx + Math.cos(a) * off, z = cz + Math.sin(a) * off; if (!free(x, z, 1)) continue; put(kind, x, z, Math.atan2(-Math.cos(a) * side, -Math.sin(a) * side), 0.85 + rnd() * 0.35); }
    if (lamps && i % 3 === 0) put("lamp", cx + Math.cos(a) * (r + 5.5), cz + Math.sin(a) * (r + 5.5), Math.atan2(-Math.cos(a), -Math.sin(a))); }
}

async function buildWorld() {
  setLoad(0.03, "Reading the survey");
  const [site, hbuf, region, rbuf] = await Promise.all([fetch("/site.json").then((r) => r.json()), fetch("/height.bin").then((r) => r.arrayBuffer()), fetch("/region.json").then((r) => r.json()).catch(() => null), fetch("/region_height.bin").then((r) => r.arrayBuffer()).catch(() => null)]);
  SITE = site; T = site.terrain; H = new Float32Array(hbuf);
  if (region && rbuf) { TR = region; HR = new Float32Array(rbuf);
    // lift the far mountains so they read from ground level like they do to the eye
    for (let r = 0; r < TR.rows; r++) for (let c = 0; c < TR.cols; c++) { const x = TR.xmin + c / (TR.cols - 1) * (TR.xmax - TR.xmin), z = TR.zmin + r / (TR.rows - 1) * (TR.zmax - TR.zmin); const d = Math.hypot(x, z); const k = 1 + 0.9 * Math.min(1, Math.max(0, (d - 2500) / 6000)); const i = r * TR.cols + c; HR[i] = HR[i] > 0 ? HR[i] * k : HR[i]; } }
  U = site.runway_dir; Nn = [-U[1], U[0]]; heading = Math.atan2(U[0], U[1]);
  runwayMid = [(site.runway[0][0] + site.runway[site.runway.length - 1][0]) / 2, (site.runway[0][1] + site.runway[site.runway.length - 1][1]) / 2];
  setLoad(0.12, "Raising the buildings"); await loadModels(); setLoad(0.58, "Laying the ground");

  const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const geo = new THREE.PlaneGeometry(W, D, T.cols - 1, T.rows - 1); geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, H[i]); geo.computeVertexNormals();
  const texLoader = new THREE.TextureLoader(); const tex = await new Promise((res) => texLoader.load("/ground.jpg", res)); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })); ground.position.set((T.xmin + T.xmax) / 2, 0, (T.zmin + T.zmax) / 2); scene.add(ground);
  if (HR) { const WR = TR.xmax - TR.xmin, DR = TR.zmax - TR.zmin; const rg = new THREE.PlaneGeometry(WR, DR, TR.cols - 1, TR.rows - 1); rg.rotateX(-Math.PI / 2); const ra = rg.attributes.position; for (let i = 0; i < ra.count; i++) ra.setY(i, HR[i] - 3); rg.computeVertexNormals();
    const rtex = await new Promise((res) => texLoader.load("/region_ground.jpg", res)); rtex.encoding = THREE.sRGBEncoding; rtex.anisotropy = 4;
    const regionMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: rtex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })); regionMesh.position.set((TR.xmin + TR.xmax) / 2, 0, (TR.zmin + TR.zmax) / 2); scene.add(regionMesh); }
  setLoad(0.66, "Painting the runway");
  scene.add(ribbon(site.runway, 30, M.asphalt, 0.35)); scene.add(ribbon(site.runway, 0.9, M.stripe, 0.55, true));
  for (const tw of site.taxiways) scene.add(ribbon(tw, 12, M.taxi, 0.3)); for (const ap of site.aprons) if (ap.length >= 3) scene.add(polygon(ap, M.apron, 0.28));
  { const L = 1758, n = Math.floor(L / 60), inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), M.rwLight, n * 2 + 2); const mt = new THREE.Matrix4(); let k = 0; for (let i = 0; i <= n; i++) for (const s of [-16.5, 16.5]) { const p = along(-L / 2 + i * 60, s); mt.makeTranslation(p[0], getH(p[0], p[1]) + 0.6, p[1]); inst.setMatrixAt(k++, mt); } inst.count = k; scene.add(inst); }

  const Z = site.zones;
  // keep-out zones for the two games (placed before anything is scattered)
  GOLF.origin = [-120, 1120]; KEEPOUT.push([GOLF.origin[0], GOLF.origin[1], 190]);
  COURSE.origin = [-360, 330]; KEEPOUT.push([COURSE.origin[0], COURSE.origin[1], 190]);
  const roads = [[Z.tower.center, Z.flightline.center], [Z.tower.center, Z.landing.center], [Z.landing.center, Z.expanse.center], [Z.flightline.center, Z.expanse.center], [Z.expanse.center, [Z.expanse.center[0] - 260, Z.expanse.center[1] + 330]], [[Z.expanse.center[0] - 260, Z.expanse.center[1] + 330], Z.landing.center], [Z.tower.center, COURSE.origin], [Z.landing.center, GOLF.origin]];
  for (const r of roads) scene.add(ribbon(r, 7, M.dirt, 0.2));
  setLoad(0.74, "Building the stages");

  // ── THE TOWER + apron ──
  put("tower", 0, 0, 0); put("fbo", 60, -30, heading + Math.PI); put("diner", -70, -10, heading);
  sign(30, 95, Math.PI, "GENESIS ONE", "DOUGLAS, ARIZONA · THE AWAKENING", true);
  hotspots.push({ x: 0, z: 0, r: 34, t: "The Tower", k: "Genesis One · overlook", p: "The heart of the site, on the original airport apron. Press M anywhere for the tower view of all 430 acres. Everything you see is concept: the land is real, the buildings are illustrations of what the three stages could become." });
  hotspots.push({ x: 60, z: -30, r: 30, t: "Private Aviation Terminal", k: "Arrivals · the front door", p: "Fly in on the 6,000 ft runway and step straight into the community. The terminal handles arrivals, a pilot lounge and the shuttle carts that run between the stages." });
  hotspots.push({ x: -70, z: -10, r: 26, t: "Flight Line Diner", k: "Stage 02 · The Flight Line", p: "A mid-century diner beside the apron where pilots, residents and visitors meet." });

  // ── THE FLIGHT LINE: hangar rows both sides, hangar homes behind, jets on the line ──
  for (let i = 0; i < 13; i++) { const [x, z] = along(-380 + i * 54, 118); put("hangar", x, z, heading + Math.PI / 2); if (i % 2 === 0) { const [jx, jz] = along(-380 + i * 54, 84); put("jet", jx, jz, heading + Math.PI / 2 + (rnd() - 0.5) * 0.4); } }
  for (let i = 0; i < 10; i++) { const [x, z] = along(-40 + i * 54, -118); put("hangar", x, z, heading - Math.PI / 2); if (i % 3 === 1) { const [jx, jz] = along(-40 + i * 54, -84); put("jet", jx, jz, heading - Math.PI / 2 + (rnd() - 0.5) * 0.4); } }
  for (let i = 0; i < 9; i++) { const [x, z] = along(-330 + i * 62, 182); put("hangarhome", x, z, heading + Math.PI / 2); }
  for (let i = 0; i < 6; i++) { const [x, z] = along(-20 + i * 62, -182); put("hangarhome", x, z, heading - Math.PI / 2); }
  { const [x, z] = along(-120, 118); hotspots.push({ x, z, r: 70, t: "Hangar Row", k: "Stage 02 · The Flight Line · 52 acres", p: "Hangars line both sides of the runway with direct taxiway access, and hangar homes sit behind them so you can live above your aircraft. Press F beside a parked jet or a cart to ride." }); }
  { const [x, z] = along(140, 160); put("solar", x, z, heading); put("windmill", x + 40, z + 20, 0); }
  { const [x, z] = along(-470, 118); sign(x, z, heading + Math.PI / 2, "THE FLIGHT LINE", "STAGE 02 · AVIATION"); }
  zoneRings.push({ ...Z.flightline, k: "Stage 02 · 52 acres" });

  // ── THE LANDING: two ring roads with homes, clubhouse in the middle, tent, chapel, amphitheater ──
  { const c = Z.landing.center;
    put("clubhouse", c[0], c[1], heading + 0.3);
    ring(c[0], c[1], 120, ["home", "home", "home", "dome", "home"], 24, true);
    ring(c[0], c[1], 235, ["home", "home", "pavilion", "home", "home", "home", "dome", "home"], 26, false);
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; scene.add(ribbon([[c[0] + Math.cos(a) * 60, c[1] + Math.sin(a) * 60], [c[0] + Math.cos(a) * 300, c[1] + Math.sin(a) * 300]], 7, M.dirt, 0.21)); }
    put("bigtent", c[0] - 150, c[1] - 70, heading + 0.8); put("chapel", c[0] + 170, c[1] + 120, heading + 2.4); put("amphitheater", c[0] - 60, c[1] + 190, heading + 3.6);
    put("observatory", c[0] + 280, c[1] - 210, 0); put("windmill", c[0] - 270, c[1] + 60, 0); put("barn", c[0] + 300, c[1] + 60, heading);
    const e = [c[0] - 300, c[1] - 260]; sign(e[0], e[1], Math.atan2(c[0] - e[0], c[1] - e[1]) + Math.PI, "THE LANDING", "STAGE 01 · RESIDENTIAL");
    hotspots.push({ x: c[0], z: c[1], r: 50, t: "The Landing Clubhouse", k: "Stage 01 · The Landing · 66 acres", p: "The first stage: themed residential lots on two ring roads around a clubhouse. Desert-modern homes, low and spread out so the desert stays visible between them." });
    hotspots.push({ x: c[0] - 150, z: c[1] - 70, r: 60, t: "The Grand Pavilion", k: "Stage 01 · gatherings", p: "A tensile fabric pavilion for the whole community: concerts, markets, film nights and the annual gathering under the desert sky." });
    hotspots.push({ x: c[0] + 170, z: c[1] + 120, r: 30, t: "The Chapel", k: "Faith communities", p: "An adobe chapel for the churches and faith communities that are part of the Giveback network." });
    hotspots.push({ x: c[0] + 280, z: c[1] - 210, r: 30, t: "Dark Sky Observatory", k: "Stage 01 · the night", p: "Douglas sits under some of the darkest skies in the country. The observatory opens to residents after sundown." });
    scatter("home", c[0], c[1], 330, 40, 12, () => 0.85 + rnd() * 0.35); scatter("dome", c[0] + 140, c[1] - 110, 130, 12, 6, () => 0.7 + rnd() * 0.6); }
  zoneRings.push({ ...Z.landing, k: "Stage 01 · 66 acres" });

  // ── THE EXPANSE: a street grid of Old West blocks, homes around, design district ──
  { const c = Z.expanse.center; const dir = heading + Math.PI / 2, dx = Math.cos(dir), dz = Math.sin(dir), px = Math.cos(dir + Math.PI / 2), pz = Math.sin(dir + Math.PI / 2);
    street(c[0], c[1], dir, 360, ["store", "saloon", "store", "hotel", "store", "barn", "saloon", "store"], 30, true);
    street(c[0] + px * 110, c[1] + pz * 110, dir, 300, ["store", "hotel", "saloon", "store", "gallery", "store"], 32, true);
    street(c[0] - px * 110, c[1] - pz * 110, dir, 300, ["home", "home", "store", "home", "saloon", "home"], 28, true);
    street(c[0] + dx * 150, c[1] + dz * 150, dir + Math.PI / 2, 240, ["store", "hotel", "saloon", "store", "barn"], 32, true);
    street(c[0] - dx * 150, c[1] - dz * 150, dir + Math.PI / 2, 240, ["home", "store", "home", "saloon"], 30, true);
    const e = [c[0] - dx * 230, c[1] - dz * 230]; sign(e[0], e[1], dir + Math.PI, "THE EXPANSE", "STAGE 03 · HOSPITALITY & DESIGN");
    hotspots.push({ x: c[0], z: c[1], r: 70, t: "Main Street", k: "Stage 03 · The Expanse · 318 acres", p: "Old West frontier storefronts on a grid of dirt streets: hospitality, commerce and gathering places for the community and its visitors." });
    const art = [c[0] + dx * 60 - px * 260, c[1] + dz * 60 - pz * 260];
    put("gallery", art[0] - 70, art[1] + 10, dir + Math.PI);
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283, rr = 24 + (i % 2) * 22; put("sculpture", art[0] + Math.cos(a) * rr, art[1] + Math.sin(a) * rr, rnd() * 6.283, 0.7 + rnd() * 0.7); }
    hotspots.push({ x: art[0], z: art[1], r: 60, t: "The Design District", k: "Stage 03 · The Expanse", p: "An artist design district: a gallery and sculptures placed on the land itself, with an immersive experience concept planned for the far edge of the site." });
    put("bigtent", c[0] - 260, c[1] + 330, dir); put("amphitheater", c[0] + 300, c[1] + 140, dir + 2); put("solar", c[0] - 330, c[1] - 60, dir); put("solar", c[0] - 330, c[1] - 30, dir);
    put("windmill", c[0] + 340, c[1] - 160, 0); put("chapel", c[0] - 200, c[1] + 200, dir + 1); put("observatory", c[0] + 380, c[1] + 20, 0);
    scatter("home", c[0], c[1], 400, 90, 12, () => 0.85 + rnd() * 0.35); scatter("dome", c[0] + 250, c[1] + 60, 160, 22, 6, () => 0.7 + rnd() * 0.6); scatter("pavilion", c[0] - 200, c[1] - 140, 130, 5, 8, () => 0.8 + rnd() * 0.5); }
  zoneRings.push({ ...Z.expanse, k: "Stage 03 · 318 acres" });

  // ── the rest of the land: ranch cluster, glamping domes, homesteads along the connector roads ──
  { const rc = [-700, -600]; put("barn", rc[0], rc[1], 0.4); put("barn", rc[0] + 60, rc[1] + 30, 2.2); put("windmill", rc[0] + 30, rc[1] - 40, 0); put("home", rc[0] - 50, rc[1] + 40, 1.1); scatter("home", rc[0], rc[1], 160, 10, 14, () => 0.9 + rnd() * 0.3);
    hotspots.push({ x: rc[0], z: rc[1], r: 60, t: "The Ranch", k: "Working desert", p: "A working ranch on the north edge of the property: horses, hay and the community's own produce." }); }
  { const gc = [-800, 300]; scatter("dome", gc[0], gc[1], 140, 18, 6, () => 0.7 + rnd() * 0.5); put("pavilion", gc[0], gc[1], 0.3); hotspots.push({ x: gc[0], z: gc[1], r: 60, t: "Glamping Field", k: "Stay a night", p: "Geodesic dome stays for visitors who want the desert night without a house of their own yet." }); }
  for (const r of roads.slice(0, 6)) { const [a, b] = r; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 60; t < L - 60; t += 70) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (const s of [-1, 1]) { if (rnd() < 0.55) continue; const hx = x + nx * s * 16, hz = z + nz * s * 16; if (!free(hx, hz, 4)) continue; put(rnd() < 0.8 ? "home" : "dome", hx, hz, Math.atan2(-nx * s, -nz * s), 0.85 + rnd() * 0.35); } } }
  scatter("home", 0, 0, 1050, 70, 14, () => 0.85 + rnd() * 0.35); scatter("dome", 0, 0, 1050, 20, 8, () => 0.7 + rnd() * 0.6); scatter("pavilion", 0, 0, 1000, 6, 10, () => 0.8 + rnd() * 0.5); scatter("windmill", 0, 0, 1000, 5, 20);
  hotspots.push({ x: (site.runway[0][0] + site.runway[6][0]) / 2, z: (site.runway[0][1] + site.runway[6][1]) / 2, r: 70, t: "Runway 03/21", k: "6,000 ft · Douglas Municipal", p: "The real runway, traced from survey data. Douglas Municipal opened in 1928 as one of the first international airports in the United States." });

  setLoad(0.82, "Building the cart course and the golf course");
  buildCourse(); buildGolf();
  setLoad(0.88, "Planting the desert");
  scatter("saguaro", 0, 0, 1050, 700, 2, () => 0.6 + rnd() * 0.9); scatter("paloverde", 0, 0, 1050, 480, 3, () => 0.7 + rnd() * 0.8);
  buildInstances();
  const scrubGeo = new THREE.IcosahedronGeometry(1, 0); scrubGeo.scale(1, 0.7, 1); const inst = new THREE.InstancedMesh(scrubGeo, M.scrub, 2200); const mtx = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 12000 && k < 2200; i++) { const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D; if (distToRunway(x, z) < 50 || Math.hypot(x, z) < 90) continue; let ko = false; for (const kk of KEEPOUT) if (Math.hypot(kk[0] - x, kk[1] - z) < kk[2]) ko = true; if (ko) continue; const s = 0.8 + rnd() * 1.6; mtx.makeRotationY(rnd() * 6.283); mtx.scale(new THREE.Vector3(s, s, s)); mtx.setPosition(x, getH(x, z) + s * 0.5, z); inst.setMatrixAt(k++, mtx); }
  inst.count = k; scene.add(inst);
  setLoad(1, "Opening the gates");
}

// ───────────────────────────── cart obstacle course ─────────────────────────────
const COURSE = { origin: null, gates: [], ramps: [], start: null, running: false, next: 0, t0: 0, best: +localStorage.getItem("g1:bestlap") || 0, laps: 0 };
function rampHeight(x, z) {   // extra height from ramps (wedges) at a point
  let h = 0;
  for (const r of COURSE.ramps) { const lx = (x - r.x) * Math.cos(-r.rot) - (z - r.z) * Math.sin(-r.rot), lz = (x - r.x) * Math.sin(-r.rot) + (z - r.z) * Math.cos(-r.rot); if (Math.abs(lx) < r.w / 2 && lz > -r.len / 2 && lz < r.len / 2) { const f = (lz + r.len / 2) / r.len; h = Math.max(h, r.h * Math.min(1, f * 1.15)); } }
  return h;
}
function buildCourse() {
  const o = COURSE.origin; const R = 120;
  const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * 6.283; const rr = R * (1 + 0.22 * Math.sin(a * 3) + 0.08 * Math.cos(a * 5)); pts.push([o[0] + Math.cos(a) * rr, o[1] + Math.sin(a) * rr]); }
  scene.add(ribbon(pts, 14, M.track, 0.24));
  const coneGeo = new THREE.ConeGeometry(0.35, 0.9, 8); const cones = new THREE.InstancedMesh(coneGeo, M.cone, 300); const mt = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 72 && k < 296; i += 1) { const p = pts[i], q = pts[i + 1]; const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); const nx = -dz / L, nz = dx / L; for (const s of [-1, 1]) { const x = p[0] + nx * s * 8, z = p[1] + nz * s * 8; mt.makeTranslation(x, getH(x, z) + 0.45, z); cones.setMatrixAt(k++, mt); } }
  cones.count = k; scene.add(cones);
  // gates every 12 samples, the first is start/finish
  for (let i = 0; i < 72; i += 12) { const p = pts[i], q = pts[i + 1]; const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); const nx = -dz / L, nz = dx / L; const g = { x: p[0], z: p[1], dx: dx / L, dz: dz / L, nx, nz };
    for (const s of [-1, 1]) { const px = p[0] + nx * s * 7.5, pz = p[1] + nz * s * 7.5; const post = box(0.3, 4.5, 0.3, i === 0 ? M.green : M.post, px, getH(px, pz) + 2.25, pz); scene.add(post); }
    const ban = box(15, 1, 0.1, i === 0 ? M.green : M.banner, p[0], getH(p[0], p[1]) + 4.6, p[1], Math.atan2(nx, nz)); scene.add(ban); COURSE.gates.push(g); }
  // ramps on the straights
  for (const i of [18, 42, 60]) { const p = pts[i], q = pts[i + 2]; const rot = Math.atan2(q[0] - p[0], q[1] - p[1]); const r = { x: p[0], z: p[1], rot, w: 7, len: 12, h: 2.2 }; COURSE.ramps.push(r);
    const geo = new THREE.BufferGeometry(); const hw = r.w / 2, hl = r.len / 2; const v = [-hw, 0, -hl, hw, 0, -hl, hw, r.h, hl, -hw, r.h, hl, -hw, 0, hl, hw, 0, hl]; geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); geo.setIndex([0, 2, 1, 0, 3, 2, 3, 4, 2, 4, 5, 2, 0, 4, 3, 1, 2, 5]); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M.ramp); m.position.set(p[0], getH(p[0], p[1]) + 0.3, p[1]); m.rotation.y = rot; scene.add(m); }
  // tyre stacks in the infield
  const tg = new THREE.TorusGeometry(0.55, 0.22, 8, 16); const tires = new THREE.InstancedMesh(tg, M.tire, 60); k = 0; for (let i = 0; i < 20; i++) { const a = rnd() * 6.283, d = 20 + rnd() * 60, x = o[0] + Math.cos(a) * d, z = o[1] + Math.sin(a) * d; for (let j = 0; j < 3; j++) { mt.makeRotationX(Math.PI / 2); mt.setPosition(x, getH(x, z) + 0.22 + j * 0.44, z); tires.setMatrixAt(k++, mt); } } tires.count = k; scene.add(tires);
  COURSE.start = COURSE.gates[0];
  sign(o[0] + R + 30, o[1] - 40, -Math.PI / 2, "CART COURSE", "PRESS C FOR A CART · LAP THE GATES");
  hotspots.push({ x: COURSE.start.x, z: COURSE.start.z, r: 40, t: "Cart Course", k: "Minigame · time trial", p: "Grab a cart (C), drive through the green start gate and lap the course through every gate in order, cones and ramps included. Fastest laps go on the leaderboard (L)." });
}
function updateCourse() {
  if (!cartMode) { if (COURSE.running) { COURSE.running = false; if (!golf.playing) $("#game").classList.remove("on"); } return; }
  const px = player.position.x, pz = player.position.z;
  const g = COURSE.gates[COURSE.next % COURSE.gates.length];
  const rel = (px - g.x) * g.dx + (pz - g.z) * g.dz, side = Math.abs((px - g.x) * g.nx + (pz - g.z) * g.nz);
  if (side < 8 && Math.abs(rel) < 3) {
    if (COURSE.next === 0) { if (!COURSE.running || COURSE.next === 0 && COURSE.running && COURSE.lapReady) { if (COURSE.running && COURSE.lapReady) { const ms = performance.now() - COURSE.t0; COURSE.laps++; if (!COURSE.best || ms < COURSE.best) { COURSE.best = ms; localStorage.setItem("g1:bestlap", String(ms)); } act({ t: "score", game: "course", v: Math.round(ms) }); logLine("Cart Course", `${player.userData.name} lapped in ${(ms / 1000).toFixed(2)} s`); } COURSE.running = true; COURSE.t0 = performance.now(); COURSE.lapReady = false; COURSE.next = 1; } }
    else { COURSE.next++; if (COURSE.next >= COURSE.gates.length) { COURSE.next = 0; COURSE.lapReady = true; } }
  }
  const near = Math.hypot(px - COURSE.origin[0], pz - COURSE.origin[1]) < 200;
  if (!golf.playing) $("#game").classList.toggle("on", near);
  if (near && !golf.playing) { $("#game-n").textContent = "CART COURSE"; $("#game-big").textContent = COURSE.running ? ((performance.now() - COURSE.t0) / 1000).toFixed(2) + " s" : "cross the green gate"; $("#game-s").textContent = (COURSE.running ? `next gate ${COURSE.next === 0 ? "finish" : COURSE.next} of ${COURSE.gates.length - 1}` : "") + (COURSE.best ? ` · best ${(COURSE.best / 1000).toFixed(2)} s` : ""); }
}

// ───────────────────────────── desert golf ─────────────────────────────
const golf = { playing: false, hole: 0, strokes: 0, total: 0, ball: null, vel: new THREE.Vector2(), aim: 0, power: 0, charging: false, moving: false, surface: 0, ballMesh: null, arrow: null, holes: [], card: [] };
const GOLF = { origin: null };
function golfLocal(h, x, z) { return [(x - h.x) * Math.cos(-h.rot) - (z - h.z) * Math.sin(-h.rot), (x - h.x) * Math.sin(-h.rot) + (z - h.z) * Math.cos(-h.rot)]; }
function golfWorld(h, lx, lz) { return [h.x + lx * Math.cos(h.rot) + lz * Math.sin(h.rot), h.z - lx * Math.sin(h.rot) + lz * Math.cos(h.rot)]; }
function bumpH(h, lx, lz) { let y = 0; for (const b of h.bumps) { const d = Math.hypot(lx - b[0], lz - b[1]); if (d < b[2]) y += b[3] * 0.5 * (1 + Math.cos(Math.PI * d / b[2])); } return y; }
function buildGolf() {
  const o = GOLF.origin; const base = getH(o[0], o[1]) + 0.9; golf.base = base;
  // six holes laid out in a loop; local coords: x across, z along the fairway (tee at z=0, cup at z=len)
  const defs = [
    { len: 26, w: 8, par: 2, cup: [0, 22], walls: [], bumpers: [], bumps: [], sand: [] },
    { len: 34, w: 10, par: 3, cup: [3, 30], walls: [[-2, 14, 6, 1.2]], bumpers: [], bumps: [], sand: [] },
    { len: 30, w: 12, par: 3, cup: [-3, 26], walls: [], bumpers: [[0, 12, 1.2], [-3, 18, 1.0], [3, 18, 1.0]], bumps: [], sand: [] },
    { len: 36, w: 10, par: 3, cup: [0, 32], walls: [], bumpers: [], bumps: [[0, 16, 6, 1.4]], sand: [] },
    { len: 40, w: 12, par: 4, cup: [4, 36], walls: [[3, 10, 1, 8], [-3, 24, 1, 8]], bumpers: [], bumps: [[-4, 30, 5, 0.9]], sand: [[-3, 14, 3.5]] },
    { len: 44, w: 12, par: 4, cup: [0, 40], walls: [[-3, 12, 5, 1], [3, 22, 5, 1]], bumpers: [[0, 32, 1.4]], bumps: [[0, 6, 5, 0.7], [3, 36, 4, 1.0]], sand: [[-4, 34, 3]] },
  ];
  defs.forEach((d, i) => {
    const a = i / 6 * 6.283; const hx = o[0] + Math.cos(a) * 95, hz = o[1] + Math.sin(a) * 95; const rot = a + Math.PI / 2;
    const h = { ...d, x: hx, z: hz, rot, i };
    const g = new THREE.Group(); g.position.set(hx, base, hz); g.rotation.y = rot;
    // fairway slab with bumps baked into vertices
    const geo = new THREE.PlaneGeometry(d.w, d.len + 8, Math.round(d.w * 2), Math.round((d.len + 8) * 2)); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, d.len / 2 - 2);
    const pa = geo.attributes.position; for (let k = 0; k < pa.count; k++) pa.setY(k, bumpH(h, pa.getX(k), pa.getZ(k))); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, M.turf));
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(d.w + 2, 1.2, d.len + 10), M.fringe); skirt.position.set(0, -0.62, d.len / 2 - 2); g.add(skirt);
    for (const s of [-1, 1]) { const r = box(0.4, 0.5, d.len + 8, M.wall, s * (d.w / 2 + 0.2), 0.25, d.len / 2 - 2); g.add(r); } g.add(box(d.w + 0.8, 0.5, 0.4, M.wall, 0, 0.25, -4)); g.add(box(d.w + 0.8, 0.5, 0.4, M.wall, 0, 0.25, d.len + 4));
    for (const w of d.walls) g.add(box(w[2], 0.6, w[3], M.wall, w[0], 0.3 + bumpH(h, w[0], w[1]), w[1]));
    for (const b of d.bumpers) { const m = new THREE.Mesh(new THREE.CylinderGeometry(b[2], b[2], 0.6, 16), M.bumper); m.position.set(b[0], 0.3 + bumpH(h, b[0], b[1]), b[1]); g.add(m); }
    for (const s of d.sand) { const m = new THREE.Mesh(new THREE.CircleGeometry(s[2], 24), M.sand); m.rotation.x = -Math.PI / 2; m.position.set(s[0], 0.02 + bumpH(h, s[0], s[1]), s[1]); g.add(m); }
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), M.hole); cup.rotation.x = -Math.PI / 2; cup.position.set(d.cup[0], 0.015 + bumpH(h, d.cup[0], d.cup[1]), d.cup[1]); g.add(cup);
    const pole = box(0.06, 2.2, 0.06, M.steel, d.cup[0], 1.1 + bumpH(h, d.cup[0], d.cup[1]), d.cup[1]); g.add(pole); const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), M.flag); fl.position.set(d.cup[0] + 0.42, 1.95 + bumpH(h, d.cup[0], d.cup[1]), d.cup[1]); g.add(fl);
    const tee = box(1.6, 0.06, 1.6, M.fringe, 0, 0.03, 0); g.add(tee);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ map: textTexture([{ text: `HOLE ${i + 1} · PAR ${d.par}`, size: 64, y: 0.5 }], 512, 256, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); num.position.set(0, 1.0, -3.6); num.rotation.y = Math.PI; g.add(num);
    scene.add(g); golf.holes.push(h);
    COLLIDERS.push([hx + Math.sin(rot) * (d.len / 2), hz + Math.cos(rot) * (d.len / 2), 0]);   // no collision, just a marker
  });
  // clubhouse-ish: a pavilion and a sign at the entrance
  put("pavilion", o[0], o[1], 0.4, 1.1); put("lamp", o[0] + 6, o[1] + 6, 0); put("lamp", o[0] - 6, o[1] - 6, 0);
  sign(o[0], o[1] - 150, 0, "DESERT GOLF", "SIX HOLES · PRESS E AT THE FIRST TEE");
  hotspots.push({ x: golf.holes[0].x, z: golf.holes[0].z, r: 16, t: "Desert Golf", k: "Minigame · six holes", p: "Six holes of desert mini golf. Aim with A and D (or the mouse), hold space to charge the shot and release to putt. Everyone on the site sees your ball. Lowest total goes on the leaderboard (L).", play: "golf" });
  golf.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })); golf.ballMesh.visible = false; scene.add(golf.ballMesh);
  const arrowGeo = new THREE.ConeGeometry(0.25, 0.9, 8); arrowGeo.rotateX(Math.PI / 2); golf.arrow = new THREE.Mesh(arrowGeo, M.green); golf.arrow.visible = false; scene.add(golf.arrow);
}
function golfStart() {
  golf.playing = true; golf.hole = 0; golf.strokes = 0; golf.total = 0; golf.card = []; golfTee(); $("#game").classList.add("on"); $("#power").style.display = "block"; closeCards(); if (cartMode) toggleCart();
}
function golfTee() { const h = golf.holes[golf.hole]; golf.ball = [0, 0]; golf.vel.set(0, 0); golf.moving = false; golf.aim = 0; golf.strokes = 0; golf.ballMesh.visible = true; golf.arrow.visible = true; golfSync(); }
function golfEnd(quit) {
  if (!quit) { act({ t: "score", game: "golf", v: golf.total }); logLine("Desert Golf", `${player.userData.name} finished 6 holes in ${golf.total}`); }
  golf.playing = false; golf.ballMesh.visible = false; golf.arrow.visible = false; $("#game").classList.remove("on"); $("#power").style.display = "none"; act({ t: "ball", b: null });
}
let lastBallSync = 0;
function golfSync() { const now = performance.now(); if (now - lastBallSync < 250) return; lastBallSync = now; const h = golf.holes[golf.hole]; const w = golfWorld(h, golf.ball[0], golf.ball[1]); act({ t: "ball", b: { x: w[0], z: w[1], h: golf.hole } }); }
function updateGolf(dt) {
  if (!golf.playing) return;
  const h = golf.holes[golf.hole]; const b = golf.ball;
  // aiming
  if (!golf.moving) { if (keys.KeyA || keys.ArrowLeft) golf.aim += 1.6 * dt; if (keys.KeyD || keys.ArrowRight) golf.aim -= 1.6 * dt; if (joy.active) golf.aim -= joy.dx * 1.6 * dt;
    if (keys.Space) { golf.charging = true; golf.power = Math.min(1, golf.power + dt * 0.8); } else if (golf.charging) { golf.charging = false; const sp = 3 + golf.power * 22; golf.vel.set(Math.sin(golf.aim) * sp, Math.cos(golf.aim) * sp); golf.moving = true; golf.strokes++; golf.power = 0; } }
  $("#power").querySelector("i").style.width = Math.round(golf.power * 100) + "%";
  // physics
  if (golf.moving) {
    const steps = 4; for (let s = 0; s < steps; s++) { const sdt = dt / steps;
      const gx = (bumpH(h, b[0] + 0.3, b[1]) - bumpH(h, b[0] - 0.3, b[1])) / 0.6, gz = (bumpH(h, b[0], b[1] + 0.3) - bumpH(h, b[0], b[1] - 0.3)) / 0.6;
      golf.vel.x -= gx * 9.8 * sdt; golf.vel.y -= gz * 9.8 * sdt;
      let inSand = false; for (const sd of h.sand) if (Math.hypot(b[0] - sd[0], b[1] - sd[1]) < sd[2]) inSand = true;
      const fr = inSand ? 4.5 : 1.15; const sp = golf.vel.length(); if (sp > 0) { const ns = Math.max(0, sp - fr * sdt); golf.vel.multiplyScalar(ns / sp); }
      let nx = b[0] + golf.vel.x * sdt, nz = b[1] + golf.vel.y * sdt;
      if (nx < -h.w / 2 + 0.22) { nx = -h.w / 2 + 0.22; golf.vel.x = Math.abs(golf.vel.x) * 0.75; } if (nx > h.w / 2 - 0.22) { nx = h.w / 2 - 0.22; golf.vel.x = -Math.abs(golf.vel.x) * 0.75; }
      if (nz < -3.6) { nz = -3.6; golf.vel.y = Math.abs(golf.vel.y) * 0.75; } if (nz > h.len + 3.6) { nz = h.len + 3.6; golf.vel.y = -Math.abs(golf.vel.y) * 0.75; }
      for (const w of h.walls) { const hx = w[2] / 2 + 0.22, hz = w[3] / 2 + 0.22; if (nx > w[0] - hx && nx < w[0] + hx && nz > w[1] - hz && nz < w[1] + hz) { const ox = Math.min(nx - (w[0] - hx), w[0] + hx - nx), oz = Math.min(nz - (w[1] - hz), w[1] + hz - nz); if (ox < oz) { nx = nx < w[0] ? w[0] - hx : w[0] + hx; golf.vel.x *= -0.75; } else { nz = nz < w[1] ? w[1] - hz : w[1] + hz; golf.vel.y *= -0.75; } } }
      for (const bp of h.bumpers) { const dx = nx - bp[0], dz = nz - bp[1], d = Math.hypot(dx, dz), min = bp[2] + 0.22; if (d < min && d > 0) { nx = bp[0] + dx / d * min; nz = bp[1] + dz / d * min; const dot = golf.vel.x * dx / d + golf.vel.y * dz / d; golf.vel.x -= 2 * dot * dx / d; golf.vel.y -= 2 * dot * dz / d; golf.vel.multiplyScalar(1.05); } }
      b[0] = nx; b[1] = nz;
      const dc = Math.hypot(b[0] - h.cup[0], b[1] - h.cup[1]);
      if (dc < 0.42 && golf.vel.length() < 4.5) { golf.moving = false; golf.vel.set(0, 0); golf.total += golf.strokes; golf.card.push(golf.strokes); logLine("Desert Golf", `${player.userData.name} holed ${golf.hole + 1} in ${golf.strokes}`); if (golf.hole < 5) { golf.hole++; golfTee(); } else { golfEnd(false); } return; }
    }
    if (golf.vel.length() < 0.15) { golf.moving = false; golf.vel.set(0, 0); if (golf.strokes >= 10) { golf.total += 10; golf.card.push(10); if (golf.hole < 5) { golf.hole++; golfTee(); } else golfEnd(false); return; } }
    golfSync();
  }
  const w = golfWorld(h, b[0], b[1]); const y = golf.base + bumpH(h, b[0], b[1]) + 0.22;
  golf.ballMesh.position.set(w[0], y, w[1]);
  golf.arrow.visible = !golf.moving; const ang = h.rot + golf.aim; golf.arrow.position.set(w[0] + Math.sin(ang) * 0.9, y, w[1] + Math.cos(ang) * 0.9); golf.arrow.rotation.y = ang;
  player.position.set(w[0] - Math.sin(ang) * 1.2, golf.base, w[1] - Math.cos(ang) * 1.2); player.rotation.y = ang; yaw = ang;
  $("#game-n").textContent = `DESERT GOLF · HOLE ${golf.hole + 1} OF 6 · PAR ${h.par}`; $("#game-big").textContent = `${golf.strokes} stroke${golf.strokes === 1 ? "" : "s"}`; $("#game-s").textContent = `total ${golf.total} · A D aim · hold space to putt · Esc quits`;
}
// other players' balls
const balls = new Map();
function updateBalls() { if (!view) return; for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; let m = balls.get(id); if (p.ball) { if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((parseInt(id.slice(0, 6), 36) % 360) / 360, 0.6, 0.55) })); scene.add(m); balls.set(id, m); } const h = golf.holes[p.ball.h] || golf.holes[0]; const l = golfLocal(h, p.ball.x, p.ball.z); m.position.set(p.ball.x, golf.base + bumpH(h, l[0], l[1]) + 0.22, p.ball.z); m.visible = true; } else if (m) m.visible = false; } }

// ───────────────────────────── day / night ─────────────────────────────
const DAY_SECONDS = 24 * 60; let timeOffset = 0;
function dayT() { return ((((Date.now() / 1000 + timeOffset) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS; }
const C = (h) => new THREE.Color(h);
const HORIZON = [[0.00, C(0x0a0f1e)], [0.21, C(0x1a1a3a)], [0.26, C(0xf08a5a)], [0.31, C(0xf3c9a0)], [0.40, C(0xe9dcc4)], [0.62, C(0xe6d6bd)], [0.72, C(0xf5b070)], [0.77, C(0xe0644c)], [0.82, C(0x3a2050)], [0.88, C(0x0a0f1e)], [1.00, C(0x0a0f1e)]];
const MID     = [[0.00, C(0x070b18)], [0.21, C(0x10163a)], [0.26, C(0xd08aa0)], [0.31, C(0xb9cfe8)], [0.40, C(0xa9cbee)], [0.62, C(0xa3c6ea)], [0.72, C(0xc49ab8)], [0.77, C(0x8a4a78)], [0.82, C(0x241a40)], [0.88, C(0x070b18)], [1.00, C(0x070b18)]];
const TOP     = [[0.00, C(0x04060e)], [0.21, C(0x0a1030)], [0.26, C(0x4a4a90)], [0.31, C(0x5f9ad8)], [0.40, C(0x3f86d2)], [0.62, C(0x3a80cc)], [0.72, C(0x6a6ab8)], [0.77, C(0x4a2a68)], [0.82, C(0x14122a)], [0.88, C(0x04060e)], [1.00, C(0x04060e)]];
function rampAt(R, t) { for (let i = 0; i < R.length - 1; i++) if (t >= R[i][0] && t <= R[i + 1][0]) return R[i][1].clone().lerp(R[i + 1][1], (t - R[i][0]) / (R[i + 1][0] - R[i][0])); return R[0][1].clone(); }
let night = 0;
function updateSky(dt) {
  const t = dayT(), el = -Math.cos(t * 6.283), az = t * 6.283;
  const hor = rampAt(HORIZON, t), mid = rampAt(MID, t), top = rampAt(TOP, t);
  skyMat.uniforms.horizon.value.copy(hor); skyMat.uniforms.mid.value.copy(mid); skyMat.uniforms.top.value.copy(top); scene.fog.color.copy(hor).lerp(mid, 0.35);
  const day = Math.max(0, Math.min(1, (el + 0.12) / 0.4)); night = 1 - day;
  const sdir = new THREE.Vector3(Math.cos(az), el, Math.sin(az) * 0.45).normalize();
  skyMat.uniforms.sunDir.value.copy(sdir); skyMat.uniforms.glow.value = el > -0.2 ? 1 : 0; skyMat.uniforms.sunCol.value.setHSL(0.08, 0.9, 0.55 + 0.25 * Math.min(1, Math.max(0, el)));
  sun.position.copy(sdir).multiplyScalar(900); sun.position.y = Math.max(sun.position.y, 30);
  sun.intensity = 1.3 * day; sun.color.setHSL(0.09, 0.6, 0.55 + 0.35 * Math.min(1, Math.max(0, el)));
  moon.intensity = 0.55 * night; hemi.intensity = 0.62 * day + 0.3; hemi.color.setHSL(0.6, 0.35, 0.55 + 0.35 * day);
  renderer.toneMappingExposure = 0.9 - 0.22 * night; stars.material.opacity = Math.max(0, night - 0.35) * 1.4;
  const cl = 0.25 + 0.75 * day; cloudA.material.color.setRGB(cl, cl, cl + 0.03 * day).lerp(hor, 0.35 * (1 - Math.min(1, Math.max(0, el)))); cloudB.material.color.copy(cloudA.material.color);
  cloudA.material.map.offset.x += dt * 0.0006; cloudB.material.map.offset.x += dt * 0.0003; cloudB.material.map.offset.y += dt * 0.0001;
  const glow = Math.max(0, night - 0.2) / 0.8; for (const m of buildingMats) m.emissiveIntensity = 0.45 * glow;
  M.lampGlow.emissiveIntensity = 2.5 * glow; M.rwLight.emissiveIntensity = 3 * glow; M.rwLightB.emissiveIntensity = 3 * glow; M.green.emissiveIntensity = 0.4 + 1.6 * night;
  const hh = Math.floor(t * 24), mm = Math.floor((t * 24 - hh) * 60); $("#clock").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} site time`;
}

// ───────────────────────────── avatars ─────────────────────────────
function makeLabel(text) { const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d"); x.font = "600 30px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center"; x.fillStyle = "rgba(10,22,16,.55)"; const w = Math.min(240, x.measureText(text).width + 28); x.beginPath(); x.roundRect ? x.roundRect(128 - w / 2, 10, w, 44, 12) : x.rect(128 - w / 2, 10, w, 44); x.fill(); x.fillStyle = "#f5f1e6"; x.fillText(text, 128, 42); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(2.2, 0.55, 1); s.position.y = 2.3; return s; }
function makeBubble(text) { const c = document.createElement("canvas"); c.width = 512; c.height = 96; const x = c.getContext("2d"); x.font = "500 28px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center"; let t = text; while (x.measureText(t).width > 470 && t.length > 4) t = t.slice(0, -2); const w = x.measureText(t).width + 36; x.fillStyle = "rgba(245,241,230,.95)"; x.beginPath(); x.roundRect ? x.roundRect(256 - w / 2, 14, w, 56, 16) : x.rect(256 - w / 2, 14, w, 56); x.fill(); x.fillStyle = "#0a1610"; x.fillText(t, 256, 52); const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false })); s.scale.set(4.4, 0.83, 1); s.position.y = 3.05; return s; }
const EMOJI = { wave: "👋", cheer: "🎉", point: "👉", sit: "🪑" };
function emojiTexture(ch) { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); x.font = "96px system-ui, Segoe UI Emoji, Apple Color Emoji, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(ch, 64, 70); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; }
const emojiTex = {}; for (const k in EMOJI) emojiTex[k] = emojiTexture(EMOJI[k]);
function avatar(id, name) {
  const hue = (parseInt(id.slice(0, 6), 36) % 360) / 360, col = new THREE.Color().setHSL(hue, 0.55, 0.5);
  const g = new THREE.Group(), walk = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 1.2, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 })); body.position.y = 0.95; walk.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1d3b6, roughness: 0.8 })); head.position.y = 1.7; walk.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), M.green); cap.position.y = 1.93; walk.add(cap);
  g.add(walk);
  const cartG = makeModel("cart"); cartG.visible = false; g.add(cartG);
  const label = makeLabel(name); g.add(label);
  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, depthTest: false, transparent: true })); emote.scale.set(1.4, 1.4, 1); emote.position.y = 3.2; emote.visible = false; g.add(emote);
  g.userData = { walk, cartG, label, emote, name, bubble: null, bubbleTick: 0 };
  scene.add(g); return g;
}
function setName(g, name) { if (g.userData.name === name) return; g.remove(g.userData.label); const l = makeLabel(name); g.add(l); g.userData.label = l; g.userData.name = name; }
function setCartVisual(g, on) { g.userData.cartG.visible = on; g.userData.walk.position.set(0.4, on ? 0.28 : 0, on ? 0.25 : 0); if (!on) g.userData.walk.position.set(0, 0, 0); }
function setBubble(g, p) { if (p.say && p.sayTick && g.userData.bubbleTick !== p.sayTick) { if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(p.say); g.add(g.userData.bubble); g.userData.bubbleTick = p.sayTick; g.userData.bubbleAt = performance.now(); } if (g.userData.bubble && performance.now() - g.userData.bubbleAt > 8000) { g.remove(g.userData.bubble); g.userData.bubble = null; } }
const emoteShown = new Map();
function showEmote(g, p) { const key = g.uuid, prev = emoteShown.get(key); if (p.emote && p.emoteTick && (!prev || prev.tick !== p.emoteTick)) { emoteShown.set(key, { tick: p.emoteTick, at: performance.now() }); g.userData.emote.material.map = emojiTex[p.emote]; g.userData.emote.material.needsUpdate = true; g.userData.emote.visible = true; } const e = emoteShown.get(key); if (e && performance.now() - e.at > 3000) g.userData.emote.visible = false; }

// ───────────────────────────── shared vehicles ─────────────────────────────
const VEH = {}; const SEAT = { cart: [[0.4, 0.28, 0.25], [-0.4, 0.28, 0.25], [0.4, 0.28, -0.75], [-0.4, 0.28, -0.75]], jet: [[0, 1.2, 4], [0, 1.2, 2.5], [0, 1.2, 1], [0, 1.2, -0.5]] };
function ensureVehicle(id, v) {
  if (VEH[id]) return VEH[id];
  const g = makeModel(v.kind === "jet" ? (MODELS.gbjet ? "gbjet" : "jet") : "cart");
  if (!g.children.length) { const b = new THREE.Mesh(new THREE.BoxGeometry(v.kind === "jet" ? 4 : 1.5, 1, v.kind === "jet" ? 16 : 2.4), M.steel); b.position.y = 0.8; g.add(b); }
  const label = makeLabel(v.kind === "jet" ? "Giveback One" : "Shuttle cart"); label.position.y = v.kind === "jet" ? 5.5 : 2.6; g.add(label);
  g.position.set(v.x, getH(v.x, v.z) + v.y, v.z); g.rotation.y = v.ry; scene.add(g);
  VEH[id] = { g, kind: v.kind, tx: v.x, tz: v.z, ty: v.y, try: v.ry, tp: v.pitch || 0, label }; return VEH[id];
}
function updateVehicles(dt) {
  if (!view || !view.vehicles) return;
  for (const [id, v] of Object.entries(view.vehicles)) {
    const V = ensureVehicle(id, v); const mineDriving = riding && riding.id === id && riding.driver;
    if (!mineDriving) { V.tx = v.x; V.tz = v.z; V.ty = v.y || 0; V.try = v.ry; V.tp = v.pitch || 0; const k = Math.min(1, dt * 6); V.g.position.x += (V.tx - V.g.position.x) * k; V.g.position.z += (V.tz - V.g.position.z) * k; const gy = getH(V.g.position.x, V.g.position.z); V.g.position.y += (gy + V.ty - V.g.position.y) * k; let d = V.try - V.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); V.g.rotation.y += d * k; V.g.rotation.x += (V.tp - V.g.rotation.x) * k; }
    const occupants = [v.driver, ...v.riders].filter((pid) => pid && view.players[pid] && view.players[pid].veh === id);
    const names = occupants.map((pid) => view.players[pid].name); const txt = (v.kind === "jet" ? "Giveback One" : "Shuttle cart") + (names.length ? " · " + names.join(", ") : " · free");
    if (V.labelText !== txt) { V.g.remove(V.label); V.label = makeLabel(txt); V.label.position.y = v.kind === "jet" ? 5.5 : 2.6; V.label.scale.set(4.4, 1.1, 1); V.g.add(V.label); V.labelText = txt; }
    occupants.forEach((pid, i) => { const a = pid === ME ? player : avatars.get(pid) && avatars.get(pid).g; if (!a) return; const seat = SEAT[v.kind][i] || SEAT[v.kind][0]; const local = new THREE.Vector3(seat[0], seat[1], seat[2]); V.g.localToWorld(local); a.position.copy(local); a.rotation.y = V.g.rotation.y; a.userData.walk.visible = v.kind !== "jet"; a.userData.label.visible = false; a.userData.cartG.visible = false; });
  }
}
function nearestVehicle() { if (!view || !view.vehicles) return null; let best = null, bd = 12; for (const [id, v] of Object.entries(view.vehicles)) { const d = Math.hypot(player.position.x - v.x, player.position.z - v.z); if (d < bd) { bd = d; best = id; } } return best; }
let vSpeed = 0, vVertical = 0, bank = 0;
function enterVehicle(id, v) { if (cartMode) toggleCart(); if (golf.playing) golfEnd(true); riding = { id, kind: v.kind, driver: v.driver === ME }; vSpeed = 0; vVertical = 0; $("#veh").classList.add("on"); $("#veh-n").textContent = v.kind === "jet" ? "GIVEBACK ONE" : "SHUTTLE CART"; }
function exitVehicle() { riding = null; $("#veh").classList.remove("on"); player.userData.walk.visible = true; player.userData.label.visible = true; player.userData.walk.position.set(0, 0, 0); if (view && view.players[ME]) { player.position.x = view.players[ME].x; player.position.z = view.players[ME].z; } }
function toggleRide() { if (riding) { act({ t: "leave" }); return; } const id = nearestVehicle(); if (id) act({ t: "board", v: id }); else setStatus("no cart or jet nearby", true); }
let lastDrive = 0;
function driveVehicle(dt) {
  const V = VEH[riding.id]; if (!V) return; const g = V.g, isJet = riding.kind === "jet";
  let throttle = 0, steer = 0; if (keys.KeyW || keys.ArrowUp) throttle += 1; if (keys.KeyS || keys.ArrowDown) throttle -= 1; if (keys.KeyA || keys.ArrowLeft) steer += 1; if (keys.KeyD || keys.ArrowRight) steer -= 1; if (joy.active) { throttle -= joy.dy; steer -= joy.dx; }
  if (!isJet) {
    const maxS = 26, accel = 14; if (throttle) vSpeed += throttle * accel * dt; else vSpeed -= Math.sign(vSpeed) * Math.min(Math.abs(vSpeed), 10 * dt); vSpeed = Math.max(-8, Math.min(maxS, vSpeed));
    g.rotation.y += steer * 1.8 * dt * Math.min(1, Math.abs(vSpeed) / 6) * Math.sign(vSpeed || 1);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt; nx = Math.max(T.xmin + 10, Math.min(T.xmax - 10, nx)); nz = Math.max(T.zmin + 10, Math.min(T.zmax - 10, nz)); [nx, nz] = collide(nx, nz, 1.6);
    g.position.set(nx, getH(nx, nz) + rampHeight(nx, nz), nz); $("#veh-s").textContent = `${Math.round(Math.abs(vSpeed) * 3.6)} km/h · W S drive · A D steer · F step out`;
  } else {
    const gy = getH(g.position.x, g.position.z), onGround = g.position.y <= gy + 0.05; const maxS = 140, accel = 22;
    if (throttle > 0) vSpeed += accel * dt; else if (throttle < 0) vSpeed -= accel * 1.4 * dt; else if (onGround) vSpeed -= Math.min(vSpeed, 8 * dt); vSpeed = Math.max(0, Math.min(maxS, vSpeed));
    const flying = vSpeed > 42; let climb = 0; if (keys.Space) climb += 1; if (keys.KeyQ || keys.ShiftLeft) climb -= 1; climb += -pitchInput;
    g.rotation.y += steer * (onGround ? 1.2 * Math.min(1, vSpeed / 10) : 0.9) * dt; bank += ((onGround ? 0 : -steer * 0.6) - bank) * Math.min(1, dt * 3); g.rotation.z = bank;
    if (flying) vVertical += (climb * 26 - vVertical) * Math.min(1, dt * 1.5); else vVertical = onGround ? 0 : vVertical - 30 * dt; if (!flying && !onGround && vSpeed < 42) vVertical = Math.min(vVertical, -6);
    const pitch = Math.max(-0.5, Math.min(0.45, flying ? vVertical / 40 : 0)); g.rotation.x += (-pitch - g.rotation.x) * Math.min(1, dt * 3);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt, ny = g.position.y + vVertical * dt; nx = Math.max(-5900, Math.min(5900, nx)); nz = Math.max(-5900, Math.min(5900, nz));
    const gy2 = getH(nx, nz); if (ny <= gy2) { ny = gy2; if (vVertical < -12) vSpeed *= 0.6; vVertical = 0; } if (!flying && ny <= gy2 + 0.05 && !onGround) { g.rotation.x = 0; bank = 0; } ny = Math.min(ny, gy2 + 2400); if (onGround && ny <= gy2 + 0.05) { [nx, nz] = collide(nx, nz, 4); }
    g.position.set(nx, ny, nz); $("#veh-s").textContent = `${Math.round(vSpeed * 3.6)} km/h · ${Math.round(ny - gy2)} m · W throttle · S brake · A D turn · space / Q climb & dive · F leave${flying ? "" : (vSpeed > 0 ? " · gaining speed" : "")}`;
  }
  player.position.copy(g.position); yaw = g.rotation.y;
  const now = performance.now(); if (now - lastDrive > 100) { lastDrive = now; const gy = getH(g.position.x, g.position.z); act({ t: "drive", x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), y: isJet ? +Math.max(0, g.position.y - gy).toFixed(2) : 0, ry: +g.rotation.y.toFixed(3), pitch: +g.rotation.x.toFixed(3) }); }
}

// ───────────────────────────── player + controls ─────────────────────────────
let player = null, yaw = 0, pitch = 0.18, towerView = false, pitchInput = 0, cartMode = false, vy = 0, airborne = false, cartSpeed = 0;
const keys = {}; const avatars = new Map(); let chatOpen = false;
function toggleCart() { if (riding || golf.playing) return; cartMode = !cartMode; setCartVisual(player, cartMode); cartSpeed = 0; pushMove(true); }
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") { if (e.code === "Escape") { e.target.blur(); closeChat(); } return; }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === "KeyF") toggleRide(); if (e.code === "KeyC") toggleCart(); if (e.code === "KeyM") towerView = !towerView; if (e.code === "KeyE") openNearest(); if (e.code === "KeyG") toggleGuestbook(); if (e.code === "KeyL") toggleBoard();
  if (e.code === "KeyN") timeOffset += DAY_SECONDS / 2; if (e.code === "KeyX") toggleSound(); if (e.code === "KeyH") document.body.classList.toggle("photo"); if (e.code === "KeyP") snapshot(); if (e.code === "Enter") openChat();
  if (e.code === "Escape") { closeCards(); if (golf.playing) golfEnd(true); }
  if (e.code === "Space" && !riding && !golf.playing && !airborne) { vy = cartMode ? 7 : 6.2; airborne = true; }
  const em = { Digit1: "wave", Digit2: "cheer", Digit3: "point", Digit4: "sit" }[e.code]; if (em) act({ t: "emote", e: em });
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
function openChat() { chatOpen = true; $("#chat").classList.add("on"); $("#chat-in").focus(); if (document.exitPointerLock) document.exitPointerLock(); }
function closeChat() { chatOpen = false; $("#chat").classList.remove("on"); $("#chat-in").blur(); }
$("#chat-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = e.target.value.trim(); if (v) act({ t: "say", text: v }); e.target.value = ""; closeChat(); } });
function snapshot() { try { const a = document.createElement("a"); a.download = "genesis-one.png"; a.href = canvas.toDataURL("image/png"); a.click(); } catch {} }
let locked = false;
canvas.addEventListener("click", () => { if (!("ontouchstart" in window) && canvas.requestPointerLock) canvas.requestPointerLock(); });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === canvas; });
addEventListener("mousemove", (e) => { if (!locked) return; if (golf.playing && !golf.moving) { golf.aim -= e.movementX * 0.003; return; } yaw -= e.movementX * 0.0022; pitch = Math.max(-0.35, Math.min(0.9, pitch + e.movementY * 0.0018)); if (riding && riding.kind === "jet") { VEH[riding.id].g.rotation.y -= e.movementX * 0.0015; pitchInput = Math.max(-1, Math.min(1, pitchInput + e.movementY * 0.004)); } });
addEventListener("mousedown", (e) => { if (locked && golf.playing && !golf.moving && e.button === 0) keys.Space = true; });
addEventListener("mouseup", (e) => { if (e.button === 0 && golf.playing) keys.Space = false; });
setInterval(() => { pitchInput *= 0.85; }, 50);
const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 }; const look = { id: null, x: 0, y: 0 }; const joyEl = $("#joy"), joyKnob = joyEl.querySelector("i");
if ("ontouchstart" in window) document.body.classList.add("touch");
canvas.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) { if (t.clientX < innerWidth / 2 && joy.id === null) { joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY; joy.active = true; } else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.cx) / 50)); joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.cy) / 50)); joyKnob.style.transform = `translate(${joy.dx * 30}px,${joy.dy * 30}px)`; } else if (t.identifier === look.id) { yaw -= (t.clientX - look.x) * 0.005; pitch = Math.max(-0.35, Math.min(0.9, pitch + (t.clientY - look.y) * 0.004)); look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchend", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; joyKnob.style.transform = ""; } if (t.identifier === look.id) look.id = null; } }, { passive: true });
document.querySelectorAll("#tbtns button").forEach((b) => { const k = b.dataset.k;
  const fire = () => { if (k === "KeyF") toggleRide(); else if (k === "KeyC") toggleCart(); else if (k === "KeyM") towerView = !towerView; else if (k === "KeyE") openNearest(); else if (k === "KeyG") toggleGuestbook(); else if (k === "KeyL") toggleBoard(); else if (k === "Digit1") act({ t: "emote", e: "wave" }); else if (k === "KeyN") timeOffset += DAY_SECONDS / 2; else if (k === "Enter") openChat(); };
  if (k === "Space" || k === "KeyQ") { b.addEventListener("touchstart", (e) => { e.preventDefault(); keys[k] = true; if (k === "Space" && !riding && !golf.playing && !airborne) { vy = 6.2; airborne = true; } }, { passive: false }); b.addEventListener("touchend", () => { keys[k] = false; }); } else b.addEventListener("click", fire); });
document.querySelectorAll("#warp button").forEach((b) => b.addEventListener("click", () => { const w = b.dataset.w; if (w === "golf") warpTo(golf.holes[0].x - 4, golf.holes[0].z - 4); else if (w === "course") warpTo(COURSE.start.x + 20, COURSE.start.z + 20); else { const z = SITE && SITE.zones[w]; if (z) warpTo(z.center[0] + 20, z.center[1] + 30); } }));
function warpTo(x, z) { if (riding) { setStatus("leave the vehicle first", true); return; } if (golf.playing) golfEnd(true); [x, z] = collide(x, z, 1); player.position.x = x; player.position.z = z; act({ t: "warp", x: +x.toFixed(2), z: +z.toFixed(2) }); lastSent.x = x; lastSent.z = z; }
$("#mm").addEventListener("click", (e) => { if (!T) return; const r = e.currentTarget.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; warpTo(T.xmin + u * (T.xmax - T.xmin), T.zmin + v * (T.zmax - T.zmin)); });

// ───────────────────────────── HUD ─────────────────────────────
let gbOpen = false, boardOpen = false;
function closeCards() { $("#info").classList.remove("on"); $("#gb").classList.remove("on"); $("#board").classList.remove("on"); gbOpen = false; boardOpen = false; }
function nearestHotspot() { let best = null, bd = 1e9; for (const h of hotspots) { const d = Math.hypot(player.position.x - h.x, player.position.z - h.z); if (d < h.r && d < bd) { bd = d; best = h; } } return best; }
function openNearest() { if (!player) return; const best = nearestHotspot(); if (!best) return; $("#info-h").textContent = best.t; $("#info-k").textContent = best.k; $("#info-p").textContent = best.p; $("#info-go").style.display = best.play ? "" : "none"; $("#info-go").onclick = () => { if (best.play === "golf") golfStart(); }; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); }
$("#info-x").addEventListener("click", closeCards);
function toggleGuestbook() { gbOpen = !gbOpen; $("#gb").classList.toggle("on", gbOpen); if (gbOpen) { renderGuestbook(); if (document.exitPointerLock) document.exitPointerLock(); $("#gb-in").focus(); } }
function renderGuestbook() { const list = $("#gb-list"); list.innerHTML = ""; const entries = (view && view.guestbook) || []; if (!entries.length) { const d = document.createElement("div"); d.textContent = "Nobody has signed yet. Be the first."; list.append(d); } for (const e of [...entries].reverse()) { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = e.by + " "; d.append(b, document.createTextNode(e.text)); list.append(d); } }
$("#gb-go").addEventListener("click", () => { const v = $("#gb-in").value.trim(); if (!v) return; act({ t: "sign", text: v }); $("#gb-in").value = ""; }); $("#gb-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gb-go").click(); }); $("#gb-x").addEventListener("click", closeCards);
function toggleBoard() { boardOpen = !boardOpen; $("#board").classList.toggle("on", boardOpen); if (boardOpen) { renderBoard(); if (document.exitPointerLock) document.exitPointerLock(); } }
function renderBoard() { const B = (view && view.boards) || { golf: [], course: [] }; for (const [k, fmt] of [["golf", (v) => v + " strokes"], ["course", (v) => (v / 1000).toFixed(2) + " s"]]) { const el = $("#b-" + k); el.innerHTML = ""; if (!B[k].length) { const d = document.createElement("div"); d.textContent = "No scores yet."; el.append(d); } B[k].forEach((e, i) => { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${i + 1}. ${e.by}`; const s = document.createElement("span"); s.textContent = fmt(e.v); d.append(b, s); el.append(d); }); } }
$("#board-x").addEventListener("click", closeCards);
function askName() { if (localStorage.getItem("g1:name")) return; $("#name").classList.add("on"); $("#name-in").focus(); }
$("#name-go").addEventListener("click", () => { const v = $("#name-in").value.trim().replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 18); if (!v) return; localStorage.setItem("g1:name", v); act({ t: "name", name: v }); $("#name").classList.remove("on"); }); $("#name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-go").click(); });
let zoneShown = null, zoneTimer = 0;
function updateZone(dt) {
  let inZone = null; for (const z of zoneRings) if (Math.hypot(player.position.x - z.center[0], player.position.z - z.center[1]) < z.r) inZone = z;
  if (inZone && inZone !== zoneShown) { zoneShown = inZone; $("#zone-n").textContent = inZone.name; $("#zone-k").textContent = inZone.k; $("#zone").classList.add("on"); zoneTimer = 3.5; } if (!inZone) zoneShown = null; if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) $("#zone").classList.remove("on"); }
  const near = nearestHotspot(); const nv = !riding && nearestVehicle(); const show = (near || nv) && !$("#info").classList.contains("on") && !golf.playing;
  $("#prompt").classList.toggle("on", !!show); if (show) $("#prompt-t").innerHTML = (nv ? `<b>F</b> &nbsp;ride the ${view.vehicles[nv].kind === "jet" ? "jet" : "cart"}` : "") + (nv && near ? " &nbsp;·&nbsp; " : "") + (near ? `<b>E</b> &nbsp;${near.play ? "play " : ""}${near.t}` : "");
}
const mmc = $("#mmc").getContext("2d"); const mmImg = new Image(); mmImg.src = "/minimap.jpg";
function drawMinimap() {
  const S = 368; mmc.clearRect(0, 0, S, S); if (mmImg.complete) mmc.drawImage(mmImg, 0, 0, S, S);
  const px = (x) => ((x - T.xmin) / (T.xmax - T.xmin)) * S, pz = (z) => ((z - T.zmin) / (T.zmax - T.zmin)) * S;
  mmc.strokeStyle = "rgba(20,20,22,.9)"; mmc.lineWidth = 5; mmc.beginPath(); SITE.runway.forEach((p, i) => (i ? mmc.lineTo(px(p[0]), pz(p[1])) : mmc.moveTo(px(p[0]), pz(p[1])))); mmc.stroke();
  mmc.font = "600 15px system-ui, sans-serif"; mmc.fillStyle = "rgba(245,241,230,.95)"; mmc.textAlign = "center";
  for (const z of zoneRings) { mmc.strokeStyle = "rgba(77,222,111,.5)"; mmc.lineWidth = 2; mmc.beginPath(); mmc.arc(px(z.center[0]), pz(z.center[1]), (z.r / (T.xmax - T.xmin)) * S, 0, 6.283); mmc.stroke(); mmc.fillText(z.name.replace("The ", ""), px(z.center[0]), pz(z.center[1]) + 5); }
  mmc.fillStyle = "#f4cd5a"; mmc.fillText("Golf", px(GOLF.origin[0]), pz(GOLF.origin[1])); mmc.fillText("Course", px(COURSE.origin[0]), pz(COURSE.origin[1]));
  if (view && view.vehicles) for (const v of Object.values(view.vehicles)) { mmc.fillStyle = v.kind === "jet" ? "#ffd166" : "#9be7ff"; mmc.beginPath(); mmc.arc(px(v.x), pz(v.z), 4, 0, 6.283); mmc.fill(); }
  if (view) for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; mmc.fillStyle = "rgba(245,241,230,.9)"; mmc.beginPath(); mmc.arc(px(p.x), pz(p.z), 4, 0, 6.283); mmc.fill(); }
  mmc.fillStyle = "#4DDE6F"; mmc.beginPath(); mmc.arc(px(player.position.x), pz(player.position.z), 6, 0, 6.283); mmc.fill(); mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 2; mmc.stroke();
}

// ───────────────────────────── movement + net sync ─────────────────────────────
let lastSent = { x: 0, z: 48, ry: 0, at: 0 };
function pushMove(force) { if (!player || riding) return; const now = performance.now(); const moved = Math.hypot(player.position.x - lastSent.x, player.position.z - lastSent.z) > 0.08 || Math.abs(yaw - lastSent.ry) > 0.02; if (force || (moved && now - lastSent.at > 120) || now - lastSent.at > 3000) { act({ t: "move", x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +yaw.toFixed(3), cart: cartMode }); lastSent = { x: player.position.x, z: player.position.z, ry: yaw, at: now }; } }
let lastT = performance.now(), bob = 0; const camTarget = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!player) { renderer.render(scene, camera); return; }
  if (riding && riding.driver) driveVehicle(dt);
  else if (!riding && !golf.playing) {
    let fx = 0, fz = 0; if (!chatOpen) { if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1; if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1; } if (joy.active) { fx += joy.dx; fz -= joy.dy; }
    const L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
    let nx, nz;
    if (cartMode) {
      // the personal cart: throttle and steer, jumps off ramps
      if (fz) cartSpeed += fz * 16 * dt; else cartSpeed -= Math.sign(cartSpeed) * Math.min(Math.abs(cartSpeed), 12 * dt); cartSpeed = Math.max(-8, Math.min(28, cartSpeed));
      if (!airborne) player.rotation.y -= fx * 2.0 * dt * Math.min(1, Math.abs(cartSpeed) / 6) * Math.sign(cartSpeed || 1);
      nx = player.position.x + Math.sin(player.rotation.y) * cartSpeed * dt; nz = player.position.z + Math.cos(player.rotation.y) * cartSpeed * dt;
      yaw += (player.rotation.y - yaw) * Math.min(1, dt * 4);
    } else {
      const speed = (keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
      nx = player.position.x + (fwd[0] * fz + right[0] * fx) * speed * dt; nz = player.position.z + (fwd[1] * fz + right[1] * fx) * speed * dt;
      if (L > 0.01) player.rotation.y = Math.atan2(fwd[0] * fz + right[0] * fx, fwd[1] * fz + right[1] * fx);
    }
    nx = Math.max(T.xmin + 8, Math.min(T.xmax - 8, nx)); nz = Math.max(T.zmin + 8, Math.min(T.zmax - 8, nz)); [nx, nz] = collide(nx, nz, cartMode ? 1.4 : 0.6);
    // vertical: ground + ramps, gravity, jumps
    const surfPrev = getH(player.position.x, player.position.z) + rampHeight(player.position.x, player.position.z);
    player.position.x = nx; player.position.z = nz;
    const surf = getH(nx, nz) + rampHeight(nx, nz);
    if (!airborne && cartMode && surfPrev - surf > 0.35 && Math.abs(cartSpeed) > 6) { airborne = true; vy = Math.min(9, Math.abs(cartSpeed) * 0.32); }
    if (airborne) { vy -= 17 * dt; player.position.y += vy * dt; if (player.position.y <= surf) { player.position.y = surf; airborne = false; vy = 0; } }
    else { bob += L * dt * 9; player.position.y = surf + (L && !cartMode ? Math.abs(Math.sin(bob)) * 0.08 : 0); }
    pushMove(false);
  } else if (golf.playing) updateGolf(dt);
  updateVehicles(dt); updateBalls(); updateCourse();
  const px = player.position.x, pz = player.position.z, gh = getH(px, pz);
  if (towerView) { const tx = Math.sin(now * 0.00012) * 220, tz = Math.cos(now * 0.00012) * 220; camera.position.set(tx, getH(tx, tz) + 160, tz); camera.lookAt(px, gh + 20, pz); }
  else if (riding) { const V = VEH[riding.id]; const isJet = riding.kind === "jet"; const dist = isJet ? 30 : 11, h = isJet ? 9 : 4; const back = new THREE.Vector3(-Math.sin(V.g.rotation.y) * dist, h, -Math.cos(V.g.rotation.y) * dist); camTarget.copy(V.g.position).add(back); camTarget.y = Math.max(camTarget.y, getH(camTarget.x, camTarget.z) + 1.5); camera.position.lerp(camTarget, isJet ? 0.12 : 0.25); camera.lookAt(V.g.position.x, V.g.position.y + (isJet ? 2 : 1.2), V.g.position.z); }
  else if (golf.playing) { const h = golf.holes[golf.hole]; const ang = h.rot + golf.aim; const dist = golf.moving ? 9 : 6; camTarget.set(golf.ballMesh.position.x - Math.sin(ang) * dist, golf.base + 4.5, golf.ballMesh.position.z - Math.cos(ang) * dist); camera.position.lerp(camTarget, 0.12); camera.lookAt(golf.ballMesh.position.x, golf.base + 0.5, golf.ballMesh.position.z); }
  else { const dist = cartMode ? 12 : 9.5, h = (cartMode ? 4.2 : 3.2) + pitch * 4, fwd = [-Math.sin(yaw), -Math.cos(yaw)]; const cx = px - fwd[0] * dist * Math.cos(pitch), cz = pz - fwd[1] * dist * Math.cos(pitch); const cy = Math.max(getH(cx, cz) + 1.2, player.position.y + h); camera.position.lerp(camTarget.set(cx, cy, cz), 0.35); camera.lookAt(px, player.position.y + 1.6, pz); }
  $("#coords").textContent = `${Math.round(px)} E · ${Math.round(pz)} S · ${Math.round(gh + (T.base_elev_m || 0))} m${cartMode ? ` · ${Math.round(Math.abs(cartSpeed) * 3.6)} km/h` : ""}`;
  if (view) {
    for (const [id, p] of Object.entries(view.players)) {
      if (id === ME) { if (player.userData.name !== p.name) setName(player, p.name); showEmote(player, p); setBubble(player, p); continue; }
      const s = seen.get(id); const stale = !s || now - s.at > 12000; let a = avatars.get(id);
      if (!a) { a = { g: avatar(id, p.name) }; a.g.position.set(p.x, getH(p.x, p.z), p.z); avatars.set(id, a); }
      a.g.visible = !stale; setName(a.g, p.name); showEmote(a.g, p); setBubble(a.g, p);
      if (p.veh && view.vehicles && view.vehicles[p.veh]) continue;
      a.g.userData.walk.visible = true; a.g.userData.label.visible = true; if (a.g.userData.cartG.visible !== !!p.cart) setCartVisual(a.g, !!p.cart);
      a.g.position.x += (p.x - a.g.position.x) * 0.12; a.g.position.z += (p.z - a.g.position.z) * 0.12; a.g.position.y = getH(a.g.position.x, a.g.position.z) + rampHeight(a.g.position.x, a.g.position.z);
      const dx = p.x - a.g.position.x, dz = p.z - a.g.position.z; if (dx * dx + dz * dz > 0.02) a.g.rotation.y = Math.atan2(dx, dz);
    }
    for (const [id, a] of avatars) if (!view.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  updateZone(dt); drawMinimap(); updateSky(dt); updateAudio(dt);
  renderer.render(scene, camera);
}

// ───────────────────────────── ambient audio ─────────────────────────────
const AUD = {}; let soundOn = false, audioReady = false, planeTimer = 40 + Math.random() * 60;
function mkAudio(src, vol, loop) { const a = new Audio(src); a.loop = loop; a.volume = 0; a.preload = "auto"; a.dataset.vol = vol; return a; }
AUD.music = mkAudio("/audio/music.m4a", 0.22, true); AUD.wind = mkAudio("/audio/wind.mp3", 0.5, true); AUD.night = mkAudio("/audio/night.mp3", 0.55, true); AUD.plane = mkAudio("/audio/plane.mp3", 0.45, false);
function startAudio() { if (audioReady) return; audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); soundOn = localStorage.getItem("g1:sound") !== "off"; updateSoundBtn(); }
function toggleSound() { soundOn = !soundOn; localStorage.setItem("g1:sound", soundOn ? "on" : "off"); if (!audioReady) { audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); } updateSoundBtn(); }
function updateSoundBtn() { $("#snd").textContent = soundOn ? "SOUND ON" : "SOUND OFF"; }
function updateAudio(dt) { if (!audioReady) return; const on = soundOn ? 1 : 0, jet = riding && riding.kind === "jet" ? Math.min(1, vSpeed / 60) : 0; const target = { music: 1, wind: 0.25 + 0.75 * (1 - night) + jet * 1.2, night: night * (1 - jet) }; for (const k in target) { const a = AUD[k], want = Math.min(1, on * +a.dataset.vol * target[k]); a.volume += (want - a.volume) * Math.min(1, dt * 1.5); } planeTimer -= dt; if (planeTimer <= 0) { planeTimer = 70 + Math.random() * 90; if (soundOn && night < 0.6) { AUD.plane.volume = +AUD.plane.dataset.vol; AUD.plane.currentTime = 0; AUD.plane.play().catch(() => {}); } } }
addEventListener("pointerdown", startAudio); addEventListener("keydown", startAudio); $("#snd").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });

// ───────────────────────────── boot ─────────────────────────────
buildWorld().then(() => { player = avatar(ME, localStorage.getItem("g1:name") || "You"); player.position.set(0, getH(0, 48), 48); $("#load").classList.add("off"); askName(); connect(); frame(); }).catch((err) => { setStatus("failed to load the site: " + err.message, true); console.error(err); });
