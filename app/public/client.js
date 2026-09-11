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
  socket.addEventListener("message", (ev) => { if (ev.data === PONG) return; let msg; try { msg = JSON.parse(ev.data); } catch { return; } if (msg.type === "state") onState(msg); else if (msg.type === "signal") onSignal(msg); else if (msg.type === "error") setStatus(msg.error, true); });
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
    if (p.say && p.sayTick && chatSeen.get(id) !== p.sayTick) { chatSeen.set(id, p.sayTick); if (introduced && player && (id === ME || Math.hypot(p.x - player.position.x, p.z - player.position.z) < 45)) logLine(p.name, p.say); }
  }
  if (!introduced && player) {
    introduced = true; const mine = view.players[ME];
    if (mine && (mine.x || mine.z)) { player.position.x = mine.x; player.position.z = mine.z; yaw = mine.ry; } else { player.position.x = HOME.x + 20; player.position.z = HOME.z + 40; }
    pushMove(true); const savedName = localStorage.getItem("g1:name"); if (savedName) act({ t: "name", name: savedName }); const lk = savedLook(); if (lk) act({ t: "look", look: lk });
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
const texLoader0 = new THREE.TextureLoader();
const skyDay = texLoader0.load("/tex/sky_day.jpg"), skyDusk = texLoader0.load("/tex/sky_dusk.jpg"), skyNight = texLoader0.load("/tex/sky_night.jpg"); skyDay.encoding = skyDusk.encoding = skyNight.encoding = THREE.sRGBEncoding;
function milkyTexture() {   // a soft tilted band of galactic haze with a little structure
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 2600; i++) { const u = Math.random(); const band = 256 + Math.sin(u * 6.283) * 120; const y = band + (Math.random() + Math.random() + Math.random() - 1.5) * 60; const r = 6 + Math.random() * 30; const g = x.createRadialGradient(u * 1024, y, 0, u * 1024, y, r); const a = 0.02 + Math.random() * 0.05; g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(u * 1024 - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 400; i++) { const u = Math.random(); const band = 256 + Math.sin(u * 6.283) * 120; const y = band + (Math.random() - 0.5) * 70; x.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(u * 1024, y, 10 + Math.random() * 30, 3 + Math.random() * 8, Math.random(), 0, 6.283); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
}
const skyMat = new THREE.ShaderMaterial({
  uniforms: { tDay: { value: skyDay }, tDusk: { value: skyDusk }, tNight: { value: skyNight }, tMilky: { value: milkyTexture() }, kDusk: { value: 0 }, kNight: { value: 0 }, nightCol: { value: new THREE.Color(0x070b18) }, horizon: { value: new THREE.Color(0xe7d6bd) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffd9a0) }, glow: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDay; uniform sampler2D tDusk; uniform sampler2D tNight; uniform sampler2D tMilky; uniform float kDusk; uniform float kNight; uniform vec3 nightCol; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float u = atan(d.z, d.x) / 6.28318 + 0.5; float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159;
      vec3 sky = mix(texture2D(tDay, vec2(u, v)).rgb, texture2D(tDusk, vec2(u, v)).rgb, kDusk);
      float hz = smoothstep(0.0, 0.12, d.y); sky = mix(horizon, sky, hz);
      vec3 nightSky = mix(vec3(0.16, 0.14, 0.24), vec3(0.015, 0.02, 0.05), smoothstep(-0.05, 0.5, d.y));
      float mw = texture2D(tMilky, vec2(u, v)).r; nightSky += vec3(0.55, 0.55, 0.7) * mw * 0.55; nightSky = mix(nightSky, texture2D(tNight, vec2(u, v)).rgb * 0.9, 0.4 * hz);
      sky = mix(sky, nightSky, kNight);
      float s = max(dot(d, normalize(sunDir)), 0.0); sky += sunCol * glow * (pow(s, 500.0) * 2.4 + pow(s, 8.0) * 0.3 * (1.0 - hz * 0.5));
      gl_FragColor = vec4(sky, 1.0); }`,
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
const cloudA = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshBasicMaterial({ map: cloudTexture(256, 0.56), transparent: true, depthWrite: false, fog: false, opacity: 0.55 }));
cloudA.rotation.x = Math.PI / 2; cloudA.position.y = 2200; scene.add(cloudA);
const cloudB = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshBasicMaterial({ map: cloudTexture(256, 0.62), transparent: true, depthWrite: false, fog: false, opacity: 0.35 }));
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
function tiled(path, rx, ry) { const t = texLoader0.load(path); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; }
function procTex(fn, size) { const c = document.createElement("canvas"); c.width = c.height = size || 256; const x = c.getContext("2d"); fn(x, c.width); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.encoding = THREE.sRGBEncoding; return t; }
const TEX = { detail: tiled("/tex/detail.jpg", 1, 1), turf: tiled("/tex/turf.jpg", 1, 1), apron: tiled("/tex/apron.jpg", 1, 1), dirt: tiled("/tex/dirt.jpg", 1, 1), sand: tiled("/tex/sand.jpg", 1, 1), wood: tiled("/tex/wood.jpg", 1, 1), adobe: tiled("/tex/adobe.jpg", 1, 1), corrugated: tiled("/tex/corrugated.jpg", 1, 1),
  plank: procTex((x, S) => { x.fillStyle = "#7a5535"; x.fillRect(0, 0, S, S); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.05)"; x.fillRect(0, i * S / 8, S, S / 8); x.fillStyle = "rgba(0,0,0,.4)"; x.fillRect(0, i * S / 8, S, 2); for (let k = 0; k < 40; k++) { x.fillStyle = "rgba(0,0,0,.08)"; x.fillRect(Math.random() * S, i * S / 8 + Math.random() * S / 8, 20 + Math.random() * 60, 1); } } }),
  adobeWall: procTex((x, S) => { x.fillStyle = "#e6dac4"; x.fillRect(0, 0, S, S); for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(120,90,60,${Math.random() * 0.08})`; x.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 4); } }),
  checker: procTex((x, S) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#f5f1e6" : "#0a1610"; x.fillRect(i * S / 4, j * S / 4, S / 4, S / 4); } }) };
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x8a8a90, map: TEX.apron, roughness: 0.95 }), taxi: new THREE.MeshStandardMaterial({ color: 0xa8a8ac, map: TEX.apron, roughness: 0.95 }),
  apron: new THREE.MeshStandardMaterial({ map: TEX.apron, roughness: 0.95 }), dirt: new THREE.MeshStandardMaterial({ map: TEX.dirt, roughness: 1 }),
  track: new THREE.MeshStandardMaterial({ color: 0xc9a67a, map: TEX.dirt, roughness: 1 }), walk: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, map: TEX.apron, roughness: 1 }), stripe: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.5, emissive: 0x1b7a35, emissiveIntensity: 0.4 }), scrub: new THREE.MeshStandardMaterial({ color: 0x6f7d4b, roughness: 1 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: 0xffd48a, emissive: 0xffb84d, emissiveIntensity: 0 }), rwLight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }),
  rwLightB: new THREE.MeshStandardMaterial({ color: 0x9fd7ff, emissive: 0x6ec2ff, emissiveIntensity: 0 }), steel: new THREE.MeshStandardMaterial({ color: 0x8e9aa4, roughness: 0.45, metalness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.95 }), cone: new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 }),
  coneW: new THREE.MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.7 }), tire: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.95 }),
  ramp: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 }), banner: new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.8, side: THREE.DoubleSide }),
  turf: new THREE.MeshStandardMaterial({ map: TEX.turf, roughness: 1 }), fringe: new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 1 }),
  sand: new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }), wall: new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 0.9 }),
  bumper: new THREE.MeshStandardMaterial({ color: 0xf4cd5a, roughness: 0.6 }), flag: new THREE.MeshStandardMaterial({ color: 0xff3b30, side: THREE.DoubleSide }),
  hole: new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), post: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95 }),
};
const buildingMats = [];

// ───────────────────────────── geometry helpers ─────────────────────────────
function ribbon(points, width, mat, lift, dashed) {
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) { const [ax, az] = points[i], [bx, bz] = points[i + 1]; const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 8)); for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  pts.push(points[points.length - 1]);
  const pos = [], idx = [], uv = []; let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    if (i) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx, w = width / 2; const l = [p[0] + nx * w, p[1] + nz * w], r = [p[0] - nx * w, p[1] - nz * w];
    pos.push(l[0], getH(l[0], l[1]) + lift, l[1], r[0], getH(r[0], r[1]) + lift, r[1]); uv.push(0, dist / width, 1, dist / width);
    if (i < pts.length - 1 && (!dashed || i % 2 === 0)) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return new THREE.Mesh(g, mat);
}
function polygon(points, mat, lift) {
  const tri = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p[0], p[1])), []); const pos = [], idx = [];
  const hAvg = points.reduce((s, p) => s + getH(p[0], p[1]), 0) / points.length; const uv = [];
  for (const p of points) { pos.push(p[0], hAvg + lift, p[1]); uv.push(p[0] / 12, p[1] / 12); } for (const t of tri) idx.push(t[0], t[2], t[1]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return new THREE.Mesh(g, mat);
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
const SIGN_ART = { "GENESIS ONE": "/tex/sign_genesis.jpg", "THE LANDING": "/tex/sign_landing.jpg", "THE FLIGHT LINE": "/tex/sign_flightline.jpg", "THE EXPANSE": "/tex/sign_expanse.jpg", "GIVEBACK HOME BASE": "/tex/sign_homebase.jpg", "DESERT GOLF": "/tex/sign_golf.jpg", "CART COURSE": "/tex/sign_course.jpg", "SKY OBBY": "/tex/sign_obby.jpg" };
const SIGN_TEX = {}; for (const k in SIGN_ART) { const t = texLoader0.load(SIGN_ART[k]); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; SIGN_TEX[k] = t; }
function sign(x, z, rot, title, sub, big) {
  const g = new THREE.Group(); const W = big ? 11 : 6.4, Hh = big ? 4 : 2.4;
  const tex = SIGN_TEX[title] || textTexture([{ text: title, size: big ? 150 : 110, y: 0.42, shadow: true }, { text: sub, size: big ? 52 : 42, y: 0.74, color: "#4DDE6F", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 1024, 384, { planks: true, border: "#4DDE6F" });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.18), [M.wood, M.wood, M.wood, M.wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })]);
  board.position.y = (big ? 3.2 : 2.2) + Hh / 2; g.add(board);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, board.position.y + Hh / 2, 0.3), M.post); p.position.set(s * (W / 2 - 0.4), (board.position.y + Hh / 2) / 2, 0); g.add(p); }
  g.position.set(x, getH(x, z), z); g.rotation.y = rot; scene.add(g); COLLIDERS.push([x, z, W / 2 * 0.6]); return g;
}

// ───────────────────────────── generated 3D models (instanced) ─────────────────────────────
const MODEL_SPECS = {
  home: { size: 15 }, clubhouse: { size: 38 }, hangar: { size: 24 }, dome: { size: 13 }, pavilion: { size: 18 }, store: { size: 11 }, saloon: { size: 15 }, tower: { height: 27, solid: 6 },
  bigtent: { size: 58 }, hangarhome: { size: 34 }, diner: { size: 30 }, chapel: { size: 16 }, hotel: { size: 26 }, barn: { size: 22 }, gallery: { size: 30 }, observatory: { size: 12 },
  amphitheater: { size: 40, solid: 0 }, solar: { size: 26, solid: 0 }, fbo: { size: 36 },
  saguaro: { height: 7, solid: 0.6, prop: true, sway: 0.12 }, paloverde: { height: 8, solid: 0.6, prop: true, sway: 0.55 }, sculpture: { height: 7, solid: 1.5, prop: true }, lamp: { height: 4.2, solid: 0.3, prop: true, sway: 0.08 }, windmill: { height: 14, solid: 2 },
  cart: { size: 3.2, vehicle: true, rot: Math.PI / 2 }, jet: { size: 22, vehicle: true, rot: Math.PI / 2 }, gbjet: { size: 22, vehicle: true, rot: Math.PI / 2 },
};
const MODELS = {}, PLACE = {}, COLLIDERS = [], INST = {};
// wind: a vertex-shader sway keyed to world position, strongest at the top of the object
const SWAY = { t: { value: 0 } }; const swayMats = [];
function addSway(mat, amount) {
  mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = SWAY.t; sh.uniforms.uSway = { value: amount };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uSway;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); float hgt = max(0.0, position.y); float w = sin(uTime * 1.3 + wp.x * 0.35 + wp.z * 0.21) * 0.6 + sin(uTime * 2.7 + wp.z * 0.5) * 0.4; transformed.x += w * uSway * hgt * hgt * 0.02; transformed.z += w * uSway * hgt * 0.01; }"); };
  swayMats.push(mat);
}
addSway(M.scrub, 0.9);
async function loadModels() {
  if (!THREE.GLTFLoader) return; const loader = new THREE.GLTFLoader(); const kinds = Object.keys(MODEL_SPECS); let done = 0;
  await Promise.all(kinds.map((k) => new Promise((res) => {
    loader.load(`/models/${k}.glb`, (g) => {
      const root = g.scene; root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root); const sz = new THREE.Vector3(); box.getSize(sz); const c = new THREE.Vector3(); box.getCenter(c);
      const spec = MODEL_SPECS[k]; const s = spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
      const norm = new THREE.Matrix4().makeRotationY(spec.rot || 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const parts = [];
      root.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().copy(norm).multiply(o.matrixWorld)); const mat = o.material.clone(); mat.side = THREE.DoubleSide; mat.transparent = false; mat.depthWrite = true; mat.roughness = 0.85; mat.metalness = 0; if (mat.map) { mat.map.encoding = THREE.sRGBEncoding; mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffb870); mat.emissiveIntensity = 0; } if (!spec.prop && !spec.vehicle) buildingMats.push(mat); if (spec.sway) addSway(mat, spec.sway); parts.push({ geometry: geo, material: mat }); });
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
    for (const part of m.parts) { const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length); list.forEach((e, i) => { p.set(e[0], e[1], e[2]); q.setFromAxisAngle(up, e[3]); s.setScalar(e[4]); mtx.compose(p, q, s); inst.setMatrixAt(i, mtx); }); inst.frustumCulled = false; scene.add(inst); (INST[kind] || (INST[kind] = [])).push(inst); } }
}
function makeModel(kind) { const m = MODELS[kind]; const g = new THREE.Group(); if (!m) return g; for (const part of m.parts) g.add(new THREE.Mesh(part.geometry, part.material)); return g; }
function collide(x, z, r) { if (inside) return [x, z]; for (const c of COLLIDERS) { const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz), min = c[2] + r; if (d < min && d > 0.001) { x = c[0] + dx / d * min; z = c[1] + dz / d * min; } } return [x, z]; }

// ───────────────────────────── layout ─────────────────────────────
const hotspots = [], zoneRings = []; let runwayMid, U, Nn, heading;
const HOME = { x: -9290, z: -13820, r: 900 };
function onLand(x, z) { return (x > T.xmin + 8 && x < T.xmax - 8 && z > T.zmin + 8 && z < T.zmax - 8) || (Math.abs(x - HOME.x) < HOME.r - 5 && Math.abs(z - HOME.z) < HOME.r - 5); }
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
function scatter(kind, cx, cz, r, n, gap, scaleFn, rotFn, minR) { let placed = 0, tries = 0; while (placed < n && tries++ < n * 60) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (minR && d < minR) continue; if (!free(x, z, gap)) continue; put(kind, x, z, rotFn ? rotFn(x, z) : rnd() * 6.283, scaleFn ? scaleFn() : 1); placed++; } }
// a road with buildings on both sides facing it
function street(cx, cz, dir, len, kinds, spacing, lamps, width) {
  const sx = Math.cos(dir), sz = Math.sin(dir), w = width || 11;
  scene.add(ribbon([[cx - sx * (len / 2 + 20), cz - sz * (len / 2 + 20)], [cx + sx * (len / 2 + 20), cz + sz * (len / 2 + 20)]], w, M.dirt, 0.22));
  for (const side of [-1, 1]) scene.add(ribbon([[cx - sx * (len / 2 + 20) - sz * side * (w / 2 + 1.3), cz - sz * (len / 2 + 20) + sx * side * (w / 2 + 1.3)], [cx + sx * (len / 2 + 20) - sz * side * (w / 2 + 1.3), cz + sz * (len / 2 + 20) + sx * side * (w / 2 + 1.3)]], 2.4, M.walk, 0.38));
  let i = 0;
  for (const side of [-1, 1]) {
    let t = -len / 2, prevR = 0;
    while (t <= len / 2) {
      const kind = kinds[(i++) % kinds.length]; if (!kind) { t += 12; continue; }
      const rr = (MODELS[kind] ? MODELS[kind].radius : 6) * (kind === "home" ? 1.0 : 1); const sc = kind === "home" ? 0.85 + rnd() * 0.35 : 1;
      t += prevR + rr * sc * 0.95 + 3; if (t > len / 2) break;
      const off = w / 2 + 4 + rr * sc; const x = cx + sx * t - sz * side * off, z = cz + sz * t + sx * side * off;
      if (free(x, z, 1.5)) put(kind, x, z, Math.atan2(sz * side, -sx * side), sc);
      prevR = rr * sc * 0.95;
    }
  }
  if (lamps) for (let t = -len / 2; t <= len / 2; t += 24) for (const side of [-1, 1]) put("lamp", cx + sx * t - sz * side * (w / 2 + 1.3), cz + sz * t + sx * side * (w / 2 + 1.3), Math.atan2(sz * side, -sx * side));
}
// a ring road with homes on both sides facing it
function ring(cx, cz, r, kinds, spacing, lamps) {
  const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 6.283; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  scene.add(ribbon(pts, 9, M.dirt, 0.22));
  for (const side of [-1, 1]) { const sp = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * 6.283; sp.push([cx + Math.cos(a) * (r + side * 5.7), cz + Math.sin(a) * (r + side * 5.7)]); } scene.add(ribbon(sp, 2.2, M.walk, 0.38)); }
  let k = 0;
  for (const side of [-1, 1]) {
    const rr0 = r + side * 12; let arc = 0, prevR = 0;
    while (arc < 6.283 * rr0 - 10) {
      const kind = kinds[(k++) % kinds.length]; if (!kind) { arc += 10; continue; }
      const sc = 0.85 + rnd() * 0.35; const rr = (MODELS[kind] ? MODELS[kind].radius : 6) * sc;
      arc += prevR + rr * 0.95 + 3; const a = arc / rr0; if (a > 6.283) break;
      const off = r + side * (7 + rr); const x = cx + Math.cos(a) * off, z = cz + Math.sin(a) * off;
      if (free(x, z, 1.5)) put(kind, x, z, Math.atan2(-Math.cos(a) * side, -Math.sin(a) * side), sc);
      prevR = rr * 0.95;
    }
  }
  if (lamps) { const n = Math.floor(6.283 * r / 26); for (let i = 0; i < n; i++) { const a = i / n * 6.283; put("lamp", cx + Math.cos(a) * (r + 5.7), cz + Math.sin(a) * (r + 5.7), Math.atan2(-Math.cos(a), -Math.sin(a))); } }
}

// The survey ground is nearly flat, so the plan adds landscape: low hills between the stages,
// and graded pads under each stage so streets and lots sit level.
function sculptTerrain(site) {
  const Z = site.zones; const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const hills = [[-170, 420, 190, 11], [560, 470, 170, 9], [-520, 920, 210, 12], [930, -330, 230, 12], [-260, -380, 140, 7], [1000, 900, 240, 14], [-950, -150, 200, 9], [300, -820, 180, 8], [-600, 1200, 160, 8]];
  const pads = [[Z.landing.center[0], Z.landing.center[1], 300, 60], [Z.expanse.center[0], Z.expanse.center[1], 330, 70], [0, 0, 160, 60], [-120, 1120, 190, 40], [-360, 330, 200, 40], [560, -720, 90, 40], [-170, 170, 340, 60], [-700, -600, 170, 40], [-800, 300, 150, 40]];
  const rwMid = runwayMid;
  const sm = (t) => t * t * (3 - 2 * t);
  const H2 = new Float32Array(H.length);
  for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) {
    const x = T.xmin + c / (T.cols - 1) * W, z = T.zmin + r / (T.rows - 1) * D; const i = r * T.cols + c; let h = H[i];
    const dr = distToRunway(x, z); const rwK = Math.min(1, Math.max(0, (dr - 120) / 120));
    for (const [hx, hz, hr, hh] of hills) { const d = Math.hypot(x - hx, z - hz); if (d < hr) { const f = 0.5 * (1 + Math.cos(Math.PI * d / hr)); h += hh * f * f * rwK; } }
    // gentle rolling noise everywhere off the runway
    h += (Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009) * 1.6 + Math.sin(x * 0.031) * Math.sin(z * 0.027) * 0.6) * rwK;
    H2[i] = h;
  }
  // pads: blend toward the pad's mean height inside its radius
  for (const [px, pz, pr, edge] of pads) {
    let sum = 0, n = 0;
    for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) { const x = T.xmin + c / (T.cols - 1) * W, z = T.zmin + r / (T.rows - 1) * D; if (Math.hypot(x - px, z - pz) < pr * 0.6) { sum += H2[r * T.cols + c]; n++; } }
    if (!n) continue; const target = sum / n;
    for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) { const x = T.xmin + c / (T.cols - 1) * W, z = T.zmin + r / (T.rows - 1) * D; const d = Math.hypot(x - px, z - pz); if (d < pr) { const k = 1 - sm(Math.min(1, Math.max(0, (d - (pr - edge)) / edge))); const i = r * T.cols + c; H2[i] = H2[i] + (target - H2[i]) * k; } }
  }
  for (let i = 0; i < H.length; i++) H[i] = H2[i];
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
  sculptTerrain(site);
  setLoad(0.12, "Raising the buildings"); await loadModels(); setLoad(0.58, "Laying the ground");

  const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const geo = new THREE.PlaneGeometry(W, D, T.cols - 1, T.rows - 1); geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, H[i]); geo.computeVertexNormals();
  const texLoader = new THREE.TextureLoader(); const tex = await new Promise((res) => texLoader.load("/ground.jpg", res)); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const gmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  gmat.onBeforeCompile = (sh) => { sh.uniforms.detailMap = { value: TEX.detail }; sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n vec3 det = texture2D(detailMap, vUv * 520.0).rgb; float dd = smoothstep(900.0, 60.0, length(vViewPosition)); diffuseColor.rgb *= mix(vec3(1.0), det * 1.7, dd * 0.55);").replace("uniform vec3 diffuse;", "uniform vec3 diffuse; uniform sampler2D detailMap;"); };
  const ground = new THREE.Mesh(geo, gmat); ground.position.set((T.xmin + T.xmax) / 2, 0, (T.zmin + T.zmax) / 2); scene.add(ground);
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

  for (const c of [Z.landing.center, Z.expanse.center]) { const pts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; pts.push([c[0] + Math.cos(a) * 46, c[1] + Math.sin(a) * 46]); } scene.add(polygon(pts, M.walk, 0.36)); }
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
    scatter("home", c[0], c[1], 330, 30, 14, () => 0.85 + rnd() * 0.35, null, 262); scatter("dome", c[0] + 140, c[1] - 110, 60, 8, 6, () => 0.7 + rnd() * 0.6); buildLots(c); }
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
    scatter("home", c[0], c[1], 420, 70, 14, () => 0.85 + rnd() * 0.35, null, 235); scatter("dome", c[0] + 300, c[1] + 120, 90, 16, 6, () => 0.7 + rnd() * 0.6); scatter("pavilion", c[0] - 260, c[1] - 200, 90, 4, 8, () => 0.8 + rnd() * 0.5); }
  zoneRings.push({ ...Z.expanse, k: "Stage 03 · 318 acres" });

  // ── the rest of the land: ranch cluster, glamping domes, homesteads along the connector roads ──
  { const rc = [-700, -600]; put("barn", rc[0], rc[1], 0.4); put("barn", rc[0] + 60, rc[1] + 30, 2.2); put("windmill", rc[0] + 30, rc[1] - 40, 0); put("home", rc[0] - 50, rc[1] + 40, 1.1); scatter("home", rc[0], rc[1], 160, 10, 14, () => 0.9 + rnd() * 0.3);
    hotspots.push({ x: rc[0], z: rc[1], r: 60, t: "The Ranch", k: "Working desert", p: "A working ranch on the north edge of the property: horses, hay and the community's own produce." }); }
  { const gc = [-800, 300]; scatter("dome", gc[0], gc[1], 140, 18, 6, () => 0.7 + rnd() * 0.5); put("pavilion", gc[0], gc[1], 0.3); hotspots.push({ x: gc[0], z: gc[1], r: 60, t: "Glamping Field", k: "Stay a night", p: "Geodesic dome stays for visitors who want the desert night without a house of their own yet." }); }
  for (const r of roads.slice(0, 6)) { const [a, b] = r; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 60; t < L - 60; t += 70) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (const s of [-1, 1]) { if (rnd() < 0.55) continue; const hx = x + nx * s * 16, hz = z + nz * s * 16; if (!free(hx, hz, 4)) continue; put(rnd() < 0.8 ? "home" : "dome", hx, hz, Math.atan2(-nx * s, -nz * s), 0.85 + rnd() * 0.35); } } }
  scatter("home", 0, 0, 1050, 40, 16, () => 0.85 + rnd() * 0.35, null, 380); scatter("dome", 0, 0, 1050, 12, 8, () => 0.7 + rnd() * 0.6, null, 380); scatter("pavilion", 0, 0, 1000, 6, 10, () => 0.8 + rnd() * 0.5); scatter("windmill", 0, 0, 1000, 5, 20);
  hotspots.push({ x: (site.runway[0][0] + site.runway[6][0]) / 2, z: (site.runway[0][1] + site.runway[6][1]) / 2, r: 70, t: "Runway 03/21", k: "6,000 ft · Douglas Municipal", p: "The real runway, traced from survey data. Douglas Municipal opened in 1928 as one of the first international airports in the United States." });

  setLoad(0.8, "Building home base, the obby and the games");
  buildHome(); buildObby(); buildCourse(); buildDrag(); buildGolf(); buildDetails();
  setLoad(0.88, "Planting the desert");
  scatter("saguaro", 0, 0, 1050, 700, 2, () => 0.6 + rnd() * 0.9); scatter("paloverde", 0, 0, 1050, 480, 3, () => 0.7 + rnd() * 0.8);
  buildInstances();
  // soft contact shadow under every building so it sits on the ground
  { const geo = new THREE.CircleGeometry(1, 20); geo.rotateX(-Math.PI / 2); let n = 0; for (const k in PLACE) if (!MODEL_SPECS[k].prop && !MODEL_SPECS[k].vehicle) n += PLACE[k].length;
    const sh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), n); const mt = new THREE.Matrix4(); let i = 0;
    for (const k in PLACE) { if (MODEL_SPECS[k].prop || MODEL_SPECS[k].vehicle || !MODELS[k]) continue; const r = MODELS[k].radius; for (const e of PLACE[k]) { mt.makeScale(r * e[4] * 1.15, 1, r * e[4] * 1.15); mt.setPosition(e[0], e[1] + 0.12, e[2]); sh.setMatrixAt(i++, mt); } } sh.count = i; scene.add(sh); }
  // windmill wheels that actually turn
  DETAILS.wheels = []; for (const e of PLACE.windmill || []) { const g = new THREE.Group(); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 10), M.steel); hub.rotation.x = Math.PI / 2; g.add(hub); for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.03), M.steel); b.position.set(Math.cos(i / 12 * 6.283) * 1.1, Math.sin(i / 12 * 6.283) * 1.1, 0); b.rotation.z = i / 12 * 6.283 + Math.PI / 2; g.add(b); } const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.05, 6, 32), M.steel); g.add(ring); g.position.set(e[0], e[1] + 12.2, e[2] + 0.9); scene.add(g); DETAILS.wheels.push(g); }
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
const DRAG = { origin: null, dir: 0, len: 320, lights: [], armed: false, t0: 0, staged: false, best: +localStorage.getItem("g1:bestdrag") || 0 };
function buildDrag() {
  const o = COURSE.origin; DRAG.origin = [o[0] + 190, o[1] - 160]; DRAG.dir = 0;   // strip runs south from the start
  const a = DRAG.origin, dx = Math.sin(DRAG.dir), dz = Math.cos(DRAG.dir); const b = [a[0] + dx * (DRAG.len + 60), a[1] + dz * (DRAG.len + 60)];
  scene.add(ribbon([[a[0] - dx * 30, a[1] - dz * 30], b], 18, M.asphalt, 0.26)); scene.add(ribbon([a, [a[0] + dx * DRAG.len, a[1] + dz * DRAG.len]], 0.5, M.stripe, 0.4, true));
  for (const s of [-1, 1]) { const px = a[0] - dz * s * 9.5, pz = a[1] + dx * s * 9.5; const post = box(0.3, 6, 0.3, M.post, px, getH(px, pz) + 3, pz); scene.add(post); }
  const bar = box(20, 0.5, 0.5, M.post, a[0], getH(a[0], a[1]) + 6, a[1], DRAG.dir); scene.add(bar);
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0x331111, emissive: i === 3 ? 0x00ff55 : 0xff2200, emissiveIntensity: 0 })); l.position.set(a[0] - dz * (-3 + i * 2), getH(a[0], a[1]) + 5.2, a[1] + dx * (-3 + i * 2)); scene.add(l); DRAG.lights.push(l); }
  const fx = a[0] + dx * DRAG.len, fz = a[1] + dz * DRAG.len; for (const s of [-1, 1]) { const px = fx - dz * s * 9.5, pz = fz + dx * s * 9.5; scene.add(box(0.3, 5, 0.3, M.green, px, getH(px, pz) + 2.5, pz)); } scene.add(box(20, 1, 0.1, M.banner, fx, getH(fx, fz) + 5, fz, DRAG.dir));
  DRAG.finish = [fx, fz];
  sign(a[0] + 16, a[1] - 6, -Math.PI / 2, "DRAG STRIP", "STAGE IN A CART · LIGHTS EVERY 30 S · 320 M");
  hotspots.push({ x: a[0], z: a[1], r: 30, t: "Drag Strip", k: "Minigame · head to head", p: "Line up behind the start bar in a cart (C). The lights count down every 30 seconds on the site clock, the same for everyone, so racers launch together. Green light to the finish banner is your time. Shift boosts, but it overheats." });
  KEEPOUT.push([a[0] + dx * DRAG.len / 2, a[1] + dz * DRAG.len / 2, 200]);
}
function updateDrag(now) {
  if (!DRAG.origin) return; const a = DRAG.origin, dx = Math.sin(DRAG.dir), dz = Math.cos(DRAG.dir);
  const cyc = (Date.now() / 1000) % 30; const phase = cyc < 24 ? -1 : Math.floor(cyc - 24);   // 24,25,26 red, 27 green
  DRAG.lights.forEach((l, i) => { l.material.emissiveIntensity = (phase >= 0 && (i < 3 ? phase === i : phase >= 3)) ? 3 : 0; });
  const hide = () => { if (DRAG.showing) { DRAG.showing = false; if (!golf.playing) $("#game").classList.remove("on"); } };
  if (!cartMode) { DRAG.armed = false; hide(); return; }
  const rel = (player.position.x - a[0]) * dx + (player.position.z - a[1]) * dz, side = Math.abs(-(player.position.x - a[0]) * dz + (player.position.z - a[1]) * dx);
  const nearStrip = side < 12 && rel > -40 && rel < DRAG.len + 40; if (!nearStrip) { DRAG.armed = false; hide(); return; }
  const staged = rel > -14 && rel < -1;
  if (staged && phase < 3) { DRAG.armed = true; DRAG.went = false; }
  if (DRAG.armed && phase === 3 && !DRAG.went) { DRAG.went = true; DRAG.t0 = now; DRAG.jumped = rel > -1; }
  if (DRAG.went && rel > DRAG.len && DRAG.t0) { const ms = now - DRAG.t0; DRAG.went = false; DRAG.armed = false; DRAG.t0 = 0; if (!DRAG.best || ms < DRAG.best) { DRAG.best = ms; localStorage.setItem("g1:bestdrag", String(ms)); } act({ t: "score", game: "drag", v: Math.round(ms) }); logLine("Drag Strip", `${player.userData.name} ran the strip in ${(ms / 1000).toFixed(2)} s`); }
  if (!golf.playing) { DRAG.showing = true; $("#game").classList.add("on"); $("#game-n").textContent = "DRAG STRIP"; $("#game-big").textContent = DRAG.went && DRAG.t0 ? ((now - DRAG.t0) / 1000).toFixed(2) + " s" : (phase < 0 ? `lights in ${Math.ceil(24 - cyc)} s` : phase < 3 ? "READY…" : "GO"); $("#game-s").textContent = (staged ? "staged · " : "stage behind the bar · ") + "W throttle · shift boost" + (DRAG.best ? ` · best ${(DRAG.best / 1000).toFixed(2)} s` : ""); }
}
function updateCourse() {
  if (!cartMode) { if (COURSE.running) { COURSE.running = false; if (!golf.playing) $("#game").classList.remove("on"); } return; }
  const px = player.position.x, pz = player.position.z;
  const g = COURSE.gates[COURSE.next % COURSE.gates.length];
  const rel = (px - g.x) * g.dx + (pz - g.z) * g.dz, side = Math.abs((px - g.x) * g.nx + (pz - g.z) * g.nz);
  if (side < 8 && Math.abs(rel) < 3) {
    if (COURSE.next === 0) { if (!COURSE.running || COURSE.next === 0 && COURSE.running && COURSE.lapReady) { if (COURSE.running && COURSE.lapReady) { const ms = performance.now() - COURSE.t0; COURSE.laps++; if (!COURSE.best || ms < COURSE.best) { COURSE.best = ms; localStorage.setItem("g1:bestlap", String(ms)); } act({ t: "score", game: "course", v: Math.round(ms) }); logLine("Cart Course", `${player.userData.name} lapped in ${(ms / 1000).toFixed(2)} s`); } COURSE.running = true; COURSE.t0 = performance.now(); COURSE.lapReady = false; COURSE.next = 1; } }
    else { COURSE.next++; sfx("gate"); if (COURSE.next >= COURSE.gates.length) { COURSE.next = 0; COURSE.lapReady = true; } }
  }
  const near = Math.hypot(px - COURSE.origin[0], pz - COURSE.origin[1]) < 170;
  if (!golf.playing && !DRAG.showing) $("#game").classList.toggle("on", near);
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
    const geo = new THREE.PlaneGeometry(d.w, d.len + 8, Math.round(d.w * 2), Math.round((d.len + 8) * 2)); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, d.len / 2 - 2); { const u = geo.attributes.uv; for (let k = 0; k < u.count; k++) u.setXY(k, u.getX(k) * d.w / 6, u.getY(k) * (d.len + 8) / 6); }
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
    if (keys.Space) { golf.charging = true; golf.power = Math.min(1, golf.power + dt * 0.8); } else if (golf.charging) { golf.charging = false; const sp = 3 + golf.power * 22; golf.vel.set(Math.sin(golf.aim) * sp, Math.cos(golf.aim) * sp); golf.moving = true; golf.strokes++; golf.power = 0; sfx("putt"); } }
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
  if (!golf.moving) { player.position.set(w[0] - Math.sin(ang) * 1.2, golf.base, w[1] - Math.cos(ang) * 1.2); player.rotation.y = ang; yaw = ang; }
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
  const hor = rampAt(HORIZON, t), mid = rampAt(MID, t);
  const day = Math.max(0, Math.min(1, (el + 0.12) / 0.4)); night = 1 - day;
  const dusk = Math.max(0, 1 - Math.abs(el - 0.08) / 0.42);
  skyMat.uniforms.horizon.value.copy(hor); skyMat.uniforms.kDusk.value = Math.min(1, dusk * 1.4); skyMat.uniforms.kNight.value = Math.pow(Math.max(0, night - 0.25) / 0.75, 1.3); scene.fog.color.copy(hor).lerp(mid, 0.35);
  const sdir = new THREE.Vector3(Math.cos(az), el, Math.sin(az) * 0.45).normalize();
  skyMat.uniforms.sunDir.value.copy(sdir); skyMat.uniforms.glow.value = el > -0.2 ? 1 : 0; skyMat.uniforms.sunCol.value.setHSL(0.08, 0.9, 0.55 + 0.25 * Math.min(1, Math.max(0, el)));
  sun.position.copy(sdir).multiplyScalar(900); sun.position.y = Math.max(sun.position.y, 30);
  sun.intensity = 1.3 * day; sun.color.setHSL(0.09, 0.6, 0.55 + 0.35 * Math.min(1, Math.max(0, el)));
  moon.intensity = 0.55 * night; hemi.intensity = 0.62 * day + 0.3; hemi.color.setHSL(0.6, 0.35, 0.55 + 0.35 * day);
  renderer.toneMappingExposure = 0.9 - 0.22 * night; stars.material.opacity = Math.max(0, night - 0.35) * 1.4 * (0.85 + 0.15 * Math.sin(performance.now() * 0.006)); stars.material.size = 80 + 20 * Math.sin(performance.now() * 0.0041);
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
const HAIR_COLORS = [0x2a1b12, 0x6b3f22, 0xd9b26a, 0x1a1a1a];
const OUTFITS = { outfit_flight: { shirt: 0x1f3b2c, pants: 0x1c1f24, trim: 0x4dde6f }, outfit_ranch: { shirt: 0x8a2f26, pants: 0x2f4a7a, trim: 0xe9e2d3 }, outfit_desert: { shirt: 0xd8c39a, pants: 0x6d5a3e, trim: 0x2a7a3e } };
function buildBody(g, look, hat, outfit) {
  const walk = g.userData && g.userData.walk; if (walk) g.remove(walk);
  const w = new THREE.Group(); const o = outfit && OUTFITS[outfit]; const skin = new THREE.Color("#" + (look && look.skin || "e8c19a")); const shirt = new THREE.Color(o ? o.shirt : "#" + (look && look.shirt || "4dde6f")); const pants = new THREE.Color(o ? o.pants : "#" + (look && look.pants || "2b3a4a"));
  const mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 }), mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 }), mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 }), mShoe = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), mShirt); torso.position.y = 1.2; w.add(torso);
  if (o) { const trim = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: o.trim })); trim.position.y = 1.47; w.add(trim); }
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.26), mPants); hips.position.y = 0.8; w.add(hips);
  const legs = [], arms = [];
  for (const sx of [-1, 1]) { const leg = new THREE.Group(); leg.position.set(sx * 0.13, 0.72, 0); const lm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.2), mPants); lm.position.y = -0.33; leg.add(lm); const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), mShoe); shoe.position.set(0, -0.68, 0.04); leg.add(shoe); w.add(leg); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(sx * 0.33, 1.46, 0); const am = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.58, 0.14), mShirt); am.position.y = -0.29; arm.add(am); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mSkin); hand.position.y = -0.6; arm.add(hand); w.add(arm); arms.push(arm); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), mSkin); neck.position.y = 1.55; w.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mSkin); head.position.y = 1.78; w.add(head);
  const hairStyle = look ? (look.hair || 0) : 0; const mHair = new THREE.MeshStandardMaterial({ color: HAIR_COLORS[hairStyle % 4], roughness: 0.9 });
  if (hairStyle === 1) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 10, 0, 6.283, 0, 1.4), mHair); h.position.y = 1.8; w.add(h); }
  else if (hairStyle === 2) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, 6.283, 0, 1.9), mHair); h.position.y = 1.79; w.add(h); const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.1), mHair); tail.position.set(0, 1.6, -0.2); w.add(tail); }
  else if (hairStyle === 3) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.44), mHair); h.position.y = 1.96; w.add(h); }
  else { const h = new THREE.Mesh(new THREE.SphereGeometry(0.228, 14, 10, 0, 6.283, 0, 1.1), mHair); h.position.y = 1.8; w.add(h); }
  if (hat === "hat_cap") { const b = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 8, 0, 6.283, 0, 1.4), M.green); b.position.y = 1.82; w.add(b); const peak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.2), M.green); peak.position.set(0, 1.86, 0.28); w.add(peak); }
  else if (hat === "hat_cowboy") { const mH = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 18), mH); brim.position.y = 1.9; w.add(brim); const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.24, 14), mH); crown.position.y = 2.02; w.add(crown); }
  else if (hat === "hat_band") { const band = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.03, 6, 20), M.green); band.rotation.x = Math.PI / 2; band.position.y = 1.86; w.add(band); }
  g.add(w); g.userData.walk = w; g.userData.legs = legs; g.userData.arms = arms; g.userData.phase = 0; g.userData.lookKey = JSON.stringify([look, hat, outfit]);
}
function animateWalk(g, speed, dt) {
  const u = g.userData; if (!u.legs) return; u.phase += dt * Math.min(12, speed * 2.4); const a = speed > 0.2 ? Math.sin(u.phase) * 0.6 : 0;
  u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a; u.arms[0].rotation.x = -a * 0.8; u.arms[1].rotation.x = a * 0.8;
  if (speed <= 0.2) { u.arms[0].rotation.x = u.arms[1].rotation.x = Math.sin(performance.now() / 900) * 0.04; }
}
function avatar(id, name, look, hat, outfit) {
  const g = new THREE.Group(); g.userData = {};
  buildBody(g, look, hat, outfit);
  const walk = g.userData.walk;
  const cartG = makeModel("cart"); cartG.visible = false; g.add(cartG);
  const label = makeLabel(name); g.add(label);
  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, depthTest: false, transparent: true })); emote.scale.set(1.4, 1.4, 1); emote.position.y = 3.2; emote.visible = false; g.add(emote);
  Object.assign(g.userData, { cartG, label, emote, name, bubble: null, bubbleTick: 0, lastPos: new THREE.Vector3() });
  scene.add(g); return g;
}
function setName(g, name) { if (g.userData.name === name) return; g.remove(g.userData.label); const l = makeLabel(name); g.add(l); g.userData.label = l; g.userData.name = name; }
function setCartVisual(g, on) { g.userData.cartG.visible = on; g.userData.walk.position.set(0.4, on ? 0.28 : 0, on ? 0.25 : 0); if (!on) g.userData.walk.position.set(0, 0, 0); }
function syncLook(g, p) { const key = JSON.stringify([p.look || null, p.hat || null, p.outfit || null]); if (g.userData.lookKey !== key) { const wasCart = g.userData.cartG && g.userData.cartG.visible; buildBody(g, p.look, p.hat, p.outfit); if (wasCart) setCartVisual(g, true); } }
function setBubble(g, p) { if (p.say && p.sayTick && g.userData.bubbleTick !== p.sayTick && (!player || g === player || Math.hypot(p.x - player.position.x, p.z - player.position.z) < 45)) { if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(p.say); g.add(g.userData.bubble); g.userData.bubbleTick = p.sayTick; g.userData.bubbleAt = performance.now(); } if (g.userData.bubble && performance.now() - g.userData.bubbleAt > 8000) { g.remove(g.userData.bubble); g.userData.bubble = null; } }
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
function enterVehicle(id, v) { sfx("board"); if (cartMode) toggleCart(); if (golf.playing) golfEnd(true); riding = { id, kind: v.kind, driver: v.driver === ME }; vSpeed = 0; vVertical = 0; $("#veh").classList.add("on"); $("#veh-n").textContent = v.kind === "jet" ? "GIVEBACK ONE" : "SHUTTLE CART"; }
function exitVehicle() { riding = null; $("#veh").classList.remove("on"); player.userData.walk.visible = true; player.userData.label.visible = true; player.userData.walk.position.set(0, 0, 0); if (view && view.players[ME]) { player.position.x = view.players[ME].x; player.position.z = view.players[ME].z; } }
function toggleRide() { if (riding) { act({ t: "leave" }); return; } const id = nearestVehicle(); if (id) act({ t: "board", v: id }); else setStatus("no cart or jet nearby", true); }
let lastDrive = 0;
function driveVehicle(dt) {
  const V = VEH[riding.id]; if (!V) return; const g = V.g, isJet = riding.kind === "jet";
  let throttle = 0, steer = 0; if (keys.KeyW || keys.ArrowUp) throttle += 1; if (keys.KeyS || keys.ArrowDown) throttle -= 1; if (keys.KeyA || keys.ArrowLeft) steer += 1; if (keys.KeyD || keys.ArrowRight) steer -= 1; if (joy.active) { throttle -= joy.dy; steer -= joy.dx; }
  if (!isJet) {
    const maxS = 26, accel = 14; if (throttle) vSpeed += throttle * accel * dt; else vSpeed -= Math.sign(vSpeed) * Math.min(Math.abs(vSpeed), 10 * dt); vSpeed = Math.max(-8, Math.min(maxS, vSpeed));
    g.rotation.y += steer * 1.8 * dt * Math.min(1, Math.abs(vSpeed) / 6) * Math.sign(vSpeed || 1);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt; if (!onLand(nx, nz)) { nx = g.position.x; nz = g.position.z; vSpeed = 0; } [nx, nz] = collide(nx, nz, 1.6);
    g.position.set(nx, getH(nx, nz) + rampHeight(nx, nz), nz); $("#veh-s").textContent = `${Math.round(Math.abs(vSpeed) * 3.6)} km/h · W S drive · A D steer · F step out`;
  } else {
    const gy = getH(g.position.x, g.position.z), onGround = g.position.y <= gy + 0.05; const maxS = 140, accel = 22;
    if (throttle > 0) vSpeed += accel * dt; else if (throttle < 0) vSpeed -= accel * 1.4 * dt; else if (onGround) vSpeed -= Math.min(vSpeed, 8 * dt); vSpeed = Math.max(0, Math.min(maxS, vSpeed));
    const flying = vSpeed > 42; let climb = 0; if (keys.Space) climb += 1; if (keys.KeyQ || keys.ShiftLeft) climb -= 1; climb += -pitchInput;
    g.rotation.y += steer * (onGround ? 1.2 * Math.min(1, vSpeed / 10) : 0.9) * dt; bank += ((onGround ? 0 : -steer * 0.6) - bank) * Math.min(1, dt * 3); g.rotation.z = bank;
    if (flying) vVertical += (climb * 26 - vVertical) * Math.min(1, dt * 1.5); else vVertical = onGround ? 0 : vVertical - 30 * dt; if (!flying && !onGround && vSpeed < 42) vVertical = Math.min(vVertical, -6);
    const pitch = Math.max(-0.5, Math.min(0.45, flying ? vVertical / 40 : 0)); g.rotation.x += (-pitch - g.rotation.x) * Math.min(1, dt * 3);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt, ny = g.position.y + vVertical * dt; nx = Math.max(-19500, Math.min(19500, nx)); nz = Math.max(-19500, Math.min(19500, nz));
    const gy2 = getH(nx, nz); if (ny <= gy2) { ny = gy2; if (vVertical < -12) vSpeed *= 0.6; vVertical = 0; } if (!flying && ny <= gy2 + 0.05 && !onGround) { g.rotation.x = 0; bank = 0; } ny = Math.min(ny, gy2 + 2400); if (onGround && ny <= gy2 + 0.05) { [nx, nz] = collide(nx, nz, 4); }
    g.position.set(nx, ny, nz); const toSite = Math.hypot(nx, nz), toHome = Math.hypot(nx - HOME.x, nz - HOME.z); const tgt = toSite > 1500 ? [0, 0, "Genesis One"] : [HOME.x, HOME.z, "home base"];
    const bearing = Math.atan2(tgt[0] - nx, tgt[1] - nz), rel = Math.atan2(Math.sin(bearing - g.rotation.y), Math.cos(bearing - g.rotation.y)); const arrow = Math.abs(rel) < 0.2 ? "▲ straight ahead" : (rel > 0 ? "◀ turn left" : "▶ turn right");
    $("#veh-s").textContent = `${Math.round(vSpeed * 3.6)} km/h · ${Math.round(ny - gy2)} m · ${tgt[2]} ${((toSite > 1500 ? toSite : toHome) / 1000).toFixed(1)} km ${arrow} · W throttle · S brake · A D turn · space / Q climb & dive · F leave${flying ? "" : (vSpeed > 0 ? " · gaining speed" : "")}`;
  }
  player.position.copy(g.position); yaw = g.rotation.y;
  const now = performance.now(); if (now - lastDrive > 100) { lastDrive = now; const gy = getH(g.position.x, g.position.z); act({ t: "drive", x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), y: isJet ? +Math.max(0, g.position.y - gy).toFixed(2) : 0, ry: +g.rotation.y.toFixed(3), pitch: +g.rotation.x.toFixed(3) }); }
}

// ───────────────────────────── player + controls ─────────────────────────────
let player = null, yaw = 0, pitch = 0.18, towerView = false, pitchInput = 0, cartMode = false, vy = 0, airborne = false, cartSpeed = 0, cartHeat = 0;
const keys = {}; const avatars = new Map(); let chatOpen = false;
function toggleCart() { if (riding || golf.playing || inside) return; cartMode = !cartMode; setCartVisual(player, cartMode); cartSpeed = 0; if (cartMode) player.rotation.y = yaw + Math.PI; pushMove(true); }
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") { if (e.code === "Escape") { e.target.blur(); closeChat(); } return; }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === "KeyF") toggleRide(); if (e.code === "KeyC") toggleCart(); if (e.code === "KeyM") towerView = !towerView; if (e.code === "KeyE") openNearest(); if (e.code === "KeyG") toggleGuestbook(); if (e.code === "KeyL") toggleBoard();
  if (e.code === "KeyN") timeOffset += DAY_SECONDS / 2; if (e.code === "KeyV") toggleVoice(); if (e.code === "KeyX") toggleSound(); if (e.code === "KeyH") document.body.classList.toggle("photo"); if (e.code === "KeyP") snapshot(); if (e.code === "Enter") openChat();
  if (e.code === "Escape") { closeCards(); if (golf.playing) golfEnd(true); }
  if (e.code === "Space" && !riding && !golf.playing && !airborne) { vy = cartMode ? 7 : 6.6; airborne = true; sfx("jump"); }
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
  if (k === "Space" || k === "KeyQ") { b.addEventListener("touchstart", (e) => { e.preventDefault(); keys[k] = true; if (k === "Space" && !riding && !golf.playing && !airborne) { vy = 6.6; airborne = true; } }, { passive: false }); b.addEventListener("touchend", () => { keys[k] = false; }); } else b.addEventListener("click", fire); });
document.querySelectorAll("#warp button").forEach((b) => b.addEventListener("click", () => { const w = b.dataset.w; if (w === "golf") warpTo(golf.holes[0].x - 4, golf.holes[0].z - 4); else if (w === "course") warpTo(COURSE.start.x + 20, COURSE.start.z + 20); else if (w === "home") warpTo(HOME.x + 20, HOME.z + 40); else if (w === "obby") warpTo(OBBY.start[0], OBBY.start[2] + 4); else if (w === "drag") warpTo(DRAG.origin[0], DRAG.origin[1] - 8); else { const z = SITE && SITE.zones[w]; if (z) warpTo(z.center[0] + 20, z.center[1] + 30); } }));
function warpTo(x, z) { if (riding) { setStatus("leave the vehicle first", true); return; } if (golf.playing) golfEnd(true); if (inside) leaveInterior(); [x, z] = collide(x, z, 1); player.position.x = x; player.position.z = z; player.position.y = getH(x, z); airborne = false; vy = 0; act({ t: "warp", x: +x.toFixed(2), z: +z.toFixed(2) }); lastSent.x = x; lastSent.z = z; }
$("#mm").addEventListener("click", (e) => { if (!T) return; const r = e.currentTarget.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; warpTo(T.xmin + u * (T.xmax - T.xmin), T.zmin + v * (T.zmax - T.zmin)); });

// ───────────────────────────── HUD ─────────────────────────────
let gbOpen = false, boardOpen = false;
function closeCards() { for (const id of ["#info", "#gb", "#board", "#shop", "#lot", "#creator"]) $(id).classList.remove("on"); gbOpen = false; boardOpen = false; }
function nearestHotspot() { let best = null, bd = 1e9; for (const h of hotspots) { const d = Math.hypot(player.position.x - h.x, player.position.z - h.z); if (d < h.r && d < bd) { bd = d; best = h; } } return best; }
function openNearest() { if (!player) return; if (inside) { if (VENUE[inside.door.kind] && !inside.atDoor()) { openShop(inside.door.kind); return; } leaveInterior(); return; } const lot = nearestLot(); if (lot) { openLot(lot); return; } const door = nearestDoor(); if (door) { enterInterior(door); return; } const best = nearestHotspot(); if (!best) return; $("#info-h").textContent = best.t; $("#info-k").textContent = best.k; $("#info-p").textContent = best.p; $("#info-go").style.display = best.play ? "" : "none"; $("#info-go").onclick = () => { if (best.play === "golf") golfStart(); }; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); }
$("#info-x").addEventListener("click", closeCards);
function toggleGuestbook() { gbOpen = !gbOpen; $("#gb").classList.toggle("on", gbOpen); if (gbOpen) { renderGuestbook(); if (document.exitPointerLock) document.exitPointerLock(); $("#gb-in").focus(); } }
function renderGuestbook() { const list = $("#gb-list"); list.innerHTML = ""; const entries = (view && view.guestbook) || []; if (!entries.length) { const d = document.createElement("div"); d.textContent = "Nobody has signed yet. Be the first."; list.append(d); } for (const e of [...entries].reverse()) { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = e.by + " "; d.append(b, document.createTextNode(e.text)); list.append(d); } }
$("#gb-go").addEventListener("click", () => { const v = $("#gb-in").value.trim(); if (!v) return; act({ t: "sign", text: v }); $("#gb-in").value = ""; }); $("#gb-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gb-go").click(); }); $("#gb-x").addEventListener("click", closeCards);
function toggleBoard() { boardOpen = !boardOpen; $("#board").classList.toggle("on", boardOpen); if (boardOpen) { renderBoard(); if (document.exitPointerLock) document.exitPointerLock(); } }
function renderBoard() { const B = Object.assign({ golf: [], course: [], obby: [], drag: [] }, (view && view.boards) || {}); for (const [k, fmt] of [["golf", (v) => v + " strokes"], ["course", (v) => (v / 1000).toFixed(2) + " s"], ["obby", (v) => (v / 1000).toFixed(2) + " s"], ["drag", (v) => (v / 1000).toFixed(2) + " s"]]) { const el = $("#b-" + k); el.innerHTML = ""; if (!B[k].length) { const d = document.createElement("div"); d.textContent = "No scores yet."; el.append(d); } B[k].forEach((e, i) => { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${i + 1}. ${e.by}`; const s = document.createElement("span"); s.textContent = fmt(e.v); d.append(b, s); el.append(d); }); } }
$("#board-x").addEventListener("click", closeCards);
function askName() { if (localStorage.getItem("g1:name")) { if (!localStorage.getItem("g1:look")) openCreator(); else if (!localStorage.getItem("g1:tut")) startTutorial(); return; } $("#name").classList.add("on"); $("#name-in").focus(); }
$("#name-go").addEventListener("click", () => { const v = $("#name-in").value.trim().replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 18); if (!v) return; localStorage.setItem("g1:name", v); act({ t: "name", name: v }); $("#name").classList.remove("on"); openCreator(); }); $("#name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-go").click(); });
let zoneShown = null, zoneTimer = 0;
function updateZone(dt) {
  let inZone = null; for (const z of zoneRings) if (Math.hypot(player.position.x - z.center[0], player.position.z - z.center[1]) < z.r) inZone = z;
  if (inZone && inZone !== zoneShown) { zoneShown = inZone; $("#zone-n").textContent = inZone.name; $("#zone-k").textContent = inZone.k; $("#zone").classList.add("on"); zoneTimer = 3.5; } if (!inZone) zoneShown = null; if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) $("#zone").classList.remove("on"); }
  const near = nearestHotspot(); const nv = !riding && nearestVehicle(); const show = (near || nv) && !$("#info").classList.contains("on") && !golf.playing;
  const door = !inside && !riding && nearestDoor();
  $("#prompt").classList.toggle("on", !!(show || door || inside || nearestLot())); const lotN = !inside && !riding && nearestLot(); if (inside) $("#prompt-t").innerHTML = VENUE[inside.door.kind] && !inside.atDoor() ? `<b>E</b> &nbsp;${VENUE[inside.door.kind].title}: browse and buy` : `<b>E</b> &nbsp;step outside`; else if (lotN) $("#prompt-t").innerHTML = `<b>E</b> &nbsp;${view && view.lots && view.lots[lotN.id] && view.lots[lotN.id].owner ? "this lot" : "lot for sale"}`; else if (door) $("#prompt-t").innerHTML = `<b>E</b> &nbsp;enter the ${DOOR_NAMES[door.kind] || door.kind}`; else if (show) $("#prompt-t").innerHTML = (nv ? `<b>F</b> &nbsp;ride the ${view.vehicles[nv].kind === "jet" ? "jet" : "cart"}` : "") + (nv && near ? " &nbsp;·&nbsp; " : "") + (near ? `<b>E</b> &nbsp;${near.play ? "play " : ""}${near.t}` : "");
}
const mmc = $("#mmc").getContext("2d"); const mmImg = new Image(); mmImg.src = "/minimap.jpg";
function drawMinimap() {
  const S = 368; mmc.clearRect(0, 0, S, S); if (mmImg.complete) mmc.drawImage(mmImg, 0, 0, S, S);
  const px = (x) => ((x - T.xmin) / (T.xmax - T.xmin)) * S, pz = (z) => ((z - T.zmin) / (T.zmax - T.zmin)) * S;
  mmc.strokeStyle = "rgba(20,20,22,.9)"; mmc.lineWidth = 5; mmc.beginPath(); SITE.runway.forEach((p, i) => (i ? mmc.lineTo(px(p[0]), pz(p[1])) : mmc.moveTo(px(p[0]), pz(p[1])))); mmc.stroke();
  mmc.font = "600 15px system-ui, sans-serif"; mmc.fillStyle = "rgba(245,241,230,.95)"; mmc.textAlign = "center";
  for (const z of zoneRings) { mmc.strokeStyle = "rgba(77,222,111,.5)"; mmc.lineWidth = 2; mmc.beginPath(); mmc.arc(px(z.center[0]), pz(z.center[1]), (z.r / (T.xmax - T.xmin)) * S, 0, 6.283); mmc.stroke(); mmc.fillText(z.name.replace("The ", ""), px(z.center[0]), pz(z.center[1]) + 5); }
  mmc.fillStyle = "#f4cd5a"; mmc.fillText("Golf", px(GOLF.origin[0]), pz(GOLF.origin[1])); mmc.fillText("Course", px(COURSE.origin[0]), pz(COURSE.origin[1])); mmc.fillText("Obby", px(OBBY.start[0]), pz(OBBY.start[2])); mmc.fillText("Drag", px(DRAG.origin[0]), pz(DRAG.origin[1] + 160));
  if (Math.abs(player.position.x - HOME.x) < HOME.r) { mmc.fillStyle = "rgba(10,22,16,.8)"; mmc.fillRect(0, S - 40, S, 40); mmc.fillStyle = "#4DDE6F"; mmc.fillText("You are at home base, 16 km north-west", S / 2, S - 15); }
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
      const boosting = (keys.ShiftLeft || keys.ShiftRight) && cartHeat < 1; cartHeat = Math.max(0, Math.min(1.2, cartHeat + (boosting ? dt * 0.45 : -dt * 0.25))); const maxS = boosting ? 40 : 28;
      if (fz) cartSpeed += fz * (boosting ? 26 : 16) * dt; else cartSpeed -= Math.sign(cartSpeed) * Math.min(Math.abs(cartSpeed), 12 * dt); cartSpeed = Math.max(-8, Math.min(maxS, cartSpeed));
      if (!airborne) player.rotation.y -= fx * 2.0 * dt * Math.min(1, Math.abs(cartSpeed) / 6) * Math.sign(cartSpeed || 1);
      nx = player.position.x + Math.sin(player.rotation.y) * cartSpeed * dt; nz = player.position.z + Math.cos(player.rotation.y) * cartSpeed * dt;
      { const want = player.rotation.y + Math.PI; let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * Math.min(1, dt * 4); }
    } else {
      const speed = (keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
      nx = player.position.x + (fwd[0] * fz + right[0] * fx) * speed * dt; nz = player.position.z + (fwd[1] * fz + right[1] * fx) * speed * dt;
      if (L > 0.01) player.rotation.y = Math.atan2(fwd[0] * fz + right[0] * fx, fwd[1] * fz + right[1] * fx);
    }
    if (!onLand(nx, nz)) { nx = player.position.x; nz = player.position.z; cartSpeed = 0; } [nx, nz] = collide(nx, nz, cartMode ? 1.4 : 0.6);
    if (inside) { const e = inside.door.e, hf = inside.half - 0.5; let lx = (nx - e[0]) * Math.cos(-e[3]) - (nz - e[2]) * Math.sin(-e[3]), lz = (nx - e[0]) * Math.sin(-e[3]) + (nz - e[2]) * Math.cos(-e[3]); if (lz > hf + 1.5) { leaveInterior(); nx = player.position.x; nz = player.position.z; } else { lx = Math.max(-hf, Math.min(hf, lx)); lz = Math.max(-hf, Math.min(hf + 1.5, lz)); nx = e[0] + lx * Math.cos(e[3]) + lz * Math.sin(e[3]); nz = e[2] - lx * Math.sin(e[3]) + lz * Math.cos(e[3]); } }
    // vertical: ground + ramps, gravity, jumps
    const surfPrev = surfaceAt(player.position.x, player.position.z, player.position.y);
    player.position.x = nx; player.position.z = nz;
    const surf = surfaceAt(nx, nz, player.position.y);
    if (!airborne && cartMode && surfPrev - surf > 0.35 && Math.abs(cartSpeed) > 6) { airborne = true; vy = Math.min(9, Math.abs(cartSpeed) * 0.32); }
    if (!airborne && player.position.y > surf + 0.6) { airborne = true; vy = 0; }
    if (airborne) { vy -= 17 * dt; player.position.y += vy * dt; if (player.position.y <= surf && vy <= 0) { player.position.y = surf; airborne = false; if (vy < -6) sfx("land"); vy = 0; } }
    else { bob += L * dt * 9; player.position.y = surf + (L && !cartMode ? Math.abs(Math.sin(bob)) * 0.08 : 0); }
    updateObby(dt);
    pushMove(false); animateWalk(player, cartMode ? 0 : L * ((keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5), dt);
  } else if (golf.playing) updateGolf(dt);
  updateVehicles(dt); updateBalls(); updateCourse();
  const px = player.position.x, pz = player.position.z, gh = getH(px, pz);
  if (towerView) { const tx = Math.sin(now * 0.00012) * 220, tz = Math.cos(now * 0.00012) * 220; camera.position.set(tx, getH(tx, tz) + 160, tz); camera.lookAt(px, gh + 20, pz); }
  else if (riding) { const V = VEH[riding.id]; const isJet = riding.kind === "jet"; const dist = isJet ? 30 : 11, h = isJet ? 9 : 4; const back = new THREE.Vector3(-Math.sin(V.g.rotation.y) * dist, h, -Math.cos(V.g.rotation.y) * dist); camTarget.copy(V.g.position).add(back); camTarget.y = Math.max(camTarget.y, getH(camTarget.x, camTarget.z) + 1.5); camera.position.lerp(camTarget, isJet ? 0.12 : 0.25); camera.lookAt(V.g.position.x, V.g.position.y + (isJet ? 2 : 1.2), V.g.position.z); }
  else if (golf.playing) { const h = golf.holes[golf.hole]; const ang = h.rot + golf.aim; const dist = golf.moving ? 9 : 6; camTarget.set(golf.ballMesh.position.x - Math.sin(ang) * dist, golf.base + 4.5, golf.ballMesh.position.z - Math.cos(ang) * dist); camera.position.lerp(camTarget, 0.12); camera.lookAt(golf.ballMesh.position.x, golf.base + 0.5, golf.ballMesh.position.z); }
  else if (inside) {
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)]; const e = inside.door.e, hf = inside.half - 0.6;
    // how far back can the camera go before it hits a wall?
    let dist = 0; for (let d = 0; d <= 3.4; d += 0.2) { const cx = px - fwd[0] * d, cz = pz - fwd[1] * d; const lx = (cx - e[0]) * Math.cos(-e[3]) - (cz - e[2]) * Math.sin(-e[3]), lz = (cx - e[0]) * Math.sin(-e[3]) + (cz - e[2]) * Math.cos(-e[3]); if (Math.abs(lx) > hf || Math.abs(lz) > hf) break; dist = d; }
    if (dist < 1.4) { camera.position.set(px, player.position.y + 1.62, pz); camera.lookAt(px + fwd[0] * 10, player.position.y + 1.62 - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
    else { camera.position.set(px - fwd[0] * dist, player.position.y + 1.9 + pitch * 1.2, pz - fwd[1] * dist); camera.lookAt(px, player.position.y + 1.3, pz); player.userData.walk.visible = true; }
  }
  else { let dist = cartMode ? 12 : 9.5; const h = (cartMode ? 4.2 : 3.2) + pitch * 4, fwd = [-Math.sin(yaw), -Math.cos(yaw)];
    // pull the camera in before it enters a building
    for (const c of COLLIDERS) { if (c[2] < 1.5) continue; const dxp = c[0] - px, dzp = c[1] - pz; if (dxp * dxp + dzp * dzp > (dist + c[2]) * (dist + c[2])) continue; for (let d = 1.5; d < dist; d += 0.5) { const sx = px - fwd[0] * d, sz = pz - fwd[1] * d; if (Math.hypot(sx - c[0], sz - c[1]) < c[2] + 0.4) { dist = d - 0.5; break; } } }
    const cx = px - fwd[0] * dist * Math.cos(pitch), cz = pz - fwd[1] * dist * Math.cos(pitch); const cy = Math.max(getH(cx, cz) + 1.2, player.position.y + h * (dist / 9.5) + 1.2); camera.position.lerp(camTarget.set(cx, cy, cz), 0.35); camera.lookAt(px, player.position.y + 1.6, pz); }
  $("#coords").textContent = `${Math.round(px)} E · ${Math.round(pz)} S · ${Math.round(gh + (T.base_elev_m || 0))} m${cartMode ? ` · ${Math.round(Math.abs(cartSpeed) * 3.6)} km/h${cartHeat > 0.05 ? ` · boost ${Math.round(Math.max(0, 1 - cartHeat) * 100)}%` : ""}` : ""}`;
  if (view) {
    for (const [id, p] of Object.entries(view.players)) {
      if (id === ME) { const nm = p.name + (p.xp >= 400 ? " · " + rankOf(p.xp) : ""); if (player.userData.name !== nm) setName(player, nm); syncLook(player, p); showEmote(player, p); setBubble(player, p); updateWallet(p); continue; }
      const s = seen.get(id); const stale = !s || now - s.at > 12000; let a = avatars.get(id);
      if (!a) { a = { g: avatar(id, p.name) }; a.g.position.set(p.x, getH(p.x, p.z), p.z); avatars.set(id, a); }
      a.g.visible = !stale; setName(a.g, p.name + (p.xp >= 400 ? " · " + rankOf(p.xp) : "")); syncLook(a.g, p); showEmote(a.g, p); setBubble(a.g, p);
      { const u = a.g.userData; const sp = Math.hypot(a.g.position.x - u.lastPos.x, a.g.position.z - u.lastPos.z) / Math.max(dt, 0.001); u.lastPos.copy(a.g.position); animateWalk(a.g, Math.min(sp, 12), dt); }
      if (p.veh && view.vehicles && view.vehicles[p.veh]) continue;
      a.g.userData.walk.visible = true; a.g.userData.label.visible = true; if (a.g.userData.cartG.visible !== !!p.cart) setCartVisual(a.g, !!p.cart);
      a.g.position.x += (p.x - a.g.position.x) * 0.12; a.g.position.z += (p.z - a.g.position.z) * 0.12; a.g.position.y = getH(a.g.position.x, a.g.position.z) + rampHeight(a.g.position.x, a.g.position.z);
      const dx = p.x - a.g.position.x, dz = p.z - a.g.position.z; if (dx * dx + dz * dz > 0.02) a.g.rotation.y = Math.atan2(dx, dz);
    }
    for (const [id, a] of avatars) if (!view.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  SWAY.t.value = now / 1000; updateLots(); updateTutorial(now); updateSfx(dt); updateZone(dt); drawMinimap(); updateSky(dt); updateAudio(dt); updateDetails(dt, now); updateVoice(now); updateNPC(dt, now); updateDrag(now);
  renderer.render(scene, camera);
}


// ───────────────────────────── home base: Bisbee-Douglas International ─────────────────────────────
function buildHome() {
  const h = HOME; const dir = 0.05;   // runway roughly north-south
  const rw = [[h.x - Math.sin(dir) * 800, h.z - Math.cos(dir) * 800], [h.x + Math.sin(dir) * 800, h.z + Math.cos(dir) * 800]];
  scene.add(ribbon(rw, 32, M.asphalt, 0.4)); scene.add(ribbon(rw, 0.9, M.stripe, 0.6, true));
  const ap = [[h.x + 30, h.z - 60], [h.x + 130, h.z - 60], [h.x + 130, h.z + 140], [h.x + 30, h.z + 140]]; scene.add(polygon(ap, M.apron, 0.35));
  scene.add(ribbon([[h.x + 16, h.z + 40], [h.x + 40, h.z + 40]], 12, M.taxi, 0.32));
  put("fbo", h.x + 150, h.z + 20, -Math.PI / 2); put("hangar", h.x + 150, h.z + 80, -Math.PI / 2); put("hangar", h.x + 150, h.z + 116, -Math.PI / 2); put("tower", h.x + 150, h.z - 40, 0); put("diner", h.x + 160, h.z + 170, -Math.PI / 2);
  put("solar", h.x + 220, h.z + 60, 0); put("windmill", h.x + 200, h.z - 90, 0);
  sign(h.x + 90, h.z + 175, Math.PI, "GIVEBACK HOME BASE", "BISBEE-DOUGLAS INTERNATIONAL · FLY TO GENESIS ONE", true);
  for (let i = 0; i < 40; i++) { const x = h.x - 300 + rnd() * 600, z = h.z - 300 + rnd() * 700; if (Math.abs(x - h.x) < 40 || (x > h.x + 20 && x < h.x + 240 && z > h.z - 120 && z < h.z + 200)) continue; put(rnd() < 0.7 ? "saguaro" : "paloverde", x, z, rnd() * 6.283, 0.7 + rnd() * 0.8); }
  { const L = 1600, n = Math.floor(L / 60), inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), M.rwLight, n * 2 + 2); const mt = new THREE.Matrix4(); let k = 0; for (let i = 0; i <= n; i++) for (const s of [-17.5, 17.5]) { const x = h.x + Math.sin(dir) * (-800 + i * 60) + Math.cos(dir) * s, z = h.z + Math.cos(dir) * (-800 + i * 60) - Math.sin(dir) * s; mt.makeTranslation(x, getH(x, z) + 0.6, z); inst.setMatrixAt(k++, mt); } inst.count = k; scene.add(inst); }
  hotspots.push({ x: h.x + 60, z: h.z + 40, r: 60, t: "Home Base", k: "Bisbee-Douglas International", p: "The real regional airport 16 km north-west of the site. This is where every visitor arrives. Board Giveback One (F), throttle up on the runway and fly south-east to Genesis One: the arrow in the flight readout points the way. In a hurry? The fast-travel buttons still work." });
  KEEPOUT.push([h.x, h.z, 0]);
}

// ───────────────────────────── the obby: a sky course of platforms ─────────────────────────────
const OBBY = { start: [560, 0, -720], plats: [], checkpoints: [], cp: 0, running: false, t0: 0, best: +localStorage.getItem("g1:bestobby") || 0 };
const OBBY_MAT = {};
function plat(x, y, z, w, d, opts) { const o = Object.assign({ x, y, z, w, d, mat: OBBY_MAT.a }, opts || {}); const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), o.mat); m.position.set(x, y - 0.25, z); scene.add(m); o.mesh = m; o.bx = x; o.bz = z; o.by = y; OBBY.plats.push(o); if (o.rail) { for (const sx of [-1, 1]) { const r = box(0.08, 0.9, d, M.steel, x + sx * (w / 2 - 0.05), y + 0.45, z); scene.add(r); o.mesh.userData.rails = (o.mesh.userData.rails || []).concat(r); } } return o; }
function buildObby() {
  const [sx, , sz] = OBBY.start; const gy = getH(sx, sz); OBBY.start[1] = gy;
  OBBY_MAT.a = new THREE.MeshStandardMaterial({ color: 0xc94a3a, roughness: 0.7 }); OBBY_MAT.b = new THREE.MeshStandardMaterial({ color: 0x3a6ac9, roughness: 0.7 }); OBBY_MAT.beam = new THREE.MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.6 });
  OBBY_MAT.cp = new THREE.MeshStandardMaterial({ map: TEX.checker, emissive: 0x1b7a35, emissiveIntensity: 0.35 }); OBBY_MAT.fin = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, emissive: 0x8a6a10, emissiveIntensity: 0.5 });
  OBBY_MAT.blink = new THREE.MeshStandardMaterial({ color: 0xb46ad8, roughness: 0.6, transparent: true }); OBBY_MAT.bounce = new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xaa7a00, emissiveIntensity: 0.5 });
  const A = OBBY_MAT.a, B = OBBY_MAT.b;
  // jump reach: about 3.3 m across with a 0.8 m rise while walking, farther when running
  let x = sx, y = gy + 0.5, z = sz; let cpN = 0;
  const checkpoint = (w) => { plat(x, y, z, w || 6, w || 6, { mat: OBBY_MAT.cp, cp: cpN, rail: true }); OBBY.checkpoints.push([x, y, z]); const lbl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), new THREE.MeshBasicMaterial({ map: textTexture([{ text: cpN === 0 ? "START" : `LEVEL ${cpN + 1}`, size: 110, y: 0.55 }], 512, 170, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide, transparent: true })); lbl.position.set(x, y + 2.2, z + (w || 6) / 2 - 0.3); scene.add(lbl); cpN++; };
  checkpoint(8);
  sign(sx + 7, sz + 4, -Math.PI / 2, "SKY OBBY", "SIX LEVELS · SPACE TO JUMP · FALL AND YOU RESPAWN");
  // level 1: stepping stones, gentle rise
  z -= 6; for (let i = 0; i < 9; i++) { x += (i % 2 ? 1.6 : -1.6); y += 0.55; z -= 2.9; plat(x, y, z, 2.4, 2.4, { mat: i % 2 ? A : B }); }
  z -= 4.5; y += 0.3; checkpoint();
  // level 2: slow moving platforms, gaps sized to a walking jump even at the far end of the swing
  z -= 5; for (let i = 0; i < 7; i++) { z -= 4.2; y += 0.35; plat(x, y, z, 2.6, 2.6, { mat: i % 2 ? A : B, move: { axis: "x", amp: 1.6, speed: 0.55 + i * 0.08, phase: i * 1.3 } }); }
  z -= 4.8; checkpoint();
  // level 3: narrow beams with turns
  z -= 4; const beams = [[0, -5], [3, -3], [3, -5], [-3, -3], [-3, -5], [0, -4]]; for (const b of beams) { x += b[0]; z += b[1]; plat(x, y, z, 0.8, Math.abs(b[1]) + 1.2, { mat: OBBY_MAT.beam }); }
  z -= 4.5; checkpoint();
  // level 4: blinking platforms, each on a different beat
  z -= 5; for (let i = 0; i < 8; i++) { x += (i % 2 ? 1.4 : -1.4); z -= 3.0; y += 0.3; plat(x, y, z, 2.4, 2.4, { mat: OBBY_MAT.blink.clone(), blink: { period: 3.2, on: 2.1, phase: i * 0.9 } }); }
  z -= 4.5; checkpoint();
  // level 5: bounce pads across wide gaps
  z -= 5; for (let i = 0; i < 4; i++) { plat(x, y, z, 2.6, 2.6, { mat: OBBY_MAT.bounce, bounce: 11.5 }); z -= 9; y += 1.5; plat(x, y, z, 3.2, 3.2, { mat: i % 2 ? A : B }); z -= 3.5; }
  z -= 1; checkpoint();
  // level 6: the spiral: rising ring of platforms, some drifting, to the gold finish
  const cx = x, cz = z - 16; for (let i = 0; i < 14; i++) { const a = -Math.PI / 2 + i / 14 * 6.283 * 1.35; const px = cx + Math.cos(a) * 9, pz = cz + Math.sin(a) * 9; y += 0.7; plat(px, y, pz, 2.4, 2.4, { mat: i % 2 ? A : B, move: i % 4 === 3 ? { axis: "y", amp: 0.7, speed: 0.9, phase: i } : null }); x = px; z = pz; }
  const fx = cx, fz = cz; y += 1.2; plat(fx, y, fz, 8, 8, { mat: OBBY_MAT.fin, finish: true, rail: true }); OBBY.finish = [fx, y, fz];
  const flag = box(0.08, 4, 0.08, M.steel, fx, y + 2, fz); scene.add(flag); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), M.flag); fl.position.set(fx + 0.8, y + 3.6, fz); scene.add(fl);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "FINISH", size: 110, y: 0.55 }], 512, 160, { bg: "#0a1610", border: "#f4cd5a" }), side: THREE.DoubleSide })); lbl.position.set(fx, y + 5, fz); scene.add(lbl);
  hotspots.push({ x: sx, z: sz, r: 20, t: "Sky Obby", k: "Minigame · six levels", p: "A Roblox-style climb: stepping stones, moving platforms, narrow beams, blinking platforms, bounce pads and a spiral to the gold finish. Checkered pads are checkpoints. Fall and you respawn at the last one. Fastest run goes on the board (L)." });
  KEEPOUT.push([sx, sz, 140]);
}
function platSolid(p, t) { if (!p.blink) return true; return ((t + p.blink.phase) % p.blink.period) < p.blink.on; }
function surfaceAt(x, z, y) {
  let s = getH(x, z) + rampHeight(x, z); const t = performance.now() / 1000;
  for (const p of OBBY.plats) { if (Math.abs(x - p.x) <= p.w / 2 + 0.3 && Math.abs(z - p.z) <= p.d / 2 + 0.3 && p.y <= y + 0.55 && p.y > s && platSolid(p, t)) s = p.y; }
  return s;
}
function updateObby(dt) {
  const t = performance.now() / 1000;
  // move the moving platforms and carry whoever stands on them
  let standing = null;
  for (const p of OBBY.plats) { if (!p.move) continue; const off = Math.sin(t * p.move.speed + p.move.phase) * p.move.amp; const nx = p.move.axis === "x" ? p.bx + off : p.bx, nz = p.move.axis === "z" ? p.bz + off : p.bz, ny = p.move.axis === "y" ? p.by + off : p.by;
    const on = !airborne && Math.abs(player.position.x - p.x) <= p.w / 2 + 0.3 && Math.abs(player.position.z - p.z) <= p.d / 2 + 0.3 && Math.abs(player.position.y - p.y) < 0.3;
    if (on) { player.position.x += nx - p.x; player.position.z += nz - p.z; player.position.y += ny - p.y; standing = p; }
    p.x = nx; p.z = nz; p.y = ny; p.mesh.position.set(nx, ny - 0.25, nz); }
  for (const p of OBBY.plats) { if (p.blink) { const on = platSolid(p, t); p.mesh.material.opacity = on ? 1 : 0.15; p.mesh.visible = true; } if (p.bounce && !airborne && Math.abs(player.position.x - p.x) <= p.w / 2 && Math.abs(player.position.z - p.z) <= p.d / 2 && Math.abs(player.position.y - p.y) < 0.3) { vy = p.bounce; airborne = true; } }
  const near = Math.hypot(player.position.x - OBBY.start[0], player.position.z - OBBY.start[2]) < 160;
  if (!near) { if (OBBY.running) { OBBY.running = false; } return; }
  for (const p of OBBY.plats) { if (p.cp === undefined && !p.finish) continue; const on = Math.abs(player.position.x - p.x) <= p.w / 2 && Math.abs(player.position.z - p.z) <= p.d / 2 && Math.abs(player.position.y - p.y) < 0.4; if (!on) continue;
    if (p.cp === 0 && !OBBY.running) { OBBY.running = true; OBBY.t0 = performance.now(); OBBY.cp = 0; }
    else if (p.cp > OBBY.cp) OBBY.cp = p.cp;
    else if (p.finish && OBBY.running) { const ms = performance.now() - OBBY.t0; OBBY.running = false; if (!OBBY.best || ms < OBBY.best) { OBBY.best = ms; localStorage.setItem("g1:bestobby", String(ms)); } act({ t: "score", game: "obby", v: Math.round(ms) }); logLine("Sky Obby", `${player.userData.name} finished in ${(ms / 1000).toFixed(2)} s`); } }
  // fell off: respawn at the last checkpoint
  if (player.position.y < OBBY.start[1] - 3 || (OBBY.running && player.position.y < OBBY.checkpoints[OBBY.cp][1] - 9)) { const c = OBBY.checkpoints[OBBY.cp]; player.position.set(c[0], c[1], c[2]); airborne = false; vy = 0; }
  if (!golf.playing && !cartMode) { $("#game").classList.toggle("on", true); $("#game-n").textContent = "SKY OBBY"; $("#game-big").textContent = OBBY.running ? ((performance.now() - OBBY.t0) / 1000).toFixed(2) + " s" : "step on the green pad"; $("#game-s").textContent = `level ${OBBY.cp + 1} of 6 · space to jump · shift to run` + (OBBY.best ? ` · best ${(OBBY.best / 1000).toFixed(2)} s` : ""); }
}

// ───────────────────────────── interiors: walk into buildings ─────────────────────────────
const DOOR_KINDS = ["hangar", "clubhouse", "saloon", "hotel", "diner", "fbo", "store", "barn", "chapel", "gallery", "hangarhome"];
const DOOR_NAMES = { hangar: "hangar", clubhouse: "clubhouse", saloon: "saloon", hotel: "hotel", diner: "diner", fbo: "terminal", store: "shop", barn: "barn", chapel: "chapel", gallery: "gallery", hangarhome: "hangar home" };
let inside = null;
function nearestDoor() {
  let best = null, bd = 1e9;
  for (const kind of DOOR_KINDS) { const list = PLACE[kind]; if (!list || !MODELS[kind]) continue; const r = MODELS[kind].radius;
    list.forEach((e, i) => { const rr = r * e[4]; const fx = e[0] + Math.sin(e[3]) * rr, fz = e[2] + Math.cos(e[3]) * rr; const d = Math.hypot(player.position.x - fx, player.position.z - fz); const dc = Math.hypot(player.position.x - e[0], player.position.z - e[2]); if ((d < 7 || dc < rr * 0.9) && d < bd) { bd = d; best = { kind, i, e, r: rr }; } }); }
  return best;
}
function furnish(g, kind, r) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 }), cream = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.9 }), glow = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffc070, emissiveIntensity: 1.2 });
  const add = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); };
  const table = (x, z) => { add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 16), wood), x, 0.75, z); add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.75, 8), dark), x, 0.37, z); for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283; add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.4), dark), x + Math.cos(a) * 1.1, 0.22, z + Math.sin(a) * 1.1); } };
  const lamps = (n) => { for (let k = 0; k < n; k++) { const a = k / n * 6.283; add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), glow), Math.cos(a) * r * 0.5, 3.2, Math.sin(a) * r * 0.5); } };
  if (kind === "hangar" || kind === "hangarhome") { const jet = makeModel("jet"); jet.scale.setScalar(0.8); jet.position.set(0, 0, r * 0.15); jet.rotation.y = Math.PI; g.add(jet); add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 0.8), dark), -r * 0.7, 0.45, -r * 0.6); add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0xc9302c })), r * 0.7, 0.7, -r * 0.6); add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0xc9302c })), r * 0.7, 0.7, -r * 0.4); lamps(6); if (kind === "hangarhome") { add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, 0.12, r * 0.6), cream), r * 0.5, 3.4, -r * 0.4); table(r * 0.5, -r * 0.4); } }
  else if (kind === "saloon" || kind === "hotel") { add(new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 1.1, 0.7), wood), 0, 0.55, -r * 0.55); for (let k = -2; k <= 2; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10), dark), k * 0.9, 0.35, -r * 0.55 + 0.8); add(new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 1.6, 0.25), wood), 0, 2.2, -r * 0.8); for (let k = 0; k < 10; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), glow), -r * 0.5 + k * r * 0.11, 2.3, -r * 0.78); table(-r * 0.4, r * 0.1); table(r * 0.4, r * 0.1); if (kind === "hotel") { add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, 0.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x8a1c1c })), r * 0.5, 0.1, r * 0.3); } lamps(4); }
  else if (kind === "diner" || kind === "hotel") {
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshBasicMaterial({ map: textTexture([{ text: kind === "diner" ? "FLIGHT LINE DINER" : "HOTEL KITCHEN", size: 64, y: 0.2, color: "#4DDE6F" }, { text: "COFFEE  10 GB", size: 52, y: 0.5, font: "'Space Grotesk', sans-serif", weight: 600 }, { text: "FULL MEAL  25 GB", size: 52, y: 0.72, font: "'Space Grotesk', sans-serif", weight: 600 }, { text: "press E to order", size: 34, y: 0.9, color: "#f4cd5a", font: "'Space Grotesk', sans-serif" }], 512, 288, { bg: "#1a120c", border: "#4DDE6F" }) })); add(menu, 0, 2.4, -r * 0.8 + 0.2);
    for (let k = 0; k < 6; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 10), new THREE.MeshStandardMaterial({ color: 0xc92c2c })), -r * 0.6 + k * r * 0.24, 0.37, -r * 0.5 + 1.1);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.7, roughness: 0.3 })), r * 0.45, 1.25, -r * 0.5); for (let k = 0; k < 3; k++) { add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), cream), -r * 0.6 + k * r * 0.5, 0.75, r * 0.3); add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xc92c2c })), -r * 0.6 + k * r * 0.5, 0.35, r * 0.3 + 0.75); add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xc92c2c })), -r * 0.6 + k * r * 0.5, 0.35, r * 0.3 - 0.75); } add(new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 1.0, 0.8), cream), 0, 0.5, -r * 0.5); lamps(5); }
  else if (kind === "clubhouse" || kind === "fbo") { for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283; add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0x2f4a3a })), Math.cos(a) * r * 0.35, 0.35, Math.sin(a) * r * 0.35, -a); } add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.06, 24), wood), 0, 0.5, 0); add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 1.1, 0.7), wood), 0, 0.55, -r * 0.6); const scr = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.2), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "GENESIS ONE", size: 96, y: 0.42, shadow: true }, { text: "THE AWAKENING", size: 40, y: 0.72, color: "#4DDE6F", font: "'Space Grotesk', sans-serif", weight: 600 }], 1024, 512, { bg: "#0a1610", border: "#4DDE6F" }) })); add(scr, 0, 2.0, -r * 0.8 + 0.2); lamps(6); }
  else if (kind === "store" || kind === "barn") { for (let k = 0; k < 3; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, r * 1.2), wood), -r * 0.5 + k * r * 0.5, 1.1, 0); add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, 1.0, 0.7), wood), 0, 0.5, -r * 0.6); lamps(3); }
  else if (kind === "chapel") { for (let k = 0; k < 4; k++) for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.4, 0.9, 0.45), wood), s * r * 0.3, 0.45, -r * 0.5 + k * r * 0.28); add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.6), cream), 0, 0.5, -r * 0.75); for (let k = 0; k < 6; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), glow), -0.6 + k * 0.24, 1.2, -r * 0.75); }
  else if (kind === "gallery") { const titles = ["Awakening I", "Runway Light", "Desert Vessel", "Tower Study", "Chiricahua", "Founders"]; for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; const ped = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.8), cream); add(ped, Math.cos(a) * r * 0.45, 0.5, Math.sin(a) * r * 0.45); const art = new THREE.Mesh([new THREE.TorusKnotGeometry(0.3, 0.1, 64, 8), new THREE.OctahedronGeometry(0.4), new THREE.SphereGeometry(0.35, 16, 12)][k % 3], k % 2 ? M.green : M.steel); add(art, Math.cos(a) * r * 0.45, 1.45, Math.sin(a) * r * 0.45); art.userData.spin = 0.3 + k * 0.1; g.userData.spinners = (g.userData.spinners || []).concat(art);
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshBasicMaterial({ map: textTexture([{ text: titles[k], size: 60, y: 0.4 }, { text: "400 GB · press E", size: 34, y: 0.78, color: "#4DDE6F", font: "'Space Grotesk', sans-serif" }], 512, 220, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); add(cap, Math.cos(a) * r * 0.45, 0.6, Math.sin(a) * r * 0.45 + 0.5); }
    for (let k = 0; k < 4; k++) { const wallArt = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshBasicMaterial({ map: textTexture([{ text: ["GENESIS", "ONE", "THE", "AWAKENING"][k], size: 150, y: 0.55, color: ["#4DDE6F", "#f4cd5a", "#f5f1e6", "#ff9180"][k] }], 512, 350, { bg: ["#0a1610", "#1a120c", "#2a1b12", "#0a1610"][k] }) })); const side = k % 2 ? 1 : -1; add(wallArt, side * (r - 0.3), 2.0, -r * 0.5 + Math.floor(k / 2) * r * 0.9, side * -Math.PI / 2); }
    lamps(6); }
}
function enterInterior(door) {
  if (inside || riding || golf.playing) return; if (cartMode) toggleCart();
  const e = door.e, r = door.r; const g = new THREE.Group(); g.position.set(e[0], e[1], e[2]); g.rotation.y = e[3];
  const isH = door.kind === "hangar" || door.kind === "hangarhome"; const wallMat = new THREE.MeshStandardMaterial({ map: isH ? TEX.corrugated : TEX.adobe, roughness: 0.9, side: THREE.DoubleSide }), floorMat = new THREE.MeshStandardMaterial({ map: isH ? TEX.apron : TEX.wood, roughness: 0.95 });
  const hgt = door.kind === "hangar" || door.kind === "hangarhome" ? 7 : 3.6, half = r * 0.95;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.05; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), wallMat); ceil.rotation.x = Math.PI / 2; ceil.position.y = hgt; g.add(ceil);
  g.add(box(half * 2, hgt, 0.2, wallMat, 0, hgt / 2, -half)); g.add(box(0.2, hgt, half * 2, wallMat, -half, hgt / 2, 0)); g.add(box(0.2, hgt, half * 2, wallMat, half, hgt / 2, 0));
  const dw = door.kind === "hangar" || door.kind === "hangarhome" ? half * 1.2 : 2.2; g.add(box(half - dw / 2, hgt, 0.2, wallMat, -(half + dw / 2) / 2, hgt / 2, half)); g.add(box(half - dw / 2, hgt, 0.2, wallMat, (half + dw / 2) / 2, hgt / 2, half)); g.add(box(dw, hgt - 2.4, 0.2, wallMat, 0, hgt - (hgt - 2.4) / 2, half));
  furnish(g, door.kind, half); scene.add(g);
  for (const inst of INST[door.kind] || []) { const m = new THREE.Matrix4().makeScale(0, 0, 0); inst.setMatrixAt(door.i, m); inst.instanceMatrix.needsUpdate = true; }
  const atDoor = () => { const lz = (player.position.x - e[0]) * Math.sin(-e[3]) + (player.position.z - e[2]) * Math.cos(-e[3]); return lz > half - 3.5; };
  inside = { door, g, half, atDoor, saved: COLLIDERS.filter((c) => Math.hypot(c[0] - e[0], c[1] - e[2]) < 0.01) }; for (const c of inside.saved) { const i = COLLIDERS.indexOf(c); if (i >= 0) COLLIDERS.splice(i, 1); }
  const inX = e[0] + Math.sin(e[3]) * (half - 2.5), inZ = e[2] + Math.cos(e[3]) * (half - 2.5); player.position.set(inX, e[1] + 0.05, inZ); yaw = e[3]; airborne = false; vy = 0; camera.position.set(inX - Math.sin(e[3]) * 1.5, e[1] + 2.2, inZ - Math.cos(e[3]) * 1.5); lastSent.at = 0; pushMove(true);
}
function leaveInterior() {
  if (!inside) return; player.userData.walk.visible = true; const { door, g } = inside; const e = door.e; scene.remove(g);
  for (const inst of INST[door.kind] || []) { const m = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e[3]); m.compose(new THREE.Vector3(e[0], e[1], e[2]), q, new THREE.Vector3(e[4], e[4], e[4])); inst.setMatrixAt(door.i, m); inst.instanceMatrix.needsUpdate = true; }
  COLLIDERS.push(...inside.saved); const outX = e[0] + Math.sin(e[3]) * (inside.half + 4), outZ = e[2] + Math.cos(e[3]) * (inside.half + 4); inside = null; player.position.set(outX, getH(outX, outZ), outZ); airborne = false; vy = 0; yaw = e[3] + Math.PI; lastSent.at = 0; pushMove(true);
}

// ───────────────────────────── small things that make it a place ─────────────────────────────
const DETAILS = { socks: [], weeds: [], hawks: [], fires: [] };
function buildDetails() {
  const Z = SITE.zones; const bench = new THREE.BoxGeometry(1.8, 0.1, 0.5), benchLeg = new THREE.BoxGeometry(0.1, 0.45, 0.45);
  const benches = new THREE.InstancedMesh(bench, M.wood, 260), legs = new THREE.InstancedMesh(benchLeg, M.post, 520); const mt = new THREE.Matrix4(); let k = 0, kl = 0;
  const putBench = (x, z, ry) => { if (k >= 260) return; const y = getH(x, z); mt.makeRotationY(ry); mt.setPosition(x, y + 0.5, z); benches.setMatrixAt(k++, mt); for (const s of [-0.7, 0.7]) { mt.makeRotationY(ry); mt.setPosition(x + Math.cos(ry) * s, y + 0.225, z - Math.sin(ry) * s); legs.setMatrixAt(kl++, mt); } };
  for (const lp of PLACE.lamp || []) if (rnd() < 0.7) putBench(lp[0] + Math.sin(lp[3]) * 1.6, lp[2] + Math.cos(lp[3]) * 1.6, lp[3] + Math.PI / 2);
  for (const c of [Z.landing.center, Z.expanse.center, [0, 60]]) for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, d = 20 + rnd() * 40; putBench(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, rnd() * 6.283); }
  benches.count = k; legs.count = kl; scene.add(benches); scene.add(legs);
  // fire pits at the glamping field, the landing and the expanse
  const pitGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.4, 12), flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0 });
  for (const c of [[-800, 300], [Z.landing.center[0] - 40, Z.landing.center[1] + 60], [Z.expanse.center[0] + 60, Z.expanse.center[1] + 240], [Z.expanse.center[0] - 260, Z.expanse.center[1] + 300]]) { for (let i = 0; i < 2; i++) { const x = c[0] + (rnd() - 0.5) * 60, z = c[1] + (rnd() - 0.5) * 60; if (!free(x, z, 3)) continue; const pit = new THREE.Mesh(pitGeo, M.tire); pit.position.set(x, getH(x, z) + 0.2, z); scene.add(pit); const fl = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 7), flameMat); fl.position.set(x, getH(x, z) + 0.9, z); scene.add(fl); DETAILS.fires.push(fl); for (let j = 0; j < 4; j++) { const a = j / 4 * 6.283; putBench(x + Math.cos(a) * 2.4, z + Math.sin(a) * 2.4, -a + Math.PI / 2); } } }
  DETAILS.flameMat = flameMat;
  // string lights over the main streets
  const strGeo = new THREE.SphereGeometry(0.09, 5, 4); const bulbs = new THREE.InstancedMesh(strGeo, M.lampGlow, 1400); let kb = 0; const lamps = PLACE.lamp || [];
  for (let i = 0; i < lamps.length - 1 && kb < 1380; i++) { const a = lamps[i], b = lamps[i + 1]; const L = Math.hypot(b[0] - a[0], b[2] - a[2]); if (L > 40 || L < 6) continue; for (let t = 0; t <= 1; t += 1 / 14) { const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, sag = -Math.sin(t * Math.PI) * 0.6; mt.makeTranslation(x, Math.max(a[1], b[1]) + 3.9 + sag, z); bulbs.setMatrixAt(kb++, mt); } }
  bulbs.count = kb; scene.add(bulbs);
  // windsocks at the aprons
  for (const p of [[70, 20], [HOME.x + 40, HOME.z - 30]]) { const pole = box(0.08, 5, 0.08, M.steel, p[0], getH(p[0], p[1]) + 2.5, p[1]); scene.add(pole); const sock = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.4, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide })); sock.rotation.z = -Math.PI / 2; sock.position.set(p[0] + 1.2, getH(p[0], p[1]) + 4.9, p[1]); const pivot = new THREE.Group(); pivot.position.set(p[0], getH(p[0], p[1]) + 4.9, p[1]); sock.position.set(1.2, 0, 0); pivot.add(sock); scene.add(pivot); DETAILS.socks.push(pivot); }
  // tumbleweeds and hawks
  for (let i = 0; i < 6; i++) { const w = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: 0xb59a6a, wireframe: true })); w.position.set((rnd() - 0.5) * 1600, 0, (rnd() - 0.5) * 1600); w.userData.v = [0.9 + rnd(), 0.4 - rnd() * 0.8]; scene.add(w); DETAILS.weeds.push(w); }
  for (let i = 0; i < 4; i++) { const g = new THREE.Group(); const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.35), M.tire); g.add(wing); const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), M.tire); g.add(body); g.userData = { c: [(rnd() - 0.5) * 1200, (rnd() - 0.5) * 1200], r: 60 + rnd() * 90, h: 60 + rnd() * 50, ph: rnd() * 6.283, sp: 0.25 + rnd() * 0.2 }; scene.add(g); DETAILS.hawks.push(g); }
  // chimney smoke at the diners and a handful of homes
  DETAILS.smoke = []; const smokeSrc = [...(PLACE.diner || []), ...(PLACE.saloon || []).slice(0, 6), ...(PLACE.home || []).filter((_, i) => i % 23 === 0)];
  for (const e of smokeSrc) { const g = new THREE.BufferGeometry(); const a = []; for (let i = 0; i < 24; i++) a.push(0, (i / 24) * 12, 0); g.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd9d4cc, size: 1.6, transparent: true, opacity: 0.25, depthWrite: false })); const h = MODELS[PLACE.diner && PLACE.diner.includes(e) ? "diner" : "home"] ? MODELS[PLACE.diner && PLACE.diner.includes(e) ? "diner" : "home"].height * e[4] : 5; pts.position.set(e[0] - Math.cos(e[3]) * 2, e[1] + h * 0.95, e[2] + Math.sin(e[3]) * 2); scene.add(pts); DETAILS.smoke.push(pts); }
  buildNPC();
  // flags at the tower and home base
  for (const p of [[-20, 20], [HOME.x + 100, HOME.z + 150]]) { const pole = box(0.1, 9, 0.1, M.steel, p[0], getH(p[0], p[1]) + 4.5, p[1]); scene.add(pole); const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "GIVEBACK", size: 120, y: 0.5, shadow: true }], 512, 256, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); fl.position.set(p[0] + 1.5, getH(p[0], p[1]) + 8.2, p[1]); scene.add(fl); DETAILS.flags = DETAILS.flags || []; DETAILS.flags.push(fl); }
}
function updateDetails(dt, now) {
  const t = now / 1000;
  for (const s of DETAILS.socks) s.rotation.y = Math.sin(t * 0.3) * 0.6 + 2.2;
  for (const f of DETAILS.flags || []) f.rotation.y = Math.sin(t * 0.5) * 0.25;
  for (const w of DETAILS.weeds) { w.position.x += w.userData.v[0] * dt * 2; w.position.z += w.userData.v[1] * dt * 2; w.rotation.x += dt * 2; w.rotation.z += dt * 1.3; if (w.position.x > 1300) w.position.x = -1300; if (Math.abs(w.position.z) > 1300) w.position.z = -w.position.z; w.position.y = getH(w.position.x, w.position.z) + 0.5 + Math.abs(Math.sin(t * 3 + w.position.x)) * 0.3; }
  for (const h of DETAILS.hawks) { const u = h.userData, a = t * u.sp + u.ph; h.position.set(u.c[0] + Math.cos(a) * u.r, getH(u.c[0], u.c[1]) + u.h + Math.sin(a * 2) * 6, u.c[1] + Math.sin(a) * u.r); h.rotation.y = -a; h.rotation.z = 0.25; }
  if (DETAILS.flameMat) { DETAILS.flameMat.emissiveIntensity = 0.3 + 1.6 * night; for (const f of DETAILS.fires) f.scale.set(1, 0.85 + Math.sin(t * 9 + f.position.x) * 0.15, 1); }
  if (inside && inside.g.userData.spinners) for (const a of inside.g.userData.spinners) a.rotation.y += dt * a.userData.spin;
  for (const w of DETAILS.wheels || []) { w.rotation.z += dt * (0.8 + Math.sin(t * 0.2) * 0.4); w.rotation.y = Math.sin(t * 0.15) * 0.5; }
  for (const m of buildingMats) m.emissiveIntensity = Math.max(0, m.emissiveIntensity) * (1 + Math.sin(t * 5.3 + m.id) * 0.06);
  for (const sm of DETAILS.smoke || []) { const a = sm.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * 1.4; let x = a.getX(i) + dt * 0.3; if (y > 12) { y = 0; x = 0; } a.setXYZ(i, x + Math.sin(t + i) * 0.01, y, a.getZ(i)); } a.needsUpdate = true; sm.material.opacity = 0.18 + 0.3 * night; }
}

// ───────────────────────────── economy: wallet, shops, lots, ranks ─────────────────────────────
function rankOf(xp) { const R = (view && view.ranks) || [[0, "Passenger"], [400, "Pilot"], [1500, "Captain"], [4000, "Tower"]]; let r = R[0][1]; for (const [need, name] of R) if (xp >= need) r = name; return r; }
function nextRank(xp) { const R = (view && view.ranks) || []; for (const [need, name] of R) if (xp < need) return [need, name]; return null; }
let lastRank = null, lastCoins = null;
function updateWallet(p) {
  const rank = rankOf(p.xp || 0); const nr = nextRank(p.xp || 0);
  $("#coins").textContent = (p.coins || 0).toLocaleString(); $("#rank").textContent = rank + (nr ? ` · ${nr[0] - (p.xp || 0)} xp to ${nr[1]}` : " · top rank"); $("#energy").style.width = (p.energy === undefined ? 100 : p.energy) + "%";
  if (lastRank && rank !== lastRank) { logLine("Genesis One", `${p.name} is now a ${rank}`); sfx("rank"); } lastRank = rank;
  if (lastCoins !== null && (p.coins || 0) > lastCoins) sfx("coin"); lastCoins = p.coins || 0;
}
setInterval(() => { if (introduced && document.hasFocus()) act({ t: "tick" }); }, 60000);
const VENUE = { store: { title: "General Store", k: "Outfitters · Main Street", items: ["hat_cap", "hat_band", "hat_cowboy", "outfit_desert", "outfit_ranch", "outfit_flight"] }, diner: { title: "Flight Line Diner", k: "Restaurant", items: ["coffee", "meal"] }, saloon: { title: "The Saloon", k: "Bar and kitchen", items: ["coffee", "meal"] }, hotel: { title: "Hotel Kitchen", k: "Restaurant", items: ["coffee", "meal"] }, gallery: { title: "Design District Gallery", k: "Art for your lot", items: ["art"] }, fbo: { title: "Terminal Shop", k: "Pilot supplies", items: ["coffee", "hat_cap", "outfit_flight"] } };
const ITEM = { hat_cap: ["Giveback cap", "Green cap with the arrow"], hat_band: ["Desert headband", "Keeps the sun off"], hat_cowboy: ["Cowboy hat", "Douglas classic"], outfit_desert: ["Desert outfit", "Sand shirt, earth pants"], outfit_ranch: ["Ranch outfit", "Red shirt, denim"], outfit_flight: ["Flight crew outfit", "Giveback One crew colours"], coffee: ["Coffee", "+40 energy"], meal: ["Full meal", "Energy back to 100"], art: ["Gallery piece", "A sculpture for your lot"] };
function openShop(kind) {
  const v = VENUE[kind]; if (!v || !view) return; const me = view.players[ME]; const prices = view.prices.shop;
  $("#shop-h").textContent = v.title; $("#shop-k").textContent = v.k; const list = $("#shop-list"); list.innerHTML = "";
  for (const it of v.items) { const row = document.createElement("div"); const owned = (me.owned || []).includes(it); const wearing = me.hat === it || me.outfit === it; const b = document.createElement("b"); b.textContent = ITEM[it][0]; const sm = document.createElement("span"); sm.textContent = ITEM[it][1] + " · " + prices[it] + " GB"; sm.style.opacity = ".7"; const btn = document.createElement("button"); btn.className = "btn"; btn.style.padding = "6px 12px";
    if (owned && (it.startsWith("hat_") || it.startsWith("outfit_"))) { btn.textContent = wearing ? "Take off" : "Wear"; btn.onclick = () => { act({ t: "wear", [it.startsWith("hat_") ? "hat" : "outfit"]: wearing ? null : it }); sfx("ui"); setTimeout(() => openShop(kind), 250); }; }
    else { btn.textContent = "Buy"; btn.disabled = me.coins < prices[it]; btn.onclick = () => { act({ t: "buy", item: it }); sfx("buy"); setTimeout(() => openShop(kind), 250); }; }
    const left = document.createElement("div"); left.append(b, document.createElement("br"), sm); row.append(left, btn); list.append(row); }
  $("#shop-coins").textContent = `${me.coins} GB · ${rankOf(me.xp || 0)}`; $("#shop").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}
$("#shop-x").addEventListener("click", closeCards);
// Founders Row: 24 lots on their own street in the Landing
const LOTS = []; const lotMeshes = {};
function buildLots(c) {
  const dir = heading + 0.3 + Math.PI / 2; const sx = Math.cos(dir), sz = Math.sin(dir); const base = [c[0] + Math.cos(dir + Math.PI / 2) * 275, c[1] + Math.sin(dir + Math.PI / 2) * 275];
  scene.add(ribbon([[base[0] - sx * 300, base[1] - sz * 300], [base[0] + sx * 300, base[1] + sz * 300]], 9, M.dirt, 0.22));
  for (const side of [-1, 1]) scene.add(ribbon([[base[0] - sx * 300 - sz * side * 5.7, base[1] - sz * 300 + sx * side * 5.7], [base[0] + sx * 300 - sz * side * 5.7, base[1] + sz * 300 + sx * side * 5.7]], 2.2, M.walk, 0.38));
  sign(base[0] - sx * 310, base[1] - sz * 310, dir + Math.PI, "FOUNDERS ROW", "24 LOTS · BUY, NAME AND BUILD");
  let i = 0;
  for (const side of [-1, 1]) for (let k = 0; k < 12; k++) { const t = -275 + k * 50; const cx = base[0] + sx * t - sz * side * 22, cz = base[1] + sz * t + sx * side * 22; const rot = Math.atan2(sz * side, -sx * side) + Math.PI;
    const id = "lot" + i++; const g = new THREE.Group(); g.position.set(cx, getH(cx, cz), cz); g.rotation.y = rot;
    for (const e of [[-10, 0, 0.1, 20], [10, 0, 0.1, 20], [0, -10, 20, 0.1], [0, 10, 20, 0.1]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(e[2] || 0.1, 0.9, e[3] || 0.1), M.post); f.position.set(e[0], 0.45, e[1]); g.add(f); }
    const postSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "FOR SALE", size: 120, y: 0.42 }, { text: "1,200 GB · PRESS E", size: 48, y: 0.76, color: "#4DDE6F", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 240, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); postSign.position.set(0, 1.8, 10.6); g.add(postSign);
    const post = box(0.1, 1.2, 0.1, M.post, 0, 0.6, 10.6); g.add(post); scene.add(g);
    LOTS.push({ id, x: cx, z: cz, rot, g, sign: postSign, state: null }); COLLIDERS.push([cx + Math.sin(rot) * 10.6, cz + Math.cos(rot) * 10.6, 0.4]); KEEPOUT.push([cx, cz, 16]); }
  hotspots.push({ x: base[0], z: base[1], r: 30, t: "Founders Row", k: "Own a piece of the plan", p: "Twenty-four lots. Buy one with the coins you earn on the site, put your name on it, and build a home, dome, pavilion or casita. Everyone sees what you built." });
}
function nearestLot() { let best = null, bd = 9; for (const l of LOTS) { const d = Math.hypot(player.position.x - (l.x + Math.sin(l.rot) * 10.6), player.position.z - (l.z + Math.cos(l.rot) * 10.6)); if (d < bd) { bd = d; best = l; } } return best; }
function updateLots() {
  if (!view || !view.lots) return;
  for (const l of LOTS) { const st = view.lots[l.id]; if (!st) continue; const key = JSON.stringify(st); if (l.key === key) continue; l.key = key;
    l.sign.material.map = textTexture(st.owner ? [{ text: st.name || "OWNED", size: 96, y: 0.42 }, { text: st.build ? ITEMS_BUILD[st.build] : "empty lot · press E to build", size: 44, y: 0.76, color: "#4DDE6F", font: "'Space Grotesk', sans-serif", weight: 600 }] : [{ text: "FOR SALE", size: 120, y: 0.42 }, { text: "1,200 GB · PRESS E", size: 48, y: 0.76, color: "#4DDE6F", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 240, { bg: "#0a1610", border: st.owner ? "#f4cd5a" : "#4DDE6F" }); l.sign.material.needsUpdate = true;
    if (l.built) { l.g.remove(l.built); l.built = null; }
    if (st.build) { const m = makeModel(st.build === "casita" ? "home" : st.build); const sc = st.build === "casita" ? 0.6 : (st.build === "home" ? 0.9 : 0.8); m.scale.setScalar(sc); m.position.set(0, 0, -1); l.g.add(m); l.built = m; } }
}
const ITEMS_BUILD = { home: "Desert home", dome: "Geodesic dome", pavilion: "Shade pavilion", casita: "Adobe casita" };
function openLot(l) {
  const st = view.lots[l.id], me = view.players[ME]; const list = $("#lot-list"); list.innerHTML = "";
  $("#lot-h").textContent = st.owner ? (st.name || "Owned lot") : "Lot for sale"; $("#lot-k").textContent = st.owner ? (st.owner === ME ? "Your lot · Founders Row" : "Owned by " + (view.players[st.owner] ? view.players[st.owner].name : "a resident")) : `Founders Row · ${view.prices.lot} GB`;
  const row = (label, sub, btnText, fn, disabled) => { const r = document.createElement("div"); const b = document.createElement("b"); b.textContent = label; const sm = document.createElement("span"); sm.textContent = sub; sm.style.opacity = ".7"; const left = document.createElement("div"); left.append(b, document.createElement("br"), sm); r.append(left); if (btnText) { const btn = document.createElement("button"); btn.className = "btn"; btn.style.padding = "6px 12px"; btn.textContent = btnText; btn.disabled = !!disabled; btn.onclick = fn; r.append(btn); } list.append(r); };
  if (!st.owner) row("Buy this lot", `${view.prices.lot} GB · you have ${me.coins}`, "Buy", () => { act({ t: "lot", id: l.id, op: "buy" }); sfx("buy"); setTimeout(() => openLot(l), 300); }, me.coins < view.prices.lot);
  else if (st.owner === ME) { for (const k in ITEMS_BUILD) row(ITEMS_BUILD[k], `${view.prices.build[k]} GB` + (st.build === k ? " · built" : ""), st.build === k ? null : "Build", () => { act({ t: "lot", id: l.id, op: "build", kind: k }); sfx("buy"); setTimeout(() => openLot(l), 300); }, me.coins < view.prices.build[k]);
    const r = document.createElement("div"); const inp = document.createElement("input"); inp.maxLength = 24; inp.placeholder = "Name your lot"; inp.value = st.name || ""; const btn = document.createElement("button"); btn.className = "btn"; btn.style.padding = "6px 12px"; btn.textContent = "Name"; btn.onclick = () => { act({ t: "lot", id: l.id, op: "name", name: inp.value }); sfx("ui"); }; r.append(inp, btn); list.append(r); }
  else row(st.build ? ITEMS_BUILD[st.build] : "Empty lot", "Owned by another resident", null);
  $("#lot").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}
$("#lot-x").addEventListener("click", closeCards);
function savedLook() { try { return JSON.parse(localStorage.getItem("g1:look")); } catch { return null; } }
function openCreator() {
  const lk = savedLook() || { skin: "e8c19a", shirt: "4dde6f", pants: "2b3a4a", hair: 0 };
  $("#c-skin").value = "#" + lk.skin; $("#c-shirt").value = "#" + lk.shirt; $("#c-pants").value = "#" + lk.pants; $("#c-hair").value = String(lk.hair || 0);
  const preview = () => { const look = { skin: $("#c-skin").value.slice(1), shirt: $("#c-shirt").value.slice(1), pants: $("#c-pants").value.slice(1), hair: +$("#c-hair").value }; buildBody(player, look, null, null); return look; };
  for (const id of ["c-skin", "c-shirt", "c-pants", "c-hair"]) $("#" + id).oninput = preview;
  $("#c-go").onclick = () => { const look = preview(); localStorage.setItem("g1:look", JSON.stringify(look)); act({ t: "look", look }); $("#creator").classList.remove("on"); sfx("ui"); if (!localStorage.getItem("g1:tut")) startTutorial(); };
  $("#creator").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}

// ───────────────────────────── the fly-in tutorial ─────────────────────────────
const TUT = { on: false, step: 0, cardAt: 0, card: 0 };
const TUT_STEPS = [
  ["Welcome to Home Base", "You are at Bisbee-Douglas International, 16 km from Genesis One. Walk to Giveback One on the apron with W A S D and press F to board."],
  ["Take off", "Hold W to throttle up. Above 150 km/h press space to climb. A and D turn. The readout shows the way to Genesis One."],
  ["Cruise", "Keep the arrow straight ahead. On the way, the cards will tell you what is waiting at the site."],
];
const TUT_CARDS = [["The Landing", "Stage 01. Two ring roads of desert-modern homes around the clubhouse, the grand pavilion, the chapel and Founders Row, where you can buy a lot."], ["The Flight Line", "Stage 02. Hangars on both sides of the 6,000 ft runway, hangar homes behind, the diner and the terminal. Every hangar opens: walk up and press E."], ["The Expanse", "Stage 03. Old West streets of saloons, hotels and shops, the design district gallery and the amphitheater."], ["Earn and spend", "You earn GB coins for time on the site and for minigames. Spend them on outfits at the General Store, meals at the diner, art at the gallery, and lots on Founders Row."], ["Ranks", "Passenger, Pilot, Captain, Tower. Play, build and compete to move up. Your rank shows on your name."], ["Play", "Desert Golf, the Cart Course, the Drag Strip and the Sky Obby all keep leaderboards (L). Press C for a cart, space to jump."], ["Talk", "Enter to chat with people near you, V for voice within 60 m, G to sign the guestbook."], ["Landing", "Line up with the runway at the site, ease off W, let the speed drop under 150 km/h and settle. Press F to step out at the tower."]];
function startTutorial() { TUT.on = true; TUT.step = 0; TUT.card = 0; TUT.cardAt = performance.now(); showTut(TUT_STEPS[0][0], TUT_STEPS[0][1]); }
function showTut(h, p) { $("#tut-h").textContent = h; $("#tut-p").textContent = p; $("#tut").classList.add("on"); }
function endTutorial() { TUT.on = false; $("#tut").classList.remove("on"); localStorage.setItem("g1:tut", "done"); }
$("#tut-skip").addEventListener("click", endTutorial);
function updateTutorial(now) {
  if (!TUT.on) return;
  if (TUT.step === 0 && riding && riding.kind === "jet") { TUT.step = 1; showTut(...TUT_STEPS[1]); }
  else if (TUT.step === 1 && riding && vSpeed > 42 && VEH[riding.id] && VEH[riding.id].g.position.y > getH(VEH[riding.id].g.position.x, VEH[riding.id].g.position.z) + 30) { TUT.step = 2; TUT.cardAt = now; showTut(...TUT_STEPS[2]); }
  else if (TUT.step === 2) { if (now - TUT.cardAt > 9000) { TUT.cardAt = now; if (TUT.card < TUT_CARDS.length) { showTut(...TUT_CARDS[TUT.card]); TUT.card++; } } if (!riding && Math.hypot(player.position.x, player.position.z) < 1400) { showTut("Welcome to Genesis One", "You made it. Press E near anything with a prompt, L for leaderboards, and the buttons on the right to jump around the site. Enjoy the walk."); setTimeout(endTutorial, 12000); TUT.on = false; localStorage.setItem("g1:tut", "done"); } }
  if (TUT.step < 2 && Math.hypot(player.position.x, player.position.z) < 1400) endTutorial();
}

// ───────────────────────────── residents: people and shuttle carts that live here ─────────────────────────────
const NPC = [];
function buildNPC() {
  const names = ["Maya", "Diego", "Harper", "Ezra", "Luna", "Theo", "Nova", "Amir", "Sage", "Cole", "Ivy", "Beau", "Wren", "Otis", "Juno", "Reid", "Elle", "Kai", "Remy", "Zia"];
  const lamps = PLACE.lamp || []; if (lamps.length < 4) return;
  for (let i = 0; i < 20; i++) { const g = avatar("npc" + i.toString(36).padStart(4, "0"), names[i % names.length], { skin: ["e8c19a", "c98f63", "8d5a3b", "f3d9c0"][i % 4], shirt: ["4dde6f", "c94a3a", "3a6ac9", "f4cd5a", "e9e2d3"][i % 5], pants: ["2b3a4a", "6d5a3e", "1c1f24"][i % 3], hair: i % 4 }, ["hat_cap", null, "hat_cowboy", null, "hat_band"][i % 5], [null, "outfit_flight", null, "outfit_ranch", "outfit_desert"][i % 5]); g.userData.label.scale.set(1.6, 0.4, 1); const l = lamps[Math.floor(rnd() * lamps.length)]; g.position.set(l[0], l[1], l[2]); NPC.push({ g, target: null, wait: rnd() * 4, speed: 1.1 + rnd() * 0.6, kind: "walk" }); }
  // two shuttle carts that loop the Landing ring road
  const c = SITE.zones.landing.center; for (let i = 0; i < 2; i++) { const g = makeModel("cart"); scene.add(g); NPC.push({ g, kind: "loop", c, r: 120, a: i * Math.PI, speed: 0.07 }); }
}
function updateNPC(dt, now) {
  const lamps = PLACE.lamp || [];
  for (const n of NPC) {
    if (n.kind === "loop") { n.a += dt * n.speed; const x = n.c[0] + Math.cos(n.a) * n.r, z = n.c[1] + Math.sin(n.a) * n.r; n.g.position.set(x, getH(x, z), z); n.g.rotation.y = Math.atan2(-Math.sin(n.a), Math.cos(n.a)) + Math.PI; continue; }
    const g = n.g;
    if (!n.target) { n.wait -= dt; if (n.wait > 0) continue; const l = lamps[Math.floor(Math.random() * lamps.length)]; if (Math.hypot(l[0] - g.position.x, l[2] - g.position.z) > 90) { n.wait = 0.5; continue; } n.target = [l[0] + (Math.random() - 0.5) * 6, l[2] + (Math.random() - 0.5) * 6]; }
    const dx = n.target[0] - g.position.x, dz = n.target[1] - g.position.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { n.target = null; n.wait = 2 + Math.random() * 6; continue; }
    g.position.x += dx / d * n.speed * dt; g.position.z += dz / d * n.speed * dt; g.position.y = getH(g.position.x, g.position.z); g.rotation.y = Math.atan2(dx, dz); animateWalk(g, n.speed * 1.6, dt);
    if (Math.random() < dt * 0.05 && player && Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z) < 12) { g.userData.emote.material.map = emojiTex.wave; g.userData.emote.material.needsUpdate = true; g.userData.emote.visible = true; setTimeout(() => { g.userData.emote.visible = false; }, 2500); }
  }
}

// ───────────────────────────── proximity voice (WebRTC, peer to peer) ─────────────────────────────
const VOICE = { on: false, stream: null, peers: new Map(), range: 60 };
async function toggleVoice() {
  if (VOICE.on) { VOICE.on = false; for (const [id] of VOICE.peers) closePeer(id); if (VOICE.stream) VOICE.stream.getTracks().forEach((t) => t.stop()); VOICE.stream = null; $("#voice").textContent = "VOICE OFF"; return; }
  try { VOICE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); VOICE.on = true; $("#voice").textContent = "VOICE ON"; setStatus("voice on: people within 60 m can hear you"); }
  catch (e) { setStatus("microphone blocked", true); }
}
function peerFor(id) {
  let p = VOICE.peers.get(id); if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); const audio = new Audio(); audio.autoplay = true; audio.volume = 0;
  if (VOICE.stream) for (const tr of VOICE.stream.getTracks()) pc.addTrack(tr, VOICE.stream);
  pc.ontrack = (ev) => { audio.srcObject = ev.streams[0]; audio.play().catch(() => {}); };
  pc.onicecandidate = (ev) => { if (ev.candidate) send({ type: "signal", to: id, data: { c: ev.candidate } }); };
  p = { pc, audio, far: 0 }; VOICE.peers.set(id, p); return p;
}
function closePeer(id) { const p = VOICE.peers.get(id); if (!p) return; try { p.pc.close(); } catch {} p.audio.srcObject = null; VOICE.peers.delete(id); }
async function onSignal(msg) {
  if (!VOICE.on) return; const id = msg.from, d = msg.data || {}; const p = peerFor(id);
  try {
    if (d.sdp) { await p.pc.setRemoteDescription(d.sdp); if (d.sdp.type === "offer") { const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans); send({ type: "signal", to: id, data: { sdp: p.pc.localDescription } }); } }
    else if (d.c) await p.pc.addIceCandidate(d.c);
  } catch (e) { console.warn("voice", e); }
}
let lastVoice = 0;
function updateVoice(now) {
  if (!VOICE.on || !view || now - lastVoice < 500) return; lastVoice = now; let nearby = 0;
  for (const [id, pl] of Object.entries(view.players)) { if (id === ME) continue; const d = Math.hypot(pl.x - player.position.x, pl.z - player.position.z); const s = seen.get(id); const live = s && now - s.at < 15000;
    if (d < VOICE.range && live) { nearby++; const p = peerFor(id); p.far = 0; p.audio.volume = Math.max(0, Math.min(1, 1 - (d - 8) / (VOICE.range - 8)));
      if (!p.offered && ME > id) { p.offered = true; p.pc.createOffer().then((o) => p.pc.setLocalDescription(o)).then(() => send({ type: "signal", to: id, data: { sdp: p.pc.localDescription } })).catch(() => {}); } }
    else if (VOICE.peers.has(id)) { const p = VOICE.peers.get(id); p.audio.volume = 0; if (++p.far > 12) closePeer(id); } }
  $("#voice").textContent = `VOICE ON · ${nearby} near`;
}
$("#voice").addEventListener("click", (e) => { e.stopPropagation(); toggleVoice(); });

// ───────────────────────────── ambient audio ─────────────────────────────
const AUD = {}; let soundOn = false, audioReady = false, planeTimer = 40 + Math.random() * 60;
function mkAudio(src, vol, loop) { const a = new Audio(src); a.loop = loop; a.volume = 0; a.preload = "auto"; a.dataset.vol = vol; return a; }
AUD.music = mkAudio("/audio/music.m4a", 0.22, true); AUD.wind = mkAudio("/audio/wind.mp3", 0.5, true); AUD.night = mkAudio("/audio/night.mp3", 0.55, true); AUD.plane = mkAudio("/audio/plane.mp3", 0.45, false);
function startAudio() { if (audioReady) return; audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); soundOn = localStorage.getItem("g1:sound") !== "off"; updateSoundBtn(); }
function toggleSound() { soundOn = !soundOn; localStorage.setItem("g1:sound", soundOn ? "on" : "off"); if (!audioReady) { audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); } updateSoundBtn(); }
function updateSoundBtn() { $("#snd").textContent = soundOn ? "SOUND ON" : "SOUND OFF"; }
function updateAudio(dt) { if (!audioReady) return; const on = soundOn ? 1 : 0, jet = riding && riding.kind === "jet" ? Math.min(1, vSpeed / 60) : 0; const target = { music: 1, wind: 0.25 + 0.75 * (1 - night) + jet * 1.2, night: night * (1 - jet) }; for (const k in target) { const a = AUD[k], want = Math.min(1, on * +a.dataset.vol * target[k]); a.volume += (want - a.volume) * Math.min(1, dt * 1.5); } planeTimer -= dt; if (planeTimer <= 0) { planeTimer = 70 + Math.random() * 90; if (soundOn && night < 0.6) { AUD.plane.volume = +AUD.plane.dataset.vol; AUD.plane.currentTime = 0; AUD.plane.play().catch(() => {}); } } }
addEventListener("pointerdown", startAudio); addEventListener("keydown", startAudio); $("#snd").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });

// ───────────────────────────── synthesised sound effects ─────────────────────────────
let ACTX = null, engine = null, engineGain = null, stepTimer = 0;
function actx() { if (!ACTX) { ACTX = new (window.AudioContext || window.webkitAudioContext)(); } if (ACTX.state === "suspended") ACTX.resume(); return ACTX; }
function tone(f, dur, type, vol, slide) { if (!soundOn) return; const c = actx(); const o = c.createOscillator(), g = c.createGain(); o.type = type || "sine"; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + dur); g.gain.value = vol || 0.08; g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur); }
function noise(dur, vol, hp) { if (!soundOn) return; const c = actx(); const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const src = c.createBufferSource(); src.buffer = b; const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 800; const g = c.createGain(); g.gain.value = vol || 0.05; src.connect(f).connect(g).connect(c.destination); src.start(); }
function sfx(name) {
  if (name === "step") noise(0.07, 0.035, 600); else if (name === "jump") tone(240, 0.18, "triangle", 0.05, 480); else if (name === "land") noise(0.09, 0.05, 300);
  else if (name === "coin") { tone(880, 0.12, "sine", 0.06); setTimeout(() => tone(1320, 0.18, "sine", 0.06), 90); } else if (name === "buy") { tone(660, 0.1, "square", 0.04); setTimeout(() => tone(990, 0.16, "square", 0.04), 100); }
  else if (name === "ui") tone(520, 0.06, "sine", 0.04); else if (name === "putt") noise(0.05, 0.08, 1500); else if (name === "rank") { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, "triangle", 0.06), i * 110)); }
  else if (name === "board") tone(300, 0.2, "sawtooth", 0.03, 120); else if (name === "gate") tone(1200, 0.08, "sine", 0.05);
}
function updateSfx(dt) {
  if (!audioReady || !soundOn) { if (engineGain) engineGain.gain.value = 0; return; }
  const c = actx();
  if (!engine) { engine = c.createOscillator(); engine.type = "sawtooth"; const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; engineGain = c.createGain(); engineGain.gain.value = 0; engine.connect(lp).connect(engineGain).connect(c.destination); engine.start(); }
  const drivingCart = cartMode || (riding && riding.kind === "cart"); const flying = riding && riding.kind === "jet";
  const sp = drivingCart ? Math.abs(riding ? vSpeed : cartSpeed) : (flying ? vSpeed : 0);
  const want = drivingCart ? Math.min(0.06, 0.012 + sp * 0.0015) : (flying ? Math.min(0.09, 0.02 + sp * 0.0006) : 0);
  engineGain.gain.value += (want - engineGain.gain.value) * Math.min(1, dt * 4); engine.frequency.value = drivingCart ? 55 + sp * 4 : (flying ? 40 + sp * 0.5 : 50);
  if (!riding && !cartMode && !airborne && !golf.playing) { const moving = keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || joy.active; if (moving) { stepTimer -= dt; if (stepTimer <= 0) { sfx("step"); stepTimer = (keys.ShiftLeft || keys.ShiftRight) ? 0.28 : 0.45; } } }
}

// ───────────────────────────── boot ─────────────────────────────
buildWorld().then(() => { const lk = savedLook(); player = avatar(ME, localStorage.getItem("g1:name") || "You", lk, null, null); player.position.set(HOME.x + 20, getH(HOME.x + 20, HOME.z + 40), HOME.z + 40); $("#load").classList.add("off"); askName(); connect(); frame(); }).catch((err) => { setStatus("failed to load the site: " + err.message, true); console.error(err); });
