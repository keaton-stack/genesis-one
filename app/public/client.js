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
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xe7d6bd, 0.000026);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 120000);
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7d6b4c, 0.42); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 1.25); sun.position.set(-600, 500, 300); scene.add(sun); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 20; sun.shadow.camera.far = 1600; sun.shadow.camera.left = sun.shadow.camera.bottom = -130; sun.shadow.camera.right = sun.shadow.camera.top = 130; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
const moon = new THREE.DirectionalLight(0x9fb4ff, 0); moon.position.set(400, 500, -300); scene.add(moon);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (typeof POST !== "undefined" && POST.rt) POST.resize(); }
addEventListener("resize", resize); resize();

// sky dome with gradient, sun glow and a cloud layer drawn from noise
const DETAILS = { socks: [], weeds: [], hawks: [], fires: [] };
const texLoader0 = new THREE.TextureLoader();
const skyDay = texLoader0.load("/tex/sky_day.jpg"), skyDusk = texLoader0.load("/tex/sky_dusk.jpg"), skyNight = texLoader0.load("/tex/sky_night.jpg"); skyDay.encoding = skyDusk.encoding = skyNight.encoding = THREE.sRGBEncoding;
function milkyTexture() {   // a soft tilted band of galactic haze with a little structure
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 2600; i++) { const u = Math.random(); const band = 256 + Math.sin(u * 6.283) * 120; const y = band + (Math.random() + Math.random() + Math.random() - 1.5) * 60; const r = 6 + Math.random() * 30; const g = x.createRadialGradient(u * 1024, y, 0, u * 1024, y, r); const a = 0.02 + Math.random() * 0.05; g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(u * 1024 - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 400; i++) { const u = Math.random(); const band = 256 + Math.sin(u * 6.283) * 120; const y = band + (Math.random() - 0.5) * 70; x.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(u * 1024, y, 10 + Math.random() * 30, 3 + Math.random() * 8, Math.random(), 0, 6.283); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
}
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uShift: { value: 0 }, tDay: { value: skyDay }, tDusk: { value: skyDusk }, tNight: { value: skyNight }, tMilky: { value: milkyTexture() }, kDusk: { value: 0 }, kNight: { value: 0 }, nightCol: { value: new THREE.Color(0x070b18) }, horizon: { value: new THREE.Color(0xe7d6bd) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffd9a0) }, glow: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uShift; uniform sampler2D tDay; uniform sampler2D tDusk; uniform sampler2D tNight; uniform sampler2D tMilky; uniform float kDusk; uniform float kNight; uniform vec3 nightCol; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float u = atan(d.z, d.x) / 6.28318 + 0.5 + uShift; float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159;
      vec3 sky = mix(texture2D(tDay, vec2(u, v)).rgb, texture2D(tDusk, vec2(u, v)).rgb, kDusk);
      float hz = smoothstep(0.0, 0.12, d.y); sky = mix(horizon, sky, hz);
      vec3 nightSky = mix(vec3(0.16, 0.14, 0.24), vec3(0.015, 0.02, 0.05), smoothstep(-0.05, 0.5, d.y));
      float mw = texture2D(tMilky, vec2(u, v)).r; nightSky += vec3(0.5, 0.52, 0.66) * mw * 0.42; nightSky += vec3(0.02, 0.025, 0.04) * hz;
      sky = mix(sky, nightSky, kNight);
      float s = max(dot(d, normalize(sunDir)), 0.0); sky += sunCol * glow * (pow(s, 500.0) * 2.4 + pow(s, 8.0) * 0.3 * (1.0 - hz * 0.5));
      gl_FragColor = vec4(sky, 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(80000, 48, 24), skyMat));
// a tiny copy of the sky feeds image-based lighting so every surface reflects the real sky colour
const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMat)); const pmrem = new THREE.PMREMGenerator(renderer); let envAt = -1e9, envTex = null;
function updateEnvironment(now) { if (now - envAt < 3500) return; envAt = now; const rt = pmrem.fromScene(envScene, 0.05); if (envTex) envTex.dispose(); envTex = rt.texture; scene.environment = envTex; }
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
// cumulus: big soft billboards that drift across the basin
function puffTexture() { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); for (let i = 0; i < 18; i++) { const px = 60 + Math.random() * 136, py = 90 + Math.random() * 110, r = 30 + Math.random() * 50; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.6, "rgba(245,245,250,0.45)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 256, 256); } const t = new THREE.CanvasTexture(c); return t; }
DETAILS.cumulus = []; { const pt = puffTexture(); for (let i = 0; i < 70; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, transparent: true, opacity: 0.8, depthWrite: false, fog: false })); const sc = 900 + Math.random() * 1600; sp.scale.set(sc * (1.4 + Math.random()), sc * 0.55, 1); sp.position.set((Math.random() - 0.5) * 60000, 1600 + Math.random() * 1800, (Math.random() - 0.5) * 60000); scene.add(sp); DETAILS.cumulus.push(sp); } }

// ───────────────────────────── terrain data ─────────────────────────────
let SITE = null, H = null, T = null, HR = null, TR = null;
function sampleGrid(h, t, x, z) {
  const u = ((x - t.xmin) / (t.xmax - t.xmin)) * (t.cols - 1), v = ((z - t.zmin) / (t.zmax - t.zmin)) * (t.rows - 1);
  const c = Math.max(0, Math.min(t.cols - 2, Math.floor(u))), r = Math.max(0, Math.min(t.rows - 2, Math.floor(v)));
  const fu = Math.max(0, Math.min(1, u - c)), fv = Math.max(0, Math.min(1, v - r)); const i = r * t.cols + c;
  return (h[i] * (1 - fu) + h[i + 1] * fu) * (1 - fv) + (h[i + t.cols] * (1 - fu) + h[i + t.cols + 1] * fu) * fv;
}
function getH(x, z) {
  if (inside && Math.hypot(x - inside.door.e[0], z - inside.door.e[2]) < inside.half * 1.5) return inside.door.e[1];
  if (H && x > T.xmin && x < T.xmax && z > T.zmin && z < T.zmax) return sampleGrid(H, T, x, z);
  if (HR) return sampleGrid(HR, TR, x, z);
  return 0;
}
let seed = 20260910; function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const loadbar = $("#loadbar"); const setLoad = (p, m) => { loadbar.style.width = Math.round(p * 100) + "%"; if (m) $("#loadmsg").textContent = m; };

// ───────────────────────────── materials ─────────────────────────────
function tiled(path, rx, ry) { const t = texLoader0.load(path); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; }
function procTex(fn, size) { const c = document.createElement("canvas"); c.width = c.height = size || 256; const x = c.getContext("2d"); fn(x, c.width); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.encoding = THREE.sRGBEncoding; return t; }
const TEX = { detail: tiled("/tex/detail.jpg", 1, 1), detail2: tiled("/tex/detail2.jpg", 1, 1), rock: tiled("/tex/rock.jpg", 1, 1), turf: tiled("/tex/turf.jpg", 1, 1), apron: tiled("/tex/apron.jpg", 1, 1), dirt: tiled("/tex/dirt.jpg", 1, 1), sand: tiled("/tex/sand.jpg", 1, 1), wood: tiled("/tex/wood.jpg", 1, 1), adobe: tiled("/tex/adobe.jpg", 1, 1), corrugated: tiled("/tex/corrugated.jpg", 1, 1),
  plank: procTex((x, S) => { x.fillStyle = "#7a5535"; x.fillRect(0, 0, S, S); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.05)"; x.fillRect(0, i * S / 8, S, S / 8); x.fillStyle = "rgba(0,0,0,.4)"; x.fillRect(0, i * S / 8, S, 2); for (let k = 0; k < 40; k++) { x.fillStyle = "rgba(0,0,0,.08)"; x.fillRect(Math.random() * S, i * S / 8 + Math.random() * S / 8, 20 + Math.random() * 60, 1); } } }),
  adobeWall: procTex((x, S) => { x.fillStyle = "#e6dac4"; x.fillRect(0, 0, S, S); for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(120,90,60,${Math.random() * 0.08})`; x.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 4); } }),
  checker: procTex((x, S) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#f5f1e6" : "#0a1610"; x.fillRect(i * S / 4, j * S / 4, S / 4, S / 4); } }) };
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x8a8a90, map: TEX.apron, roughness: 0.95 }), taxi: new THREE.MeshStandardMaterial({ color: 0xa8a8ac, map: TEX.apron, roughness: 0.95 }),
  apron: new THREE.MeshStandardMaterial({ map: TEX.apron, roughness: 0.95 }), dirt: new THREE.MeshStandardMaterial({ map: TEX.dirt, roughness: 1 }),
  track: new THREE.MeshStandardMaterial({ color: 0xc9a67a, map: TEX.dirt, roughness: 1 }), walk: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, map: TEX.apron, roughness: 1 }), curb: new THREE.MeshStandardMaterial({ color: 0xbdb7a8, roughness: 0.9 }), stripe: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 }),
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
const ROADS = [], DEFER = [];
function ribbon(points, width, mat, lift, dashed) { if (mat === M.dirt || mat === M.track || mat === M.walk || mat === M.asphalt || mat === M.taxi || mat === M.deck) ROADS.push({ pts: points, w: width }); const g = new THREE.Group(); DEFER.push(() => g.add(ribbonNow(points, width, mat, lift, dashed))); return g; }
function polygon(points, mat, lift) { const g = new THREE.Group(); DEFER.push(() => g.add(polygonNow(points, mat, lift))); return g; }
function ribbonNow(points, width, mat, lift, dashed) {
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
function polygonNow(points, mat, lift) {
  const tri = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p[0], p[1])), []); const pos = [], idx = [];
  const uv = [];
  for (const p of points) { pos.push(p[0], getH(p[0], p[1]) + lift, p[1]); uv.push(p[0] / 12, p[1] / 12); } for (const t of tri) idx.push(t[0], t[2], t[1]);
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
  amphitheater: { size: 40, solid: 0 }, solar: { size: 26, solid: 0 }, fbo: { size: 36 }, terminal: { size: 92 },
  bank: { size: 16 }, restaurant: { size: 32 }, villa: { size: 19 }, ranch: { size: 18 }, casita: { size: 9 }, bush1: { size: 2.6, solid: 0, prop: true, sway: 0.9 }, bush2: { size: 2.2, solid: 0, prop: true, sway: 0.9 }, mesquite: { height: 6, solid: 0.5, prop: true, sway: 0.5 }, ocotillo: { height: 4, solid: 0.3, prop: true, sway: 0.7 }, boulder: { size: 3.5, solid: 1.4, prop: true }, art1: { height: 9, solid: 2, prop: true }, art2: { height: 8, solid: 2, prop: true }, art3: { height: 10, solid: 2, prop: true }, art4: { height: 7, solid: 2, prop: true },
  lakehouse: { size: 24 }, manor: { size: 44 }, dock: { size: 16, prop: true, solid: 0 }, glamp: { size: 12 }, artpav: { size: 40 }, flagship: { size: 34 }, monolith: { height: 6.5, prop: true, solid: 0.8 }, corten: { height: 7.5, prop: true, solid: 0.6 }, lantern: { height: 5.5, prop: true, solid: 1.2 }, mesa: { size: 720, prop: true, solid: 0 }, butte: { size: 420, prop: true, solid: 0 }, ironwood: { height: 8.5, solid: 0.5, prop: true, sway: 0.5 }, desertwillow: { height: 6.5, solid: 0.4, prop: true, sway: 0.8 }, fanpalm: { height: 13, solid: 0.5, prop: true, sway: 0.35 }, coyote: { size: 1.3, prop: true, solid: 0, animal: true }, roadrunner: { size: 0.55, prop: true, solid: 0, animal: true }, scorpion: { size: 0.28, prop: true, solid: 0, animal: true }, jackrabbit: { size: 0.55, prop: true, solid: 0, animal: true }, javelina: { size: 1.1, prop: true, solid: 0, animal: true }, snake: { size: 0.9, prop: true, solid: 0, animal: true }, tortoise: { size: 0.45, prop: true, solid: 0, animal: true }, quail: { size: 0.3, prop: true, solid: 0, animal: true },
  saguaro: { height: 7, solid: 0.6, prop: true, sway: 0.12 }, paloverde: { height: 8, solid: 0.6, prop: true, sway: 0.55 }, sculpture: { height: 7, solid: 1.5, prop: true }, lamp: { height: 4.2, solid: 0.3, prop: true, sway: 0.08 }, windmill: { height: 14, solid: 2 },
  cart: { size: 3.2, vehicle: true, rot: Math.PI / 2 }, jet: { size: 22, vehicle: true, rot: Math.PI / 2 }, gbjet: { size: 22, vehicle: true, rot: Math.PI / 2 },
};
const MODELS = {}, PLACE = {}, COLLIDERS = [], INST = {};
const DOOR_KINDS = ["manor", "terminal", "lakehouse", "glamp", "flagship", "artpav", "hangar", "clubhouse", "saloon", "hotel", "diner", "fbo", "store", "barn", "chapel", "gallery", "hangarhome", "bank", "restaurant", "villa", "ranch"];
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
    loader.load(`/models/${k}.glb?v=${window.BUILD || 0}`, (g) => {
      const root = g.scene; root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root); const sz = new THREE.Vector3(); box.getSize(sz); const c = new THREE.Vector3(); box.getCenter(c);
      const spec = MODEL_SPECS[k]; const s = spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
      const norm = new THREE.Matrix4().makeRotationY(spec.rot || 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const parts = [];
      root.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().copy(norm).multiply(o.matrixWorld)); const mat = o.material.clone(); mat.side = THREE.DoubleSide; mat.transparent = false; mat.depthWrite = true; mat.roughness = 0.85; mat.metalness = 0; if (mat.map) { mat.map.encoding = THREE.sRGBEncoding; mat.map.anisotropy = 8; mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffb870); mat.emissiveIntensity = 0; } if (!spec.prop && !spec.vehicle) buildingMats.push(mat); if (spec.sway) addSway(mat, spec.sway); parts.push({ geometry: geo, material: mat }); });
      MODELS[k] = { parts, radius: Math.max(sz.x, sz.z) * s / 2, height: sz.y * s }; setLoad(0.15 + 0.4 * (++done / kinds.length)); res();
    }, undefined, () => { setLoad(0.15 + 0.4 * (++done / kinds.length)); res(); });
  })));
}
const HOME_KINDS = ["home", "villa", "ranch", "casita"];
M.deck = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.85 }); M.tile = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.55 });
const HUD = { gameOwner: null }; function gameHud(n) { HUD.gameOwner = n; $("#game").classList.add("on"); }
// level pads: grade the ground to the building's base height inside its footprint
function flattenPads() {
  const W = T.xmax - T.xmin, D = T.zmax - T.zmin; const cw = W / (T.cols - 1), ch = D / (T.rows - 1); const sm = (t) => t * t * (3 - 2 * t);
  const pads = [];
  for (const kind in PLACE) { const spec = MODEL_SPECS[kind]; if (spec.prop || spec.vehicle || !MODELS[kind]) continue; for (const e of PLACE[kind]) pads.push([e[0], e[2], MODELS[kind].radius * e[4] * 1.25 + 3, e[1]]); }
  for (const l of LOTS) pads.push([l.x, l.z, 12, getH(l.x, l.z)]); for (const q of POOLS) pads.push([q.x, q.z, Math.max(q.w, q.d) / 2 + 4, q.y]);
  for (const [px, pz, pr, target] of pads) { const edge = Math.max(6, pr * 0.5); const c0 = Math.max(0, Math.floor((px - pr - edge - T.xmin) / cw)), c1 = Math.min(T.cols - 1, Math.ceil((px + pr + edge - T.xmin) / cw)), r0 = Math.max(0, Math.floor((pz - pr - edge - T.zmin) / ch)), r1 = Math.min(T.rows - 1, Math.ceil((pz + pr + edge - T.zmin) / ch));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const x = T.xmin + c * cw, z = T.zmin + r * ch; const d = Math.hypot(x - px, z - pz); if (d > pr + edge) continue; const k = d < pr ? 1 : 1 - sm((d - pr) / edge); const i = r * T.cols + c; H[i] = H[i] + (target - H[i]) * k; } }
}
function put(kind, x, z, rot, scale) {
  if (kind === "home") { const v = HOME_KINDS.filter((k) => MODELS[k]); kind = v[Math.floor(rnd() * v.length)] || "home"; }
  const sc = scale || 1; (PLACE[kind] || (PLACE[kind] = [])).push([x, getH(x, z), z, rot || 0, sc]);
  const spec = MODEL_SPECS[kind], m = MODELS[kind]; const solid = spec.solid !== undefined ? spec.solid * sc : (m ? m.radius * (DOOR_KINDS.includes(kind) ? 0.86 : 0.7) * sc : 4);
  if (solid > 0) COLLIDERS.push([x, z, solid]);
}
const INSTSET = [], HIDDEN = new Set(); let cullAt = 0, FRAME_N = 0;
function rangeFor(kind) { const sp = MODEL_SPECS[kind], m = MODELS[kind]; if (sp.size >= 300) return 1e9; if (!sp.prop) return 2600; const h = m.height; return h < 3.5 ? 340 : h < 8 ? 700 : 1100; }
function buildInstances() {
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const kind in PLACE) { const m = MODELS[kind], list = PLACE[kind]; if (!m || !list.length) continue;
    if (MODEL_SPECS[kind].prop) for (const e of list) e[1] = getH(e[0], e[2]);
    // one packed matrix per placement; the instanced meshes are refilled from this as the camera moves
    const mats = new Float32Array(list.length * 16); list.forEach((e, i) => { p.set(e[0], e[1], e[2]); q.setFromAxisAngle(up, e[3]); s.setScalar(e[4]); mtx.compose(p, q, s); mtx.toArray(mats, i * 16); });
    const S = { kind, list, mats, insts: [], R: rangeFor(kind), rad: m.radius, h: m.height, idx: new Int32Array(list.length), n: 0 }; INSTSET.push(S);
    for (const part of m.parts) { const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length); inst.castShadow = !MODEL_SPECS[kind].prop || m.height > 3; inst.receiveShadow = true; inst.frustumCulled = false; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(inst); S.insts.push(inst); (INST[kind] || (INST[kind] = [])).push(inst); } }
  updateCulling(true);
}
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _cullCam = new THREE.PerspectiveCamera(90, 1, 0.5, 120000); let cullYaw = 0;
function updateCulling(force) {
  // cull against a wider-than-view frustum so a quick turn never shows things popping in
  _cullCam.fov = Math.min(150, camera.fov + 40); _cullCam.aspect = camera.aspect; _cullCam.updateProjectionMatrix(); _cullCam.position.copy(camera.position); _cullCam.quaternion.copy(camera.quaternion); _cullCam.updateMatrixWorld(true); cullYaw = yaw;
  _pm.multiplyMatrices(_cullCam.projectionMatrix, _cullCam.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
  const cx = camera.position.x, cz = camera.position.z; const near2 = 240 * 240;
  for (const S of INSTSET) { const list = S.list, R2 = S.R * S.R; let n = 0;
    for (let i = 0; i < list.length; i++) { const e = list[i]; const dx = e[0] - cx, dz = e[2] - cz; const d2 = dx * dx + dz * dz; if (d2 > R2) continue;
      if (d2 > near2) { const hh = S.h * e[4]; _sph.center.set(e[0], e[1] + hh * 0.5, e[2]); _sph.radius = S.rad * e[4] * 1.4 + hh * 0.6; if (!_frus.intersectsSphere(_sph)) continue; }
      if (HIDDEN.size && HIDDEN.has(S.kind + ":" + i)) continue; S.idx[n++] = i; }
    let same = !force && n === S.n; if (same) for (let k = 0; k < n; k++) if (S.idx[k] !== S.prev[k]) { same = false; break; }
    if (same) continue; if (!S.prev || S.prev.length < list.length) S.prev = new Int32Array(list.length); S.prev.set(S.idx.subarray(0, n)); S.n = n;
    for (const inst of S.insts) { const arr = inst.instanceMatrix.array; for (let k = 0; k < n; k++) { const i = S.idx[k]; arr.set(S.mats.subarray(i * 16, i * 16 + 16), k * 16); } inst.count = n; inst.instanceMatrix.needsUpdate = true; } }
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
const HUBS = [], ROADS_MAIN = [], POOLS = [], GROUND_MATS = [], MANORS = [];
const VISITED = new Set((localStorage.getItem("g1:visited") || "").split(",").filter(Boolean));
const RINGS = { list: [], next: -1, t0: 0, best: +localStorage.getItem("g1:bestrings") || 0 };
const HUNT = { coins: [], got: new Set((localStorage.getItem("g1:hunt") || "").split(",").filter(Boolean)), t0: +localStorage.getItem("g1:huntt0") || 0, done: !!localStorage.getItem("g1:huntdone") };
const LAP = { gates: [], next: -1, t0: 0, best: +localStorage.getItem("g1:bestlap") || 0 };
function nearRoad(x, z, extra) { for (const r of ROADS) { const p = r.pts; for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1]; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < r.w / 2 + (extra || 0)) return true; } } return false; }
function free(x, z, gap) {
  if (distToRunway(x, z) < 95) return false; if (nearRoad(x, z, gap + 2)) return false;
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
  for (const side of [-1, 1]) { scene.add(ribbon([[cx - sx * (len / 2 + 20) - sz * side * (w / 2 + 1.3), cz - sz * (len / 2 + 20) + sx * side * (w / 2 + 1.3)], [cx + sx * (len / 2 + 20) - sz * side * (w / 2 + 1.3), cz + sz * (len / 2 + 20) + sx * side * (w / 2 + 1.3)]], 2.4, M.walk, 0.38)); scene.add(ribbon([[cx - sx * (len / 2 + 20) - sz * side * (w / 2 + 0.15), cz - sz * (len / 2 + 20) + sx * side * (w / 2 + 0.15)], [cx + sx * (len / 2 + 20) - sz * side * (w / 2 + 0.15), cz + sz * (len / 2 + 20) + sx * side * (w / 2 + 0.15)]], 0.3, M.curb, 0.42)); }
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
  const hills = [[-170, 420, 190, 11], [560, 470, 170, 9], [-520, 920, 210, 12], [930, -330, 230, 12], [-260, -380, 140, 7], [-1000, -880, 220, 12], [-950, -150, 200, 9], [300, -820, 180, 8], [-600, 1200, 160, 8], [1080, -800, 180, 9]];
  const pads = [[Z.landing.center[0], Z.landing.center[1], 310, 60], [Z.expanse.center[0], Z.expanse.center[1], 330, 70], [0, 0, 160, 60], [-160, 1080, 300, 60], [-360, 330, 200, 40], [1040, 1260, 110, 40], [-170, 170, 340, 60], [-700, -600, 170, 40], [-800, 300, 150, 40], [285, 721, 300, 60], [600, 480, 185, 50], [33, -686, 90, 30]];
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
    for (let r = 0; r < TR.rows; r++) for (let c = 0; c < TR.cols; c++) { const x = TR.xmin + c / (TR.cols - 1) * (TR.xmax - TR.xmin), z = TR.zmin + r / (TR.rows - 1) * (TR.zmax - TR.zmin); const d = Math.hypot(x, z); const k = 1 + 2.6 * Math.min(1, Math.max(0, (d - 2200) / 5500)); const i = r * TR.cols + c; HR[i] = HR[i] > 0 ? HR[i] * k : HR[i] * 0.5; if (d > 14000) HR[i] += (d - 14000) * 0.06 * (0.6 + 0.4 * Math.sin(x * 0.0007) * Math.cos(z * 0.0009)); } }
  U = site.runway_dir; Nn = [-U[1], U[0]]; heading = Math.atan2(U[0], U[1]);
  runwayMid = [(site.runway[0][0] + site.runway[site.runway.length - 1][0]) / 2, (site.runway[0][1] + site.runway[site.runway.length - 1][1]) / 2];
  site.runway = [along(-1150, 0), along(1150, 0)]; site.zones.landing.center = [252, -497]; site.zones.landing.r = 300;
  sculptTerrain(site);
  // upsample the survey grid 2x each way so pads and roads can be graded at ~4.7 m
  { const C = T.cols, R = T.rows, C2 = C * 2 - 1, R2 = R * 2 - 1; const H2 = new Float32Array(C2 * R2);
    for (let r = 0; r < R2; r++) for (let c = 0; c < C2; c++) { const fx = c / 2, fz = r / 2; const x0 = Math.min(C - 2, Math.floor(fx)), z0 = Math.min(R - 2, Math.floor(fz)); const tx = fx - x0, tz = fz - z0; H2[r * C2 + c] = (H[z0 * C + x0] * (1 - tx) + H[z0 * C + x0 + 1] * tx) * (1 - tz) + (H[(z0 + 1) * C + x0] * (1 - tx) + H[(z0 + 1) * C + x0 + 1] * tx) * tz; }
    H = H2; T.cols = C2; T.rows = R2; }
  setLoad(0.12, "Raising the buildings"); await loadModels(); await loadCharacters(); setLoad(0.58, "Laying the ground");

  const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const texLoader = new THREE.TextureLoader(); const tex = await new Promise((res) => texLoader.load("/ground.jpg", res)); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const gmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, bumpMap: TEX.detail, bumpScale: 0.35 }); GROUND_MATS.push(gmat);
  gmat.onBeforeCompile = (sh) => { sh.uniforms.detailMap = { value: TEX.detail }; sh.uniforms.groundMap = { value: TEX.detail2 }; sh.uniforms.rockMap = { value: TEX.rock }; sh.uniforms.uLake = { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.level, LAKE.r) }; sh.uniforms.uTime = { value: 0 }; gmat.userData.sh = sh; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWN; varying vec3 vWP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWN = normalize(normal); vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vCloud = cloudShadeV(vWP.xz, uTime);").replace("#include <common>", "#include <common>\nuniform float uTime; varying float vCloud; float chashV(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float cnoiseV(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(chashV(i), chashV(i + vec2(1, 0)), f.x), mix(chashV(i + vec2(0, 1)), chashV(i + vec2(1, 1)), f.x), f.y); } float cloudShadeV(vec2 wp, float t){ vec2 q = wp * 0.0011 + vec2(t * 0.011, t * 0.004); float n = cnoiseV(q) * 0.6 + cnoiseV(q * 2.3 + 7.1) * 0.3 + cnoiseV(q * 5.1 + 3.3) * 0.1; return smoothstep(0.52, 0.72, n); }"); sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWN; varying vec3 vWP; varying float vCloud; uniform vec4 uLake; uniform float uTime; float wet = 0.0; float chash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float cnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(chash(i), chash(i + vec2(1, 0)), f.x), mix(chash(i + vec2(0, 1)), chash(i + vec2(1, 1)), f.x), f.y); } float cloudShade(vec2 wp, float t){ vec2 q = wp * 0.0011 + vec2(t * 0.011, t * 0.004); float n = cnoise(q) * 0.6 + cnoise(q * 2.3 + 7.1) * 0.3 + cnoise(q * 5.1 + 3.3) * 0.1; return smoothstep(0.52, 0.72, n); }").replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.3, wet);").replace("#include <map_fragment>", "#include <map_fragment>\n float dist = length(vViewPosition); float near = smoothstep(700.0, 40.0, dist); vec3 grd = texture2D(groundMap, vUv * 480.0).rgb; vec3 grd2 = texture2D(groundMap, vUv * 61.0 + 0.37).rgb; vec3 det = texture2D(detailMap, vUv * 1400.0).rgb; vec3 closeCol = grd * mix(vec3(1.0), grd2 * 1.6, 0.45) * mix(vec3(1.0), det * 1.5, 0.35); vec3 aerialTint = diffuseColor.rgb / vec3(0.62, 0.55, 0.45); diffuseColor.rgb = mix(diffuseColor.rgb, closeCol * 0.78 * clamp(aerialTint, 0.55, 1.15), near * 0.85); float slope = 1.0 - clamp(vWN.y, 0.0, 1.0); vec3 rock = texture2D(rockMap, vUv * 300.0).rgb; diffuseColor.rgb = mix(diffuseColor.rgb, rock, smoothstep(0.12, 0.35, slope) * 0.8); diffuseColor.rgb *= 1.0 - 0.38 * vCloud; if (length(vWP.xz - uLake.xy) < uLake.w * 1.9) { wet = smoothstep(2.4, 0.0, vWP.y - uLake.z); vec3 sandy = mix(diffuseColor.rgb, vec3(0.78, 0.7, 0.55) * grd * 1.3, smoothstep(4.5, 1.0, vWP.y - uLake.z) * 0.6); diffuseColor.rgb = mix(sandy, sandy * vec3(0.55, 0.52, 0.47), wet); if (vWP.y < uLake.z - 0.05) { float ca = pow(cnoise(vWP.xz * 3.1 + uTime * 0.55) * cnoise(vWP.xz * 4.3 - uTime * 0.45), 1.6) * 3.0; float dk = clamp((uLake.z - vWP.y) / 5.0, 0.0, 1.0); diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.85, 0.9) * (1.0 + ca * (1.0 - dk * 0.7)), 0.85); } }").replace("uniform vec3 diffuse;", "uniform vec3 diffuse; uniform sampler2D detailMap; uniform sampler2D groundMap; uniform sampler2D rockMap;"); };
  const buildGround = () => { const geo = new THREE.PlaneGeometry(W, D, T.cols - 1, T.rows - 1); geo.rotateX(-Math.PI / 2); const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, H[i]); geo.computeVertexNormals(); const ground = new THREE.Mesh(geo, gmat); ground.receiveShadow = true; ground.position.set((T.xmin + T.xmax) / 2, 0, (T.zmin + T.zmax) / 2); scene.add(ground); };
  if (HR) { const WR = TR.xmax - TR.xmin, DR = TR.zmax - TR.zmin; const rg = new THREE.PlaneGeometry(WR, DR, TR.cols - 1, TR.rows - 1); rg.rotateX(-Math.PI / 2); const ra = rg.attributes.position; for (let i = 0; i < ra.count; i++) ra.setY(i, HR[i] - 3); rg.computeVertexNormals();
    const rtex = await new Promise((res) => texLoader.load("/region_ground.jpg", res)); rtex.encoding = THREE.sRGBEncoding; rtex.anisotropy = 4;
    const rmat = new THREE.MeshStandardMaterial({ map: rtex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); GROUND_MATS.push(rmat); rmat.onBeforeCompile = (sh) => { sh.uniforms.rockMap = { value: TEX.rock }; sh.uniforms.uTime = { value: 0 }; rmat.userData.sh = sh; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vH; varying vec3 vRN; varying vec3 vRP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y; vRN = normalize(normal); vRP = (modelMatrix * vec4(transformed, 1.0)).xyz; { vec2 q = vRP.xz * 0.0011 + vec2(uTime * 0.011, uTime * 0.004); float cn = rnoiseV(q) * 0.6 + rnoiseV(q * 2.3 + 7.1) * 0.3 + rnoiseV(q * 5.1 + 3.3) * 0.1; vRC = smoothstep(0.52, 0.72, cn); }").replace("#include <common>", "#include <common>\nuniform float uTime; varying float vRC; float rhashV(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float rnoiseV(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rhashV(i), rhashV(i + vec2(1, 0)), f.x), mix(rhashV(i + vec2(0, 1)), rhashV(i + vec2(1, 1)), f.x), f.y); }"); sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vH; varying vec3 vRN; varying vec3 vRP; varying float vRC; uniform sampler2D rockMap; uniform float uTime; float rhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float rnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rhash(i), rhash(i + vec2(1, 0)), f.x), mix(rhash(i + vec2(0, 1)), rhash(i + vec2(1, 1)), f.x), f.y); }").replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.rgb *= 1.0 - 0.38 * vRC; { float band = 0.5 + 0.5 * sin(vH * 0.075 + rnoise(vRP.xz * 0.0016) * 4.0); float rocky = smoothstep(60.0, 320.0, vH); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(0.78, 0.55, 0.42), vec3(1.08, 0.92, 0.78), band), rocky * 0.55); } float slopeR = 1.0 - clamp(vRN.y, 0.0, 1.0); float scrub = texture2D(rockMap, vUv * 1100.0).g; diffuseColor.rgb *= 0.82 + 0.36 * scrub; float rk = max(smoothstep(120.0, 700.0, vH), smoothstep(0.22, 0.48, slopeR)); vec3 rock = texture2D(rockMap, vUv * 260.0).rgb * texture2D(rockMap, vUv * 41.0).rgb * 1.9; diffuseColor.rgb = mix(diffuseColor.rgb, rock * vec3(0.95, 0.85, 0.8), rk * 0.85); float snow = smoothstep(1500.0, 2100.0, vH); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93), snow * 0.7);"); };
    const regionMesh = new THREE.Mesh(rg, rmat); regionMesh.position.set((TR.xmin + TR.xmax) / 2, 0, (TR.zmin + TR.zmax) / 2); scene.add(regionMesh);
    // inner 36 km: 3x finer mesh with ridged fractal detail so the ranges read as rock, not blobs
    { const R0 = 18000, K = 3; const cw = (TR.xmax - TR.xmin) / (TR.cols - 1); const c0 = Math.max(0, Math.floor((-R0 - TR.xmin) / cw)), c1 = Math.min(TR.cols - 1, Math.ceil((R0 - TR.xmin) / cw)); const n = (c1 - c0) * K + 1;
      const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }; const sm = (t) => t * t * (3 - 2 * t);
      const vnoise = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy); return (hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx) * (1 - fy) + (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy; };
      const ridge = (x, y) => 1 - Math.abs(vnoise(x, y) * 2 - 1);
      const geo = new THREE.PlaneGeometry(2 * R0, 2 * R0, n - 1, n - 1); geo.rotateX(-Math.PI / 2); const pa = geo.attributes.position; const x0 = TR.xmin + c0 * cw;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) + 0, z = pa.getZ(i); const wx = x, wz = z; const h = sampleGrid(HR, TR, wx, wz); const relief = Math.min(1, Math.max(0, (h - 70) / 380)); const d = Math.hypot(wx, wz); const nearK = Math.min(1, Math.max(0, (d - 1400) / 1200));
        const det = (ridge(wx / 900, wz / 900) * 42 + ridge(wx / 340 + 3.1, wz / 340) * 16 + vnoise(wx / 130, wz / 130 + 9.7) * 6 - 20) * relief * nearK; pa.setY(i, h - 2.5 + det); }
      geo.computeVertexNormals(); const inner = new THREE.Mesh(geo, rmat); inner.position.set(0, 0, 0); inner.renderOrder = 0; scene.add(inner); }
    for (const [k, d, a, sc] of [["mesa", 3400, 0.35, 1.0], ["butte", 2700, 1.05, 0.8], ["mesa", 4100, 1.75, 1.35], ["mesa", 3200, 2.5, 0.9], ["butte", 2600, 3.3, 0.7], ["mesa", 3900, 4.1, 1.15], ["butte", 3000, 4.9, 0.85], ["mesa", 4500, 5.6, 1.4], ["butte", 5200, 2.1, 1.1]]) if (MODELS[k]) put(k, Math.cos(a) * d, Math.sin(a) * d, rnd() * 6.283, sc); }
  setLoad(0.66, "Painting the runway");
  scene.add(ribbon(site.runway, 30, M.asphalt, 0.35)); scene.add(ribbon(site.runway, 0.9, M.stripe, 0.55, true));
  for (const tw of site.taxiways) scene.add(ribbon(tw, 12, M.taxi, 0.3)); for (const ap of site.aprons) if (ap.length >= 3) scene.add(polygon(ap, M.apron, 0.28));
  { const L = 2300, n = Math.floor(L / 60), inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), M.rwLight, n * 2 + 2); const mt = new THREE.Matrix4(); let k = 0; for (let i = 0; i <= n; i++) for (const s of [-16.5, 16.5]) { const p = along(-L / 2 + i * 60, s); mt.makeTranslation(p[0], getH(p[0], p[1]) + 0.6, p[1]); inst.setMatrixAt(k++, mt); } inst.count = k; scene.add(inst); }

  const Z = site.zones;
  // keep-out zones for the two games (placed before anything is scattered)
  GOLF.origin = [-160, 1080]; KEEPOUT.push([GOLF.origin[0], GOLF.origin[1], 330]);
  COURSE.origin = [-360, 330]; KEEPOUT.push([COURSE.origin[0], COURSE.origin[1], 190]);
  const dirU = Math.atan2(U[1], U[0]);
  const XNE = along(-1220, 0), XSW = along(1220, 0), LND = Z.landing.center, EXP = Z.expanse.center, DSG = [600, 480], CMN = [285, 721], LK = [LAKE.x + 190, LAKE.z], FR = along(-600, 690);
  HUBS.push(["The Tower", 0, 0], ["The Landing", LND[0], LND[1]], ["Flight Line", Z.flightline.center[0], Z.flightline.center[1]], ["Main Street", EXP[0], EXP[1]], ["Design District", DSG[0], DSG[1]], ["The Commons", CMN[0], CMN[1]], ["Desert Golf", GOLF.origin[0], GOLF.origin[1]], ["Lakeside", LAKE.x, LAKE.z], ["Cart Course", COURSE.origin[0], COURSE.origin[1]], ["Sky Obby", 1040, 1260], ["Founders Row", FR[0], FR[1]]);
  // the Boulevard: one loop that touches every hub, crossing the runway at both ends, plus the apron taxiway crossing
  const roads = [
    [[0, 0], [150, -250], LND],
    [LND, along(-900, 400), along(-1120, 200), XNE],
    [XNE, [900, -300], EXP],
    [EXP, DSG], [DSG, CMN], [CMN, GOLF.origin], [GOLF.origin, XSW],
    [XSW, [LAKE.x + 260, LAKE.z + 140], LK], [LK, [-620, 460], COURSE.origin], [COURSE.origin, [-160, 160], [0, 0]],
    [along(-59, 60), along(-59, -110), [270, 300], CMN],
    [LND, [140, -600], FR], [CMN, [700, 1000], [1040, 1290]], [DSG, [1000, 620], [1040, 1290]],
  ];
  ROADS_MAIN.push(...roads);
  for (const r of roads) scene.add(ribbon(r, 9, M.dirt, 0.2));
  // hold-short bars where the boulevard crosses the runway
  for (const t of [-1220, 1220, -59]) for (const sgn of [-1, 1]) { const a = along(t, sgn * 21), b = along(t, sgn * 25); scene.add(ribbon([[a[0] - U[0] * 8, a[1] - U[1] * 8], [a[0] + U[0] * 8, a[1] + U[1] * 8]], 1.2, M.stripe, 0.5)); }
  for (const r of [[[0, 0], LND], [CMN, DSG], [COURSE.origin, [COURSE.origin[0] + 190, COURSE.origin[1] - 160]], [LND, FR], [EXP, [EXP[0] + 200, EXP[1] + 380]]]) scene.add(ribbon(r, 4, M.walk, 0.34));
  // street lamps along the boulevard
  for (const r of roads) for (let i = 0; i < r.length - 1; i++) { const [a, b] = [r[i], r[i + 1]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (let t = 30; t < L - 20; t += 46) { const sd = Math.floor(t / 46) % 2 ? 1 : -1; const x = a[0] + (b[0] - a[0]) * t / L + nx * sd * 6.2, z = a[1] + (b[1] - a[1]) * t / L + nz * sd * 6.2; if (distToRunway(x, z) < 40 || !onLand(x, z)) continue; put("lamp", x, z, Math.atan2(-nx * sd, -nz * sd)); } }
  setLoad(0.74, "Building the stages");

  for (const c of [Z.landing.center, Z.expanse.center]) { const pts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; pts.push([c[0] + Math.cos(a) * 46, c[1] + Math.sin(a) * 46]); } scene.add(polygon(pts, M.walk, 0.36)); }
  // ── THE TOWER + apron ──
  put("tower", 0, 0, 0); TERM.pos = along(-150, 262); TERM.rot = Math.atan2(-Nn[0], -Nn[1]); put(MODELS.terminal ? "terminal" : "fbo", TERM.pos[0], TERM.pos[1], TERM.rot); put("diner", -70, -10, heading);
  { const r = (MODELS.terminal || MODELS.fbo).radius; TERM.door = [TERM.pos[0] + Math.sin(TERM.rot) * (r * 0.86 + 1), TERM.pos[1] + Math.cos(TERM.rot) * (r * 0.86 + 1)]; TERM.exit = [TERM.pos[0] + Math.sin(TERM.rot) * (r * 0.86 + 9), TERM.pos[1] + Math.cos(TERM.rot) * (r * 0.86 + 9)]; GUIDE.x = TERM.door[0] + Math.cos(TERM.rot) * 5; GUIDE.z = TERM.door[1] - Math.sin(TERM.rot) * 5; }
  // apron in front of the terminal, with stand markings
  { const pts = []; for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283; pts.push([TERM.exit[0] + Math.sin(TERM.rot) * 30 + Math.cos(a) * 62, TERM.exit[1] + Math.cos(TERM.rot) * 30 + Math.sin(a) * 62]); } scene.add(polygon(pts, M.apron, 0.3)); }
  sign(30, 95, Math.PI, "GENESIS ONE", "DOUGLAS, ARIZONA · THE AWAKENING", true);
  hotspots.push({ x: 0, z: 0, r: 34, t: "The Tower", k: "Genesis One · overlook", p: "The heart of the site, on the original airport apron. Press M anywhere for the tower view of all 430 acres. Everything you see is concept: the land is real, the buildings are illustrations of what the three stages could become." });
  hotspots.push({ x: TERM.door[0], z: TERM.door[1], r: 40, t: "Douglas Municipal Terminal", k: "Arrivals · the front door", p: "Every visit starts here. Arrivals, baggage claim, check-in, four gates and the Sky Cafe are inside; the shuttle carts and Sky the tour guide wait at the door. Jets land and depart on the runway all day." });
  hotspots.push({ x: -70, z: -10, r: 26, t: "Flight Line Diner", k: "Stage 02 · The Flight Line", p: "A mid-century diner beside the apron where pilots, residents and visitors meet." });

  // ── THE FLIGHT LINE: hangar rows both sides, hangar homes behind, jets on the line ──
  for (let i = 0; i < 13; i++) { const [x, z] = along(-380 + i * 54, 118); put("hangar", x, z, heading + Math.PI / 2); if (i % 2 === 0) { const [jx, jz] = along(-380 + i * 54, 84); put("jet", jx, jz, heading + Math.PI / 2 + (rnd() - 0.5) * 0.4); } }
  for (let i = 0; i < 9; i++) { const [x, z] = along(-330 + i * 62, 182); put("hangarhome", x, z, heading + Math.PI / 2); }
  for (let i = 0; i < 5; i++) { const [x, z] = along(322 + i * 54, 118); if (Math.hypot(x - COURSE.origin[0], z - COURSE.origin[1]) < 215) continue; put("hangar", x, z, heading + Math.PI / 2); if (i % 2) { const [jx, jz] = along(322 + i * 54, 84); put("jet", jx, jz, heading + Math.PI / 2); } }
  for (let i = 0; i < 3; i++) { const [x, z] = along(240 + i * 62, 182); if (Math.hypot(x - COURSE.origin[0], z - COURSE.origin[1]) < 215) continue; put("hangarhome", x, z, heading + Math.PI / 2); }
  { const [x, z] = along(-120, 118); hotspots.push({ x, z, r: 70, t: "Hangar Row", k: "Stage 02 · The Flight Line · 52 acres", p: "Hangars line the north side of the runway with direct taxiway access, and hangar homes sit behind them so you can live above your aircraft. Press F beside a parked jet or a cart to ride." }); }
  // keep the apron in front of the terminal clear of hangars, hangar homes and parked jets
  for (const k of ["hangar", "hangarhome", "jet"]) { if (!PLACE[k]) continue; const gone = PLACE[k].filter((e) => { const t = (e[0] - runwayMid[0]) * U[0] + (e[2] - runwayMid[1]) * U[1]; return Math.abs(t + 150) < 100; }); PLACE[k] = PLACE[k].filter((e) => !gone.includes(e)); for (const e of gone) { const i = COLLIDERS.findIndex((c) => Math.abs(c[0] - e[0]) < 0.01 && Math.abs(c[1] - e[2]) < 0.01); if (i >= 0) COLLIDERS.splice(i, 1); } }
  { const [x, z] = along(140, 160); put("solar", x, z, heading); put("windmill", x + 40, z + 20, 0); }
  { const [x, z] = along(-470, 118); sign(x, z, heading + Math.PI / 2, "THE FLIGHT LINE", "STAGE 02 · AVIATION"); }
  zoneRings.push({ ...Z.flightline, k: "Stage 02 · 52 acres" });

  // ── THE LANDING: two ring roads with homes, clubhouse in the middle, tent, chapel, amphitheater ──
  { const c = Z.landing.center;
    put("clubhouse", c[0], c[1], heading + 0.3); put("restaurant", c[0] + 62, c[1] + 10, heading + 0.3 + Math.PI / 2);
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
    scatter("home", c[0], c[1], 330, 30, 14, () => 0.85 + rnd() * 0.35, null, 262); scatter("dome", c[0] + 140, c[1] - 110, 60, 8, 6, () => 0.7 + rnd() * 0.6); buildLots(c, FR, dirU); }
  zoneRings.push({ ...Z.landing, k: "Stage 01 · 66 acres" });

  zoneRings.push({ ...Z.expanse, k: "Stage 03 · 318 acres" });
  // ── THE EXPANSE: a street grid of Old West blocks, homes around, design district ──
  { const c = Z.expanse.center; const dir = heading + Math.PI / 2, dx = Math.cos(dir), dz = Math.sin(dir), px = Math.cos(dir + Math.PI / 2), pz = Math.sin(dir + Math.PI / 2);
    street(c[0], c[1], dir, 360, ["store", "saloon", "bank", "hotel", "store", "restaurant", "saloon", "store"], 30, true);
    street(c[0] + px * 110, c[1] + pz * 110, dir, 300, ["store", "hotel", "saloon", "store", "gallery", "store"], 32, true);
    street(c[0] - px * 110, c[1] - pz * 110, dir, 300, ["home", "home", "store", "home", "saloon", "home"], 28, true);
    street(c[0] + dx * 150, c[1] + dz * 150, dir + Math.PI / 2, 240, ["store", "hotel", "saloon", "store", "barn"], 32, true);
    street(c[0] - dx * 150, c[1] - dz * 150, dir + Math.PI / 2, 240, ["home", "store", "home", "saloon"], 30, true);
    const e = [c[0] - dx * 230, c[1] - dz * 230]; sign(e[0], e[1], dir + Math.PI, "THE EXPANSE", "STAGE 03 · HOSPITALITY & DESIGN");
    hotspots.push({ x: c[0], z: c[1], r: 70, t: "Main Street", k: "Stage 03 · The Expanse · 318 acres", p: "Old West frontier storefronts on a grid of dirt streets: hospitality, commerce and gathering places for the community and its visitors." });
    const art = DSG; buildDesignDistrict(art, dir + Math.PI / 2);
    hotspots.push({ x: art[0], z: art[1], r: 60, t: "The Design District", k: "Stage 03 · The Expanse", p: "An artist design district on a raised gallery walk: a tensile gallery pavilion, lit domes and the tent, with monumental sculptures placed on the land on both sides of the boardwalk." });
    put("amphitheater", 980, 560, dir + 2); put("solar", c[0] - 330, c[1] - 60, dir); put("solar", c[0] - 330, c[1] - 30, dir);
    put("windmill", 1120, 40, 0); put("chapel", c[0] + 210, c[1] - 200, dir + 1); put("observatory", 1080, -120, 0);
    KEEPOUT.push([CMN[0], CMN[1], 330]);
    scatter("home", c[0], c[1], 420, 70, 14, () => 0.85 + rnd() * 0.35, null, 235); scatter("dome", 1050, 600, 80, 14, 6, () => 0.7 + rnd() * 0.6); scatter("pavilion", c[0] - 260, c[1] - 200, 90, 4, 8, () => 0.8 + rnd() * 0.5); }
  zoneRings.push({ name: "Design District", center: DSG, r: 170, k: "Stage 03 · gallery walk" });
  // ── THE COMMONS: glamping village with a central pavilion, pool homes on a ring road, the flagship pavilion on the rise ──
  { const c = CMN; KEEPOUT.pop();
    ring(c[0], c[1], 165, ["villa", "home", "villa", "ranch", "home", "dome"], 24, true);
    put(MODELS.pavilion ? "pavilion" : "bigtent", c[0], c[1], heading + 0.5);
    for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + 0.2; const rr = i % 2 ? 60 : 92; const x = c[0] + Math.cos(a) * rr, z = c[1] + Math.sin(a) * rr; put(MODELS.glamp ? "glamp" : "dome", x, z, Math.atan2(c[0] - x, c[1] - z), 0.9 + rnd() * 0.25); if (i % 2 === 0) scene.add(ribbon([[c[0] + Math.cos(a) * 22, c[1] + Math.sin(a) * 22], [x - Math.cos(a) * 10, z - Math.sin(a) * 10]], 2.4, M.deck, 0.36)); }
    { const pl = []; for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; pl.push([c[0] + Math.cos(a) * 26, c[1] + Math.sin(a) * 26]); } scene.add(polygon(pl, M.walk, 0.36)); for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + 0.3; put("lamp", c[0] + Math.cos(a) * 28, c[1] + Math.sin(a) * 28, -a); } }
    if (MODELS.flagship) put("flagship", c[0] + 250, c[1] - 110, Math.atan2(-250, 110));
    sign(c[0] - 215, c[1] - 130, Math.atan2(215, 130), "THE COMMONS", "STAGE 03 · GLAMPING VILLAGE & POOL HOMES");
    hotspots.push({ x: c[0], z: c[1], r: 50, t: "The Commons", k: "Stage 03 · The Expanse", p: "A glamping village around a tensile pavilion: tent cabins on timber decks, pool homes on the ring road, and the flagship pavilion on the rise to the east. Every tent opens." });
    if (MODELS.flagship) hotspots.push({ x: c[0] + 250, z: c[1] - 110, r: 34, t: "The Flagship Pavilion", k: "Stage 03 · signature stay", p: "The signature villa of the Expanse: a tensile shell over cedar, a round deck, a fire pit and an infinity pool looking back over the village." });
    zoneRings.push({ name: "The Commons", center: c, r: 210, k: "glamping village · pool homes" });
    KEEPOUT.push([c[0], c[1], 130]); scatter("home", c[0], c[1], 320, 22, 16, () => 0.85 + rnd() * 0.35, null, 215); }

  // ── the rest of the land: ranch cluster, glamping domes, homesteads along the connector roads ──
  { const rc = [-700, -600]; put("barn", rc[0], rc[1], 0.4); put("barn", rc[0] + 60, rc[1] + 30, 2.2); put("windmill", rc[0] + 30, rc[1] - 40, 0); put("home", rc[0] - 50, rc[1] + 40, 1.1); scatter("home", rc[0], rc[1], 160, 10, 14, () => 0.9 + rnd() * 0.3);
    hotspots.push({ x: rc[0], z: rc[1], r: 60, t: "The Ranch", k: "Working desert", p: "A working ranch on the north edge of the property: horses, hay and the community's own produce." }); }
  { const gc = [-800, 300]; scatter("dome", gc[0], gc[1], 140, 18, 6, () => 0.7 + rnd() * 0.5); put("pavilion", gc[0], gc[1], 0.3); hotspots.push({ x: gc[0], z: gc[1], r: 60, t: "Glamping Field", k: "Stay a night", p: "Geodesic dome stays for visitors who want the desert night without a house of their own yet." }); }
  for (const r0 of roads.slice(0, 10)) for (let q = 0; q < r0.length - 1; q++) { const r = [r0[q], r0[q + 1]]; const [a, b] = r; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 60; t < L - 60; t += 70) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (const s of [-1, 1]) { if (rnd() < 0.55) continue; const hx = x + nx * s * 18, hz = z + nz * s * 18; if (distToRunway(hx, hz) < 140 || !free(hx, hz, 4)) continue; put(rnd() < 0.8 ? "home" : "dome", hx, hz, Math.atan2(-nx * s, -nz * s), 0.85 + rnd() * 0.35); } } }
  scatter("home", 0, 0, 1050, 40, 16, () => 0.85 + rnd() * 0.35, null, 380); scatter("dome", 0, 0, 1050, 12, 8, () => 0.7 + rnd() * 0.6, null, 380); scatter("pavilion", 0, 0, 1000, 6, 10, () => 0.8 + rnd() * 0.5); scatter("windmill", 0, 0, 1000, 5, 20);
  hotspots.push({ x: runwayMid[0] + Nn[0] * 40, z: runwayMid[1] + Nn[1] * 40, r: 70, t: "Runway 03/21", k: "6,000 ft · Douglas Municipal", p: "The real runway, traced from survey data. Douglas Municipal opened in 1928 as one of the first international airports in the United States." });

  setLoad(0.8, "Building home base, the obby and the games");
  buildHome(); buildObby(); buildCourse(); buildDrag(); buildGolf(); buildDetails(); buildFauna(); buildGuide();
  setLoad(0.88, "Planting the desert");
  scatter("saguaro", 0, 0, 1050, 700, 2, () => 0.6 + rnd() * 0.9); scatter("paloverde", 0, 0, 1050, 480, 3, () => 0.7 + rnd() * 0.8);
  if (MODELS.bush1) scatter("bush1", 0, 0, 1080, 4200, 0.3, () => 0.6 + rnd() * 1.1); if (MODELS.bush2) scatter("bush2", 0, 0, 1080, 3400, 0.3, () => 0.6 + rnd() * 1.1); if (MODELS.mesquite) scatter("mesquite", 0, 0, 1050, 260, 3, () => 0.8 + rnd() * 0.6); if (MODELS.ocotillo) scatter("ocotillo", 0, 0, 1050, 320, 1, () => 0.7 + rnd() * 0.8); if (MODELS.boulder) scatter("boulder", 0, 0, 1050, 160, 3, () => 0.5 + rnd() * 1.6);
  dedupeBuildings(); addPools(); buildLake(); flattenPads(); buildInstances(); buildGround(); buildPoolMeshes(); buildMinigames(); for (const f of DEFER) f(); DEFER.length = 0; buildWater(); buildFX(); initPost();
  // door portals: a lit frame and a mat at every enterable door
  { const portals = []; for (const kind of DOOR_KINDS) for (const e of PLACE[kind] || []) { if (!MODELS[kind]) continue; const rr = MODELS[kind].radius * e[4]; portals.push([e[0] + Math.sin(e[3]) * rr * 0.86, e[1], e[2] + Math.cos(e[3]) * rr * 0.86, e[3]]); }
    const matG = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.06, 1.4), new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 1 }), portals.length); const frameG = new THREE.InstancedMesh(new THREE.TorusGeometry(1.35, 0.05, 6, 24, Math.PI), M.green, portals.length); const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    portals.forEach((pp, i) => { q.setFromAxisAngle(up, pp[3]); mt.compose(new THREE.Vector3(pp[0] + Math.sin(pp[3]) * 0.9, pp[1] + 0.06, pp[2] + Math.cos(pp[3]) * 0.9), q, new THREE.Vector3(1, 1, 1)); matG.setMatrixAt(i, mt); mt.compose(new THREE.Vector3(pp[0], pp[1] + 0.1, pp[2]), q, new THREE.Vector3(1, 1, 1)); frameG.setMatrixAt(i, mt); });
    scene.add(matG); scene.add(frameG); DETAILS.portals = frameG; }
  // soft contact shadow under every building so it sits on the ground
  { const geo = new THREE.CircleGeometry(1, 20); geo.rotateX(-Math.PI / 2); let n = 0; for (const k in PLACE) if (!MODEL_SPECS[k].prop && !MODEL_SPECS[k].vehicle) n += PLACE[k].length;
    const sh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), n); const mt = new THREE.Matrix4(); let i = 0;
    for (const k in PLACE) { if (MODEL_SPECS[k].prop || MODEL_SPECS[k].vehicle || !MODELS[k]) continue; const r = MODELS[k].radius; for (const e of PLACE[k]) { mt.makeScale(r * e[4] * 1.15, 1, r * e[4] * 1.15); mt.setPosition(e[0], e[1] + 0.12, e[2]); sh.setMatrixAt(i++, mt); } } sh.count = i; scene.add(sh); }
  // windmill wheels that actually turn
  DETAILS.wheels = []; for (const e of PLACE.windmill || []) { const g = new THREE.Group(); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 10), M.steel); hub.rotation.x = Math.PI / 2; g.add(hub); for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.03), M.steel); b.position.set(Math.cos(i / 12 * 6.283) * 1.1, Math.sin(i / 12 * 6.283) * 1.1, 0); b.rotation.z = i / 12 * 6.283 + Math.PI / 2; g.add(b); } const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.05, 6, 32), M.steel); g.add(ring); g.position.set(e[0], e[1] + 12.2, e[2] + 0.9); scene.add(g); DETAILS.wheels.push(g); }
  // grass tufts: crossed alpha planes, thousands of them, swaying
  { const c = document.createElement("canvas"); c.width = 128; c.height = 128; const x = c.getContext("2d"); for (let i = 0; i < 26; i++) { x.strokeStyle = `hsl(${70 + Math.random() * 30},${35 + Math.random() * 25}%,${38 + Math.random() * 22}%)`; x.lineWidth = 2 + Math.random() * 2; x.beginPath(); x.moveTo(64 + (Math.random() - 0.5) * 30, 128); x.quadraticCurveTo(64 + (Math.random() - 0.5) * 70, 70, 64 + (Math.random() - 0.5) * 110, 10 + Math.random() * 40); x.stroke(); }
    const tuft = new THREE.CanvasTexture(c); tuft.encoding = THREE.sRGBEncoding; const tm = new THREE.MeshStandardMaterial({ map: tuft, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }); addSway(tm, 1.6);
    const pg = new THREE.PlaneGeometry(1.4, 1.1); pg.translate(0, 0.55, 0); const pg2 = pg.clone(); pg2.rotateY(Math.PI / 2); const tg = THREE.BufferGeometryUtils ? THREE.BufferGeometryUtils.mergeBufferGeometries([pg, pg2]) : pg;
    const tufts = new THREE.InstancedMesh(tg, tm, 14000); const mt2 = new THREE.Matrix4(); let kt = 0;
    for (let i = 0; i < 70000 && kt < 14000; i++) { const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D; if (distToRunway(x, z) < 40 || Math.hypot(x, z) < 70 || nearRoad(x, z, 1.5)) continue; let ko = false; for (const kk of KEEPOUT) if (Math.hypot(kk[0] - x, kk[1] - z) < kk[2] * 0.7) ko = true; if (ko) continue; const sc = 0.6 + rnd() * 1.1; mt2.makeRotationY(rnd() * 6.283); mt2.scale(new THREE.Vector3(sc, sc, sc)); mt2.setPosition(x, getH(x, z), z); tufts.setMatrixAt(kt++, mt2); }
    tufts.count = kt; tufts.frustumCulled = false; scene.add(tufts);
    if (!THREE.BufferGeometryUtils) { const t2 = new THREE.InstancedMesh(pg2, tm, kt); for (let i = 0; i < kt; i++) { tufts.getMatrixAt(i, mt2); t2.setMatrixAt(i, mt2); } t2.frustumCulled = false; scene.add(t2); } }
  // rocks
  { const rockMat = new THREE.MeshStandardMaterial({ color: 0x8f7d68, roughness: 1, flatShading: true }); const rg = new THREE.DodecahedronGeometry(1, 0); const rocks = new THREE.InstancedMesh(rg, rockMat, 700); const mt3 = new THREE.Matrix4(); let kr = 0;
    for (let i = 0; i < 6000 && kr < 700; i++) { const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D; if (distToRunway(x, z) < 60 || Math.hypot(x, z) < 90 || !free(x, z, 2)) continue; const sc = 0.3 + rnd() * rnd() * 2.2; mt3.makeRotationFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); mt3.scale(new THREE.Vector3(sc * (0.8 + rnd() * 0.6), sc * 0.7, sc)); mt3.setPosition(x, getH(x, z) + sc * 0.25, z); rocks.setMatrixAt(kr++, mt3); if (sc > 1.2) COLLIDERS.push([x, z, sc * 0.8]); }
    rocks.count = kr; scene.add(rocks); }
  const scrubGeo = new THREE.IcosahedronGeometry(1, 0); scrubGeo.scale(1, 0.7, 1); const inst = new THREE.InstancedMesh(scrubGeo, M.scrub, MODELS.bush1 ? 1 : 2200); const mtx = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 12000 && k < 2200; i++) { const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D; if (distToRunway(x, z) < 50 || Math.hypot(x, z) < 90 || nearRoad(x, z, 2)) continue; let ko = false; for (const kk of KEEPOUT) if (Math.hypot(kk[0] - x, kk[1] - z) < kk[2]) ko = true; if (ko) continue; const s = 0.8 + rnd() * 1.6; mtx.makeRotationY(rnd() * 6.283); mtx.scale(new THREE.Vector3(s, s, s)); mtx.setPosition(x, getH(x, z) + s * 0.5, z); inst.setMatrixAt(k++, mtx); }
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
  if (!golf.playing && !DRAG.showing && near) gameHud("course");
  if (near && !golf.playing) { $("#game-n").textContent = "CART COURSE"; $("#game-big").textContent = COURSE.running ? ((performance.now() - COURSE.t0) / 1000).toFixed(2) + " s" : "cross the green gate"; $("#game-s").textContent = (COURSE.running ? `next gate ${COURSE.next === 0 ? "finish" : COURSE.next} of ${COURSE.gates.length - 1}` : "") + (COURSE.best ? ` · best ${(COURSE.best / 1000).toFixed(2)} s` : ""); }
}

// ───────────────────────────── desert golf ─────────────────────────────
const golf = { playing: false, hole: 0, strokes: 0, total: 0, card: [], holes: [], ball: new THREE.Vector3(), vel: new THREE.Vector3(), moving: false, air: false, aim: 0, power: 0, charging: false, club: 0, ballMesh: null, arrow: null, last: new THREE.Vector3(), swing: 0, holed: 0 };
const GOLF = { origin: null };
const CLUBS = [["Driver", 66, 12], ["3 Wood", 58, 17], ["5 Iron", 47, 25], ["9 Iron", 37, 40], ["Wedge", 27, 54], ["Putter", 13, 0]];
function segDist(x, z, a, b) { const vx = b[0] - a[0], vz = b[1] - a[1]; const L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / L2)); return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)); }
function golfSurface(x, z) {
  for (const h of golf.holes) { if (Math.hypot(x - h.green[0], z - h.green[1]) < h.green[2]) return "green"; for (const b of h.bunkers) if (Math.hypot(x - b[0], z - b[1]) < b[2]) return "sand"; }
  for (const h of golf.holes) for (let i = 0; i < h.pts.length - 1; i++) if (segDist(x, z, h.pts[i], h.pts[i + 1]) < h.w / 2) return "fairway";
  return "rough";
}
function buildGolf() {
  const o = GOLF.origin; golf.base = getH(o[0], o[1]);
  const defs = [[3, 120, 0], [4, 190, 0.35], [3, 100, 0], [4, 200, -0.4], [5, 235, 0.3], [3, 130, 0]];
  const turf2 = new THREE.MeshStandardMaterial({ map: TEX.turf, color: 0xbfe2a0, roughness: 1 });
  defs.forEach(([par, len, dog], i) => {
    const a = i / 6 * 6.283 + 0.3; const tee = [o[0] + Math.cos(a) * 40, o[1] + Math.sin(a) * 40]; const dir = a;
    const mid = [tee[0] + Math.cos(dir) * len * 0.55, tee[1] + Math.sin(dir) * len * 0.55]; const gdir = dir + dog; const green = [mid[0] + Math.cos(gdir) * len * 0.45, mid[1] + Math.sin(gdir) * len * 0.45];
    const pts = dog ? [tee, mid, green] : [tee, green]; const h = { i, par, len, tee, pts, w: 24, green: [green[0], green[1], 11], cup: [green[0] + Math.cos(gdir) * 3, green[1] + Math.sin(gdir) * 2], bunkers: [], dir };
    for (let k = 0; k < (par === 3 ? 1 : 2); k++) { const t = 0.65 + k * 0.2; const side = k % 2 ? 1 : -1; const bx = tee[0] + Math.cos(dir) * len * t + Math.cos(dir + Math.PI / 2) * side * 16, bz = tee[1] + Math.sin(dir) * len * t + Math.sin(dir + Math.PI / 2) * side * 16; h.bunkers.push([bx, bz, 5 + k * 2]); }
    scene.add(ribbon(pts, h.w, M.turf, 0.3)); const gp = []; for (let k = 0; k < 28; k++) { const ga = k / 28 * 6.283; gp.push([green[0] + Math.cos(ga) * 11, green[1] + Math.sin(ga) * 11]); } scene.add(polygon(gp, turf2, 0.34));
    for (const b of h.bunkers) { const bp = []; for (let k = 0; k < 20; k++) { const ga = k / 20 * 6.283; bp.push([b[0] + Math.cos(ga) * b[2], b[1] + Math.sin(ga) * b[2]]); } scene.add(polygon(bp, M.sand, 0.33)); }
    const tb = box(4, 0.25, 3, turf2, tee[0], getH(tee[0], tee[1]) + 0.35, tee[1], -dir); scene.add(tb);
    const cupY = getH(h.cup[0], h.cup[1]) + 0.36; const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide })); cup.position.set(h.cup[0], cupY - 0.15, h.cup[1]); scene.add(cup); const lip = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xf5f1e6 })); lip.rotation.x = -Math.PI / 2; lip.position.set(h.cup[0], cupY + 0.005, h.cup[1]); scene.add(lip);
    const pole = box(0.05, 2.4, 0.05, M.steel, h.cup[0], cupY + 1.2, h.cup[1]); scene.add(pole); const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ map: textTexture([{ text: String(i + 1), size: 150, y: 0.6 }], 256, 160, { bg: "#ff3b30" }), side: THREE.DoubleSide })); fl.position.set(h.cup[0] + 0.47, cupY + 2.1, h.cup[1]); scene.add(fl); h.flag = fl;
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), new THREE.MeshBasicMaterial({ map: textTexture([{ text: `HOLE ${i + 1}`, size: 90, y: 0.36 }, { text: `PAR ${par} · ${len} M`, size: 44, y: 0.74, color: "#4DDE6F", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 240, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); sg.position.set(tee[0] - Math.cos(dir + Math.PI / 2) * 3, getH(tee[0], tee[1]) + 1.4, tee[1] - Math.sin(dir + Math.PI / 2) * 3); sg.rotation.y = -dir + Math.PI / 2; scene.add(sg); scene.add(box(0.08, 1.2, 0.08, M.post, sg.position.x, sg.position.y - 0.9, sg.position.z));
    golf.holes.push(h);
  });
  put("clubhouse", o[0], o[1], 0.3); put("lamp", o[0] + 22, o[1] + 4, 0); put("lamp", o[0] - 22, o[1] - 4, 0); put("cart", o[0] + 26, o[1] + 12, 1.2); put("cart", o[0] + 30, o[1] + 12, 1.2);
  sign(o[0], o[1] - 60, 0, "DESERT GOLF", "SIX HOLES · PRESS E AT THE FIRST TEE");
  hotspots.push({ x: golf.holes[0].tee[0], z: golf.holes[0].tee[1], r: 14, t: "Desert Golf", k: "Six holes · par 22", p: "A real course on the desert: fairways, greens, bunkers and rough that all play differently. Pick a club with 1 to 6 or the mouse wheel, aim with A and D or the mouse, hold space to load the swing and release to hit. Everyone on the site sees your ball. Lowest total goes on the board (L).", play: "golf" });
  golf.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })); golf.ballMesh.visible = false; scene.add(golf.ballMesh);
  const arrowGeo = new THREE.ConeGeometry(0.22, 1.2, 8); arrowGeo.rotateX(Math.PI / 2); golf.arrow = new THREE.Mesh(arrowGeo, M.green); golf.arrow.visible = false; scene.add(golf.arrow);
  golf.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); golf.shadow.rotation.x = -Math.PI / 2; golf.shadow.visible = false; scene.add(golf.shadow);
}
function golfStart() { golf.playing = true; golf.hole = 0; golf.total = 0; golf.card = []; golfTee(); $("#game").classList.add("on"); $("#power").style.display = "block"; closeCards(); if (cartMode) toggleCart(); if (inside) leaveInterior(); }
function golfTee() { const h = golf.holes[golf.hole]; golf.ball.set(h.tee[0], getH(h.tee[0], h.tee[1]) + 0.5 + 0.16, h.tee[1]); golf.vel.set(0, 0, 0); golf.moving = false; golf.air = false; golf.aim = Math.atan2(h.cup[0] - h.tee[0], h.cup[1] - h.tee[1]); golf.strokes = 0; golf.club = h.par === 3 && h.len < 140 ? 2 : 0; golf.ballMesh.visible = true; golf.arrow.visible = true; golf.shadow.visible = true; golf.last.copy(golf.ball); golfSync(true); }
function golfEnd(quit) {
  if (!quit) { act({ t: "score", game: "golf", v: golf.total }); logLine("Desert Golf", `${player.userData.name} finished 6 holes in ${golf.total} (${golf.total - 22 >= 0 ? "+" : ""}${golf.total - 22})`); }
  golf.playing = false; golf.ballMesh.visible = false; golf.arrow.visible = false; golf.shadow.visible = false; $("#game").classList.remove("on"); $("#power").style.display = "none"; act({ t: "ball", b: null }); if (player.userData.legs) player.userData.arms.forEach((a) => (a.rotation.x = 0));
}
let lastBallSync = 0;
function golfSync(force) { const now = performance.now(); if (!force && now - lastBallSync < 250) return; lastBallSync = now; act({ t: "ball", b: { x: +golf.ball.x.toFixed(2), z: +golf.ball.z.toFixed(2), h: golf.hole } }); }
function golfSelectClub(i) { golf.club = Math.max(0, Math.min(CLUBS.length - 1, i)); sfx("ui"); }
addEventListener("wheel", (e) => { if (golf.playing && !golf.moving) golfSelectClub(golf.club + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });
function updateGolf(dt) {
  if (!golf.playing) return; const h = golf.holes[golf.hole]; const b = golf.ball; const cupY = getH(h.cup[0], h.cup[1]) + 0.36;
  if (!golf.moving) {
    if (keys.KeyA || keys.ArrowLeft) golf.aim += 1.2 * dt; if (keys.KeyD || keys.ArrowRight) golf.aim -= 1.2 * dt; if (joy.active) golf.aim -= joy.dx * 1.2 * dt;
    if (keys.Space) { golf.charging = true; golf.power = Math.min(1, golf.power + dt * 0.7); }
    else if (golf.charging) { golf.charging = false; const [name, v0, loft] = CLUBS[golf.club]; const pw = Math.max(0.12, golf.power); const v = v0 * pw; const lf = loft * Math.PI / 180; const sp = golfSurface(b.x, b.z); const pen = sp === "sand" ? 0.6 : sp === "rough" ? 0.85 : 1;
      golf.vel.set(Math.sin(golf.aim) * v * Math.cos(lf) * pen, golf.club === 5 ? 0 : v * Math.sin(lf) * pen, Math.cos(golf.aim) * v * Math.cos(lf) * pen); golf.air = golf.club !== 5; golf.moving = true; golf.strokes++; golf.power = 0; golf.swing = 0.45; golf.last.copy(b); sfx(golf.club === 5 ? "putt" : "swing"); }
  }
  $("#power").querySelector("i").style.width = Math.round(golf.power * 100) + "%";
  if (golf.moving) {
    const steps = 6; for (let sI = 0; sI < steps; sI++) { const sdt = dt / steps; const ground = getH(b.x, b.z) + 0.32 + 0.16; const sp = golfSurface(b.x, b.z);
      if (golf.air) { golf.vel.y -= 9.8 * sdt; const spd = golf.vel.length(); golf.vel.multiplyScalar(Math.max(0, 1 - 0.0045 * spd * sdt)); b.addScaledVector(golf.vel, sdt);
        if (b.y <= ground) { b.y = ground; const e = sp === "green" ? 0.35 : sp === "sand" ? 0.12 : sp === "rough" ? 0.28 : 0.42; golf.vel.y = -golf.vel.y * e; golf.vel.x *= sp === "sand" ? 0.35 : 0.72; golf.vel.z *= sp === "sand" ? 0.35 : 0.72; if (golf.vel.y < 1.4) { golf.vel.y = 0; golf.air = false; } } }
      else { const gx = (getH(b.x + 0.4, b.z) - getH(b.x - 0.4, b.z)) / 0.8, gz = (getH(b.x, b.z + 0.4) - getH(b.x, b.z - 0.4)) / 0.8; golf.vel.x -= gx * 9.8 * sdt * 0.9; golf.vel.z -= gz * 9.8 * sdt * 0.9;
        const fr = sp === "green" ? 0.85 : sp === "fairway" ? 1.7 : sp === "sand" ? 7.5 : 3.4; const spd = Math.hypot(golf.vel.x, golf.vel.z); if (spd > 0) { const ns = Math.max(0, spd - fr * sdt); golf.vel.x *= ns / spd; golf.vel.z *= ns / spd; }
        b.x += golf.vel.x * sdt; b.z += golf.vel.z * sdt; b.y = ground;
        const dc = Math.hypot(b.x - h.cup[0], b.z - h.cup[1]); if (dc < 1.0 && spd < 3) { golf.vel.x -= (b.x - h.cup[0]) / dc * 2.5 * sdt; golf.vel.z -= (b.z - h.cup[1]) / dc * 2.5 * sdt; }
        if (dc < 0.34 && spd < 4.5) { golf.moving = false; golf.vel.set(0, 0, 0); golf.holed = 1; b.set(h.cup[0], cupY - 0.2, h.cup[1]); golf.total += golf.strokes; golf.card.push(golf.strokes); sfx("coin"); logLine("Desert Golf", `${player.userData.name} holed ${golf.hole + 1} in ${golf.strokes} (par ${h.par})`); setTimeout(() => { if (!golf.playing) return; if (golf.hole < 5) { golf.hole++; golfTee(); } else golfEnd(false); }, 1600); return; }
        if (spd < 0.25 && !golf.air) { golf.moving = false; golf.vel.set(0, 0, 0); if (golf.strokes >= 12) { golf.total += 12; golf.card.push(12); if (golf.hole < 5) { golf.hole++; golfTee(); } else golfEnd(false); return; } } }
      if (Math.hypot(b.x - GOLF.origin[0], b.z - GOLF.origin[1]) > 330 || !onLand(b.x, b.z)) { b.copy(golf.last); golf.vel.set(0, 0, 0); golf.moving = false; golf.air = false; golf.strokes++; logLine("Desert Golf", "out of bounds, one stroke penalty"); break; }
    }
    golfSync();
  }
  golf.ballMesh.position.copy(b); golf.shadow.position.set(b.x, getH(b.x, b.z) + 0.335, b.z);
  golf.arrow.visible = !golf.moving; const ang = golf.aim; golf.arrow.position.set(b.x + Math.sin(ang) * 1.2, b.y, b.z + Math.cos(ang) * 1.2); golf.arrow.rotation.y = ang;
  // the golfer stands beside the ball, facing across the line, and swings
  if (!golf.moving) { const side = ang + Math.PI / 2; player.position.set(b.x - Math.sin(side) * 0.75, getH(b.x, b.z) + 0.32, b.z - Math.cos(side) * 0.75); player.rotation.y = side; yaw = ang; }
  const arms = player.userData.legs ? player.userData.arms : null; if (arms) { if (golf.charging) { const back = -1.6 * golf.power; arms[0].rotation.x = back; arms[1].rotation.x = back; } else if (golf.swing > 0) { golf.swing -= dt; const k = golf.swing / 0.45; const fw = 1.8 * Math.sin((1 - k) * Math.PI); arms[0].rotation.x = fw; arms[1].rotation.x = fw; } else { arms[0].rotation.x = -0.35; arms[1].rotation.x = -0.35; } }
  const dist = Math.hypot(b.x - h.cup[0], b.z - h.cup[1]); const sp = golfSurface(b.x, b.z);
  $("#game-n").textContent = `DESERT GOLF · HOLE ${golf.hole + 1} · PAR ${h.par}`; $("#game-big").textContent = `${golf.strokes} stroke${golf.strokes === 1 ? "" : "s"} · ${Math.round(dist)} m to the pin`; $("#game-s").textContent = `${CLUBS[golf.club][0]} (1-6 or wheel) · ${sp} · A D aim · hold space to swing · total ${golf.total} · Esc quits`;
}
const balls = new Map();
function updateBalls() { if (!view) return; for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; let m = balls.get(id); if (p.ball) { if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((parseInt(id.slice(0, 6), 36) % 360) / 360, 0.6, 0.55) })); scene.add(m); balls.set(id, m); } m.position.set(p.ball.x, getH(p.ball.x, p.ball.z) + 0.48, p.ball.z); m.visible = true; } else if (m) m.visible = false; } }

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
  if (player) { sun.target.position.copy(player.position); sun.position.copy(player.position).addScaledVector(sdir, 700); if (sun.position.y < player.position.y + 40) sun.position.y = player.position.y + 40; } else { sun.position.copy(sdir).multiplyScalar(900); sun.position.y = Math.max(sun.position.y, 30); }
  sun.castShadow = day > 0.05;
  sun.intensity = 1.45 * day; sun.color.setHSL(0.09 - 0.03 * dusk, 0.55 + 0.35 * dusk, 0.55 + 0.35 * Math.min(1, Math.max(0, el)));
  moon.intensity = 0.55 * night; hemi.intensity = 0.42 * day + 0.22; hemi.color.setHSL(0.6, 0.35, 0.55 + 0.35 * day);
  renderer.toneMappingExposure = 0.9 - 0.22 * night; POST.exposure = 0.9 - 0.22 * night; stars.material.opacity = Math.max(0, night - 0.35) * 1.4 * (0.85 + 0.15 * Math.sin(performance.now() * 0.006)); stars.material.size = 80 + 20 * Math.sin(performance.now() * 0.0041);
  const cl = 0.25 + 0.75 * day; cloudA.material.color.setRGB(cl, cl, cl + 0.03 * day).lerp(hor, 0.35 * (1 - Math.min(1, Math.max(0, el)))); cloudB.material.color.copy(cloudA.material.color);
  cloudA.material.opacity = 0.55 * (0.1 + 0.9 * day); cloudB.material.opacity = 0.35 * (0.1 + 0.9 * day); cloudA.material.map.offset.x += dt * 0.004; cloudA.material.map.offset.y += dt * 0.0012; cloudB.material.map.offset.x += dt * 0.0022; cloudB.material.map.offset.y -= dt * 0.0008; skyMat.uniforms.uShift.value += dt * 0.0016; for (const c of DETAILS.cumulus || []) { c.position.x += dt * 2.4; if (c.position.x > 30000) c.position.x = -30000; c.material.opacity = 0.8 * day; }
  const glow = Math.max(0, night - 0.2) / 0.8; for (const m of buildingMats) m.emissiveIntensity = 0.45 * glow;
  if (DETAILS.portals) DETAILS.portals.material === M.green || 0;
  M.lampGlow.emissiveIntensity = 2.5 * glow; if (DETAILS.bulbs) DETAILS.bulbs.emissiveIntensity = 2.2 * glow; if (DETAILS.halo) DETAILS.halo.material.opacity = 0.7 * glow; M.rwLight.emissiveIntensity = 3 * glow; M.rwLightB.emissiveIntensity = 3 * glow; M.green.emissiveIntensity = 0.4 + 1.6 * night;
  { const sp = new THREE.Vector3().copy(sdir).multiplyScalar(5000).add(camera.position); const v = sp.clone().project(camera); const front = v.z < 1 && sdir.dot(new THREE.Vector3().copy(camera.getWorldDirection(new THREE.Vector3()))) > 0; POST.sunUV.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5); const inView = front && Math.abs(v.x) < 1.6 && Math.abs(v.y) < 1.6; const target = inView && el > -0.08 ? Math.min(1, (el + 0.08) / 0.2) * (1 - Math.max(0, Math.abs(v.x) - 1) / 0.6) * (1 - Math.max(0, Math.abs(v.y) - 1) / 0.6) : 0; POST.sunVis += (target - POST.sunVis) * Math.min(1, dt * 6);
    POST.heat = Math.max(0, Math.min(1, (el - 0.45) / 0.4)); POST.hazeCol.copy(hor).lerp(mid, 0.45); POST.sunCol.setHSL(0.07, 0.85, 0.5 + 0.2 * Math.min(1, Math.max(0, el))).multiplyScalar(1 - night * 0.9); if (POST.mFinal) POST.mFinal.uniforms.uHazeK.value = 0.00003 + 0.00004 * dusk + 0.00002 * night; }
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
const CHAR = {};   // body -> { scene, clips: { walk, idle }, height }
async function loadCharacters() {
  if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return; const loader = new THREE.GLTFLoader();
  const load = (url) => new Promise((res) => loader.load(url, res, undefined, () => res(null)));
  for (const body of ["m", "f"]) {
    const walk = await load(`/models/char_${body}.glb?v=${window.BUILD || 0}`); if (!walk) continue;
    const vq = `?v=${window.BUILD || 0}`; const idle = await load(`/models/char_${body}_idle.glb` + vq); const run = await load(`/models/char_${body}_run.glb` + vq); const jump = await load(`/models/char_${body}_jump.glb` + vq); const swim = await load(`/models/char_${body}_swim.glb` + vq);
    const root = walk.scene; root.updateMatrixWorld(true);
    // measure the SKINNED pose (Meshy rigs keep bones in cm and geometry in m, so plain bounds are 100x off)
    const box = new THREE.Box3(); const v = new THREE.Vector3();
    root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); const n = o.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 4000)); for (let i = 0; i < n; i += step) { o.boneTransform(i, v); v.applyMatrix4(o.matrixWorld); box.expandByPoint(v); } } else if (o.isMesh) box.expandByObject(o); });
    const sz = new THREE.Vector3(); box.getSize(sz); if (!(sz.y > 0)) continue;
    const wantH = body === "m" ? 1.78 : 1.68; const sc = wantH / sz.y;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material.side = THREE.FrontSide; o.material.emissive && o.material.emissive.set(0x000000); o.material.metalness = 0; o.material.metalnessMap = null; o.material.roughness = 0.82; o.material.roughnessMap = null; o.material.needsUpdate = true; if (o.material.map) { o.material.map.encoding = THREE.sRGBEncoding; o.material.map.anisotropy = 8; } } });
    CHAR[body] = { scene: root, scale: sc, yoff: -box.min.y * sc, clips: { walk: walk.animations && walk.animations[0], idle: idle && idle.animations && idle.animations[0], run: run && run.animations && run.animations[0], jump: jump && jump.animations && jump.animations[0], swim: swim && swim.animations && swim.animations[0] } };
  }
}
// tint the plain white shirt and dark trousers of the generated body by luminance mask
function tintMaterial(mat, look) {
  const m = mat.clone(); const shirt = new THREE.Color("#" + (look && look.shirt || "4dde6f")), pants = new THREE.Color("#" + (look && look.pants || "2b3a4a")), skin = new THREE.Color("#" + (look && look.skin || "e8c19a"));
  m.onBeforeCompile = (sh) => { sh.uniforms.uShirt = { value: shirt }; sh.uniforms.uPants = { value: pants }; sh.uniforms.uSkin = { value: skin };
    sh.fragmentShader = sh.fragmentShader.replace("uniform vec3 diffuse;", "uniform vec3 diffuse; uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uSkin;").replace("#include <map_fragment>", "#include <map_fragment>\n { float lum = dot(diffuseColor.rgb, vec3(0.333)); float sat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)); float wht = smoothstep(0.62, 0.8, lum) * (1.0 - smoothstep(0.08, 0.2, sat)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uShirt * 1.15, wht); float drk = (1.0 - smoothstep(0.16, 0.3, lum)) * (1.0 - smoothstep(0.1, 0.2, sat)); diffuseColor.rgb = mix(diffuseColor.rgb, uPants * (0.35 + lum * 2.0), drk * 0.85); float sk = smoothstep(0.08, 0.25, sat) * smoothstep(0.35, 0.6, lum) * step(diffuseColor.b, diffuseColor.r); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (uSkin / vec3(0.91, 0.76, 0.6)), sk * 0.9); }"); };
  m.needsUpdate = true; return m;
}
function buildBody(g, look, hat, outfit, gear) {
  const body = (look && look.body) || "m";
  if (CHAR[body]) return buildRigged(g, look, hat, outfit, CHAR[body], gear);
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
const LOGO_TEX = texLoader0.load("/tex/gb_logo.png"); LOGO_TEX.encoding = THREE.sRGBEncoding;
function buildRigged(g, look, hat, outfit, C, gear) {
  const walk = g.userData && g.userData.walk; if (walk) g.remove(walk);
  const w = new THREE.Group(); const clone = THREE.SkeletonUtils.clone(C.scene); clone.scale.setScalar(C.scale); clone.position.y = C.yoff;
  const o = outfit && OUTFITS[outfit]; const lk = Object.assign({}, look || {}); if (o) { lk.shirt = o.shirt.toString(16).padStart(6, "0"); lk.pants = o.pants.toString(16).padStart(6, "0"); }
  const top = gear && gear.top; if (top === "gear_tee_gb") lk.shirt = "f5f1e6"; else if (top === "gear_tee_black") lk.shirt = "141414"; else if (top === "gear_hoodie_gb") lk.shirt = "1f6b3a"; else if (top === "gear_jersey_gb") lk.shirt = "f4cd5a"; else if (top === "gear_vest_crew") lk.shirt = "ffb300";
  clone.traverse((n) => { if (n.isMesh) { n.material = tintMaterial(n.material, lk); n.castShadow = true; n.receiveShadow = true; } });
  w.add(clone);
  const mixer = new THREE.AnimationMixer(clone); const acts = {};
  if (C.clips.walk) { acts.walk = mixer.clipAction(C.clips.walk); acts.walk.play(); acts.walk.setEffectiveWeight(0); }
  if (C.clips.idle) { acts.idle = mixer.clipAction(C.clips.idle); acts.idle.play(); acts.idle.setEffectiveWeight(1); }
  if (C.clips.run) { acts.run = mixer.clipAction(C.clips.run); acts.run.play(); acts.run.setEffectiveWeight(0); }
  if (C.clips.jump) { acts.jump = mixer.clipAction(C.clips.jump); acts.jump.setLoop(THREE.LoopOnce, 1); acts.jump.clampWhenFinished = true; acts.jump.play(); acts.jump.setEffectiveWeight(0); }
  if (C.clips.swim) { acts.swim = mixer.clipAction(C.clips.swim); acts.swim.play(); acts.swim.setEffectiveWeight(0); }
  // hats ride the head bone when there is one
  let head = null; clone.traverse((n) => { if (!head && n.isBone && /head/i.test(n.name)) head = n; });
  if (hat && head) { const hg = new THREE.Group(); const inv = 1 / C.scale;
    if (hat === "hat_cap") { const b = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, 6.283, 0, 1.4), M.green); hg.add(b); const peak = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.015, 0.1), M.green); peak.position.set(0, 0.02, 0.13); hg.add(peak); hg.position.y = 0.06; }
    else if (hat === "hat_cowboy") { const mH = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 18), mH); hg.add(brim); const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.12, 14), mH); crown.position.y = 0.065; hg.add(crown); hg.position.y = 0.1; }
    else if (hat === "hat_band") { const band = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.014, 6, 20), M.green); band.rotation.x = Math.PI / 2; hg.add(band); hg.position.y = 0.06; }
    hg.scale.setScalar(inv); head.add(hg); }
  // gear: logo decals, hoods, vests, glasses, neckwear, packs and watches ride the bones
  if (gear && Object.keys(gear).length) { const bones = {}; clone.traverse((n) => { if (n.isBone) bones[n.name] = n; }); const inv = 1 / C.scale; const attach = (bone, mesh, x, y, z, rx, ry) => { const b = bones[bone]; if (!b) return; const hg = new THREE.Group(); hg.add(mesh); hg.position.set(x, y, z); if (rx) hg.rotation.x = rx; if (ry) hg.rotation.y = ry; hg.scale.setScalar(inv); b.add(hg); };
    const logo = (w) => new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: LOGO_TEX, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const chest = bones.Spine02 ? "Spine02" : "Spine01"; const cy = 0.16;
    if (gear.top === "gear_tee_gb" || gear.top === "gear_tee_black" || gear.top === "gear_hoodie_gb") attach(chest, logo(0.2), 0, cy, 0.13, 0, 0);
    if (gear.top === "gear_jersey_gb") { const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "01", size: 150, y: 0.7 }], 256, 160, { bg: "#f4cd5a", border: "#f4cd5a" }), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); attach(chest, nm, 0, cy, -0.13, 0, Math.PI); attach(chest, logo(0.16), 0, cy + 0.02, 0.13, 0, 0); }
    if (gear.top === "gear_hoodie_gb") { const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, 6.283, 0, 1.6), new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.9 })); hood.rotation.x = Math.PI; attach("neck", hood, 0, 0.02, -0.06, 0, 0); }
    if (gear.top === "gear_vest_crew") { const v = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.8, emissive: 0x805500, emissiveIntensity: 0.3 }); const strip = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, emissive: 0x888888, emissiveIntensity: 0.6 }); const grp = new THREE.Group(); const front = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.03), v); front.position.z = 0.135; grp.add(front); const back = front.clone(); back.position.z = -0.135; grp.add(back); const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.035), strip); s1.position.set(0, -0.04, 0.135); grp.add(s1); const s2 = s1.clone(); s2.position.z = -0.135; grp.add(s2); attach(chest, grp, 0, cy - 0.02, 0, 0, 0); }
    if (gear.face === "gear_shades") { const gl = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.6 }); const grp = new THREE.Group(); for (const sx of [-1, 1]) { const lens = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.012), gl); lens.position.set(sx * 0.033, 0, 0); grp.add(lens); } const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.008), gl); grp.add(bridge); for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.1), gl); arm.position.set(sx * 0.06, 0.005, -0.05); grp.add(arm); } attach("Head", grp, 0, 0.09, 0.1, 0, 0); }
    if (gear.neck === "gear_bandana") attach("neck", new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 20), new THREE.MeshStandardMaterial({ color: 0xc8341a, roughness: 0.9 })), 0, 0.03, 0.01, Math.PI / 2, 0);
    if (gear.neck === "gear_scarf") { const sc = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.95 })); attach("neck", sc, 0, 0.03, 0.01, Math.PI / 2, 0); attach("neck", new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.95 })), 0.05, -0.1, 0.1, 0, 0); }
    if (gear.neck === "gear_chain") { const au = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, roughness: 0.25, metalness: 0.9 }); attach("neck", new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 24), au), 0, 0.02, 0.02, Math.PI / 2.4, 0); attach(chest, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16), au), 0, cy + 0.08, 0.14, Math.PI / 2, 0); }
    if (gear.neck === "gear_lanyard") { attach("neck", new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.005, 6, 20), new THREE.MeshStandardMaterial({ color: 0x2a7a3e })), 0, 0.02, 0.02, Math.PI / 2.4, 0); attach(chest, new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.085, 0.004), new THREE.MeshStandardMaterial({ color: 0xf5f1e6 })), 0, cy - 0.02, 0.14, 0, 0); }
    if (gear.back === "gear_backpack_gb") { const pk = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.14), new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.85 })); pk.add(body); const lid = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.15), new THREE.MeshStandardMaterial({ color: 0x14522b, roughness: 0.85 })); lid.position.y = 0.16; pk.add(lid); const lg = logo(0.14); lg.position.set(0, -0.02, -0.075); lg.rotation.y = Math.PI; pk.add(lg); for (const sx of [-1, 1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0x14522b })); strap.position.set(sx * 0.09, 0.02, 0.12); pk.add(strap); } attach(chest, pk, 0, cy - 0.02, -0.15, 0, 0); }
    if (gear.wrist === "gear_watch") { const wg = new THREE.Group(); wg.add(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.8, roughness: 0.3 }))); const face = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16), new THREE.MeshStandardMaterial({ color: 0x0a1610, metalness: 0.5, roughness: 0.3 })); face.rotation.x = Math.PI / 2; face.position.z = 0.03; wg.add(face); attach("LeftHand", wg, 0, 0.02, 0, 0, 0); } }
  g.add(w); g.userData.walk = w; g.userData.mixer = mixer; g.userData.acts = acts; g.userData.legs = null; g.userData.lookKey = JSON.stringify([look, hat, outfit, gear || null]);
}
function animateWalk(g, speed, dt) {
  const u = g.userData;
  if (u.mixer) { u.mixer.update(dt); const A = u.acts; const air = !!u.air && !!A.jump; const k = Math.min(1, speed / 1.2); const run = A.run ? Math.max(0, Math.min(1, (speed - 5.2) / 2.5)) : 0;
    const sw = !!u.swim && !!A.swim; const want = { idle: air || sw ? 0 : 1 - k, walk: air || sw ? 0 : k * (1 - run), run: air || sw ? 0 : k * run, jump: air && !sw ? 1 : 0, swim: sw ? 1 : 0 }; const w = u.w || (u.w = { idle: 1, walk: 0, run: 0, jump: 0, swim: 0 }); const rate = Math.min(1, dt * 9);
    for (const n in want) { w[n] += (want[n] - w[n]) * rate; if (A[n]) A[n].setEffectiveWeight(w[n]); }
    if (A.walk) A.walk.setEffectiveTimeScale(Math.max(0.6, Math.min(1.7, speed / 1.5))); if (A.swim) A.swim.setEffectiveTimeScale(speed > 0.3 ? 1.0 : 0.5); if (A.run) A.run.setEffectiveTimeScale(Math.max(0.8, Math.min(1.5, speed / 7.5)));
    if (air && !u.wasAir && A.jump) { A.jump.reset(); A.jump.time = 0.12; A.jump.play(); } u.wasAir = air;
    if (!A.idle && A.walk) A.walk.setEffectiveTimeScale(speed > 0.2 ? Math.max(0.6, speed / 1.5) : 0); return; }
  if (!u.legs) return; u.phase += dt * Math.min(12, speed * 2.4); const a = speed > 0.2 ? Math.sin(u.phase) * 0.6 : 0;
  u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a; u.arms[0].rotation.x = -a * 0.8; u.arms[1].rotation.x = a * 0.8;
  if (speed <= 0.2) { u.arms[0].rotation.x = u.arms[1].rotation.x = Math.sin(performance.now() / 900) * 0.04; }
}
function avatar(id, name, look, hat, outfit) {
  const g = new THREE.Group(); g.userData = {};
  buildBody(g, look, hat, outfit); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const walk = g.userData.walk;
  const cartG = makeModel("cart"); cartG.visible = false; g.add(cartG);
  const label = makeLabel(name); g.add(label);
  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, depthTest: false, transparent: true })); emote.scale.set(1.4, 1.4, 1); emote.position.y = 3.2; emote.visible = false; g.add(emote);
  Object.assign(g.userData, { cartG, label, emote, name, bubble: null, bubbleTick: 0, lastPos: new THREE.Vector3() });
  scene.add(g); return g;
}
function setName(g, name) { if (g.userData.name === name) return; g.remove(g.userData.label); const l = makeLabel(name); g.add(l); g.userData.label = l; g.userData.name = name; }
function setCartVisual(g, on) { g.userData.cartG.visible = on; g.userData.walk.position.set(0.4, on ? 0.28 : 0, on ? 0.25 : 0); if (!on) g.userData.walk.position.set(0, 0, 0); }
const GEAR_SLOT = { gear_tee_gb: "top", gear_tee_black: "top", gear_hoodie_gb: "top", gear_vest_crew: "top", gear_jersey_gb: "top", gear_shades: "face", gear_bandana: "neck", gear_scarf: "neck", gear_chain: "neck", gear_backpack_gb: "back", gear_watch: "wrist", gear_lanyard: "neck" };
function syncLook(g, p) { const key = JSON.stringify([p.look || null, p.hat || null, p.outfit || null, p.gear || null]); if (g.userData.lookKey !== key) { const wasCart = g.userData.cartG && g.userData.cartG.visible; buildBody(g, p.look, p.hat, p.outfit, p.gear); if (wasCart) setCartVisual(g, true); } }
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
const mv = { x: 0, z: 0 }; let runK = 0, spdLast = 0; const SWIM = { on: false };
let player = null, yaw = 0, pitch = 0.18, towerView = false, pitchInput = 0, cartMode = false, vy = 0, airborne = false, cartSpeed = 0, cartHeat = 0; const slide = { x: 0, z: 0 };
const keys = {}; const avatars = new Map(); let chatOpen = false;
function toggleCart() { if (riding || golf.playing || inside) return; cartMode = !cartMode; setCartVisual(player, cartMode); cartSpeed = 0; if (cartMode) player.rotation.y = yaw + Math.PI; pushMove(true); }
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") { if (e.code === "Escape") { e.target.blur(); closeChat(); } return; }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === "KeyF") toggleRide(); if (e.code === "KeyC") toggleCart(); if (e.code === "KeyI" && !chatOpen) { if ($("#inv").classList.contains("on")) closeCards(); else openInventory(); } if (e.code === "Escape" && BUILD.on) cancelBuild(); if (e.code === "Enter" && BUILD.on && !chatOpen) { placeBuild(); e.preventDefault(); return; } if (BUILD.on && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { BUILD.ry += e.code === "ArrowLeft" ? 0.2 : -0.2; e.preventDefault(); return; } if (e.code === "Delete" && !chatOpen && !BUILD.on) { const pr = nearestOwnProp(); if (pr) { act({ t: "prop", op: "remove", id: pr.id }); sfx("ui"); setStatus("removed " + (CAT[pr.kind] ? CAT[pr.kind][0] : pr.kind)); } } if (e.code === "KeyM") towerView = !towerView; if (e.code === "KeyB" && !chatOpen && OBBY.running) { const c = OBBY.checkpoints[OBBY.cp]; player.position.set(c[0], c[1], c[2]); airborne = false; vy = 0; } if (e.code === "KeyR" && !chatOpen) setStation(RADIO.i + 1); if (e.code === "BracketLeft" && !chatOpen) setStation(RADIO.i - 1); if (e.code === "BracketRight" && !chatOpen) setStation(RADIO.i + 1); if (e.code === "Tab") { e.preventDefault(); $("#mm").classList.toggle("big"); } if (e.code === "KeyE") openNearest(); if (e.code === "KeyG") toggleGuestbook(); if (e.code === "KeyL") toggleBoard();
  if (e.code === "KeyN") timeOffset += DAY_SECONDS / 2; if (e.code === "KeyV") toggleVoice(); if (e.code === "KeyX") toggleSound(); if (e.code === "KeyH") document.body.classList.toggle("photo"); if (e.code === "KeyP") snapshot(); if (e.code === "Enter") openChat();
  if (e.code === "Escape") { closeCards(); if (golf.playing) golfEnd(true); }
  if (e.code === "Space" && !riding && !golf.playing && !airborne && !SWIM.on) { vy = cartMode ? 7 : 6.6; airborne = true; sfx("jump"); }
  if (golf.playing && /^Digit[1-6]$/.test(e.code)) { golfSelectClub(+e.code.slice(5) - 1); return; }
  const em = { Digit1: "wave", Digit2: "cheer", Digit3: "point", Digit4: "sit" }[e.code]; if (em) act({ t: "emote", e: em });
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
function openChat() { chatOpen = true; $("#chat").classList.add("on"); $("#chat-in").focus(); if (document.exitPointerLock) document.exitPointerLock(); }
function closeChat() { chatOpen = false; $("#chat").classList.remove("on"); $("#chat-in").blur(); }
$("#chat-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = e.target.value.trim(); if (v) { act({ t: "say", text: v }); npcHear(v); } e.target.value = ""; closeChat(); } });
function snapshot() { try { const a = document.createElement("a"); a.download = "genesis-one.png"; a.href = canvas.toDataURL("image/png"); a.click(); } catch {} }
let locked = false;
canvas.addEventListener("click", () => { if (!("ontouchstart" in window) && canvas.requestPointerLock) canvas.requestPointerLock(); });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === canvas; });
addEventListener("mousemove", (e) => { if (!locked) return; if (golf.playing && !golf.moving) { golf.aim -= e.movementX * 0.003; return; } yaw -= e.movementX * 0.0022; pitch = Math.max(-0.62, Math.min(0.9, pitch + e.movementY * 0.0018)); if (riding && riding.kind === "jet") { VEH[riding.id].g.rotation.y -= e.movementX * 0.0015; pitchInput = Math.max(-1, Math.min(1, pitchInput + e.movementY * 0.004)); } });
addEventListener("mousedown", (e) => { if (locked && golf.playing && !golf.moving && e.button === 0) keys.Space = true; });
addEventListener("mouseup", (e) => { if (e.button === 0 && golf.playing) keys.Space = false; });
setInterval(() => { pitchInput *= 0.85; }, 50);
const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 }; const look = { id: null, x: 0, y: 0 }; const joyEl = $("#joy"), joyKnob = joyEl.querySelector("i");
if ("ontouchstart" in window) document.body.classList.add("touch");
canvas.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) { if (t.clientX < innerWidth / 2 && joy.id === null) { joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY; joy.active = true; } else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.cx) / 50)); joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.cy) / 50)); joyKnob.style.transform = `translate(${joy.dx * 30}px,${joy.dy * 30}px)`; } else if (t.identifier === look.id) { yaw -= (t.clientX - look.x) * 0.005; pitch = Math.max(-0.62, Math.min(0.9, pitch + (t.clientY - look.y) * 0.004)); look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchend", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; joyKnob.style.transform = ""; } if (t.identifier === look.id) look.id = null; } }, { passive: true });
document.querySelectorAll("#tbtns button").forEach((b) => { const k = b.dataset.k;
  const fire = () => { if (k === "KeyF") toggleRide(); else if (k === "KeyC") toggleCart(); else if (k === "KeyM") towerView = !towerView; else if (k === "KeyE") openNearest(); else if (k === "KeyG") toggleGuestbook(); else if (k === "KeyL") toggleBoard(); else if (k === "Digit1") act({ t: "emote", e: "wave" }); else if (k === "KeyN") timeOffset += DAY_SECONDS / 2; else if (k === "Enter") openChat(); };
  if (k === "Space" || k === "KeyQ") { b.addEventListener("touchstart", (e) => { e.preventDefault(); keys[k] = true; if (k === "Space" && !riding && !golf.playing && !airborne) { vy = 6.6; airborne = true; } }, { passive: false }); b.addEventListener("touchend", () => { keys[k] = false; }); } else b.addEventListener("click", fire); });
document.querySelectorAll("#warp button").forEach((b) => b.addEventListener("click", () => { const w = b.dataset.w; if (w === "golf") warpTo(golf.holes[0].tee[0] - 4, golf.holes[0].tee[1] - 4); else if (w === "course") warpTo(COURSE.start.x + 20, COURSE.start.z + 20); else if (w === "home") warpTo(HOME.x + 20, HOME.z + 40); else if (w === "obby") warpTo(OBBY.start[0], OBBY.start[2] + 4); else if (w === "drag") warpTo(DRAG.origin[0], DRAG.origin[1] - 8); else if (w === "tower") warpTo(62, 4); else if (w === "lake") warpTo(LAKE.x, LAKE.z + LAKE.r + 40); else if (w === "design") warpTo(600 - 30, 480 + 160); else if (w === "commons") warpTo(285, 721 + 60); else { const z = SITE && SITE.zones[w]; if (z) { if (w === "expanse") warpTo(z.center[0], z.center[1]); else warpTo(z.center[0] + 20, z.center[1] + 30); } } }));
function warpTo(x, z, y) { cullAt = 0; if (riding) { setStatus("leave the vehicle first", true); return; } if (golf.playing) golfEnd(true); if (inside) leaveInterior(); [x, z] = collide(x, z, 1); player.position.x = x; player.position.z = z; player.position.y = getH(x, z); airborne = false; vy = 0; if (typeof y === "number" && y > player.position.y + 0.3) { player.position.y = y; airborne = true; } act({ t: "warp", x: +x.toFixed(2), z: +z.toFixed(2) }); lastSent.x = x; lastSent.z = z; }
$("#mm").addEventListener("click", (e) => { if (!T) return; $("#mm").classList.remove("big"); const r = e.currentTarget.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; warpTo(T.xmin + u * (T.xmax - T.xmin), T.zmin + v * (T.zmax - T.zmin)); });

// ───────────────────────────── HUD ─────────────────────────────
let gbOpen = false, boardOpen = false;
function closeCards() { closeTalk(); $("#inv").classList.remove("on"); for (const id of ["#info", "#gb", "#board", "#shop", "#lot", "#creator"]) $(id).classList.remove("on"); gbOpen = false; boardOpen = false; }
function nearestHotspot() { let best = null, bd = 1e9; for (const h of hotspots) { const d = Math.hypot(player.position.x - h.x, player.position.z - h.z); if (d < h.r && d < bd) { bd = d; best = h; } } return best; }
function openNearest() { if (!player) return; if (inside) { if (VENUE[inside.door.kind] && !inside.atDoor()) { openShop(inside.door.kind); return; } leaveInterior(); return; } const lot = nearestLot(); if (lot) { openLot(lot); return; } const door = nearestDoor(); if (door) { enterInterior(door); return; } const best = nearestHotspot(); if (!best) return; $("#info-h").textContent = best.t; $("#info-k").textContent = best.k; $("#info-p").textContent = best.p; $("#info-go").style.display = best.play ? "" : "none"; $("#info-go").onclick = () => { if (best.play === "golf") golfStart(); else if (best.play === "tour") startTour(); };
  if (best.play && best.play.startsWith("npc:")) { const c = CAST.find((k) => k.id === best.play.slice(4)); if (c) { showTalk(c, 0); return; } } $("#info-go").textContent = best.play === "tour" ? "Start the tour" : "Play"; $("#info").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); }
$("#info-x").addEventListener("click", closeCards);
function toggleGuestbook() { gbOpen = !gbOpen; $("#gb").classList.toggle("on", gbOpen); if (gbOpen) { renderGuestbook(); if (document.exitPointerLock) document.exitPointerLock(); $("#gb-in").focus(); } }
function renderGuestbook() { const list = $("#gb-list"); list.innerHTML = ""; const entries = (view && view.guestbook) || []; if (!entries.length) { const d = document.createElement("div"); d.textContent = "Nobody has signed yet. Be the first."; list.append(d); } for (const e of [...entries].reverse()) { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = e.by + " "; d.append(b, document.createTextNode(e.text)); list.append(d); } }
$("#gb-go").addEventListener("click", () => { const v = $("#gb-in").value.trim(); if (!v) return; act({ t: "sign", text: v }); $("#gb-in").value = ""; }); $("#gb-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gb-go").click(); }); $("#gb-x").addEventListener("click", closeCards);
function toggleBoard() { boardOpen = !boardOpen; $("#board").classList.toggle("on", boardOpen); if (boardOpen) { renderBoard(); if (document.exitPointerLock) document.exitPointerLock(); } }
function renderBoard() { const B = Object.assign({ golf: [], course: [], obby: [], drag: [], rings: [], hunt: [], lap: [] }, (view && view.boards) || {}); for (const [k, fmt] of [["golf", (v) => v + " strokes"], ["course", (v) => (v / 1000).toFixed(2) + " s"], ["obby", (v) => (v / 1000).toFixed(2) + " s"], ["drag", (v) => (v / 1000).toFixed(2) + " s"], ["rings", (v) => (v / 1000).toFixed(2) + " s"], ["hunt", (v) => (v / 60000).toFixed(1) + " min"], ["lap", (v) => (v / 1000).toFixed(2) + " s"]]) { const el = $("#b-" + k); el.innerHTML = ""; if (!B[k].length) { const d = document.createElement("div"); d.textContent = "No scores yet."; el.append(d); } B[k].forEach((e, i) => { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${i + 1}. ${e.by}`; const s = document.createElement("span"); s.textContent = fmt(e.v); d.append(b, s); el.append(d); }); } }
$("#board-x").addEventListener("click", closeCards);
function askName() { if (localStorage.getItem("g1:name")) { if (!localStorage.getItem("g1:look")) openCreator(); else if (!localStorage.getItem("g1:tut")) startTutorial(); return; } $("#name").classList.add("on"); $("#name-in").focus(); }
$("#name-go").addEventListener("click", () => { const v = $("#name-in").value.trim().replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 18); if (!v) return; localStorage.setItem("g1:name", v); act({ t: "name", name: v }); $("#name").classList.remove("on"); openCreator(); }); $("#name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-go").click(); });
let zoneShown = null, zoneTimer = 0;
function updateZone(dt) {
  let inZone = null; for (const z of zoneRings) if (Math.hypot(player.position.x - z.center[0], player.position.z - z.center[1]) < z.r) inZone = z;
  if (inZone && inZone !== zoneShown) { zoneShown = inZone; $("#zone-n").textContent = inZone.name; $("#zone-k").textContent = inZone.k; $("#zone").classList.add("on"); zoneTimer = 3.5; } if (!inZone) zoneShown = null; if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) $("#zone").classList.remove("on"); }
  const near = nearestHotspot(); const nv = !riding && nearestVehicle(); const show = (near || nv) && !$("#info").classList.contains("on") && !golf.playing;
  const door = !inside && !riding && nearestDoor(); if (door && !golf.playing && !cartMode) { const rr = door.r * 0.86; const mx = door.e[0] + Math.sin(door.e[3]) * (rr + 0.9), mz = door.e[2] + Math.cos(door.e[3]) * (rr + 0.9); if (Math.hypot(player.position.x - mx, player.position.z - mz) < 1.1 && performance.now() - (inside_left_at || 0) > 1500) enterInterior(door); }
  $("#prompt").classList.toggle("on", !!(show || door || inside || nearestLot())); const lotN = !inside && !riding && nearestLot(); if (inside) $("#prompt-t").innerHTML = VENUE[inside.door.kind] && !inside.atDoor() ? `<b>E</b> &nbsp;${VENUE[inside.door.kind].title}: browse and buy` : `<b>E</b> &nbsp;step outside`; else if (lotN) $("#prompt-t").innerHTML = `<b>E</b> &nbsp;${view && view.lots && view.lots[lotN.id] && view.lots[lotN.id].owner ? "this lot" : "lot for sale"}`; else if (door) $("#prompt-t").innerHTML = `<b>E</b> &nbsp;enter the ${DOOR_NAMES[door.kind] || door.kind}`; else if (show) $("#prompt-t").innerHTML = (nv ? `<b>F</b> &nbsp;ride the ${view.vehicles[nv].kind === "jet" ? "jet" : "cart"}` : "") + (nv && near ? " &nbsp;·&nbsp; " : "") + (near ? `<b>E</b> &nbsp;${near.play === "tour" ? "talk to " : near.play ? "play " : ""}${near.t}` : "");
}
const mmc = $("#mmc").getContext("2d"); const mmImg = new Image(); mmImg.src = "/minimap.jpg";
function drawMinimap() {
  const S = 368; mmc.clearRect(0, 0, S, S); if (mmImg.complete) mmc.drawImage(mmImg, 0, 0, S, S);
  const px = (x) => ((x - T.xmin) / (T.xmax - T.xmin)) * S, pz = (z) => ((z - T.zmin) / (T.zmax - T.zmin)) * S;
  mmc.strokeStyle = "rgba(20,20,22,.9)"; mmc.lineWidth = 5; mmc.beginPath(); SITE.runway.forEach((p, i) => (i ? mmc.lineTo(px(p[0]), pz(p[1])) : mmc.moveTo(px(p[0]), pz(p[1])))); mmc.stroke();
  mmc.font = "600 15px system-ui, sans-serif"; mmc.fillStyle = "rgba(245,241,230,.95)"; mmc.textAlign = "center";
  for (const z of zoneRings) { mmc.strokeStyle = "rgba(77,222,111,.5)"; mmc.lineWidth = 2; mmc.beginPath(); mmc.arc(px(z.center[0]), pz(z.center[1]), (z.r / (T.xmax - T.xmin)) * S, 0, 6.283); mmc.stroke(); mmc.fillText(z.name.replace("The ", ""), px(z.center[0]), pz(z.center[1]) + 5); }
  mmc.fillStyle = "#f4cd5a"; mmc.fillText("Golf", px(GOLF.origin[0]), pz(GOLF.origin[1])); mmc.fillText("Course", px(COURSE.origin[0]), pz(COURSE.origin[1])); mmc.fillText("Obby", px(OBBY.start[0]), pz(OBBY.start[2])); mmc.fillText("Drag", px(DRAG.origin[0]), pz(DRAG.origin[1] + 160)); mmc.fillStyle = "#8fd8ff"; mmc.fillText("Lake", px(LAKE.x), pz(LAKE.z) + 5); mmc.fillStyle = "#f4cd5a"; mmc.fillText("Row", px(33), pz(-686) + 5);
  if (Math.abs(player.position.x - HOME.x) < HOME.r) { mmc.fillStyle = "rgba(10,22,16,.8)"; mmc.fillRect(0, S - 40, S, 40); mmc.fillStyle = "#4DDE6F"; mmc.fillText("You are at home base, 16 km north-west", S / 2, S - 15); }
  if (view && view.vehicles) for (const v of Object.values(view.vehicles)) { mmc.fillStyle = v.kind === "jet" ? "#ffd166" : "#9be7ff"; mmc.beginPath(); mmc.arc(px(v.x), pz(v.z), 4, 0, 6.283); mmc.fill(); }
  if (view) for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; mmc.fillStyle = "rgba(245,241,230,.9)"; mmc.beginPath(); mmc.arc(px(p.x), pz(p.z), 4, 0, 6.283); mmc.fill(); }
  mmc.fillStyle = "#4DDE6F"; mmc.beginPath(); mmc.arc(px(player.position.x), pz(player.position.z), 6, 0, 6.283); mmc.fill(); mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 2; mmc.stroke();
}

// ───────────────────────────── movement + net sync ─────────────────────────────
let lastSent = { x: 0, z: 48, ry: 0, at: 0 };
function pushMove(force) { if (!player || riding) return; const now = performance.now(); const moved = Math.hypot(player.position.x - lastSent.x, player.position.z - lastSent.z) > 0.08 || Math.abs(yaw - lastSent.ry) > 0.02 || Math.abs(player.position.y - (lastSent.y || 0)) > 0.15; if (force || (moved && now - lastSent.at > 120) || now - lastSent.at > 3000) { act({ t: "move", x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2), ry: +yaw.toFixed(3), cart: cartMode }); lastSent = { x: player.position.x, y: player.position.y, z: player.position.z, ry: yaw, at: now }; } }
let lastT = performance.now(), bob = 0, bobY = 0; const camTarget = new THREE.Vector3(); const CAM = { dist: 9.5, look: new THREE.Vector3(), init: false, prAcc: 0, prN: 0, pr: 0 };
const smoothK = (dt, rate) => 1 - Math.exp(-dt * rate);
function camLook(x, y, z, dt, rate) { if (!CAM.init) { CAM.look.set(x, y, z); CAM.init = true; } else CAM.look.lerp(camTarget.set(x, y, z), smoothK(dt, rate || 22)); camera.lookAt(CAM.look); }
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; FRAME_N++;
  if (!player) { renderer.render(scene, camera); return; }
  if (now - cullAt > 250 || Math.abs(Math.atan2(Math.sin(yaw - cullYaw), Math.cos(yaw - cullYaw))) > 0.3) { cullAt = now; updateCulling(false); }
  renderer.shadowMap.needsUpdate = (FRAME_N & 1) === 0;
  // adaptive resolution: if frames run long, drop the pixel ratio a notch; raise it again when there is headroom
  { if (!CAM.pr) CAM.pr = renderer.getPixelRatio(); CAM.prAcc += now - lastT + dt * 1000; CAM.prN++; if (CAM.prN >= 120) { const avg = CAM.prAcc / CAM.prN; CAM.prAcc = 0; CAM.prN = 0; const cap = Math.min(devicePixelRatio, 1.5); let pr = CAM.pr; if (avg > 21 && pr > 0.75) pr = Math.max(0.75, pr - 0.25); else if (avg < 11 && pr < cap) pr = Math.min(cap, pr + 0.25); if (pr !== CAM.pr) { CAM.pr = pr; renderer.setPixelRatio(pr); resize(); } } }
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
      const sprint = (keys.ShiftLeft || keys.ShiftRight) && L > 0.01; const speed = sprint ? 9.6 : 4.6; const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
      // acceleration and deceleration instead of instant speed changes
      { const tx = (fwd[0] * fz + right[0] * fx) * speed, tz = (fwd[1] * fz + right[1] * fx) * speed; const acc = Math.min(1, dt * (L > 0.01 ? 8 : 11)); mv.x += (tx - mv.x) * acc; mv.z += (tz - mv.z) * acc; if (Math.hypot(mv.x, mv.z) < 0.05 && L < 0.01) { mv.x = 0; mv.z = 0; } }
      runK += ((sprint && !airborne ? 1 : 0) - runK) * Math.min(1, dt * 4);
      let onIce = false; if (!airborne) for (const pl of OBBY.plats) if (pl.ice && Math.abs(player.position.x - pl.x) <= pl.w / 2 && Math.abs(player.position.z - pl.z) <= pl.d / 2 && Math.abs(player.position.y - pl.y) < 0.4) onIce = true;
      if (onIce) { slide.x += (fwd[0] * fz + right[0] * fx) * speed * 2.2 * dt; slide.z += (fwd[1] * fz + right[1] * fx) * speed * 2.2 * dt; const sm = Math.hypot(slide.x, slide.z); if (sm > speed * 1.3) { slide.x *= speed * 1.3 / sm; slide.z *= speed * 1.3 / sm; } slide.x *= Math.pow(0.35, dt); slide.z *= Math.pow(0.35, dt); }
      else if (!airborne) { slide.x = 0; slide.z = 0; }
      nx = player.position.x + (onIce || airborne && (slide.x || slide.z) ? slide.x : mv.x) * dt; nz = player.position.z + (onIce || airborne && (slide.x || slide.z) ? slide.z : mv.z) * dt;
      if (Math.hypot(mv.x, mv.z) > 0.4) { const want = Math.atan2(mv.x, mv.z); let d = want - player.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); player.rotation.y += d * Math.min(1, dt * 12); }
    }
    if (!onLand(nx, nz)) { nx = player.position.x; nz = player.position.z; cartSpeed = 0; } [nx, nz] = collide(nx, nz, cartMode ? 1.4 : 0.6);
    if (cartMode && waterDepthAt(nx, nz) > 0.5) { nx = player.position.x; nz = player.position.z; cartSpeed *= 0.5; }
    if (inside) { const e = inside.door.e, hf = inside.half - 0.5; let lx = (nx - e[0]) * Math.cos(e[3]) - (nz - e[2]) * Math.sin(e[3]), lz = (nx - e[0]) * Math.sin(e[3]) + (nz - e[2]) * Math.cos(e[3]); if (lz > hf + 1.5) { leaveInterior(); nx = player.position.x; nz = player.position.z; } else { lx = Math.max(-hf, Math.min(hf, lx)); lz = Math.max(-hf, Math.min(hf + 1.5, lz)); nx = e[0] + lx * Math.cos(e[3]) + lz * Math.sin(e[3]); nz = e[2] - lx * Math.sin(e[3]) + lz * Math.cos(e[3]); } }
    // vertical: ground + ramps, gravity, jumps
    const surfPrev = surfaceAt(player.position.x, player.position.z, player.position.y);
    player.position.x = nx; player.position.z = nz;
    const surf = surfaceAt(nx, nz, player.position.y);
    if (!airborne && cartMode && surfPrev - surf > 0.35 && Math.abs(cartSpeed) > 6) { airborne = true; vy = Math.min(9, Math.abs(cartSpeed) * 0.32); }
    if (!airborne && player.position.y > surf + 0.6) { airborne = true; vy = 0; }
    const wdep = !cartMode && !inside ? waterDepthAt(nx, nz) : 0; const wasSwim = SWIM.on; SWIM.on = wdep > 1.1;
    if (SWIM.on) { const swimY = LAKE.level - 0.55 + Math.sin(now * 0.002) * 0.05; if (!wasSwim) { sfx("land"); emitDust(nx, LAKE.level, nz, 14, 1.2, 1.2); airborne = false; vy = 0; } player.position.y += (swimY - player.position.y) * Math.min(1, dt * 6); mv.x *= 0.55; mv.z *= 0.55; bobY = 0; }
    else if (airborne) { vy -= 17 * dt; player.position.y += vy * dt; if (player.position.y <= surf && vy <= 0) { player.position.y = surf; airborne = false; if (vy < -6) { sfx("land"); emitDust(nx, surf, nz, 16, 1.4, 1.6); } vy = 0; } }
    else { bob += L * dt * 9; bobY = L && !cartMode ? Math.abs(Math.sin(bob)) * 0.05 : 0; player.position.y = surf + bobY; }
    if (SWIM.on && spdLast > 0.6 && FRAME_N % 4 === 0) emitDust(nx, LAKE.level, nz, 1, 0.8, 0.4);
    updateObby(dt);
    pushMove(false); player.userData.air = airborne && !cartMode && !SWIM.on; player.userData.swim = SWIM.on; const spd = cartMode ? 0 : Math.hypot(mv.x, mv.z); spdLast = spd; animateWalk(player, spd, dt);
    // footprints, tyre tracks and dust
    if (FX.dust) { const ry = player.rotation.y;
      if (!cartMode && !airborne && !inside && spd > 0.5) { FX.stepDist += spd * dt; if (FX.stepDist > (spd > 6 ? 1.15 : 0.72)) { FX.stepDist = 0; FX.side = -FX.side; stamp(FX.prints, nx + Math.cos(ry) * 0.17 * FX.side, surf, nz - Math.sin(ry) * 0.17 * FX.side, ry, 1); sfx("step"); if (spd > 6) emitDust(nx, surf, nz, 2, 0.5, 0.5); } }
      if (cartMode && !airborne && Math.abs(cartSpeed) > 3) { FX.trackDist += Math.abs(cartSpeed) * dt; FX.dustAcc += Math.abs(cartSpeed) * dt; const bx = nx - Math.sin(ry) * 0.9, bz = nz - Math.cos(ry) * 0.9; if (FX.trackDist > 0.95) { FX.trackDist = 0; for (const sd of [-1, 1]) stamp(FX.tracks, bx + Math.cos(ry) * 0.6 * sd, surf, bz - Math.sin(ry) * 0.6 * sd, ry, 1); } if (FX.dustAcc > 1.2) { FX.dustAcc = 0; emitDust(bx, surf, bz, 2 + Math.floor(Math.abs(cartSpeed) / 10), 1.3, 0.9 + Math.abs(cartSpeed) / 30); } } }
  } else if (golf.playing) updateGolf(dt);
  updateVehicles(dt); updateBalls(); updateCourse(); updateFX(dt, now); updateBuild(); if ((FRAME_N & 15) === 0) syncProps(); updateMinigames(dt, now); updateTraffic(dt, now); updateEnvironment(now); updateCast(dt, now); updateDevil(dt, now); if ((FRAME_N & 1) === 0) drawCompass(now); if (!HUD.gameOwner && !DRAG.showing && !golf.playing) $("#game").classList.remove("on"); HUD.gameOwner = null;
  if (riding && riding.kind !== "jet" && FX.dust && Math.abs(vSpeed) > 3) { const V = VEH[riding.id]; if (V) { FX.dustAcc += Math.abs(vSpeed) * dt; if (FX.dustAcc > 1.3) { FX.dustAcc = 0; const ry = V.g.rotation.y; emitDust(V.g.position.x - Math.sin(ry) * 1.6, V.g.position.y, V.g.position.z - Math.cos(ry) * 1.6, 3, 1.6, 1.1); } } } if (!golf.playing && player.userData.arms && !airborne && !cartMode) { /* arms rest */ }
  const px = player.position.x, pz = player.position.z, gh = getH(px, pz);
  { const fovT = riding ? (riding.kind === "jet" ? 70 : 64 + Math.min(10, Math.abs(vSpeed) * 0.3)) : cartMode ? 62 + Math.min(14, Math.abs(cartSpeed) * 0.32) : 62 + 7 * runK; if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); } }
  if (towerView) { const tx = Math.sin(now * 0.00012) * 220, tz = Math.cos(now * 0.00012) * 220; camera.position.set(tx, getH(tx, tz) + 160, tz); camera.lookAt(px, gh + 20, pz); }
  else if (riding) { const V = VEH[riding.id]; const isJet = riding.kind === "jet"; const dist = isJet ? 30 : 11, h = isJet ? 9 : 4; const back = new THREE.Vector3(-Math.sin(V.g.rotation.y) * dist, h, -Math.cos(V.g.rotation.y) * dist); camTarget.copy(V.g.position).add(back); camTarget.y = Math.max(camTarget.y, getH(camTarget.x, camTarget.z) + 1.5); camera.position.lerp(camTarget, smoothK(dt, isJet ? 8 : 16)); camLook(V.g.position.x, V.g.position.y + (isJet ? 2 : 1.2), V.g.position.z, dt, 30); }
  else if (golf.playing) { const ang = golf.aim; const b = golf.ballMesh.position; const dist = golf.moving ? 14 : (golf.club === 5 ? 4.5 : 7); camTarget.set(b.x - Math.sin(ang) * dist, Math.max(getH(b.x - Math.sin(ang) * dist, b.z - Math.cos(ang) * dist) + 1.5, b.y + (golf.moving ? 5 : 2.6)), b.z - Math.cos(ang) * dist); camera.position.lerp(camTarget, smoothK(dt, golf.moving ? 4 : 10)); camLook(b.x, b.y + 0.3, b.z, dt, 20); }
  else if (inside) {
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)]; const e = inside.door.e, hf = inside.half - 0.6;
    // how far back can the camera go before it hits a wall?
    let dist = 0; for (let d = 0; d <= 3.4; d += 0.2) { const cx = px - fwd[0] * d, cz = pz - fwd[1] * d; const lx = (cx - e[0]) * Math.cos(e[3]) - (cz - e[2]) * Math.sin(e[3]), lz = (cx - e[0]) * Math.sin(e[3]) + (cz - e[2]) * Math.cos(e[3]); if (Math.abs(lx) > hf || Math.abs(lz) > hf) break; dist = d; }
    if (inside.fp === undefined) inside.fp = dist < 1.4; else if (inside.fp && dist > 2.2) inside.fp = false; else if (!inside.fp && dist < 1.2) inside.fp = true;
    CAM.dist += (dist - CAM.dist) * smoothK(dt, 10); const sd = Math.min(dist, CAM.dist);
    if (inside.fp) { camera.position.set(px, player.position.y - bobY + 1.62, pz); CAM.init = false; camera.lookAt(px + fwd[0] * 10, player.position.y - bobY + 1.62 - pitch * 6, pz + fwd[1] * 10); player.userData.walk.visible = false; }
    else { camera.position.lerp(camTarget.set(px - fwd[0] * sd, player.position.y - bobY + 1.9 + pitch * 1.2, pz - fwd[1] * sd), smoothK(dt, 24)); camLook(px, player.position.y - bobY + 1.3, pz, dt, 30); player.userData.walk.visible = true; }
  }
  else { let dist = cartMode ? 12 : 9.5; const h = (cartMode ? 4.2 : 3.2) + pitch * 4, fwd = [-Math.sin(yaw), -Math.cos(yaw)];
    // pull the camera in before it enters a building
    for (const c of COLLIDERS) { if (c[2] < 2.5) continue; const cr = c[2] * 0.95; const dxp = c[0] - px, dzp = c[1] - pz; if (dxp * dxp + dzp * dzp > (dist + cr) * (dist + cr)) continue; for (let d = 3.5; d < dist; d += 0.5) { const sx = px - fwd[0] * d, sz = pz - fwd[1] * d; if (Math.hypot(sx - c[0], sz - c[1]) < cr) { dist = Math.max(3.5, d - 0.5); break; } } }
    // the pull-in distance is smoothed so buildings never snap the camera; smoothing rates are per second, not per frame
    CAM.dist += (dist - CAM.dist) * smoothK(dt, dist < CAM.dist ? 14 : 5); const sd = CAM.dist;
    const cx = px - fwd[0] * sd * Math.cos(pitch), cz = pz - fwd[1] * sd * Math.cos(pitch); const baseY = player.position.y - bobY; const cy = Math.max(getH(cx, cz) + 1.2, baseY + h * (sd / 9.5) + 1.2); camera.position.lerp(camTarget.set(cx, cy, cz), smoothK(dt, cartMode ? 12 : 16)); camLook(px, baseY + 1.6, pz, dt, 26); }
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
      { const k = 1 - Math.exp(-dt * 9); a.g.position.x += (p.x - a.g.position.x) * k; a.g.position.z += (p.z - a.g.position.z) * k; const ground = getH(a.g.position.x, a.g.position.z) + rampHeight(a.g.position.x, a.g.position.z); const ty = typeof p.y === "number" && p.y > ground - 2 ? Math.max(ground, p.y) : ground; a.g.position.y += (ty - a.g.position.y) * (1 - Math.exp(-dt * 12)); a.g.userData.air = a.g.position.y > ground + 0.6; a.g.userData.swim = LAKE.level && waterDepthAt(a.g.position.x, a.g.position.z) > 1.1 && a.g.position.y < LAKE.level; }
      const dx = p.x - a.g.position.x, dz = p.z - a.g.position.z; if (dx * dx + dz * dz > 0.02) a.g.rotation.y = Math.atan2(dx, dz);
    }
    for (const [id, a] of avatars) if (!view.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  SWAY.t.value = now / 1000; updateLots(); updateTutorial(now); updateSfx(dt); updateFauna(dt, now); updateGuide(dt, now); updateZone(dt); if ((FRAME_N & 3) === 0) drawMinimap(); updateSky(dt); updateAudio(dt); updateDetails(dt, now); updateVoice(now); updateNPC(dt, now); updateDrag(now);
  renderFrame();
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
const OBBY = { start: [1040, 0, 1260], plats: [], checkpoints: [], cp: 0, running: false, t0: 0, best: +localStorage.getItem("g1:bestobby") || 0 };
const OBBY_MAT = {};
setInterval(() => { if (OBBY_MAT.lava) OBBY_MAT.lava.emissiveIntensity = 0.32 + 0.22 * Math.sin(performance.now() * 0.004); }, 50);

// ───────────────────────────── design district: a gallery walk with sculptures on the land ─────────────────────────────
function buildDesignDistrict(o, dir) {
  const sx = Math.cos(dir), sz = Math.sin(dir), px = -sz, pz = sx;
  const wAt = (t) => Math.sin(t / 130 * Math.PI) * 26;
  const walk = []; for (let t = -132; t <= 132; t += 6) walk.push([o[0] + sx * t + px * wAt(t), o[1] + sz * t + pz * wAt(t)]);
  scene.add(ribbon(walk, 3.8, M.deck, 0.42)); for (const sd of [-1, 1]) scene.add(ribbon(walk.map((p) => [p[0] + px * sd * 2.2, p[1] + pz * sd * 2.2]), 0.22, M.steel, 0.6));
  const at = (t, w, kind, rot, sc) => { const x = o[0] + sx * t + px * w, z = o[1] + sz * t + pz * w; if (!MODELS[kind]) return null; put(kind, x, z, rot === undefined ? Math.atan2(o[0] + sx * t - x, o[1] + sz * t - z) : rot, sc || 1); return [x, z]; };
  at(108, 44, MODELS.artpav ? "artpav" : "gallery"); at(-36, -48, "gallery"); at(62, -50, "bigtent"); at(-98, 36, "dome", undefined, 1.25); at(16, 52, "dome", undefined, 1.1); at(-120, -30, MODELS.glamp ? "glamp" : "casita");
  const pieces = ["monolith", "corten", "lantern", "art1", "art2", "art3", "art4", "sculpture", "lantern", "monolith", "sculpture", "corten"]; let i = 0;
  for (let t = -122; t <= 122; t += 21) { const sd = i % 2 ? 1 : -1; const w = wAt(t) + sd * (9 + (i % 3) * 4); const k = pieces[i % pieces.length]; at(t, w, MODELS[k] ? k : "sculpture", rnd() * 6.283, k === "sculpture" ? 0.9 + rnd() * 0.6 : 1); i++; }
  for (let t = -120; t <= 120; t += 30) for (const sd of [-1, 1]) at(t, wAt(t) + sd * 4.6, "lamp");
  for (let k = 0; k < 46; k++) { const t = -145 + rnd() * 290, w = (rnd() < 0.5 ? -1 : 1) * (7 + rnd() * 55); const kind = rnd() < 0.3 ? "boulder" : rnd() < 0.55 ? "bush1" : rnd() < 0.5 ? "ocotillo" : "bush2"; const x = o[0] + sx * t + px * w, z = o[1] + sz * t + pz * w; if (MODELS[kind] && free(x, z, 2)) put(kind, x, z, rnd() * 6.283, 0.6 + rnd() * 0.9); }
  { const pl = []; for (let k = 0; k < 20; k++) { const a = k / 20 * 6.283; pl.push([o[0] + sx * 108 + px * 44 + Math.cos(a) * 30, o[1] + sz * 108 + pz * 44 + Math.sin(a) * 30]); } scene.add(polygon(pl, M.deck, 0.4)); }
  sign(o[0] - sx * 160, o[1] - sz * 160, dir + Math.PI, "THE DESIGN DISTRICT", "STAGE 03 · GALLERY WALK · SCULPTURES ON THE LAND");
  KEEPOUT.push([o[0], o[1], 175]);
}
// remove any building that overlaps another (keeps the larger one)
function dedupeBuildings() {
  const B = []; for (const k in PLACE) { const sp = MODEL_SPECS[k]; if (sp.prop || sp.vehicle || !MODELS[k]) continue; PLACE[k].forEach((e, i) => B.push({ k, i, e, r: MODELS[k].radius * e[4] })); }
  B.sort((a, b) => b.r - a.r); const dead = new Set(); let removed = 0;
  for (let i = 0; i < B.length; i++) { if (dead.has(B[i])) continue; for (let j = i + 1; j < B.length; j++) { if (dead.has(B[j])) continue; const a = B[i], b = B[j]; if (Math.hypot(a.e[0] - b.e[0], a.e[2] - b.e[2]) < (a.r + b.r) * 0.88) { dead.add(b); removed++; } } }
  const gone = [...dead].map((d) => d.e); for (const d of dead) { const list = PLACE[d.k]; const idx = list.indexOf(d.e); if (idx >= 0) list.splice(idx, 1); }
  if (gone.length) { const keep = COLLIDERS.filter((c) => !gone.some((e) => Math.abs(e[0] - c[0]) < 0.01 && Math.abs(e[2] - c[1]) < 0.01)); COLLIDERS.length = 0; COLLIDERS.push(...keep); }
  console.log("dedupe removed", removed, "overlapping buildings");
}
// pools behind villas, ranches and lake houses
function addPools() {
  for (const kind of ["villa", "ranch", "lakehouse", "flagship", "home"]) { const list = PLACE[kind]; if (!list || !MODELS[kind]) continue; const r = MODELS[kind].radius;
    for (const e of list) { if (rnd() > (kind === "lakehouse" || kind === "villa" ? 0.85 : kind === "flagship" ? 0 : 0.45)) continue; const fx = Math.sin(e[3]), fz = Math.cos(e[3]); const w = 5 + rnd() * 3, d = 9 + rnd() * 4; const dist = r * e[4] + d / 2 + 4; const x = e[0] - fx * dist, z = e[2] - fz * dist;
      if (!onLand(x, z) || distToRunway(x, z) < 60 || nearRoad(x, z, 6) || Math.hypot(x - LAKE.x, z - LAKE.z) < lakeShore(x, z) + 10) continue;
      let clash = false; for (const k2 in PLACE) { const sp2 = MODEL_SPECS[k2]; if (sp2.prop || !MODELS[k2]) continue; for (const o of PLACE[k2]) { if (o === e) continue; if (Math.hypot(o[0] - x, o[2] - z) < MODELS[k2].radius * o[4] + 7) { clash = true; break; } } if (clash) break; }
      if (clash) continue; for (const q of POOLS) if (Math.hypot(q.x - x, q.z - z) < 14) { clash = true; break; } if (clash) continue;
      POOLS.push({ x, z, rot: e[3], y: e[1], w, d }); } }
  console.log("pools:", POOLS.length);
}
let POOL_MAT = null;
function buildPoolMeshes() {
  if (!POOLS.length) return;
  POOL_MAT = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) }, uSky: { value: new THREE.Color(0.55, 0.75, 0.95) }, uNight: { value: 0 } },
    vertexShader: `varying vec3 vWP; varying vec2 vUv; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying vec3 vWP; varying vec2 vUv; uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uNight;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); } float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec2 p = vWP.xz; float n1 = noise(p*2.2 + uTime*0.5), n2 = noise(p*3.1 - uTime*0.4); vec3 N = normalize(vec3((n1-0.5)*0.25, 1.0, (n2-0.5)*0.25)); vec3 V = normalize(cameraPosition - vWP); float fres = 0.12 + 0.88 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float nk = 1.0 - uNight * 0.8; vec3 water = mix(vec3(0.08, 0.42, 0.55), vec3(0.16, 0.6, 0.72), noise(p * 0.7 + uTime * 0.2)) * nk; vec3 caust = vec3(0.35) * pow(noise(p * 4.5 + uTime * 0.7) * noise(p * 5.2 - uTime * 0.6), 1.5) * 3.0 * nk;
        vec3 Hh = normalize(V + uSun); float spec = pow(max(dot(N, Hh), 0.0), 300.0) * 2.0; vec3 col = mix(water + caust, uSky * nk, fres * 0.7) + uSunCol * spec * max(uSun.y, 0.0);
        float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y); gl_FragColor = vec4(col, 0.9 * edge + 0.1);
        #include <tonemapping_fragment>
        #include <encodings_fragment> }` });
  const rim = new THREE.BoxGeometry(1, 0.3, 1); const rimMat = M.tile; const deckMat = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.85 }); const lounger = new THREE.BoxGeometry(0.7, 0.3, 1.9); const lMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.8 });
  const rims = new THREE.InstancedMesh(rim, rimMat, POOLS.length * 4), decks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 1), deckMat, POOLS.length), lounges = new THREE.InstancedMesh(lounger, lMat, POOLS.length * 2);
  const WPOS = [], WUV = [], WIDX = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(); let ri = 0, li = 0;
  POOLS.forEach((P, i) => { const y = getH(P.x, P.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.rot); const fx = Math.sin(P.rot), fz = Math.cos(P.rot), rx = Math.cos(P.rot), rz = -Math.sin(P.rot);
    m.compose(v.set(P.x, y + 0.06, P.z), q, sc.set(P.w + 6, 1, P.d + 6)); decks.setMatrixAt(i, m);
    { const g = new THREE.PlaneGeometry(P.w, P.d).rotateX(-Math.PI / 2); g.rotateY(P.rot); g.translate(P.x, y + 0.2, P.z); WPOS.push(...g.attributes.position.array); WUV.push(...g.attributes.uv.array); const base = WIDX.length ? Math.max(...WIDX) + 1 : 0; WIDX.push(...Array.from(g.index.array, (ix) => ix + base)); }
    for (const [ox, oz, w, d] of [[0, P.d / 2 + 0.2, P.w + 0.8, 0.4], [0, -P.d / 2 - 0.2, P.w + 0.8, 0.4], [P.w / 2 + 0.2, 0, 0.4, P.d], [-P.w / 2 - 0.2, 0, 0.4, P.d]]) { m.compose(v.set(P.x + rx * ox + fx * oz, y + 0.27, P.z + rz * ox + fz * oz), q, sc.set(w, 1, d)); rims.setMatrixAt(ri++, m); }
    for (const sd of [-1, 1]) { m.compose(v.set(P.x + rx * (P.w / 2 + 1.6) * sd, y + 0.3, P.z + rz * (P.w / 2 + 1.6) * sd), q, sc.set(1, 1, 1)); lounges.setMatrixAt(li++, m); } });
  rims.count = ri; lounges.count = li; for (const im of [rims, decks, lounges]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(WPOS, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(WUV, 2)); g.setIndex(WIDX); const water = new THREE.Mesh(g, POOL_MAT); water.renderOrder = 3; water.frustumCulled = false; scene.add(water); }
}
// ───────────────────────────── minigames: sky rings, founders' cache, lake lap ─────────────────────────────
function buildMinigames() {
  // Sky Rings: ten rings in a loop over the site for the jet
  { const cx = 300, cz = 300, R = 640; const ringGeo = new THREE.TorusGeometry(16, 1.1, 10, 40); const mOff = new THREE.MeshStandardMaterial({ color: 0x4dde6f, emissive: 0x1b7a35, emissiveIntensity: 0.6, roughness: 0.5 }), mNext = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, emissive: 0xf4cd5a, emissiveIntensity: 1.4 });
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283 - 1.2; const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R; const y = getH(x, z) + 90 + 45 * Math.sin(i * 1.7); const m = new THREE.Mesh(ringGeo, mOff); m.position.set(x, y, z); m.rotation.y = a + Math.PI / 2; scene.add(m); RINGS.list.push({ x, y, z, m }); }
    RINGS.mOff = mOff; RINGS.mNext = mNext; const s0 = RINGS.list[0];
    hotspots.push({ x: 120, z: 60, r: 40, t: "Sky Rings", k: "Minigame · fly the jet", p: "Take Giveback One (press F beside it on the apron), climb, and fly through the ten green rings in order, starting with the gold one. Fastest lap goes on the board (L)." }); }
  // Founders' Cache: twelve $GBACK tokens hidden across the site
  { const spots = [[66, 40], [252 - 60, -497 + 130], [33, -686 - 30], [851, 219 + 120], [600 + 90, 480 - 40], [285, 721 - 100], [-160, 1080 + 60], [LAKE.x + 170, LAKE.z - 60], [-360, 330 + 140], [1040 - 40, 1260 - 30], [-700, -600 + 40], [-800, 300 - 60]];
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 24); geo.rotateX(Math.PI / 2); const mat = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, emissive: 0xaa7a10, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });
    spots.forEach((sp, i) => { const [x, z] = sp; const m = new THREE.Mesh(geo, mat); m.position.set(x, getH(x, z) + 1.2, z); m.castShadow = true; scene.add(m); const id = "c" + i; m.visible = !HUNT.got.has(id); HUNT.coins.push({ id, x, z, m }); });
    hotspots.push({ x: 30, z: 60, r: 26, t: "Founders' Cache", k: "Minigame · treasure hunt", p: "Twelve gold $GBACK tokens are hidden across the site, one near every landmark. Walk into a token to collect it. The compass shows the nearest one you still need. Collect all twelve for the reward and a place on the board." }); }
  // Lake Lap: a cart time trial around the Lakeside loop road
  { const n = 6; for (let i = 0; i < n; i++) { const a = i / n * 6.283; const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200); const x = LAKE.x + Math.cos(a) * (sh + 52), z = LAKE.z + Math.sin(a) * (sh + 52); LAP.gates.push({ x, z, a }); }
    const g0 = LAP.gates[0]; const arch = new THREE.Group(); const post = new THREE.CylinderGeometry(0.25, 0.25, 6, 10); for (const sd of [-1, 1]) { const pm = new THREE.Mesh(post, M.steel); pm.position.set(Math.cos(g0.a + Math.PI / 2) * 5 * sd, 3, Math.sin(g0.a + Math.PI / 2) * 5 * sd); arch.add(pm); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x4dde6f, emissive: 0x1b7a35, emissiveIntensity: 0.6 })); beam.position.y = 6; beam.rotation.y = -(g0.a + Math.PI / 2); arch.add(beam);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "LAKE LAP", size: 110, y: 0.6 }], 512, 120, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide, transparent: true })); lbl.position.y = 7.2; lbl.rotation.y = -(g0.a + Math.PI / 2); arch.add(lbl);
    arch.position.set(g0.x, getH(g0.x, g0.z), g0.z); scene.add(arch); LAP.arch = arch;
    hotspots.push({ x: g0.x, z: g0.z, r: 30, t: "Lake Lap", k: "Minigame · cart time trial", p: "Press C for a cart and drive through the arch to start the clock. One lap of the lake loop road, either direction, through all six gates. Fastest lap goes on the board (L)." }); }
}
function updateMinigames(dt, now) {
  // sky rings
  const jet = riding && riding.kind === "jet" && riding.driver ? VEH[riding.id] : null; const R = RINGS;
  if (jet) { const p = jet.g.position; const target = R.next < 0 ? 0 : R.next; const r = R.list[target]; const d = Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z);
    if (d < 19) { if (R.next < 0) { R.next = 1; R.t0 = now; sfx("coin"); } else { R.next++; sfx("coin"); if (R.next >= R.list.length) { const ms = now - R.t0; R.next = -1; if (!R.best || ms < R.best) { R.best = ms; localStorage.setItem("g1:bestrings", String(ms)); } act({ t: "score", game: "rings", v: Math.round(ms) }); logLine("Sky Rings", `${player.userData.name} flew the rings in ${(ms / 1000).toFixed(2)} s`); } } }
    if (R.next >= 0 || Math.hypot(p.x - R.list[0].x, p.z - R.list[0].z) < 400) { gameHud("rings"); $("#game-n").textContent = "SKY RINGS"; $("#game-big").textContent = R.next < 0 ? "fly through the gold ring" : ((now - R.t0) / 1000).toFixed(2) + " s"; $("#game-s").textContent = `ring ${R.next < 0 ? 1 : R.next + 1} of ${R.list.length}` + (R.best ? ` · best ${(R.best / 1000).toFixed(2)} s` : ""); } }
  else if (R.next >= 0) R.next = -1;
  for (let i = 0; i < R.list.length; i++) { const rg = R.list[i]; const isNext = (R.next < 0 ? 0 : R.next) === i; rg.m.material = isNext ? R.mNext : R.mOff; rg.m.rotation.z = isNext ? now * 0.002 : 0; }
  // founders' cache
  if (!HUNT.done) { for (const c of HUNT.coins) { if (!c.m.visible) continue; c.m.rotation.y = now * 0.003; c.m.position.y = getH(c.x, c.z) + 1.2 + Math.sin(now * 0.004 + c.x) * 0.15; if (!riding && Math.hypot(player.position.x - c.x, player.position.z - c.z) < 2.2) { c.m.visible = false; HUNT.got.add(c.id); if (!HUNT.t0) { HUNT.t0 = now; localStorage.setItem("g1:huntt0", String(Date.now())); } localStorage.setItem("g1:hunt", [...HUNT.got].join(",")); sfx("coin"); emitDust(c.x, getH(c.x, c.z), c.z, 10, 1, 1.2); setStatus(`$GBACK token ${HUNT.got.size} of ${HUNT.coins.length}`);
      if (HUNT.got.size >= HUNT.coins.length) { HUNT.done = true; localStorage.setItem("g1:huntdone", "1"); const ms = Date.now() - (+localStorage.getItem("g1:huntt0") || Date.now()); act({ t: "score", game: "hunt", v: Math.round(Math.min(ms, 3.6e6)) }); logLine("Founders' Cache", `${player.userData.name} found all twelve tokens`); } } } }
  // lake lap
  const L = LAP; const inCart = cartMode || (riding && riding.kind === "cart" && riding.driver); const pp = riding ? VEH[riding.id].g.position : player.position;
  if (inCart) { const g0 = L.gates[0]; if (L.next < 0) { if (Math.hypot(pp.x - g0.x, pp.z - g0.z) < 7) { L.next = 1; L.dir = 0; L.t0 = now; sfx("coin"); } }
    else { const n = L.gates.length;
      if (L.next < n) { const cand = L.dir === 0 ? [[1, 1], [n - 1, -1]] : [[L.dir > 0 ? L.next : n - L.next, L.dir]]; for (const [gi, dr] of cand) { const g = L.gates[gi]; if (g && Math.hypot(pp.x - g.x, pp.z - g.z) < 9) { L.dir = dr; L.next++; sfx("coin"); break; } } }
      else if (Math.hypot(pp.x - g0.x, pp.z - g0.z) < 9) { const ms = now - L.t0; L.next = -1; if (!L.best || ms < L.best) { L.best = ms; localStorage.setItem("g1:bestlap", String(ms)); } act({ t: "score", game: "lap", v: Math.round(ms) }); logLine("Lake Lap", `${player.userData.name} lapped the lake in ${(ms / 1000).toFixed(2)} s`); }
      if (Math.hypot(pp.x - LAKE.x, pp.z - LAKE.z) > LAKE.r + 220) L.next = -1; }
    if (L.next >= 0 || Math.hypot(pp.x - g0.x, pp.z - g0.z) < 60) { gameHud("lap"); $("#game-n").textContent = "LAKE LAP"; $("#game-big").textContent = L.next < 0 ? "drive through the arch" : ((now - L.t0) / 1000).toFixed(2) + " s"; $("#game-s").textContent = (L.next < 0 ? "one lap of the loop road" : `gate ${Math.min(L.next, L.gates.length)} of ${L.gates.length}`) + (L.best ? ` · best ${(L.best / 1000).toFixed(2)} s` : ""); } }
  else if (L.next >= 0) L.next = -1;
  if (L.arch) L.arch.children[1].material.emissiveIntensity = L.next >= 0 ? 1.6 : 0.6;
}
// ───────────────────────────── compass + players list ─────────────────────────────
const cmpc = $("#cmp").getContext("2d"); let plistAt = 0;
function drawCompass(now) {
  const W = 900, Hh = 56; cmpc.clearRect(0, 0, W, Hh); const fwd = yaw + Math.PI; const px = player.position.x, pz = player.position.z; const half = 1.15;
  cmpc.fillStyle = "rgba(10,22,16,.45)"; cmpc.beginPath(); cmpc.roundRect ? cmpc.roundRect(0, 6, W, 44, 12) : cmpc.rect(0, 6, W, 44); cmpc.fill();
  const tick = (rel, label, col, big, sub) => { if (Math.abs(rel) > half) return; const x = W / 2 + rel / half * (W / 2 - 24); const k = 1 - Math.abs(rel) / half * 0.5; cmpc.globalAlpha = 0.35 + 0.65 * k; cmpc.fillStyle = col; cmpc.fillRect(x - 1.5, big ? 8 : 12, 3, big ? 12 : 8); cmpc.font = `${big ? 600 : 500} ${big ? 16 : 13}px 'Space Grotesk', system-ui, sans-serif`; cmpc.textAlign = "center"; cmpc.fillText(label, x, 36); if (sub) { cmpc.font = "500 11px 'JetBrains Mono', monospace"; cmpc.fillStyle = "rgba(245,241,230,.7)"; cmpc.fillText(sub, x, 48); } cmpc.globalAlpha = 1; };
  for (const [lab, ang] of [["N", Math.PI], ["E", Math.PI / 2], ["S", 0], ["W", -Math.PI / 2]]) { let rel = ang - fwd; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); tick(rel, lab, "rgba(245,241,230,.55)", false); }
  let nearest = null, nd = 1e9; const rows = HUBS.map((h) => { const d = Math.hypot(h[1] - px, h[2] - pz); if (d < 70) { if (!VISITED.has(h[0])) { VISITED.add(h[0]); localStorage.setItem("g1:visited", [...VISITED].join(",")); setStatus(`${h[0]} · discovered`); } } if (!VISITED.has(h[0]) && d < nd) { nd = d; nearest = h; } return [h, d]; });
  rows.sort((a, b) => a[1] - b[1]).slice(0, 6).forEach(([h, d]) => { let rel = Math.atan2(h[1] - px, h[2] - pz) - fwd; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); const isNext = h === nearest; tick(rel, h[0], isNext ? "#4dde6f" : VISITED.has(h[0]) ? "rgba(245,241,230,.85)" : "#f4cd5a", isNext, `${d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"}`); });
  if (!HUNT.done) { let bc = null, bd = 1e9; for (const c of HUNT.coins) { if (!c.m.visible) continue; const d = Math.hypot(c.x - px, c.z - pz); if (d < bd) { bd = d; bc = c; } } if (bc && bd < 320) { let rel = Math.atan2(bc.x - px, bc.z - pz) - fwd; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); tick(rel, "$", "#f4cd5a", false, Math.round(bd) + " m"); } }
  if (now - plistAt > 800 && view) { plistAt = now; const el = $("#plist"); el.innerHTML = ""; const others = Object.entries(view.players).filter(([id]) => id !== ME).map(([id, p]) => [id, p, Math.hypot(p.x - px, p.z - pz)]).sort((a, b) => a[2] - b[2]).slice(0, 8);
    for (const [id, p, d] of others) { const row = document.createElement("div"); row.textContent = `${p.name} · ${d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km"}`; row.title = "teleport to " + p.name; row.onclick = () => { warpTo(p.x + 1.2, p.z + 1.2, typeof p.y === "number" ? p.y + 0.4 : undefined); setStatus("teleported to " + p.name); }; el.append(row); }
    el.style.display = others.length ? "" : "none"; }
}
// ───────────────────────────── inventory, catalog and building the site by hand ─────────────────────────────
const CAT = { bench: ["Bench", "Timber bench", "out"], picnic: ["Picnic table", "Cedar table with benches", "out"], firepit: ["Fire pit", "Stone ring, lit at night", "out"], lights: ["String lights", "Pole with warm bulbs", "out"], cactuspot: ["Cactus pot", "Terracotta with a barrel cactus", "out"], fountain: ["Fountain", "Stone bowl fountain", "out"], flag: ["Giveback flag", "Pole with the flag", "out"], signpost: ["Sign post", "Wooden post with a blank sign", "out"], lounger: ["Lounger", "Pool lounger", "out"], umbrella: ["Umbrella", "Cream shade umbrella", "out"], mailbox: ["Mailbox", "Rural mailbox on a post", "out"], boulder: ["Boulder", "Desert boulder", "out"], saguaro: ["Saguaro", "A full cactus", "out"], paloverde: ["Palo verde", "Desert tree", "out"], mesquite: ["Mesquite", "Shade tree", "out"], hottub: ["Hot tub", "Cedar hot tub", "out"], hammock: ["Hammock", "Between two posts", "out"], grill: ["Grill", "Steel barbecue", "out"], cooler: ["Cooler", "Green cooler", "out"],
  table: ["Table", "Round timber table", "in"], chair: ["Chair", "Timber chair", "in"], bed: ["Bed", "Queen bed, linen", "in"], sofa: ["Sofa", "Leather sofa", "in"], rug: ["Rug", "Woven rug", "in"], lamp: ["Floor lamp", "Warm light", "in"], shelf: ["Bookshelf", "Timber shelves", "in"], kitchen: ["Kitchen counter", "Counter with sink", "in"], stool: ["Bar stool", "Leather stool", "in"], cup: ["Cup", "Ceramic cup", "in"], glass: ["Glass", "Water glass", "in"], plate: ["Plate", "Ceramic plate", "in"], bottle: ["Bottle", "Green bottle", "in"], tv: ["TV", "Wall screen", "in"], plant: ["Plant", "Potted desert plant", "in"], art: ["Framed print", "Genesis One print", "in"], bar: ["Bar", "Timber bar with rail", "in"], desk: ["Desk", "Work desk with chair", "in"], fridge: ["Fridge", "Steel fridge", "in"], fireplace: ["Fireplace", "Stone fireplace, lit", "in"], guitar: ["Guitar", "Acoustic on a stand", "in"] };
const BUILD = { on: false, kind: null, ghost: null, ry: 0 }; const PROPS = new Map();
function makeProp(kind, ghost) {
  const g = new THREE.Group(); const wood = new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 }), cream = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.9 }), steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.4, metalness: 0.6 }), stone = new THREE.MeshStandardMaterial({ map: TEX.rock, roughness: 0.95 }), leather = new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.6 }), linen = new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.95 }), green = new THREE.MeshStandardMaterial({ color: 0x2a7a3e, roughness: 0.8 }), glow = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffc070, emissiveIntensity: 1.3 }), fire = new THREE.MeshStandardMaterial({ color: 0xff7a1f, emissive: 0xff5a10, emissiveIntensity: 2 }), terra = new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 }), water = new THREE.MeshStandardMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0.6 }), glass = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.5 });
  const add = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; }; const B = (w, h, d, m, x, y, z, ry) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z, ry); const C = (r1, r2, h, m, x, y, z, n) => add(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, n || 12), m), x, y, z);
  switch (kind) {
    case "bench": B(1.8, 0.08, 0.45, wood, 0, 0.45, 0); B(1.8, 0.4, 0.06, wood, 0, 0.72, -0.2); for (const sx of [-1, 1]) B(0.08, 0.45, 0.4, dark, sx * 0.8, 0.22, 0); break;
    case "picnic": B(1.8, 0.06, 0.8, wood, 0, 0.75, 0); for (const sz of [-1, 1]) B(1.8, 0.05, 0.3, wood, 0, 0.45, sz * 0.7); for (const sx of [-1, 1]) B(0.08, 0.75, 1.6, dark, sx * 0.7, 0.37, 0); break;
    case "firepit": C(0.7, 0.7, 0.35, stone, 0, 0.17, 0, 16); C(0.5, 0.5, 0.36, dark, 0, 0.18, 0, 16); add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 8), fire), 0, 0.6, 0); add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), fire), 0.15, 0.5, 0.1); g.userData.light = 0xff8a30; break;
    case "lights": for (const sx of [-1, 1]) C(0.05, 0.06, 2.6, dark, sx * 1.6, 1.3, 0); B(3.2, 0.02, 0.02, dark, 0, 2.5, 0); for (let k = 0; k < 6; k++) add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glow), -1.25 + k * 0.5, 2.4, 0); break;
    case "cactuspot": C(0.32, 0.25, 0.4, terra, 0, 0.2, 0); C(0.16, 0.18, 0.4, green, 0, 0.6, 0, 10); break;
    case "fountain": C(1.1, 1.0, 0.5, stone, 0, 0.25, 0, 20); C(1.0, 1.0, 0.04, water, 0, 0.52, 0, 20); C(0.12, 0.16, 0.9, stone, 0, 0.9, 0); C(0.45, 0.45, 0.06, stone, 0, 1.36, 0, 16); break;
    case "flag": C(0.05, 0.06, 6, steel, 0, 3, 0); add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), new THREE.MeshBasicMaterial({ map: LOGO_TEX, side: THREE.DoubleSide, transparent: true, color: 0xffffff })), 0.92, 5.4, 0); B(1.9, 1.05, 0.01, green, 0.92, 5.4, -0.01); break;
    case "signpost": C(0.07, 0.08, 2.2, dark, 0, 1.1, 0); B(1.2, 0.5, 0.06, wood, 0, 1.9, 0); break;
    case "lounger": B(0.7, 0.08, 1.9, cream, 0, 0.35, 0); B(0.7, 0.6, 0.08, cream, 0, 0.65, -0.8); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.05, 0.3, 0.05, steel, sx * 0.3, 0.15, sz * 0.85); break;
    case "umbrella": C(0.03, 0.04, 2.4, steel, 0, 1.2, 0); add(new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.45, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.9, side: THREE.DoubleSide })), 0, 2.5, 0); break;
    case "mailbox": C(0.05, 0.06, 1.2, dark, 0, 0.6, 0); B(0.25, 0.25, 0.5, steel, 0, 1.3, 0); break;
    case "boulder": add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 1), stone), 0, 0.5, 0).scale.set(1.3, 0.8, 1); break;
    case "saguaro": case "paloverde": case "mesquite": if (MODELS[kind]) { const m = makeModel(kind); m.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.9, side: THREE.DoubleSide }); }); g.add(m); } else C(0.3, 0.35, 3, green, 0, 1.5, 0); break;
    case "hottub": C(1.1, 1.0, 0.9, wood, 0, 0.45, 0, 20); C(0.95, 0.95, 0.04, water, 0, 0.88, 0, 20); break;
    case "hammock": for (const sx of [-1, 1]) C(0.06, 0.08, 1.6, dark, sx * 1.5, 0.8, 0); B(2.6, 0.04, 0.9, linen, 0, 0.9, 0); break;
    case "grill": B(0.9, 0.35, 0.5, dark, 0, 0.85, 0); B(0.9, 0.3, 0.5, steel, 0, 1.15, 0); for (const sx of [-1, 1]) C(0.03, 0.03, 0.7, steel, sx * 0.35, 0.35, 0); break;
    case "cooler": B(0.6, 0.4, 0.4, green, 0, 0.2, 0); B(0.62, 0.06, 0.42, cream, 0, 0.42, 0); break;
    case "table": C(0.7, 0.7, 0.06, wood, 0, 0.75, 0, 16); C(0.08, 0.2, 0.75, dark, 0, 0.37, 0); break;
    case "chair": B(0.45, 0.05, 0.45, wood, 0, 0.45, 0); B(0.45, 0.5, 0.05, wood, 0, 0.72, -0.2); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.04, 0.45, 0.04, dark, sx * 0.19, 0.22, sz * 0.19); break;
    case "bed": B(1.6, 0.3, 2.0, wood, 0, 0.18, 0); B(1.5, 0.25, 1.9, linen, 0, 0.45, 0); B(1.4, 0.2, 0.5, cream, 0, 0.65, -0.65); B(1.7, 0.9, 0.1, wood, 0, 0.7, -1.0); break;
    case "sofa": B(2.0, 0.5, 0.9, leather, 0, 0.35, 0); B(2.0, 0.55, 0.25, leather, 0, 0.85, -0.33); for (const sx of [-1, 1]) B(0.2, 0.6, 0.9, leather, sx * 0.9, 0.55, 0); break;
    case "rug": B(2.6, 0.03, 1.8, new THREE.MeshStandardMaterial({ color: 0x8a3b2e, roughness: 1 }), 0, 0.02, 0); B(2.2, 0.035, 1.4, new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 1 }), 0, 0.02, 0); break;
    case "lamp": C(0.2, 0.25, 0.04, dark, 0, 0.02, 0); C(0.03, 0.03, 1.5, dark, 0, 0.75, 0); add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e2d3, emissive: 0xffc070, emissiveIntensity: 0.8, side: THREE.DoubleSide })), 0, 1.55, 0); g.userData.light = 0xffc070; break;
    case "shelf": B(1.2, 2.0, 0.35, wood, 0, 1.0, 0); for (let k = 0; k < 4; k++) { B(1.1, 0.03, 0.3, dark, 0, 0.35 + k * 0.45, 0); for (let j = 0; j < 5; j++) B(0.12, 0.28, 0.2, new THREE.MeshStandardMaterial({ color: [0x8a3b2e, 0x2f4a7a, 0x2a7a3e, 0xf4cd5a, 0xe9e2d3][(j + k) % 5] }), -0.4 + j * 0.2, 0.52 + k * 0.45, 0); } break;
    case "kitchen": B(2.0, 0.9, 0.6, cream, 0, 0.45, 0); B(2.0, 0.05, 0.7, stone, 0, 0.93, 0); B(0.5, 0.03, 0.4, steel, 0.5, 0.96, 0); C(0.02, 0.02, 0.3, steel, 0.5, 1.1, -0.15); break;
    case "stool": C(0.2, 0.2, 0.06, leather, 0, 0.72, 0); C(0.03, 0.03, 0.7, steel, 0, 0.35, 0); C(0.18, 0.18, 0.03, steel, 0, 0.02, 0); break;
    case "cup": C(0.05, 0.04, 0.09, cream, 0, 0.045, 0, 10); break;
    case "glass": C(0.035, 0.03, 0.12, glass, 0, 0.06, 0, 10); break;
    case "plate": C(0.13, 0.12, 0.015, cream, 0, 0.008, 0, 16); break;
    case "bottle": C(0.035, 0.035, 0.22, new THREE.MeshStandardMaterial({ color: 0x2a5a3e, transparent: true, opacity: 0.8 }), 0, 0.11, 0, 10); C(0.015, 0.02, 0.08, new THREE.MeshStandardMaterial({ color: 0x2a5a3e }), 0, 0.26, 0, 8); break;
    case "tv": B(1.6, 0.9, 0.05, dark, 0, 1.3, 0); B(1.5, 0.8, 0.02, new THREE.MeshStandardMaterial({ color: 0x0a1610, emissive: 0x1b7a35, emissiveIntensity: 0.5 }), 0, 1.3, 0.03); break;
    case "plant": C(0.3, 0.24, 0.5, terra, 0, 0.25, 0); if (MODELS.bush2) { const m = makeModel("bush2"); m.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.9, side: THREE.DoubleSide }); }); m.scale.setScalar(0.35); add(m, 0, 0.5, 0); } break;
    case "art": add(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "GENESIS ONE", size: 100, y: 0.62 }], 512, 340, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })), 0, 1.6, 0); B(1.3, 0.9, 0.04, dark, 0, 1.6, -0.03); break;
    case "bar": B(2.4, 1.05, 0.6, wood, 0, 0.52, 0); B(2.5, 0.06, 0.7, dark, 0, 1.08, 0); C(0.02, 0.02, 2.4, steel, 0, 0.35, 0.4).rotation.z = Math.PI / 2; for (let k = 0; k < 3; k++) C(0.035, 0.035, 0.22, new THREE.MeshStandardMaterial({ color: [0x2a5a3e, 0x8a3b2e, 0xf4cd5a][k], transparent: true, opacity: 0.85 }), -0.6 + k * 0.6, 1.22, -0.15, 10); break;
    case "desk": B(1.4, 0.05, 0.7, wood, 0, 0.75, 0); for (const sx of [-1, 1]) B(0.05, 0.75, 0.6, dark, sx * 0.65, 0.37, 0); B(0.45, 0.3, 0.02, dark, 0, 1.0, -0.2); B(0.45, 0.45, 0.45, leather, 0, 0.25, 0.7); break;
    case "fridge": B(0.8, 1.9, 0.75, steel, 0, 0.95, 0); B(0.02, 1.2, 0.02, dark, 0.3, 1.0, 0.38); break;
    case "fireplace": B(2.2, 2.4, 0.7, stone, 0, 1.2, 0); B(1.2, 1.0, 0.5, dark, 0, 0.55, 0.15); add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 8), fire), 0, 0.5, 0.2); g.userData.light = 0xff8a30; break;
    case "guitar": C(0.03, 0.03, 0.9, dark, 0, 0.45, -0.1); add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16), wood), 0, 0.35, 0).rotation.x = Math.PI / 2 - 0.3; B(0.05, 0.6, 0.03, dark, 0, 0.75, 0.1); break;
    default: B(0.5, 0.5, 0.5, cream, 0, 0.25, 0);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = !ghost; if (ghost) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.5; o.material.emissive = new THREE.Color(0x4dde6f); o.material.emissiveIntensity = 0.4; } } });
  if (!ghost && g.userData.light) { const pl = new THREE.PointLight(g.userData.light, 0.7, 7, 1.5); pl.position.set(0, 0.8, 0); g.add(pl); }
  return g;
}
function roomKey() { return inside ? inside.door.kind + ":" + inside.door.i : null; }
function toRoomLocal(x, y, z, ry) { const e = inside.door.e; const dx = x - e[0], dz = z - e[2]; return { x: dx * Math.cos(e[3]) - dz * Math.sin(e[3]), y: y - e[1], z: dx * Math.sin(e[3]) + dz * Math.cos(e[3]), ry: ry - e[3] }; }
function startBuild(kind) { closeCards(); if (riding || golf.playing) { setStatus("not while riding or playing", true); return; } if (BUILD.ghost) scene.remove(BUILD.ghost); BUILD.on = true; BUILD.kind = kind; BUILD.ry = player.rotation.y; BUILD.ghost = makeProp(kind, true); scene.add(BUILD.ghost); setStatus(`placing ${CAT[kind][0]} · arrows rotate · Enter or click to place · Esc to cancel`); }
function cancelBuild() { if (BUILD.ghost) scene.remove(BUILD.ghost); BUILD.on = false; BUILD.ghost = null; BUILD.kind = null; }
function buildTarget() { const fwd = [Math.sin(player.rotation.y), Math.cos(player.rotation.y)]; const x = player.position.x + fwd[0] * 2.4, z = player.position.z + fwd[1] * 2.4; const y = inside ? inside.door.e[1] + 0.05 : getH(x, z); return [x, y, z]; }
function updateBuild() { if (!BUILD.on || !BUILD.ghost) return; const [x, y, z] = buildTarget(); BUILD.ghost.position.set(x, y, z); BUILD.ghost.rotation.y = BUILD.ry; }
function placeBuild() { if (!BUILD.on) return; const [x, y, z] = buildTarget(); const kind = BUILD.kind; if (inside) { const l = toRoomLocal(x, y, z, BUILD.ry); act({ t: "prop", op: "add", kind, x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2), ry: +l.ry.toFixed(2), room: roomKey() }); } else act({ t: "prop", op: "add", kind, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), ry: +BUILD.ry.toFixed(2) }); sfx("buy"); emitDust(x, y, z, 6, 0.8, 0.6); cancelBuild(); }
function syncProps() {
  if (!view || !view.props) return; const here = roomKey(); const want = new Set();
  for (const pr of view.props) { const key = pr.id; if (pr.room && pr.room !== here) continue; want.add(key); if (PROPS.has(key)) continue; const g = makeProp(pr.kind, false); g.userData.prop = pr;
    if (pr.room) { g.position.set(pr.x, pr.y, pr.z); g.rotation.y = pr.ry; inside.g.add(g); } else { g.position.set(pr.x, pr.y, pr.z); g.rotation.y = pr.ry; scene.add(g); } PROPS.set(key, g); }
  for (const [key, g] of PROPS) if (!want.has(key)) { if (g.parent) g.parent.remove(g); PROPS.delete(key); }
}
function nearestOwnProp() { if (!view || !view.props) return null; let best = null, bd = 4; for (const [key, g] of PROPS) { const pr = g.userData.prop; if (pr.by !== ME) continue; const wp = new THREE.Vector3(); g.getWorldPosition(wp); const d = Math.hypot(wp.x - player.position.x, wp.z - player.position.z); if (d < bd) { bd = d; best = pr; } } return best; }
function openInventory() {
  if (!view) return; closeCards(); const me = view.players[ME]; const prices = view.prices; const box = $("#inv-list"); box.innerHTML = "";
  const section = (title) => { const h = document.createElement("h3"); h.textContent = title; h.style.marginTop = "10px"; box.append(h); };
  const row = (name, sub, btnText, onclick, disabled) => { const r = document.createElement("div"); const left = document.createElement("div"); const b = document.createElement("b"); b.textContent = name; const sm = document.createElement("span"); sm.textContent = sub; sm.style.opacity = ".7"; left.append(b, document.createElement("br"), sm); r.append(left); if (btnText) { const btn = document.createElement("button"); btn.className = "btn"; btn.style.padding = "6px 12px"; btn.textContent = btnText; btn.disabled = !!disabled; btn.onclick = onclick; r.append(btn); } box.append(r); };
  section("Wearing"); const worn = []; if (me.hat) worn.push(ITEM[me.hat] ? ITEM[me.hat][0] : me.hat); if (me.outfit) worn.push(ITEM[me.outfit] ? ITEM[me.outfit][0] : me.outfit); for (const k in me.gear || {}) worn.push(ITEM[me.gear[k]] ? ITEM[me.gear[k]][0] : me.gear[k]); row(worn.length ? worn.join(" · ") : "Nothing yet", worn.length ? "Take things off below" : "Buy apparel at the General Store on Main Street");
  section("Apparel you own"); const owned = (me.owned || []).filter((it) => ITEM[it]); if (!owned.length) row("Nothing yet", "The General Store sells Giveback merch, hats and outfits");
  for (const it of owned) { let on, toggle; if (it.startsWith("gear_")) { const slot = GEAR_SLOT[it]; on = me.gear && me.gear[slot] === it; toggle = () => act({ t: "wear", gear: { [slot]: on ? null : it } }); } else if (it.startsWith("hat_")) { on = me.hat === it; toggle = () => act({ t: "wear", hat: on ? null : it }); } else { on = me.outfit === it; toggle = () => act({ t: "wear", outfit: on ? null : it }); } row(ITEM[it][0], ITEM[it][1], on ? "Take off" : "Wear", () => { toggle(); sfx("ui"); setTimeout(openInventory, 250); }); }
  section(inside ? "Place inside this room" : "Place on the land"); const want = inside ? "in" : "out"; for (const k in CAT) { if (CAT[k][2] !== want) continue; const price = prices.catalog ? prices.catalog[k] : 0; row(CAT[k][0], `${CAT[k][1]} · ${price} GB`, "Place", () => startBuild(k), me.coins < price); }
  section("Your placed items"); const mine = (view.props || []).filter((p) => p.by === ME); row(`${mine.length} placed`, "Stand next to one of yours and press Delete to remove it. Items stay for everyone.");
  $("#inv-coins").textContent = `${me.coins} GB`; $("#inv").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}
$("#inv-x").addEventListener("click", closeCards);
// ───────────────────────────── lakeside ─────────────────────────────
const LAKE = { x: -930, z: 620, r: 115, level: 0 };
function lakeShore(x, z) { const a = Math.atan2(z - LAKE.z, x - LAKE.x); return LAKE.r * (1 + 0.18 * Math.sin(a * 3 + 0.7) + 0.12 * Math.sin(a * 5 - 1.9) + 0.06 * Math.sin(a * 8 + 2.4)); }
function waterDepthAt(x, z) { if (!LAKE.level) return 0; if (Math.hypot(x - LAKE.x, z - LAKE.z) > lakeShore(x, z) + 6) return 0; return LAKE.level - getH(x, z); }
function lakeDepth(x, z) { const d = Math.hypot(x - LAKE.x, z - LAKE.z) / lakeShore(x, z); return d >= 1 ? 0 : (1 - d * d) * 6.5; }
function buildLake() {
  let sum = 0, n = 0; for (let a = 0; a < 6.283; a += 0.2) { const rr = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200) + 14; sum += getH(LAKE.x + Math.cos(a) * rr, LAKE.z + Math.sin(a) * rr); n++; }
  const rim = sum / n; LAKE.level = rim - 0.6;
  const W = T.xmax - T.xmin, D = T.zmax - T.zmin; const cw = W / (T.cols - 1), ch = D / (T.rows - 1);
  for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) { const x = T.xmin + c * cw, z = T.zmin + r * ch; const d = Math.hypot(x - LAKE.x, z - LAKE.z); if (d > LAKE.r * 1.5 + 60) continue; const sh = lakeShore(x, z); const i = r * T.cols + c;
    if (d < sh) H[i] = LAKE.level - lakeDepth(x, z) - 0.3; else { const t = Math.min(1, (d - sh) / 60); const tt = t * t * (3 - 2 * t); H[i] = H[i] * tt + (rim + 0.35) * (1 - tt); } }
  for (const k in PLACE) PLACE[k] = PLACE[k].filter((e) => Math.hypot(e[0] - LAKE.x, e[2] - LAKE.z) > lakeShore(e[0], e[2]) + (MODEL_SPECS[k].prop ? 5 : 34));
  COLLIDERS.length && (COLLIDERS.splice(0, COLLIDERS.length, ...COLLIDERS.filter((c) => Math.hypot(c[0] - LAKE.x, c[1] - LAKE.z) > lakeShore(c[0], c[1]) + 6)));
  // two grand manors on the north rise, looking down over the water
  if (MODELS.manor) for (const [a, who] of [[-0.75, "FOUNDER'S LAKE HOUSE"], [-1.25, "DEV'S LAKE HOUSE"]]) { const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200); const hx = LAKE.x + Math.cos(a) * (sh + 62), hz = LAKE.z + Math.sin(a) * (sh + 62); const face = Math.atan2(LAKE.x - hx, LAKE.z - hz); put("manor", hx, hz, face, 1); MANORS.push({ x: hx, z: hz, rot: face, who });
    hotspots.push({ x: hx + Math.sin(face) * 30, z: hz + Math.cos(face) * 30, r: 22, t: who, k: "Lakeside · private residence", p: who === "FOUNDER'S LAKE HOUSE" ? "The founder's home on the rise: rammed earth and cedar, glass to the water, an infinity pool on the deck. Fully furnished inside; walk onto the mat." : "The dev's home next door, the same footprint with its own pool and deck. Fully furnished inside; walk onto the mat." }); }
  const hn = 7; for (let i = 0; i < hn; i++) { const a = i / hn * 6.283 + 0.4; const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200); const hx = LAKE.x + Math.cos(a) * (sh + 28), hz = LAKE.z + Math.sin(a) * (sh + 28); const face = Math.atan2(LAKE.x - hx, LAKE.z - hz); if (MODELS.lakehouse) put("lakehouse", hx, hz, face, 1); if (MODELS.dock) put("dock", LAKE.x + Math.cos(a) * (sh - 5), LAKE.z + Math.sin(a) * (sh - 5), face + Math.PI / 2, 1); }
  for (let i = 0; i < 52; i++) { const a = rnd() * 6.283; const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200); const d = sh + 5 + rnd() * 26; const x = LAKE.x + Math.cos(a) * d, z = LAKE.z + Math.sin(a) * d; const r = rnd(); const kind = r < 0.4 && MODELS.fanpalm ? "fanpalm" : r < 0.7 && MODELS.desertwillow ? "desertwillow" : MODELS.ironwood ? "ironwood" : "mesquite"; if (MODELS[kind] && free(x, z, 3)) put(kind, x, z, rnd() * 6.283, 0.8 + rnd() * 0.5); }
  KEEPOUT.push([LAKE.x, LAKE.z, LAKE.r * 1.35 + 30]);
  const loop = []; for (let a = 0; a <= 6.283 + 0.01; a += 0.12) { const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200); loop.push([LAKE.x + Math.cos(a) * (sh + 52), LAKE.z + Math.sin(a) * (sh + 52)]); } scene.add(ribbon(loop, 5, M.dirt, 0.3));
  sign(LAKE.x + LAKE.r + 70, LAKE.z - 60, Math.PI / 2, "LAKESIDE", "MAN-MADE LAKE · LAKE HOUSES · DOCKS · SWIM FROM ANY DOCK");
  for (const m of MANORS) sign(m.x + Math.sin(m.rot) * 34 + Math.cos(m.rot) * 10, m.z + Math.cos(m.rot) * 34 - Math.sin(m.rot) * 10, m.rot + Math.PI, m.who, "PRIVATE RESIDENCE · LAKESIDE");
  hotspots.push({ x: LAKE.x + LAKE.r + 40, z: LAKE.z, r: 45, t: "Lakeside", k: "Man-made lake", p: "A lined, pumped lake on the west side of the Expanse: seven lake houses with docks, fan palms, desert willows and ironwoods around the shore. Walk in from any dock." });
  zoneRings.push({ name: "Lakeside", center: [LAKE.x, LAKE.z], r: LAKE.r + 60, k: "man-made lake · lake houses" });
}
let WATER = null;
function buildWater() {
  const N = 80, S = LAKE.r * 3.4; const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2); const pa = geo.attributes.position; const dep = new Float32Array(pa.count);
  for (let i = 0; i < pa.count; i++) dep[i] = LAKE.level - getH(pa.getX(i) + LAKE.x, pa.getZ(i) + LAKE.z); geo.setAttribute("depth", new THREE.BufferAttribute(dep, 1));
  const rt = new THREE.WebGLRenderTarget(1024, 512, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { tRefl: { value: rt.texture }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) }, uTexMat: { value: new THREE.Matrix4() }, uNight: { value: 0 } },
    vertexShader: `attribute float depth; varying float vDep; varying vec3 vWP; varying vec4 vUvR; uniform mat4 uTexMat; uniform float uTime; void main(){ vDep = depth; vec3 p = position; float dk = clamp(depth, 0.0, 1.0); p.y += (sin(p.x*0.35+uTime*1.3)*0.06 + sin(p.z*0.27-uTime*1.1)*0.06 + sin((p.x+p.z)*0.9+uTime*2.1)*0.025) * dk; vec4 wp = modelMatrix*vec4(p,1.0); vWP = wp.xyz; vUvR = uTexMat*wp; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `varying float vDep; varying vec3 vWP; varying vec4 vUvR; uniform sampler2D tRefl; uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uNight;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){ if (vDep < -0.5) discard; vec2 p = vWP.xz; float n1 = noise(p*0.9 + uTime*0.35), n2 = noise(p*1.7 - uTime*0.27), n3 = noise(p*4.0 + vec2(uTime*0.5,-uTime*0.4)); vec3 N = normalize(vec3((n1-0.5)*0.4 + (n3-0.5)*0.14, 1.0, (n2-0.5)*0.4 + (n3-0.5)*0.14));
        vec3 V = normalize(cameraPosition - vWP); float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0); fres = 0.18 + 0.82*fres;
        vec2 ruv = vUvR.xy / vUvR.w + N.xz * 0.05; vec3 refl = texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb;
        float nk = 1.0 - uNight*0.85; vec3 deep = vec3(0.05,0.15,0.17) * nk; vec3 shallow = vec3(0.3,0.48,0.44) * nk; float dk = clamp(vDep / 4.0, 0.0, 1.0); vec3 water = mix(shallow, deep, dk);
        vec3 Hh = normalize(V + uSun); float spec = pow(max(dot(N, Hh), 0.0), 420.0) * 2.6 + pow(max(dot(N, Hh), 0.0), 36.0) * 0.22;
        vec3 col = mix(water, refl, fres * 0.9) + uSunCol * spec * max(uSun.y, 0.0);
        float foam = smoothstep(0.4, 0.0, vDep) * (0.3 + 0.4*noise(p*6.0 + uTime*0.8)); col = mix(col, vec3(0.88,0.9,0.88) * nk, foam*0.55);
        float alpha = smoothstep(-0.35, 0.45, vDep) * 0.97; gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment> }` });
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(LAKE.x, LAKE.level, LAKE.z); mesh.renderOrder = 4; mesh.frustumCulled = false; scene.add(mesh);
  WATER = { mesh, mat, rt, cam: new THREE.PerspectiveCamera(60, 2, 0.5, 60000), floats: [] };
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, roughness: 0.6 }), buoyMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.5 });
  for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283 + 0.5; const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200) * 0.55; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 12), buoyMat); b.position.set(LAKE.x + Math.cos(a) * sh, LAKE.level + 0.3, LAKE.z + Math.sin(a) * sh); scene.add(b); WATER.floats.push(b); }
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 1.4; const sh = lakeShore(LAKE.x + Math.cos(a) * 200, LAKE.z + Math.sin(a) * 200) * 0.3; const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 3.2), boardMat); b.position.set(LAKE.x + Math.cos(a) * sh, LAKE.level + 0.05, LAKE.z + Math.sin(a) * sh); b.rotation.y = a; scene.add(b); WATER.floats.push(b); }
}
function renderReflection() {
  const Wt = WATER; if (!Wt) return; const dcam = Math.hypot(camera.position.x - LAKE.x, camera.position.z - LAKE.z); Wt.mesh.visible = dcam < 1600; if (dcam > 1000) return;
  const rc = Wt.cam; rc.fov = camera.fov; rc.aspect = camera.aspect; rc.updateProjectionMatrix(); const y0 = LAKE.level;
  rc.position.set(camera.position.x, 2 * y0 - camera.position.y, camera.position.z); const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = -dir.y; rc.up.set(0, -1, 0); rc.lookAt(rc.position.x + dir.x, rc.position.y + dir.y, rc.position.z + dir.z); rc.updateMatrixWorld();
  Wt.mat.uniforms.uTexMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
  Wt.mesh.visible = false; const sm = renderer.shadowMap.enabled; renderer.shadowMap.enabled = false; if (player) player.userData.walk.visible = player.userData.walk.visible; renderer.setRenderTarget(Wt.rt); renderer.render(scene, rc); renderer.setRenderTarget(null); renderer.shadowMap.enabled = sm; Wt.mesh.visible = true;
}

// ───────────────────────────── small details: dust, footprints, tyre tracks, hawks ─────────────────────────────
const FX = { stepDist: 0, trackDist: 0, dustAcc: 0, side: 1 };
// ───────────────────────────── airport traffic: jets land, taxi to the terminal, and depart ─────────────────────────────
const TRAFFIC = { jets: [], next: 0, gate: null };
function spawnTrafficJet(dir) {
  if (!MODELS.jet) return; const g = makeModel("jet"); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 })); beacon.position.set(0, 3.2, 0); g.add(beacon);
  const land = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 4 })); land.position.set(0, 0.6, 10); g.add(land);
  const gateT = -2 + (rnd() - 0.5) * 20; const j = { g, dir, phase: "approach", t: -4200 * dir, s: 0, alt: 230, speed: 92, wait: 30 + rnd() * 45, gateT, beacon, land, heading: 0, pitch: 0 };
  TRAFFIC.jets.push(j); return j;
}
function updateTraffic(dt, now) {
  if (!SITE) return;
  if (now > TRAFFIC.next) { TRAFFIC.next = now + 95000 + rnd() * 80000; if (TRAFFIC.jets.length < 2) spawnTrafficJet(rnd() < 0.5 ? 1 : -1); }
  for (const j of [...TRAFFIC.jets]) { const d = j.dir; let vx = 0, vz = 0;
    const pos = (t, s) => along(t, s);
    if (j.phase === "approach") { j.t += j.speed * d * dt; const k = Math.min(1, Math.max(0, (j.t * d + 4200) / 3400)); j.alt = 230 * (1 - k) * (1 - k); j.pitch = 0.04; if (j.t * d >= -800) { j.phase = "rollout"; j.alt = 0; emitDust(...pos(j.t, 0), 8, 3, 1); } }
    else if (j.phase === "rollout") { j.speed = Math.max(14, j.speed - 22 * dt); j.t += j.speed * d * dt; j.pitch = 0; if (j.t * d >= 200) { j.phase = "taxiOff"; j.t = 200 * d; j.speed = 12; } }
    else if (j.phase === "taxiOff") { j.s += 12 * dt; if (j.s >= 88) { j.s = 88; j.phase = "taxiIn"; } }
    else if (j.phase === "taxiIn") { const dir2 = Math.sign(j.gateT - j.t) || 1; j.t += 12 * dir2 * dt; if (Math.abs(j.t - j.gateT) < 2) { j.t = j.gateT; j.phase = "gate"; j.timer = j.wait; } }
    else if (j.phase === "gate") { j.timer -= dt; if (j.timer <= 0) j.phase = "taxiOut"; }
    else if (j.phase === "taxiOut") { const dir2 = Math.sign(200 * d - j.t) || 1; j.t += 12 * dir2 * dt; if (Math.abs(j.t - 200 * d) < 2) { j.t = 200 * d; j.phase = "taxiOn"; } }
    else if (j.phase === "taxiOn") { j.s -= 12 * dt; if (j.s <= 0) { j.s = 0; j.phase = "takeoff"; j.speed = 5; } }
    else if (j.phase === "takeoff") { j.speed = Math.min(95, j.speed + 9 * dt); j.t += j.speed * d * dt; if (j.speed > 72) { j.alt += (j.alt < 12 ? 6 : 14) * dt; j.pitch = -0.16; } if (j.t * d > 4500) { scene.remove(j.g); TRAFFIC.jets.splice(TRAFFIC.jets.indexOf(j), 1); continue; } }
    const [x, z] = pos(j.t, j.s); const y = getH(x, z) + 1.0 + j.alt; const g = j.g; const dx = x - g.position.x, dz = z - g.position.z;
    if (Math.hypot(dx, dz) > 0.05) { const want = Math.atan2(dx, dz); let dh = want - g.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); g.rotation.y += dh * Math.min(1, dt * (j.phase.startsWith("taxi") ? 2.5 : 6)); }
    if (!g.userData.placed) { g.position.set(x, y, z); g.rotation.y = Math.atan2(U[0] * d, U[1] * d); g.userData.placed = true; } else { g.position.set(x, y, z); }
    g.rotation.x += (j.pitch - g.rotation.x) * Math.min(1, dt * 2);
    j.beacon.material.emissiveIntensity = (now % 1000) < 120 ? 4 : 0.2; j.land.visible = j.phase === "approach" || j.phase === "takeoff" || j.phase === "rollout";
    if ((j.phase === "rollout" || j.phase === "takeoff") && j.speed > 30 && FRAME_N % 3 === 0) emitDust(x - Math.sin(g.rotation.y) * 8, getH(x, z), z - Math.cos(g.rotation.y) * 8, 1, 2, 0.8);
  }
  // engine sound follows the nearest fast jet
  if (audioReady && AUD.traffic) { let best = 0; for (const j of TRAFFIC.jets) { if (j.speed < 30 || !player) continue; const dd = Math.hypot(j.g.position.x - player.position.x, j.g.position.z - player.position.z, (j.g.position.y - player.position.y) * 0.5); best = Math.max(best, Math.max(0, 1 - dd / 900) * Math.min(1, j.speed / 90)); } const want = soundOn ? +AUD.traffic.dataset.vol * best : 0; AUD.traffic.volume += (want - AUD.traffic.volume) * Math.min(1, dt * 2); if (want > 0.01 && AUD.traffic.paused) AUD.traffic.play().catch(() => {}); }
}
function birdTex() { const c = document.createElement("canvas"); c.width = 64; c.height = 32; const x = c.getContext("2d"); x.strokeStyle = "rgba(20,16,12,0.9)"; x.lineWidth = 3; x.lineCap = "round"; x.beginPath(); x.moveTo(4, 20); x.quadraticCurveTo(18, 4, 32, 18); x.quadraticCurveTo(46, 4, 60, 20); x.stroke(); return new THREE.CanvasTexture(c); }
function buildLightPools() {
  const lamps = PLACE.lamp || []; if (!lamps.length) return; const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, "rgba(255,214,150,0.9)"); gr.addColorStop(0.35, "rgba(255,200,130,0.35)"); gr.addColorStop(1, "rgba(255,190,120,0)"); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }); const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), mat, lamps.length); const m = new THREE.Matrix4();
  lamps.forEach((e, i) => { m.makeTranslation(e[0], getH(e[0], e[2]) + 0.08, e[2]); im.setMatrixAt(i, m); }); im.renderOrder = 3; im.frustumCulled = false; scene.add(im); DETAILS.pools = im;
}
// a dust devil wanders the open desert by day
const DEVIL = { pts: null, x: 0, z: 0, vx: 0, vz: 0, life: 0, next: 30 };
function updateDevil(dt, now) {
  if (!FX.dust || !T) return;
  if (DEVIL.life <= 0) { DEVIL.next -= dt; if (DEVIL.next > 0 || night > 0.4) return; DEVIL.next = 90 + Math.random() * 120; let tries = 0; do { DEVIL.x = (Math.random() - 0.5) * 2000; DEVIL.z = (Math.random() - 0.5) * 2000; } while (tries++ < 20 && !free(DEVIL.x, DEVIL.z, 25)); const a = Math.random() * 6.283; DEVIL.vx = Math.cos(a) * 2.5; DEVIL.vz = Math.sin(a) * 2.5; DEVIL.life = 40 + Math.random() * 40; return; }
  DEVIL.life -= dt; DEVIL.x += DEVIL.vx * dt; DEVIL.z += DEVIL.vz * dt; DEVIL.vx += (Math.random() - 0.5) * dt * 2; DEVIL.vz += (Math.random() - 0.5) * dt * 2; if (!onLand(DEVIL.x, DEVIL.z)) DEVIL.life = 0;
  const gy = getH(DEVIL.x, DEVIL.z); for (let k = 0; k < 3; k++) { const h = Math.random() * 14; const r = 0.6 + h * 0.18; const a = now * 0.008 + h * 1.7 + k * 2; emitDust(DEVIL.x + Math.cos(a) * r, gy + h, DEVIL.z + Math.sin(a) * r, 1, 0.3, 1.8); }
}
function buildFX() {
  const N = 700; const g = new THREE.BufferGeometry(); const pos = new Float32Array(N * 3); const alp = new Float32Array(N); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("alpha", new THREE.BufferAttribute(alp, 1));
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, "rgba(255,255,255,0.8)"); gr.addColorStop(0.45, "rgba(255,255,255,0.3)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { tMap: { value: tex }, uCol: { value: new THREE.Color(0xcdb894) } }, vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (1.0 + (1.0 - alpha) * 2.8) * 320.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`, fragmentShader: `uniform sampler2D tMap; uniform vec3 uCol; varying float vA; void main(){ vec4 t = texture2D(tMap, gl_PointCoord); gl_FragColor = vec4(uCol, t.a * vA * 0.5); }` });
  FX.dust = { pts: new THREE.Points(g, mat), pos, alp, vel: new Float32Array(N * 3), life: new Float32Array(N), n: N, i: 0 }; FX.dust.pts.frustumCulled = false; FX.dust.pts.renderOrder = 6; scene.add(FX.dust.pts);
  const mk = (n, w, h) => { const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2e2419, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), n); const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < n; i++) im.setMatrixAt(i, m); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.renderOrder = 2; im.frustumCulled = false; scene.add(im); return { im, n, i: 0 }; };
  FX.prints = mk(180, 0.13, 0.3); FX.tracks = mk(420, 0.15, 1.05);
  buildLightPools();
  FX.birds = []; const bt = birdTex(); for (let f = 0; f < 3; f++) { const cx = (rnd() - 0.5) * 1500, cz = (rnd() - 0.5) * 1500; for (let i = 0; i < 5; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bt, transparent: true, depthWrite: false })); sp.scale.set(2.4, 1.2, 1); scene.add(sp); FX.birds.push({ s: sp, cx, cz, r: 40 + i * 9, a: rnd() * 6.283, h: 75 + i * 6, w: 0.22 + rnd() * 0.1 }); } }
}
function emitDust(x, y, z, n, spread, up) { const D = FX.dust; if (!D) return; for (let k = 0; k < n; k++) { const i = D.i = (D.i + 1) % D.n; D.pos[i * 3] = x + (rnd() - 0.5) * spread; D.pos[i * 3 + 1] = y + 0.15; D.pos[i * 3 + 2] = z + (rnd() - 0.5) * spread; D.vel[i * 3] = (rnd() - 0.5) * 1.4; D.vel[i * 3 + 1] = 0.5 + rnd() * up; D.vel[i * 3 + 2] = (rnd() - 0.5) * 1.4; D.life[i] = 1; D.alp[i] = 1; } }
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _sv = new THREE.Vector3(), _ss = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function stamp(R, x, y, z, rot, sc) { if (!R) return; const i = R.i = (R.i + 1) % R.n; _sm.compose(_sv.set(x, y + 0.03, z), _sq.setFromAxisAngle(_up, rot), _ss.set(sc, 1, sc)); R.im.setMatrixAt(i, _sm); R.im.instanceMatrix.needsUpdate = true; }
function updateFX(dt, now) {
  const D = FX.dust; if (D) { for (let i = 0; i < D.n; i++) { if (D.life[i] <= 0) continue; D.life[i] -= dt * 0.5; D.alp[i] = Math.max(0, D.life[i]); D.pos[i * 3] += D.vel[i * 3] * dt; D.pos[i * 3 + 1] += D.vel[i * 3 + 1] * dt; D.pos[i * 3 + 2] += D.vel[i * 3 + 2] * dt; D.vel[i * 3 + 1] *= 0.96; } D.pts.geometry.attributes.position.needsUpdate = true; D.pts.geometry.attributes.alpha.needsUpdate = true; D.pts.material.uniforms.uCol.value.setRGB(0.8, 0.72, 0.58).multiplyScalar(1 - night * 0.7); }
  if (DETAILS.pools) DETAILS.pools.material.opacity = 0.75 * Math.max(0, night - 0.2) / 0.8;
  if (FX.birds) for (const b of FX.birds) { b.a += b.w * dt; b.s.position.set(b.cx + Math.cos(b.a) * b.r, getH(b.cx, b.cz) + b.h + Math.sin(now * 0.001 + b.r) * 3, b.cz + Math.sin(b.a) * b.r); b.s.material.opacity = 0.9 - night * 0.8; }
  for (const gm of GROUND_MATS) if (gm.userData.sh) gm.userData.sh.uniforms.uTime.value = now / 1000; if (POOL_MAT) { POOL_MAT.uniforms.uTime.value = now / 1000; POOL_MAT.uniforms.uNight.value = night; POOL_MAT.uniforms.uSun.value.copy(sun.position).sub(player ? player.position : new THREE.Vector3()).normalize(); POOL_MAT.uniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity); POOL_MAT.uniforms.uSky.value.copy(scene.fog.color); }
  if (inside && inside.g.userData.bags) { const bags = inside.g.userData.bags, cx = -inside.half + 9, cz = -inside.half + 8; bags.forEach((b, k) => { const a = k / 6 * 6.283 + now * 0.0004; b.position.set(cx + Math.cos(a) * 5, 1.35, cz + Math.sin(a) * 5); b.rotation.y = -a; }); }
  if (WATER) { for (const f of WATER.floats) { f.position.y = LAKE.level + (f.geometry.type === "BoxGeometry" ? 0.05 : 0.3) + Math.sin(now * 0.0016 + f.position.x) * 0.08; f.rotation.z = Math.sin(now * 0.0012 + f.position.z) * 0.06; } WATER.mat.uniforms.uTime.value = now / 1000; WATER.mat.uniforms.uNight.value = night; WATER.mat.uniforms.uSun.value.copy(sun.position).sub(player ? player.position : new THREE.Vector3()).normalize(); WATER.mat.uniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity); }
}

// ───────────────────────────── post-processing: god rays, bloom, aerial haze, grading, FXAA ─────────────────────────────
var POST = { on: !/nopost/.test(location.search), sunUV: new THREE.Vector2(0.5, 0.5), sunVis: 0, hazeCol: new THREE.Color(0xe7d6bd), sunCol: new THREE.Color(1, 0.8, 0.6) };
function initPost() {
  renderer.toneMapping = THREE.NoToneMapping; POST.exposure = 1;
  const mkRT = (w, h, depth) => { const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, encoding: THREE.LinearEncoding, depthBuffer: !!depth, stencilBuffer: false }); if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); } return rt; };
  POST.resize = () => { const w = renderer.domElement.width, h = renderer.domElement.height; if (POST.rt) { POST.rt.dispose(); POST.rays.dispose(); POST.bA.dispose(); POST.bB.dispose(); } POST.rt = mkRT(w, h, true); POST.rays = mkRT(w >> 2, h >> 2); POST.bA = mkRT(w >> 2, h >> 2); POST.bB = mkRT(w >> 2, h >> 2); if (POST.ao) { POST.ao.dispose(); POST.ao2.dispose(); } POST.ao = mkRT(w >> 1, h >> 1); POST.ao2 = mkRT(w >> 1, h >> 1); POST.mAO.uniforms.uPx.value.set(2 / w, 2 / h); POST.mAOBlur.uniforms.uPx.value.set(2 / w, 2 / h); POST.mFinal.uniforms.uPx.value.set(1 / w, 1 / h); POST.mBlur.uniforms.uPx.value.set(4 / w, 4 / h); };
  POST.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); POST.qscene = new THREE.Scene(); POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); POST.quad.frustumCulled = false; POST.qscene.add(POST.quad);
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  POST.mRays = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tDepth: { value: null }, uSun: { value: POST.sunUV }, uStrength: { value: 0 } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tCol; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uStrength;
    void main(){ vec2 d = (uSun - vUv) / 56.0; vec2 uv = vUv; float acc = 0.0, w = 1.0, tw = 0.0; for (int i = 0; i < 56; i++) { uv += d; float z = texture2D(tDepth, uv).x; float sky = step(0.99998, z); vec3 c = texture2D(tCol, uv).rgb; float br = max(0.0, dot(c, vec3(0.333)) - 1.1) * 0.8; acc += min(1.0, sky * 0.9 + br) * w; tw += w; w *= 0.972; } float r = acc / tw; vec2 sd = (vUv - uSun) * vec2(1.0, 0.7); float halo = exp(-dot(sd, sd) * 5.0); gl_FragColor = vec4(vec3(r * uStrength * (0.45 + 0.55 * halo)), 1.0); }` });
  POST.mAO = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uPx: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far }, uAspect: { value: 1 } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tDepth; uniform vec2 uPx; uniform float uNear; uniform float uFar; uniform float uAspect;
    float lin(vec2 uv){ float z = texture2D(tDepth, uv).x; return 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ float z = lin(vUv); if (z > 1500.0) { gl_FragColor = vec4(1.0); return; } float rad = clamp(0.9 / z, 0.0025, 0.06); float ang = hash(vUv * 917.0) * 6.283; float occ = 0.0;
      for (int i = 0; i < 12; i++) { float fi = float(i); float a = ang + fi * 2.399; float r = rad * (0.25 + 0.75 * fract(fi * 0.618 + 0.3)); vec2 o = vec2(cos(a), sin(a) * uAspect) * r; float zs = lin(vUv + o); float dz = z - zs; float rangeK = 1.0 - smoothstep(z * 0.04, z * 0.12, dz); occ += smoothstep(0.0, 1.0, dz / (z * 0.012)) * rangeK; }
      gl_FragColor = vec4(vec3(1.0 - occ / 12.0 * 0.95), 1.0); }` });
  POST.mAOBlur = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tDepth: { value: null }, uPx: { value: new THREE.Vector2() } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tCol; uniform sampler2D tDepth; uniform vec2 uPx; void main(){ float z0 = texture2D(tDepth, vUv).x; float acc = 0.0, tw = 0.0; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) { vec2 uv = vUv + vec2(float(i), float(j)) * uPx * 1.5; float w = 1.0 - min(1.0, abs(texture2D(tDepth, uv).x - z0) * 4000.0); acc += texture2D(tCol, uv).r * w; tw += w; } gl_FragColor = vec4(vec3(acc / max(tw, 0.001)), 1.0); }` });
  POST.mBright = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tCol; void main(){ vec3 c = texture2D(tCol, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(c * smoothstep(1.1, 2.2, l), 1.0); }` });
  POST.mBlur = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, uPx: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tCol; uniform vec2 uPx; uniform vec2 uDir; void main(){ vec2 o = uPx * uDir; vec3 c = texture2D(tCol, vUv).rgb * 0.227; c += (texture2D(tCol, vUv + o * 1.385).rgb + texture2D(tCol, vUv - o * 1.385).rgb) * 0.316; c += (texture2D(tCol, vUv + o * 3.23).rgb + texture2D(tCol, vUv - o * 3.23).rgb) * 0.07; gl_FragColor = vec4(c, 1.0); }` });
  POST.mFinal = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tRays: { value: null }, tAO: { value: null }, uPx: { value: new THREE.Vector2() }, uSun: { value: POST.sunUV }, uSunVis: { value: 0 }, uSunCol: { value: POST.sunCol }, uHaze: { value: POST.hazeCol }, uHazeK: { value: 0.00009 }, uNight: { value: 0 }, uTime: { value: 0 }, uNear: { value: camera.near }, uFar: { value: camera.far }, uExposure: { value: 1 }, uHeat: { value: 0 }, uUnder: { value: 0 } }, vertexShader: vs, fragmentShader: `varying vec2 vUv; uniform sampler2D tCol; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tAO; uniform vec2 uPx; uniform vec2 uSun; uniform float uSunVis; uniform vec3 uSunCol; uniform vec3 uHaze; uniform float uHazeK; uniform float uNight; uniform float uTime; uniform float uNear; uniform float uFar; uniform float uExposure; uniform float uHeat; uniform float uUnder;
    vec3 aces(vec3 x){ x *= 0.6; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 fxaa(vec2 uv){ vec3 rgbNW = texture2D(tCol, uv + vec2(-1.0, -1.0) * uPx).rgb, rgbNE = texture2D(tCol, uv + vec2(1.0, -1.0) * uPx).rgb, rgbSW = texture2D(tCol, uv + vec2(-1.0, 1.0) * uPx).rgb, rgbSE = texture2D(tCol, uv + vec2(1.0, 1.0) * uPx).rgb, rgbM = texture2D(tCol, uv).rgb;
      float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM); float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE))); float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125); float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce); dir = min(vec2(8.0), max(vec2(-8.0), dir * rcp)) * uPx;
      vec3 a = 0.5 * (texture2D(tCol, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tCol, uv + dir * (2.0 / 3.0 - 0.5)).rgb); vec3 b = a * 0.5 + 0.25 * (texture2D(tCol, uv + dir * -0.5).rgb + texture2D(tCol, uv + dir * 0.5).rgb); float lb = luma(b); return (lb < lMin || lb > lMax) ? a : b; }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ float z0 = texture2D(tDepth, vUv).x; float lin0 = 2.0 * uNear * uFar / (uFar + uNear - (z0 * 2.0 - 1.0) * (uFar - uNear)); vec2 uvh = vUv; { float far = smoothstep(900.0, 6000.0, lin0) * (1.0 - step(60000.0, lin0)); float amp = 0.0; uvh += vec2(sin(vUv.y * 90.0 + uTime * 2.7) + sin(vUv.y * 41.0 - uTime * 1.9), cos(vUv.x * 70.0 + uTime * 2.2)) * amp; }
      vec3 c = fxaa(uvh); { vec3 nb = (texture2D(tCol, uvh + vec2(uPx.x, 0.0)).rgb + texture2D(tCol, uvh - vec2(uPx.x, 0.0)).rgb + texture2D(tCol, uvh + vec2(0.0, uPx.y)).rgb + texture2D(tCol, uvh - vec2(0.0, uPx.y)).rgb) * 0.25; c += (c - nb) * 0.32; }
      float ao = texture2D(tAO, vUv).r; c *= mix(1.0, ao, 0.85); float z = texture2D(tDepth, vUv).x; float lin = 2.0 * uNear * uFar / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear)); float isSky = step(60000.0, lin);
      // aerial perspective: distance haze that warms toward the sun
      float haze = (1.0 - exp(-lin * uHazeK)) * (1.0 - isSky) * 0.5; vec2 sd = vUv - uSun; float sunF = exp(-dot(sd, sd) * 2.2) * uSunVis; vec3 hazeCol = mix(uHaze, uSunCol, sunF * 0.75); c = mix(c, hazeCol, haze);
      vec3 rays = texture2D(tRays, vUv).rgb; c += texture2D(tBloom, vUv).rgb * 0.38 + rays * uSunCol * 1.1;
      vec2 fd = sd * vec2(1.0, 0.62); c += uSunCol * exp(-dot(fd, fd) * 700.0) * 0.55 * uSunVis * clamp(rays.r * 3.0, 0.0, 1.0);
      if (uUnder > 0.0) { float wob = sin(vUv.y * 40.0 + uTime * 2.0) * 0.004 * uUnder; c = mix(c, texture2D(tCol, vUv + vec2(wob, 0.0)).rgb, 0.5 * uUnder); c = mix(c, c * vec3(0.35, 0.7, 0.8) + vec3(0.0, 0.05, 0.08), uUnder); c = mix(c, vec3(0.05, 0.25, 0.3), uUnder * (1.0 - exp(-lin * 0.02))); }
      c = aces(c * uExposure * 1.35);
      float l = luma(c); c = mix(vec3(l), c, 1.14); c = (c - 0.5) * 1.04 + 0.5; c = mix(c * vec3(0.93, 0.97, 1.08), c * vec3(1.07, 1.0, 0.92), smoothstep(0.15, 0.85, l));
      c *= mix(0.8, 1.0, smoothstep(1.3, 0.4, length((vUv - 0.5) * vec2(1.25, 1.0)))); c += (hash(vUv + fract(uTime)) - 0.5) * (0.016 + uNight * 0.02); c = max(c, 0.0);
      vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); gl_FragColor = vec4(s, 1.0); }` });
  POST.resize();
}
function renderFrame() {
  if (!POST.rt || !POST.on || document.body.classList.contains("photo")) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera); renderer.toneMapping = THREE.NoToneMapping; return; }
  if ((FRAME_N & 1) === 0) renderReflection();
  renderer.setRenderTarget(POST.rt); renderer.render(scene, camera);
  const pass = (mat, target) => { POST.quad.material = mat; renderer.setRenderTarget(target); renderer.render(POST.qscene, POST.qcam); };
  POST.mRays.uniforms.tCol.value = POST.rt.texture; POST.mRays.uniforms.tDepth.value = POST.rt.depthTexture; POST.mRays.uniforms.uStrength.value = POST.sunVis * 0.9; pass(POST.mRays, POST.rays);
  POST.mAO.uniforms.tDepth.value = POST.rt.depthTexture; POST.mAO.uniforms.uAspect.value = camera.aspect; pass(POST.mAO, POST.ao); POST.mAOBlur.uniforms.tCol.value = POST.ao.texture; POST.mAOBlur.uniforms.tDepth.value = POST.rt.depthTexture; pass(POST.mAOBlur, POST.ao2);
  POST.mBright.uniforms.tCol.value = POST.rt.texture; pass(POST.mBright, POST.bA); POST.mBlur.uniforms.tCol.value = POST.bA.texture; POST.mBlur.uniforms.uDir.value.set(1, 0); pass(POST.mBlur, POST.bB); POST.mBlur.uniforms.tCol.value = POST.bB.texture; POST.mBlur.uniforms.uDir.value.set(0, 1); pass(POST.mBlur, POST.bA);
  const F = POST.mFinal.uniforms; F.tCol.value = POST.rt.texture; F.tDepth.value = POST.rt.depthTexture; F.tBloom.value = POST.bA.texture; F.tRays.value = POST.rays.texture; F.tAO.value = POST.ao2.texture; F.uSunVis.value = POST.sunVis; F.uNight.value = night; F.uTime.value = performance.now() / 1000; F.uExposure.value = POST.exposure; F.uHeat.value = POST.heat || 0; F.uUnder.value = (WATER && camera.position.y < LAKE.level && waterDepthAt(camera.position.x, camera.position.z) > 0) ? 1 : 0; pass(POST.mFinal, null);
}
function plat(x, y, z, w, d, opts) { const o = Object.assign({ x, y, z, w, d, mat: OBBY_MAT.a }, opts || {}); const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), o.mat); m.position.set(x, y - 0.25, z); scene.add(m); o.mesh = m; o.bx = x; o.bz = z; o.by = y; OBBY.plats.push(o); if (o.rail) { for (const sx of [-1, 1]) { const r = box(0.08, 0.9, d, M.steel, x + sx * (w / 2 - 0.05), y + 0.45, z); scene.add(r); o.mesh.userData.rails = (o.mesh.userData.rails || []).concat(r); } } return o; }
function buildObby() {
  const [sx, , sz] = OBBY.start; const gy = getH(sx, sz); OBBY.start[1] = gy;
  OBBY_MAT.a = new THREE.MeshStandardMaterial({ color: 0xc94a3a, roughness: 0.7 }); OBBY_MAT.b = new THREE.MeshStandardMaterial({ color: 0x3a6ac9, roughness: 0.7 }); OBBY_MAT.beam = new THREE.MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.6 });
  OBBY_MAT.cp = new THREE.MeshStandardMaterial({ map: TEX.checker, emissive: 0x1b7a35, emissiveIntensity: 0.35 }); OBBY_MAT.fin = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, emissive: 0x8a6a10, emissiveIntensity: 0.5 });
  OBBY_MAT.blink = new THREE.MeshStandardMaterial({ color: 0xb46ad8, roughness: 0.6, transparent: true }); OBBY_MAT.bounce = new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xaa7a00, emissiveIntensity: 0.5 });
  OBBY_MAT.ice = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }); OBBY_MAT.bar = new THREE.MeshStandardMaterial({ color: 0xff4d2e, emissive: 0x6a1a10, emissiveIntensity: 0.5 });
  const A = OBBY_MAT.a, B = OBBY_MAT.b;
  let x = sx, y = gy + 0.5, z = sz; let cpN = 0;
  const checkpoint = (w) => { plat(x, y, z, w || 6, w || 6, { mat: OBBY_MAT.cp, cp: cpN, rail: true }); OBBY.checkpoints.push([x, y, z]); const lbl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), new THREE.MeshBasicMaterial({ map: textTexture([{ text: cpN === 0 ? "START" : `LEVEL ${cpN + 1}`, size: 110, y: 0.55 }], 512, 170, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide, transparent: true })); lbl.position.set(x, y + 2.2, z + (w || 6) / 2 - 0.3); scene.add(lbl); cpN++; };
  const bar = (p, speed) => { const m = new THREE.Mesh(new THREE.BoxGeometry(p.w * 1.7, 0.3, 0.26), OBBY_MAT.bar); m.position.set(p.x, p.y + 0.5, p.z); scene.add(m); p.bar = { mesh: m, speed, r: p.w * 0.85 }; const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 8), M.steel); hub.position.set(p.x, p.y + 0.55, p.z); scene.add(hub); };
  checkpoint(8);
  sign(sx + 7, sz + 4, -Math.PI / 2, "SKY OBBY", "SIXTEEN LEVELS · SPACE TO JUMP · SHIFT TO RUN · FALL AND YOU RESPAWN");
  // 1 stepping stones
  z -= 6; for (let i = 0; i < 9; i++) { x += (i % 2 ? 1.6 : -1.6); y += 0.55; z -= 2.9; plat(x, y, z, 2.4, 2.4, { mat: i % 2 ? A : B }); } z -= 4.5; y += 0.3; checkpoint();
  // 2 slow movers
  z -= 5; for (let i = 0; i < 7; i++) { z -= 4.2; y += 0.35; plat(x, y, z, 2.6, 2.6, { mat: i % 2 ? A : B, move: { axis: "x", amp: 1.6, speed: 0.55 + i * 0.08, phase: i * 1.3 } }); } z -= 4.8; checkpoint();
  // 3 beams
  z -= 4; for (const b of [[0, -5], [3, -3], [3, -5], [-3, -3], [-3, -5], [0, -4]]) { x += b[0]; z += b[1]; plat(x, y, z, 0.8, Math.abs(b[1]) + 1.2, { mat: OBBY_MAT.beam }); } z -= 4.5; checkpoint();
  // 4 blinkers
  z -= 5; for (let i = 0; i < 8; i++) { x += (i % 2 ? 1.4 : -1.4); z -= 3.0; y += 0.3; plat(x, y, z, 2.4, 2.4, { mat: OBBY_MAT.blink.clone(), blink: { period: 3.2, on: 2.1, phase: i * 0.9 } }); } z -= 4.5; checkpoint();
  // 5 bounce pads
  z -= 5; for (let i = 0; i < 4; i++) { plat(x, y, z, 2.6, 2.6, { mat: OBBY_MAT.bounce, bounce: 11.5 }); z -= 9; y += 1.5; plat(x, y, z, 3.2, 3.2, { mat: i % 2 ? A : B }); z -= 3.5; } z -= 1; checkpoint();
  // 6 lava grid: only the blue tiles hold you, red ones send you back, then a pillar hop
  { z -= 5; OBBY_MAT.lava = new THREE.MeshStandardMaterial({ color: 0xc8341a, emissive: 0xb02008, emissiveIntensity: 0.4, roughness: 0.6 });
    const path = [1, 1, 2, 2, 3, 3, 2, 1, 0, 0, 1, 2]; const cx0 = x;
    for (let r = 0; r < path.length; r++) { z -= 2.2; for (let c = 0; c < 4; c++) { const px = cx0 + (c - 1.5) * 2.2; plat(px, y, z, 2.1, 2.1, c === path[r] ? { mat: B } : { mat: OBBY_MAT.lava, lava: true }); } }
    x = cx0 + (path[path.length - 1] - 1.5) * 2.2;
    for (let i = 0; i < 5; i++) { z -= 2.9; y += 0.5; plat(x, y, z, 1.7, 1.7, { mat: i % 2 ? A : B }); const pil = box(1.2, y - gy + 1, 1.2, M.walk, x, (y + gy) / 2 - 0.3, z); scene.add(pil); }
    z -= 4; y += 0.3; checkpoint(); x = cx0; }
  // 7 zigzag movers on z
  for (let i = 0; i < 8; i++) { x += (i % 2 ? 2.4 : -2.4); z -= 3.2; y += 0.3; plat(x, y, z, 2.4, 2.4, { mat: i % 2 ? B : A, move: { axis: "z", amp: 1.0, speed: 0.7 + i * 0.05, phase: i } }); } z -= 4.5; checkpoint();
  // 8 spinning bars
  z -= 5; for (let i = 0; i < 4; i++) { const p = plat(x, y, z, 6, 6, { mat: i % 2 ? A : B }); bar(p, 0.7 + i * 0.15); z -= 8.6; y += 0.5; } z += 1.5; checkpoint();
  // 9 ice run
  z -= 5; for (let i = 0; i < 6; i++) { x += (i % 2 ? 1.2 : -1.2); z -= 3.1; y += 0.25; plat(x, y, z, 3.0, 3.0, { mat: OBBY_MAT.ice, ice: true }); } z -= 4.5; checkpoint();
  // 10 elevators
  z -= 5; for (let i = 0; i < 4; i++) { plat(x, y, z, 2.6, 2.6, { mat: OBBY_MAT.b, move: { axis: "y", amp: 2.4, speed: 0.5, phase: i * 1.57 } }); z -= 3.2; y += 3.0; plat(x, y, z, 2.6, 2.6, { mat: A }); z -= 3.0; } checkpoint();
  // 11 shrinking platforms
  z -= 5; for (let i = 0; i < 7; i++) { x += (i % 2 ? 1.8 : -1.8); z -= 3.0; y += 0.3; plat(x, y, z, 2.6, 2.6, { mat: i % 2 ? A : B, pulse: { speed: 0.9 + i * 0.1, phase: i } }); } z -= 4.5; checkpoint();
  // 12 fast blink chain over a long drop
  z -= 5; for (let i = 0; i < 9; i++) { z -= 3.0; y += 0.2; plat(x, y, z, 2.2, 2.2, { mat: OBBY_MAT.blink.clone(), blink: { period: 2.2, on: 1.4, phase: i * 0.55 } }); } z -= 4.5; checkpoint();
  // 13 beam gauntlet with bars
  z -= 4; for (let i = 0; i < 3; i++) { const p = plat(x, y, z - 4, 0.9, 8, { mat: OBBY_MAT.beam }); z -= 8; const q = plat(x, y, z - 1, 5, 5, { mat: A }); bar(q, 1.0); z -= 4.5; y += 0.4; } z -= 3; checkpoint();
  // 14 movers + blinkers
  z -= 5; for (let i = 0; i < 8; i++) { z -= 3.2; y += 0.3; x += (i % 2 ? 1.5 : -1.5); plat(x, y, z, 2.4, 2.4, i % 2 ? { mat: OBBY_MAT.blink.clone(), blink: { period: 3, on: 2, phase: i } } : { mat: B, move: { axis: "x", amp: 1.4, speed: 0.8, phase: i } }); } z -= 4.5; checkpoint();
  // 15 bounce and ice
  z -= 5; for (let i = 0; i < 3; i++) { plat(x, y, z, 2.6, 2.6, { mat: OBBY_MAT.bounce, bounce: 12 }); z -= 9.5; y += 1.6; plat(x, y, z, 4, 4, { mat: OBBY_MAT.ice, ice: true }); z -= 4; } checkpoint();
  // 16 the summit tower: a second spiral to the finish
  { const cx = x, cz = z - 10; for (let i = 0; i < 16; i++) { const a = Math.PI / 2 + i / 16 * 6.283 * 1.5; const px = cx + Math.cos(a) * 4.6, pz = cz + Math.sin(a) * 4.6; y += 0.42; plat(px, y, pz, 2.2, 2.2, { mat: i % 2 ? A : B, move: i % 5 === 4 ? { axis: "y", amp: 0.5, speed: 1.1, phase: i } : null }); x = px; z = pz; }
    const fx = cx, fz = cz; y += 1.2; plat(fx, y, fz, 8, 8, { mat: OBBY_MAT.fin, finish: true, rail: true }); OBBY.finish = [fx, y, fz];
    const flag = box(0.08, 4, 0.08, M.steel, fx, y + 2, fz); scene.add(flag); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), M.flag); fl.position.set(fx + 0.8, y + 3.6, fz); scene.add(fl);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "FINISH", size: 110, y: 0.55 }], 512, 160, { bg: "#0a1610", border: "#f4cd5a" }), side: THREE.DoubleSide })); lbl.position.set(fx, y + 5, fz); scene.add(lbl); }
  hotspots.push({ x: sx, z: sz, r: 20, t: "Sky Obby", k: "Minigame · sixteen levels", p: "A Roblox-style climb: stepping stones, movers, beams, blinkers, bounce pads, a lava grid, spinning bars, ice, elevators, shrinking platforms and a summit tower. Checkered pads are checkpoints. Fall or get hit and you respawn at the last one. Fastest run goes on the board (L)." });
  KEEPOUT.push([sx, sz, 120]);
}
function platSolid(p, t) { if (!p.blink) return true; return ((t + p.blink.phase) % p.blink.period) < p.blink.on; }
function surfaceAt(x, z, y) {
  if (inside) return inside.door.e[1] + 0.05;
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
  for (const p of OBBY.plats) { if (p.pulse) { const sc = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * p.pulse.speed + p.pulse.phase)); p.mesh.scale.set(sc, 1, sc); p.w = 2.6 * sc; p.d = 2.6 * sc; }
    if (p.bar) { const a = t * p.bar.speed; p.bar.mesh.rotation.y = a; const dx = player.position.x - p.x, dz = player.position.z - p.z; const d = Math.hypot(dx, dz); if (d < p.bar.r && Math.abs(player.position.y - p.y) < 1.2 && !airborne) { const pa = Math.atan2(-dz, dx); const diff = Math.atan2(Math.sin(pa - a), Math.cos(pa - a)); const diff2 = Math.atan2(Math.sin(pa - a - Math.PI), Math.cos(pa - a - Math.PI)); if (Math.min(Math.abs(diff), Math.abs(diff2)) < 0.1 + 0.16 / Math.max(0.6, d)) { const c = OBBY.checkpoints[OBBY.cp]; player.position.set(c[0], c[1], c[2]); airborne = false; vy = 0; sfx("land"); } } }
    if (p.lava && !airborne && Math.abs(player.position.x - p.x) <= p.w / 2 - 0.12 && Math.abs(player.position.z - p.z) <= p.d / 2 - 0.12 && Math.abs(player.position.y - p.y) < 0.3) { const c = OBBY.checkpoints[OBBY.cp]; player.position.set(c[0], c[1], c[2]); airborne = false; vy = 0; sfx("land"); emitDust(c[0], c[1], c[2], 10, 1, 1); }
    if (p.blink) { const on = platSolid(p, t); p.mesh.material.opacity = on ? 1 : 0.15; p.mesh.visible = true; } if (p.bounce && !airborne && Math.abs(player.position.x - p.x) <= p.w / 2 && Math.abs(player.position.z - p.z) <= p.d / 2 && Math.abs(player.position.y - p.y) < 0.3) { vy = p.bounce; airborne = true; } }
  const near = Math.hypot(player.position.x - OBBY.start[0], player.position.z - OBBY.start[2]) < 260;
  if (!near) { if (OBBY.running) { OBBY.running = false; } return; }
  for (const p of OBBY.plats) { if (p.cp === undefined && !p.finish) continue; const on = Math.abs(player.position.x - p.x) <= p.w / 2 && Math.abs(player.position.z - p.z) <= p.d / 2 && Math.abs(player.position.y - p.y) < 0.4; if (!on) continue;
    if (p.cp === 0 && !OBBY.running) { OBBY.running = true; OBBY.t0 = performance.now(); OBBY.cp = 0; }
    else if (p.cp > OBBY.cp) OBBY.cp = p.cp;
    else if (p.finish && OBBY.running) { const ms = performance.now() - OBBY.t0; OBBY.running = false; if (!OBBY.best || ms < OBBY.best) { OBBY.best = ms; localStorage.setItem("g1:bestobby", String(ms)); } act({ t: "score", game: "obby", v: Math.round(ms) }); logLine("Sky Obby", `${player.userData.name} finished in ${(ms / 1000).toFixed(2)} s`); } }
  // fell off: respawn at the last checkpoint
  { const px = player.position.x, pz = player.position.z; const ground = getH(px, pz) + rampHeight(px, pz); const onGround = !airborne && player.position.y < ground + 0.35; const farFromStart = Math.hypot(px - OBBY.start[0], pz - OBBY.start[2]) > 5.5;
    if (OBBY.running && ((onGround && farFromStart) || player.position.y < OBBY.checkpoints[OBBY.cp][1] - 9)) { const c = OBBY.checkpoints[OBBY.cp]; player.position.set(c[0], c[1], c[2]); airborne = false; vy = 0; mv.x = 0; mv.z = 0; sfx("land"); setStatus(`back to level ${OBBY.cp + 1}`); } }
  if (!golf.playing && !cartMode) { gameHud("obby"); $("#game-n").textContent = "SKY OBBY"; $("#game-big").textContent = OBBY.running ? ((performance.now() - OBBY.t0) / 1000).toFixed(2) + " s" : "step on the green pad"; $("#game-s").textContent = `level ${OBBY.cp + 1} of 16 · space to jump · shift to run · B back to checkpoint` + (OBBY.best ? ` · best ${(OBBY.best / 1000).toFixed(2)} s` : ""); }
}

// ───────────────────────────── interiors: walk into buildings ─────────────────────────────

const DOOR_NAMES = { manor: "lake manor", terminal: "terminal", lakehouse: "lake house", glamp: "glamping tent", flagship: "flagship pavilion", artpav: "gallery pavilion", villa: "villa", ranch: "ranch house", bank: "bank", restaurant: "restaurant", hangar: "hangar", clubhouse: "clubhouse", saloon: "saloon", hotel: "hotel", diner: "diner", fbo: "terminal", store: "shop", barn: "barn", chapel: "chapel", gallery: "gallery", hangarhome: "hangar home" };
let inside = null;
function nearestDoor() {
  let best = null, bd = 1e9;
  for (const kind of DOOR_KINDS) { const list = PLACE[kind]; if (!list || !MODELS[kind]) continue; const r = MODELS[kind].radius;
    list.forEach((e, i) => { const rr = r * e[4]; const fx = e[0] + Math.sin(e[3]) * rr * 0.86, fz = e[2] + Math.cos(e[3]) * rr * 0.86; const d = Math.hypot(player.position.x - fx, player.position.z - fz); if (d < 5 && d < bd) { bd = d; best = { kind, i, e, r: rr }; } }); }
  return best;
}
function furnishTerminal(g, half, hgt) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.5, metalness: 0.6 }), white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7 }), green = new THREE.MeshStandardMaterial({ color: 0x2a7a3e, roughness: 0.7 }), seat = new THREE.MeshStandardMaterial({ color: 0x3f5a6b, roughness: 0.8 }), lit = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 1.6 }), carpet = new THREE.MeshStandardMaterial({ color: 0x1f5a34, roughness: 1 });
  const add = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; };
  const label = (lines, w, h, x, y, z, ry, bg, border) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(lines, 1024, Math.round(1024 * h / w), { bg: bg || "#0a1610", border: border || "#4DDE6F" }), side: THREE.DoubleSide, transparent: true })); return add(m, x, y, z, ry); };
  // ceiling: exposed beams, a grid of lit panels, skylight strips
  for (let k = -3; k <= 3; k++) { add(new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.5, 0.5), steel), 0, hgt - 0.3, k * half / 3.5); add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, half * 2), steel), k * half / 3.5, hgt - 0.55, 0); }
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.2), lit), i * half / 2.6, hgt - 0.08, j * half / 2.6);
  for (let k = -1; k <= 1; k++) add(new THREE.Mesh(new THREE.BoxGeometry(half * 1.6, 0.06, 2.2), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0xdfefff, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 })), 0, hgt - 0.05, k * half * 0.55);
  // structural columns
  for (const [x, z] of [[-14, -12], [14, -12], [-14, 12], [14, 12]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, hgt, 14), steel), x, hgt / 2, z);
  // green carpet path from baggage claim (left, back) to the exit doors (front, centre)
  const path = [[-half + 9, -half + 8], [-half + 9, 6], [0, 6], [0, half - 2]]; for (let i = 0; i < path.length - 1; i++) { const [ax, az] = path[i], [bx, bz] = path[i + 1]; const L = Math.hypot(bx - ax, bz - az); add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, L + 3), carpet), (ax + bx) / 2, 0.08, (az + bz) / 2, Math.atan2(bx - ax, bz - az)); }
  // ARRIVALS: baggage carousel, arrivals board, trolleys
  { const cx = -half + 9, cz = -half + 8; add(new THREE.Mesh(new THREE.TorusGeometry(5, 0.9, 10, 40), dark), cx, 0.5, cz).rotation.x = Math.PI / 2; add(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.9, 32), steel), cx, 0.45, cz); const belt = add(new THREE.Mesh(new THREE.TorusGeometry(5, 0.55, 8, 40), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })), cx, 0.95, cz); belt.rotation.x = Math.PI / 2; g.userData.belt = belt;
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; const bag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.35), new THREE.MeshStandardMaterial({ color: [0x8a2f26, 0x2f4a7a, 0x1c1f24, 0x6d5a3e, 0xd8c39a, 0x4a4a4a][k], roughness: 0.8 })); add(bag, cx + Math.cos(a) * 5, 1.35, cz + Math.sin(a) * 5, -a); (g.userData.bags || (g.userData.bags = [])).push(bag); }
    label([{ text: "ARRIVALS · BAGGAGE CLAIM", size: 72, y: 0.4 }, { text: "GIVEBACK ONE  ·  BISBEE-DOUGLAS INTL  ·  LANDED", size: 44, y: 0.78 }], 12, 2.4, cx, 5.2, -half + 0.3, 0);
    for (let k = 0; k < 3; k++) { add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.9), steel), cx + 9 + k * 0.9, 0.5, cz - 6); } }
  // CHECK-IN: six counters along the back wall under the departures board
  for (let k = 0; k < 6; k++) { const x = -6 + k * 5.2; add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.2), white), x, 0.55, -half + 3); add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 1.4), dark), x, 1.14, -half + 3); add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.05), dark), x + 1.2, 1.4, -half + 2.8); add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), green), x - 1.4, 1.35, -half + 2.9); label([{ text: `CHECK-IN ${k + 1}`, size: 90, y: 0.62 }], 2.2, 0.7, x, 2.6, -half + 0.4, 0, "#2a7a3e", "#f5f1e6"); }
  label([{ text: "DEPARTURES", size: 64, y: 0.14 }, { text: "GB 101   BISBEE-DOUGLAS INTL      GATE A1   ON TIME", size: 40, y: 0.36 }, { text: "GB 204   PHOENIX SKY HARBOR       GATE A2   BOARDING", size: 40, y: 0.52 }, { text: "GB 318   TUCSON                   GATE A3   ON TIME", size: 40, y: 0.68 }, { text: "GB 777   THE EXPANSE (SHUTTLE)    DOOR      NOW", size: 40, y: 0.84 }], 16, 4.2, 7, 6.2, -half + 0.3, 0);
  // SECURITY: stanchion zigzag between check-in and the gates
  { const posts = []; for (let k = 0; k < 8; k++) posts.push([-22 + (k % 2) * 3, -8 + k * 1.6]); posts.forEach((pp, i) => { add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), steel), pp[0], 0.5, pp[1]); add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), steel), pp[0], 0.02, pp[1]); if (i) { const [ax, az] = posts[i - 1]; const L = Math.hypot(pp[0] - ax, pp[1] - az); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, L), dark), (ax + pp[0]) / 2, 0.95, (az + pp[1]) / 2, Math.atan2(pp[0] - ax, pp[1] - az)); } });
    add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8), steel), -22, 1.1, 6); add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.8), steel), -19.5, 0.45, 6); label([{ text: "SECURITY", size: 90, y: 0.62 }], 3, 0.8, -21, 3.2, 5.5, 0, "#1c1f24", "#f4cd5a"); }
  // GATES A1-A4 along the right wall: desks, signs, seating rows facing the glass front
  for (let k = 0; k < 4; k++) { const z = -half + 10 + k * 11; add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 2.6), white), half - 3, 0.55, z, 0); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.6), dark), half - 3, 1.35, z); label([{ text: `GATE A${k + 1}`, size: 96, y: 0.62 }], 3, 1, half - 0.4, 3.4, z, -Math.PI / 2, "#0a1610", "#4DDE6F");
    for (let row = 0; row < 2; row++) for (let c = 0; c < 6; c++) { const x = half - 9 - row * 1.8, zz = z - 4 + c * 1.1; add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.6), seat), x, 0.45, zz); add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.6), seat), x + 0.4, 0.95, zz); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), steel), x - 0.3, 0.22, zz); } }
  // SKY CAFE: counter, stools, menu, and an information desk in the centre
  { const cx = 12, cz = 14; add(new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.4), new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.8 })), cx, 0.55, cz); add(new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 1.6), dark), cx, 1.14, cz); for (let k = 0; k < 5; k++) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12), dark), cx - 2.8 + k * 1.4, 0.72, cz + 1.4); add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), steel), cx - 2.8 + k * 1.4, 0.35, cz + 1.4); } label([{ text: "SKY CAFE", size: 100, y: 0.4 }, { text: "COFFEE · BREAKFAST BURRITOS · PRICKLY PEAR TEA", size: 40, y: 0.78 }], 7, 1.6, cx, 3.6, cz - 1.2, 0, "#3a2a1c", "#f4cd5a"); add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.8, 0.9), steel), cx + 4.5, 0.9, cz - 0.6);
    add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.1, 24, 1, true), white), 0, 0.55, -4); add(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.08, 24), dark), 0, 1.14, -4); label([{ text: "i  INFORMATION", size: 90, y: 0.62 }], 3.4, 0.9, 0, 2.6, -4, 0, "#0a1610", "#8fd8ff"); }
  // planters with desert plants, bins, a clock
  for (const [x, z] of [[-10, 14], [10, -14], [-24, 18], [24, -18], [-4, 18], [18, 2]]) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 })), x, 0.45, z); if (MODELS.bush1) { const b = makeModel(rnd() < 0.5 ? "bush1" : "ocotillo"); b.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.9, side: THREE.DoubleSide }); }); b.scale.setScalar(0.5); add(b, x, 0.85, z, rnd() * 6.283); } add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.9, 10), dark), x + 1.5, 0.45, z); }
  // hanging wayfinding signs
  label([{ text: "EXIT  ·  GENESIS ONE  →", size: 84, y: 0.62 }], 8, 1.4, 0, 6.8, half - 3, 0, "#2a7a3e", "#f5f1e6"); label([{ text: "← BAGGAGE CLAIM   |   GATES A1-A4 →", size: 64, y: 0.62 }], 12, 1.4, 0, 6.8, -10, 0); label([{ text: "SHUTTLE CARTS · TOUR GUIDE · TOWER", size: 60, y: 0.62 }], 10, 1.2, -12, 6.6, half - 6, 0, "#1c1f24", "#8fd8ff");
  label([{ text: "WELCOME TO DOUGLAS MUNICIPAL  ·  EST. 1928", size: 64, y: 0.62 }], 14, 1.4, 0, hgt - 1.4, -half + 0.3, 0, "#0a1610", "#f4cd5a");
}
function furnishManor(g, half, hgt) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }), dark = new THREE.MeshStandardMaterial({ color: 0x2b2624, roughness: 0.8 }), cream = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.85 }), linen = new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.95 }), leather = new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.6 }), steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.35, metalness: 0.7 }), stone = new THREE.MeshStandardMaterial({ map: TEX.rock, roughness: 0.95 }), rugM = new THREE.MeshStandardMaterial({ color: 0x8a3b2e, roughness: 1 }), glow = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffc070, emissiveIntensity: 1.4 }), fire = new THREE.MeshStandardMaterial({ color: 0xff7a1f, emissive: 0xff5a10, emissiveIntensity: 2.2 }), green = new THREE.MeshStandardMaterial({ color: 0x2a7a3e, roughness: 0.9 });
  const add = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; };
  const B = (w, h, d, m, x, y, z, ry) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z, ry);
  const label = (lines, w, h, x, y, z, ry, bg, border) => add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(lines, 1024, Math.round(1024 * h / w), { bg: bg || "#0a1610", border: border || "#4DDE6F" }), side: THREE.DoubleSide, transparent: true })), x, y, z, ry);
  // beams, pendants, a rug and the fireplace wall on the left
  for (let k = -2; k <= 2; k++) B(half * 2, 0.3, 0.3, wood, 0, hgt - 0.15, k * half / 2.6);
  for (const [x, z] of [[-8, -8], [8, -8], [0, 6], [-10, 8]]) { B(0.04, 1.2, 0.04, dark, x, hgt - 0.6, z); add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), glow), x, hgt - 1.25, z); }
  B(6, 0.04, 4.2, rugM, -8, 0.08, 2);
  B(4.6, hgt - 0.2, 0.9, stone, -half + 0.6, (hgt - 0.2) / 2, -4); B(1.6, 1.1, 0.5, dark, -half + 0.85, 0.6, -4); add(new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 8), fire), -half + 0.95, 0.5, -4); add(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8), fire), -half + 0.95, 0.45, -3.6);
  { const fl = new THREE.PointLight(0xff8a30, 0.9, 12, 1.5); fl.position.set(-half + 1.5, 1.2, -4); g.add(fl); }
  // living: sectional, coffee table, TV wall, side tables and plants
  B(4.2, 0.55, 1.1, leather, -8, 0.4, 4); B(4.2, 0.6, 0.3, leather, -8, 0.95, 4.6); B(1.1, 0.55, 3.0, leather, -6.4, 0.4, 2.3); B(0.3, 0.6, 3.0, leather, -5.95, 0.95, 2.3);
  B(1.6, 0.06, 0.9, wood, -8.2, 0.42, 1.8); for (const sx of [-1, 1]) B(0.08, 0.4, 0.08, dark, -8.2 + sx * 0.7, 0.2, 1.8);
  B(2.6, 1.5, 0.08, dark, -8, 1.6, -half + 0.3); B(2.4, 1.3, 0.02, new THREE.MeshStandardMaterial({ color: 0x0a1610, emissive: 0x1b7a35, emissiveIntensity: 0.4 }), -8, 1.6, -half + 0.36); B(3.2, 0.4, 0.5, wood, -8, 0.2, -half + 0.45);
  // dining: long table for eight under the pendants
  B(4.4, 0.08, 1.3, wood, 0, 0.76, 6); for (const sx of [-1, 1]) B(0.12, 0.72, 1.1, dark, sx * 1.9, 0.36, 6); for (let k = 0; k < 4; k++) for (const sz of [-1, 1]) { const x = -1.5 + k * 1.0, z = 6 + sz * 0.95; B(0.45, 0.45, 0.45, linen, x, 0.24, z); B(0.45, 0.5, 0.08, linen, x, 0.7, z + sz * 0.2); }
  for (let k = 0; k < 3; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.04, 12), cream), -1 + k * 1.0, 0.82, 6); add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.5 })), 0.5, 0.9, 5.7);
  // kitchen along the right wall: cabinets, island with stools, fridge, range
  B(7, 0.95, 0.7, cream, half - 1.2, 0.48, -6, Math.PI / 2); B(7, 0.06, 0.8, stone, half - 1.2, 0.98, -6, Math.PI / 2); B(7, 1.0, 0.4, cream, half - 0.3, 2.2, -6, Math.PI / 2);
  B(0.9, 2.0, 0.8, steel, half - 1.0, 1.0, -10.6); B(0.9, 0.95, 0.7, steel, half - 1.2, 0.48, -2.2); B(0.8, 0.05, 0.6, dark, half - 1.2, 1.0, -2.2);
  B(3.2, 0.95, 1.2, dark, half - 5.5, 0.48, -6); B(3.4, 0.06, 1.4, stone, half - 5.5, 0.98, -6); for (let k = 0; k < 3; k++) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), leather), half - 6.5 + k * 1.0, 0.72, -4.9); add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), steel), half - 6.5 + k * 1.0, 0.35, -4.9); }
  for (let k = 0; k < 2; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), cream), half - 5.9 + k * 0.5, 1.07, -6.2);
  // bedroom in the back left: king bed, nightstands, wardrobe, art
  B(2.2, 0.35, 2.4, wood, -half + 4.5, 0.2, -half + 4); B(2.1, 0.3, 2.2, linen, -half + 4.5, 0.5, -half + 4); B(2.1, 0.25, 0.7, cream, -half + 4.5, 0.75, -half + 3); B(2.3, 1.1, 0.12, wood, -half + 4.5, 0.85, -half + 2.7);
  for (const sx of [-1, 1]) { B(0.5, 0.5, 0.5, wood, -half + 4.5 + sx * 1.45, 0.25, -half + 3); add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), glow), -half + 4.5 + sx * 1.45, 0.7, -half + 3); }
  B(1.6, 2.2, 0.6, wood, -half + 8.5, 1.1, -half + 0.5); B(3.2, 0.04, 2.4, rugM, -half + 4.5, 0.08, -half + 6.5);
  // office nook and a bath corner in the back right
  B(1.8, 0.06, 0.8, wood, half - 4, 0.75, -half + 2); B(0.6, 0.02, 0.4, dark, half - 4, 0.79, -half + 2); B(0.5, 0.35, 0.02, dark, half - 4, 1.05, -half + 1.8); B(0.5, 0.5, 0.5, leather, half - 4, 0.3, -half + 3.2); B(1.2, 2.0, 0.35, wood, half - 1.2, 1.0, -half + 1.5); for (let k = 0; k < 4; k++) B(1.1, 0.03, 0.3, dark, half - 1.2, 0.45 + k * 0.45, -half + 1.5);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 0.6, 24), cream), half - 8, 0.3, -half + 2.2); add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0.6 })), half - 8, 0.55, -half + 2.2);
  // art, plants, the Genesis One print
  label([{ text: "GENESIS ONE", size: 120, y: 0.5 }, { text: "THE AWAKENING", size: 48, y: 0.82 }], 2.4, 1.4, 2, 2.3, -half + 0.3, 0, "#0a1610", "#f4cd5a"); label([{ text: "DOUGLAS, ARIZONA · EST. 1928", size: 60, y: 0.6 }], 2.4, 0.8, -3, 2.1, -half + 0.3, 0, "#3a2a1c", "#e9e2d3");
  for (const [x, z] of [[-half + 1.2, half - 2], [half - 1.2, half - 2], [3, -half + 1.2], [-3, 9]]) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.32, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 })), x, 0.3, z); if (MODELS.bush1) { const b = makeModel("bush1"); b.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.9, side: THREE.DoubleSide }); }); b.scale.setScalar(0.45); add(b, x, 0.6, z, rnd() * 6.283); } }
}
function furnishHome(g, kind, r) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9 }), cream = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.9 }), linen = new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.95 }), fabric = new THREE.MeshStandardMaterial({ color: [0x3a4a5a, 0x8a3b2e, 0x2a7a3e, 0x6d5a3e][Math.floor(rnd() * 4)], roughness: 0.85 }), rugM = new THREE.MeshStandardMaterial({ color: [0x8a3b2e, 0x2f4a7a, 0xb5623a][Math.floor(rnd() * 3)], roughness: 1 }), glow = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffc070, emissiveIntensity: 1.2 });
  const add = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; }; const B = (w, h, d, m, x, y, z, ry) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z, ry);
  const h = r * 0.86; const small = h < 5;
  // sofa + coffee table + rug facing the door, lamps in the corners
  B(2.4, 0.5, 0.9, fabric, 0, 0.35, -h * 0.25); B(2.4, 0.55, 0.25, fabric, 0, 0.85, -h * 0.25 - 0.35); B(1.2, 0.06, 0.6, wood, 0, 0.4, -h * 0.25 + 1.2); B(3.4, 0.04, 2.6, rugM, 0, 0.07, -h * 0.25 + 0.8);
  for (const sx of [-1, 1]) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.4, 8), dark), sx * (h - 0.7), 0.7, -h + 0.7); add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glow), sx * (h - 0.7), 1.55, -h + 0.7); }
  // bed against the back wall, nightstand, wardrobe
  B(1.7, 0.3, 2.0, wood, -h * 0.5, 0.18, -h + 1.3); B(1.6, 0.25, 1.9, linen, -h * 0.5, 0.45, -h + 1.3); B(1.5, 0.2, 0.55, cream, -h * 0.5, 0.65, -h + 0.55); B(1.8, 0.9, 0.1, wood, -h * 0.5, 0.7, -h + 0.28);
  B(0.45, 0.5, 0.45, wood, -h * 0.5 + 1.2, 0.25, -h + 0.6); if (!small) B(1.2, 2.0, 0.55, wood, h * 0.55, 1.0, -h + 0.4);
  // kitchenette or dining on the right, table with chairs
  B(2.2, 0.9, 0.6, cream, h - 0.5, 0.45, 0, Math.PI / 2); B(2.2, 0.05, 0.7, dark, h - 0.5, 0.93, 0, Math.PI / 2); add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.05, 12), cream), h - 0.5, 0.98, 0.4); add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.5 })), h - 0.45, 1.03, -0.3);
  if (!small) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 16), wood), h * 0.4, 0.75, h * 0.35); add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.75, 8), dark), h * 0.4, 0.37, h * 0.35); for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283; B(0.4, 0.45, 0.4, dark, h * 0.4 + Math.cos(a) * 1.1, 0.22, h * 0.35 + Math.sin(a) * 1.1); } }
  // a plant and a framed print
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 })), -h + 0.8, 0.25, h - 1.0); if (MODELS.bush2) { const b = makeModel("bush2"); b.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.9, side: THREE.DoubleSide }); }); b.scale.setScalar(0.35); add(b, -h + 0.8, 0.5, h - 1.0); }
  add(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ map: textTexture([{ text: "GENESIS ONE", size: 100, y: 0.62 }], 512, 340, { bg: "#0a1610", border: "#4DDE6F" }) })), 0, 2.0, -h + 0.12);
}
function furnish(g, kind, r) {
  if (kind === "terminal") return furnishTerminal(g, r, 9.5);
  if (kind === "manor") return furnishManor(g, r, 6.2);
  if (["villa", "ranch", "casita", "home", "lakehouse", "glamp", "flagship", "hangarhome", "dome"].includes(kind)) return furnishHome(g, kind, r);
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
  else if (kind === "villa" || kind === "ranch") { add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.0), new THREE.MeshStandardMaterial({ color: 0x3a4a5a })), 0, 0.35, r * 0.3); add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.8), wood), 0, 0.2, r * 0.3 - 1.4); add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111 })), 0, 1.4, -r * 0.8 + 0.1); add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.9, 0.6), cream), -r * 0.45, 0.45, -r * 0.5); table(r * 0.45, -r * 0.3); add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.0), new THREE.MeshStandardMaterial({ color: 0xe9e2d3 })), -r * 0.5, 0.25, r * 0.5); lamps(4); }
  else if (kind === "store" || kind === "barn") { for (let k = 0; k < 3; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, r * 1.2), wood), -r * 0.5 + k * r * 0.5, 1.1, 0); add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, 1.0, 0.7), wood), 0, 0.5, -r * 0.6); lamps(3); }
  else if (kind === "chapel") { for (let k = 0; k < 4; k++) for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.4, 0.9, 0.45), wood), s * r * 0.3, 0.45, -r * 0.5 + k * r * 0.28); add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.6), cream), 0, 0.5, -r * 0.75); for (let k = 0; k < 6; k++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), glow), -0.6 + k * 0.24, 1.2, -r * 0.75); }
  else if (kind === "gallery") { const titles = ["Awakening I", "Runway Light", "Desert Vessel", "Tower Study", "Chiricahua", "Founders"]; for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; const ped = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.8), cream); add(ped, Math.cos(a) * r * 0.45, 0.5, Math.sin(a) * r * 0.45); const art = new THREE.Mesh([new THREE.TorusKnotGeometry(0.3, 0.1, 64, 8), new THREE.OctahedronGeometry(0.4), new THREE.SphereGeometry(0.35, 16, 12)][k % 3], k % 2 ? M.green : M.steel); add(art, Math.cos(a) * r * 0.45, 1.45, Math.sin(a) * r * 0.45); art.userData.spin = 0.3 + k * 0.1; g.userData.spinners = (g.userData.spinners || []).concat(art);
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshBasicMaterial({ map: textTexture([{ text: titles[k], size: 60, y: 0.4 }, { text: "400 GB · press E", size: 34, y: 0.78, color: "#4DDE6F", font: "'Space Grotesk', sans-serif" }], 512, 220, { bg: "#0a1610", border: "#4DDE6F" }), side: THREE.DoubleSide })); add(cap, Math.cos(a) * r * 0.45, 0.6, Math.sin(a) * r * 0.45 + 0.5); }
    for (let k = 0; k < 4; k++) { const wallArt = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshBasicMaterial({ map: textTexture([{ text: ["GENESIS", "ONE", "THE", "AWAKENING"][k], size: 150, y: 0.55, color: ["#4DDE6F", "#f4cd5a", "#f5f1e6", "#ff9180"][k] }], 512, 350, { bg: ["#0a1610", "#1a120c", "#2a1b12", "#0a1610"][k] }) })); const side = k % 2 ? 1 : -1; add(wallArt, side * (r - 0.3), 2.0, -r * 0.5 + Math.floor(k / 2) * r * 0.9, side * -Math.PI / 2); }
    lamps(6); }
}
function fade() { const f = $("#fade"); f.style.opacity = 1; setTimeout(() => { f.style.opacity = 0; }, 260); }
function enterInterior(door) {
  if (inside || riding || golf.playing) return; if (cartMode) toggleCart(); fade();
  const e = door.e, r = door.r; const g = new THREE.Group(); g.position.set(e[0], e[1], e[2]); g.rotation.y = e[3];
  if (door.kind === "terminal") { for (const [lx, lz] of [[-14, -12], [14, -12], [-14, 12], [14, 12], [0, 0]]) { const lamp = new THREE.PointLight(0xfff4e2, 0.55, 60, 1.2); lamp.position.set(lx, 8, lz); g.add(lamp); } const fill = new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.5); g.add(fill); }
  else { const lamp = new THREE.PointLight(0xffe2b8, 1.6, r * 5, 1.4); lamp.position.set(0, 3.4, 0); g.add(lamp); const fill = new THREE.HemisphereLight(0xfff0dc, 0x6a5a48, 0.85); g.add(fill); }
  const isH = door.kind === "hangar" || door.kind === "hangarhome"; const wallMat = door.kind === "manor" ? new THREE.MeshStandardMaterial({ color: 0xd9c8b0, roughness: 0.9, side: THREE.DoubleSide }) : door.kind === "terminal" ? new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.85, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ map: isH ? TEX.corrugated : TEX.adobe, roughness: 0.9, side: THREE.DoubleSide }), floorMat = door.kind === "manor" ? new THREE.MeshStandardMaterial({ color: 0xcfc3ad, roughness: 0.35 }) : door.kind === "terminal" ? new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.25, metalness: 0.05 }) : new THREE.MeshStandardMaterial({ map: isH ? TEX.apron : TEX.wood, roughness: 0.95 });
  const isT = door.kind === "terminal", isM = door.kind === "manor"; const hgt = isT ? 9.5 : isM ? 6.2 : door.kind === "hangar" || door.kind === "hangarhome" ? 7 : 4.4, half = isT ? 27 : isM ? 19 : r * 0.86; const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.95, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }), glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  if (!isH && !isT && !isM) { for (const side of [-1, 1]) for (let k = -1; k <= 1; k++) { const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), glassMat); win.position.set(side * (half - 0.08), 1.9, k * half * 0.5); win.rotation.y = side * Math.PI / 2; g.add(win); const fr = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 1.6), trimMat); fr.position.set(side * (half - 0.05), 1.9, k * half * 0.5); g.add(fr); }
    for (const side of [-1, 1]) { g.add(box(0.06, 0.25, half * 2, trimMat, side * (half - 0.08), 0.12, 0)); } g.add(box(half * 2, 0.25, 0.06, trimMat, 0, 0.12, -half + 0.08)); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.05; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), isH ? wallMat : ceilMat); ceil.rotation.x = Math.PI / 2; ceil.position.y = hgt; g.add(ceil); if (!isH && !isT) for (let k = -1; k <= 1; k++) { const beam = box(half * 2, 0.22, 0.22, trimMat, 0, hgt - 0.11, k * half * 0.6); g.add(beam); }
  g.add(box(half * 2, hgt, 0.2, wallMat, 0, hgt / 2, -half)); g.add(box(0.2, hgt, half * 2, wallMat, -half, hgt / 2, 0)); g.add(box(0.2, hgt, half * 2, wallMat, half, hgt / 2, 0));
  const dw = isT ? 8 : isM ? 4 : door.kind === "hangar" || door.kind === "hangarhome" ? half * 1.2 : 2.2; const frontMat = isT || isM ? glassMat : wallMat; g.add(box(half - dw / 2, hgt, 0.2, frontMat, -(half + dw / 2) / 2, hgt / 2, half)); g.add(box(half - dw / 2, hgt, 0.2, frontMat, (half + dw / 2) / 2, hgt / 2, half)); g.add(box(dw, hgt - (isT ? 4 : 2.4), 0.2, frontMat, 0, hgt - (hgt - (isT ? 4 : 2.4)) / 2, half)); if (isT) { for (let k = -4; k <= 4; k++) { if (k === 0) continue; g.add(box(0.5, hgt, 0.5, trimMat, k * (half / 4.5), hgt / 2, half - 0.2)); } g.add(box(half * 2, 0.6, 0.6, trimMat, 0, hgt - 0.3, half - 0.2)); } if (isM) { for (let k = -3; k <= 3; k++) { if (k === 0) continue; g.add(box(0.3, hgt, 0.3, trimMat, k * (half / 3.5), hgt / 2, half - 0.15)); } g.add(box(half * 2, 0.4, 0.4, trimMat, 0, hgt - 0.2, half - 0.15)); } if (!isH && !isT) { g.add(box(0.14, 2.4, 0.3, trimMat, -dw / 2 - 0.07, 1.2, half)); g.add(box(0.14, 2.4, 0.3, trimMat, dw / 2 + 0.07, 1.2, half)); g.add(box(dw + 0.28, 0.14, 0.3, trimMat, 0, 2.47, half)); }
  furnish(g, door.kind, half); scene.add(g); for (const [k, pg] of PROPS) { if (pg.parent) pg.parent.remove(pg); } PROPS.clear();
  HIDDEN.add(door.kind + ":" + door.i); updateCulling(true);
  const atDoor = () => { const lz = (player.position.x - e[0]) * Math.sin(e[3]) + (player.position.z - e[2]) * Math.cos(e[3]); return lz > half - 3.5; };
  inside = { door, g, half, atDoor, saved: COLLIDERS.filter((c) => Math.hypot(c[0] - e[0], c[1] - e[2]) < 0.01) }; for (const c of inside.saved) { const i = COLLIDERS.indexOf(c); if (i >= 0) COLLIDERS.splice(i, 1); }
  const inX = e[0] + Math.sin(e[3]) * (half - 3), inZ = e[2] + Math.cos(e[3]) * (half - 3); player.position.set(inX, e[1] + 0.05, inZ); player.rotation.y = e[3] + Math.PI; yaw = e[3]; pitch = 0.1; airborne = false; vy = 0; cartSpeed = 0; camera.position.set(inX + Math.sin(e[3]) * 2.5, e[1] + 2.0, inZ + Math.cos(e[3]) * 2.5); lastSent.at = 0; pushMove(true); sfx("ui");
}
let inside_left_at = 0;
function leaveInterior() {
  if (!inside) return; fade(); inside_left_at = performance.now(); player.userData.walk.visible = true; const { door, g } = inside; const e = door.e; scene.remove(g); for (const [k, pg] of PROPS) { if (pg.parent) pg.parent.remove(pg); } PROPS.clear(); cancelBuild();
  HIDDEN.delete(door.kind + ":" + door.i); updateCulling(true);
  COLLIDERS.push(...inside.saved); const outX = e[0] + Math.sin(e[3]) * (door.r * 0.86 + 2.5), outZ = e[2] + Math.cos(e[3]) * (door.r * 0.86 + 2.5); inside = null; player.position.set(outX, getH(outX, outZ), outZ); player.rotation.y = e[3]; airborne = false; vy = 0; yaw = e[3] + Math.PI; camera.position.set(outX + Math.sin(e[3]) * 6, getH(outX, outZ) + 3, outZ + Math.cos(e[3]) * 6); lastSent.at = 0; pushMove(true); sfx("ui");
}

// ───────────────────────────── small things that make it a place ─────────────────────────────

function buildDetails() {
  const Z = SITE.zones; const bench = new THREE.BoxGeometry(1.8, 0.1, 0.5), benchLeg = new THREE.BoxGeometry(0.1, 0.45, 0.45);
  const benches = new THREE.InstancedMesh(bench, M.wood, 260), legs = new THREE.InstancedMesh(benchLeg, M.post, 520); const mt = new THREE.Matrix4(); let k = 0, kl = 0;
  const putBench = (x, z, ry) => { if (k >= 260) return; const y = getH(x, z); mt.makeRotationY(ry); mt.setPosition(x, y + 0.5, z); benches.setMatrixAt(k++, mt); for (const s of [-0.7, 0.7]) { mt.makeRotationY(ry); mt.setPosition(x + Math.cos(ry) * s, y + 0.225, z - Math.sin(ry) * s); legs.setMatrixAt(kl++, mt); } };
  for (const lp of PLACE.lamp || []) if (rnd() < 0.7) putBench(lp[0] + Math.sin(lp[3]) * 1.6, lp[2] + Math.cos(lp[3]) * 1.6, lp[3] + Math.PI / 2);
  for (const c of [Z.landing.center, Z.expanse.center, [0, 60]]) for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, d = 20 + rnd() * 40; putBench(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, rnd() * 6.283); }
  benches.count = k; legs.count = kl; scene.add(benches); scene.add(legs);
  // fingerposts: every junction points the way, with distances
  { const Z = SITE.zones; const targets = [["The Tower", 0, 0], ["The Landing", Z.landing.center[0], Z.landing.center[1]], ["The Expanse", Z.expanse.center[0], Z.expanse.center[1]], ["Flight Line", Z.flightline.center[0], Z.flightline.center[1]], ["Desert Golf", GOLF.origin[0], GOLF.origin[1]], ["Cart Course", COURSE.origin[0], COURSE.origin[1]], ["Sky Obby", OBBY.start[0], OBBY.start[2]], ["Drag Strip", DRAG.origin[0], DRAG.origin[1]], ["Founders Row", 33, -686], ["Lakeside", LAKE.x, LAKE.z], ["The Commons", 285, 721], ["Design District", 600, 480]];
    const spots = [[0, 95], [Z.landing.center[0] - 120, Z.landing.center[1] + 250], [Z.expanse.center[0] - 200, Z.expanse.center[1] - 40], [Z.flightline.center[0] + 40, Z.flightline.center[1] + 60], [GOLF.origin[0], GOLF.origin[1] - 75], [COURSE.origin[0] + 150, COURSE.origin[1]], [OBBY.start[0] - 14, OBBY.start[2] + 14], [-300, 500], [440, 600], [-450, -150], [880, -280], [LAKE.x + 200, LAKE.z + 10], [285, 921], [600, 330], [-620, 470], [150, -250]];
    for (const sp of spots) { const [x, z] = sp; const y = getH(x, z); const pole = box(0.16, 3.4, 0.16, M.post, x, y + 1.7, z); scene.add(pole); const near = targets.map((t) => [t, Math.hypot(t[1] - x, t[2] - z)]).filter((t) => t[1] > 40).sort((a, b) => a[1] - b[1]).slice(0, 4);
      near.forEach(([t, d], i) => { const ang = Math.atan2(t[1] - x, t[2] - z); const fg = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.06), [M.wood, M.wood, M.wood, M.wood, new THREE.MeshBasicMaterial({ map: textTexture([{ text: `${t[0]} · ${Math.round(d / 10) * 10} m`, size: 44, y: 0.6, color: "#f5f1e6", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 96, { bg: "#2a7a3e" }) }), new THREE.MeshBasicMaterial({ map: textTexture([{ text: `${t[0]} · ${Math.round(d / 10) * 10} m`, size: 44, y: 0.6, color: "#f5f1e6", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 96, { bg: "#2a7a3e" }) })]); fg.position.set(x + Math.sin(ang) * 0.85, y + 3.1 - i * 0.42, z + Math.cos(ang) * 0.85); fg.rotation.y = ang + Math.PI / 2; scene.add(fg); }); } }
  // planters with cactus at every shop front, hitching posts on main street, bins by the lamps
  { const pot = new THREE.CylinderGeometry(0.45, 0.35, 0.5, 10), potMat = new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 }); const pots = new THREE.InstancedMesh(pot, potMat, 400); const cac = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 0.75, 8), M.scrub, 400); let kp = 0; const mt = new THREE.Matrix4();
    for (const kind of ["store", "saloon", "hotel", "diner", "gallery", "fbo"]) for (const e of PLACE[kind] || []) { if (!MODELS[kind] || kp > 396) continue; const rr = MODELS[kind].radius * e[4] * 0.86; for (const sd of [-1, 1]) { const x = e[0] + Math.sin(e[3]) * rr + Math.cos(e[3]) * sd * 2.2, z = e[2] + Math.cos(e[3]) * rr - Math.sin(e[3]) * sd * 2.2; mt.makeTranslation(x, e[1] + 0.25, z); pots.setMatrixAt(kp, mt); mt.makeTranslation(x, e[1] + 0.85, z); cac.setMatrixAt(kp++, mt); } }
    pots.count = kp; cac.count = kp; scene.add(pots); scene.add(cac);
    const postG = new THREE.BoxGeometry(0.16, 1.0, 0.16), railG = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6); const posts = new THREE.InstancedMesh(postG, M.post, 200), rails = new THREE.InstancedMesh(railG, M.post, 100); let kh = 0, kr = 0;
    for (const kind of ["saloon", "hotel"]) for (const e of PLACE[kind] || []) { if (!MODELS[kind] || kr > 98) continue; const rr = MODELS[kind].radius * e[4] * 0.86 + 3.2; const cx = e[0] + Math.sin(e[3]) * rr, cz = e[2] + Math.cos(e[3]) * rr; for (const sd of [-1, 1]) { mt.makeRotationY(e[3]); mt.setPosition(cx + Math.cos(e[3]) * sd * 1.1, e[1] + 0.5, cz - Math.sin(e[3]) * sd * 1.1); posts.setMatrixAt(kh++, mt); } mt.makeRotationY(e[3]); mt.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)); mt.setPosition(cx, e[1] + 0.95, cz); rails.setMatrixAt(kr++, mt); }
    posts.count = kh; rails.count = kr; scene.add(posts); scene.add(rails);
    const binG = new THREE.CylinderGeometry(0.28, 0.25, 0.8, 10), binMat = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.8, metalness: 0.3 }); const bins = new THREE.InstancedMesh(binG, binMat, 120); let kb = 0; for (const lp of (PLACE.lamp || [])) { if (kb >= 120) break; if (rnd() < 0.5) continue; mt.makeTranslation(lp[0] - Math.sin(lp[3]) * 0.9, lp[1] + 0.4, lp[2] - Math.cos(lp[3]) * 0.9); bins.setMatrixAt(kb++, mt); } bins.count = kb; scene.add(bins);
    // mailboxes and a parked cart at some homes
    const mbG = new THREE.BoxGeometry(0.22, 0.2, 0.42), mbMat = new THREE.MeshStandardMaterial({ color: 0x24303a, roughness: 0.6, metalness: 0.5 }); const mbs = new THREE.InstancedMesh(mbG, mbMat, 400), mbp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), M.post, 400); let km = 0;
    for (const hk of HOME_KINDS) for (const e of PLACE[hk] || []) { if (km >= 400 || rnd() < 0.45 || !MODELS[hk]) continue; const rr = MODELS[hk].radius * e[4] + 2.5; const x = e[0] + Math.sin(e[3]) * rr + Math.cos(e[3]) * 2.5, z = e[2] + Math.cos(e[3]) * rr - Math.sin(e[3]) * 2.5; mt.makeRotationY(e[3]); mt.setPosition(x, e[1] + 1.1, z); mbs.setMatrixAt(km, mt); mt.makeTranslation(x, e[1] + 0.5, z); mbp.setMatrixAt(km++, mt); }
    mbs.count = km; mbp.count = km; scene.add(mbs); scene.add(mbp);
    if (MODELS.cart) { for (const hk of HOME_KINDS) for (const e of (PLACE[hk] || [])) { if (rnd() < 0.9 || !MODELS[hk]) continue; const rr = MODELS[hk].radius * e[4] + 3; put("cart", e[0] + Math.sin(e[3]) * rr - Math.cos(e[3]) * 3, e[2] + Math.cos(e[3]) * rr + Math.sin(e[3]) * 3, e[3] + 0.4 + rnd() * 0.3); } }
    // street name signs at the Expanse grid corners
    const c = SITE.zones.expanse.center, dir = heading + Math.PI / 2, dx = Math.cos(dir), dz = Math.sin(dir), px = Math.cos(dir + Math.PI / 2), pz = Math.sin(dir + Math.PI / 2);
    const names = [["MAIN STREET", 0, 0], ["FRONTIER AVE", 0, 110], ["MESQUITE ROW", 0, -110], ["EAST CROSS", 150, 0], ["WEST CROSS", -150, 0]];
    for (const [nm, a, b] of names) { const x = c[0] + dx * a + px * b + dx * 20, z = c[1] + dz * a + pz * b + dz * 20; const pole = box(0.08, 3, 0.08, M.steel, x, getH(x, z) + 1.5, z); scene.add(pole); const sgn = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.4), new THREE.MeshBasicMaterial({ map: textTexture([{ text: nm, size: 70, y: 0.56, color: "#f5f1e6", font: "'Space Grotesk', sans-serif", weight: 600 }], 512, 112, { bg: "#2a7a3e" }), side: THREE.DoubleSide })); sgn.position.set(x, getH(x, z) + 2.8, z); sgn.rotation.y = a === 0 ? dir : dir + Math.PI / 2; scene.add(sgn); } }
  // fire pits at the glamping field, the landing and the expanse
  const pitGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.4, 12), flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0 });
  for (const c of [[-800, 300], [Z.landing.center[0] - 40, Z.landing.center[1] + 60], [Z.expanse.center[0] + 60, Z.expanse.center[1] + 240], [Z.expanse.center[0] - 260, Z.expanse.center[1] + 300]]) { for (let i = 0; i < 2; i++) { const x = c[0] + (rnd() - 0.5) * 60, z = c[1] + (rnd() - 0.5) * 60; if (!free(x, z, 3)) continue; const pit = new THREE.Mesh(pitGeo, M.tire); pit.position.set(x, getH(x, z) + 0.2, z); scene.add(pit); const fl = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 7), flameMat); fl.position.set(x, getH(x, z) + 0.9, z); scene.add(fl); DETAILS.fires.push(fl); for (let j = 0; j < 4; j++) { const a = j / 4 * 6.283; putBench(x + Math.cos(a) * 2.4, z + Math.sin(a) * 2.4, -a + Math.PI / 2); } } }
  DETAILS.flameMat = flameMat;
  // lamp bulbs: a bright core and a soft halo billboard on every lamp head
  { const heads = (PLACE.lamp || []).map((lp) => [lp[0], lp[1] + 3.55, lp[2]]); const core = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd48a, emissiveIntensity: 0 }), heads.length); const mt = new THREE.Matrix4(); heads.forEach((h, i) => { mt.makeTranslation(h[0], h[1], h[2]); core.setMatrixAt(i, mt); }); scene.add(core); DETAILS.bulbs = core.material;
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,225,160,0.55)"); g.addColorStop(0.2, "rgba(255,200,120,0.22)"); g.addColorStop(0.55, "rgba(255,180,90,0.06)"); g.addColorStop(1, "rgba(255,180,90,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(heads.flat(), 3)); DETAILS.halo = new THREE.Points(hg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 2.6, transparent: true, opacity: 0, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, sizeAttenuation: true })); scene.add(DETAILS.halo); }
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
  $("#coins").textContent = (p.coins || 0).toLocaleString(); $("#gback").textContent = (p.coins || 0).toLocaleString() + " $GBACK"; $("#rank").textContent = rank + (nr ? ` · ${nr[0] - (p.xp || 0)} xp to ${nr[1]}` : " · top rank"); $("#energy").style.width = (p.energy === undefined ? 100 : p.energy) + "%";
  if (lastRank && rank !== lastRank) { logLine("Genesis One", `${p.name} is now a ${rank}`); sfx("rank"); } lastRank = rank;
  if (lastCoins !== null && (p.coins || 0) > lastCoins) sfx("coin"); lastCoins = p.coins || 0;
}
setInterval(() => { if (introduced && document.hasFocus()) act({ t: "tick" }); }, 60000);
const VENUE = { restaurant: { title: "The Awakening Restaurant", k: "Fine dining", items: ["coffee", "meal"] }, bank: { title: "Genesis Bank", k: "Your $GBACK balance", items: [] }, store: { title: "General Store", k: "Outfitters · Main Street", items: ["gear_tee_gb", "gear_tee_black", "gear_hoodie_gb", "gear_jersey_gb", "gear_vest_crew", "hat_cap", "hat_trucker", "hat_beanie", "hat_cowboy", "hat_band", "gear_shades", "gear_bandana", "gear_scarf", "gear_chain", "gear_backpack_gb", "gear_watch", "gear_lanyard", "outfit_flight", "outfit_ranch", "outfit_desert"] }, diner: { title: "Flight Line Diner", k: "Restaurant", items: ["coffee", "meal"] }, saloon: { title: "The Saloon", k: "Bar and kitchen", items: ["coffee", "meal"] }, hotel: { title: "Hotel Kitchen", k: "Restaurant", items: ["coffee", "meal"] }, gallery: { title: "Design District Gallery", k: "Art for your lot", items: ["art"] }, fbo: { title: "Terminal Shop", k: "Pilot supplies", items: ["coffee", "hat_cap", "outfit_flight"] } };
const ITEM = { hat_trucker: ["GB trucker hat", "Mesh back, Giveback front"], hat_beanie: ["Desert beanie", "Cold nights out here"], gear_tee_gb: ["Giveback tee", "White tee, green Giveback logo"], gear_tee_black: ["Giveback tee · black", "Black tee, green logo"], gear_hoodie_gb: ["Giveback hoodie", "Green hoodie, logo on the chest"], gear_vest_crew: ["Ground crew vest", "Hi-vis over anything"], gear_jersey_gb: ["Genesis jersey", "Gold and green, number 01"], gear_shades: ["Aviator shades", "For the glare"], gear_bandana: ["Bandana", "Red, Douglas style"], gear_scarf: ["Desert scarf", "Sand and cream"], gear_chain: ["$GBACK chain", "Gold coin on a chain"], gear_backpack_gb: ["Giveback backpack", "Green pack with the logo"], gear_watch: ["Pilot watch", "Steel, left wrist"], gear_lanyard: ["Crew lanyard", "Green, with your pass"], hat_cap: ["Giveback cap", "Green cap with the arrow"], hat_band: ["Desert headband", "Keeps the sun off"], hat_cowboy: ["Cowboy hat", "Douglas classic"], outfit_desert: ["Desert outfit", "Sand shirt, earth pants"], outfit_ranch: ["Ranch outfit", "Red shirt, denim"], outfit_flight: ["Flight crew outfit", "Giveback One crew colours"], coffee: ["Coffee", "+40 energy"], meal: ["Full meal", "Energy back to 100"], art: ["Gallery piece", "A sculpture for your lot"] };
function openShop(kind) {
  const v = VENUE[kind]; if (!v || !view) return; const me = view.players[ME]; const prices = view.prices.shop;
  $("#shop-h").textContent = v.title; $("#shop-k").textContent = v.k; const list = $("#shop-list"); list.innerHTML = "";
  for (const it of v.items) { if (!ITEM[it] || prices[it] === undefined) continue; const row = document.createElement("div"); const owned = (me.owned || []).includes(it); const wearing = me.hat === it || me.outfit === it; const b = document.createElement("b"); b.textContent = ITEM[it][0]; const sm = document.createElement("span"); sm.textContent = ITEM[it][1] + " · " + prices[it] + " GB"; sm.style.opacity = ".7"; const btn = document.createElement("button"); btn.className = "btn"; btn.style.padding = "6px 12px";
    if (owned && it.startsWith("gear_")) { const slot = GEAR_SLOT[it]; const on = me.gear && me.gear[slot] === it; btn.textContent = on ? "Take off" : "Wear"; btn.onclick = () => { act({ t: "wear", gear: { [slot]: on ? null : it } }); sfx("ui"); setTimeout(() => openShop(kind), 250); }; }
    else if (owned && (it.startsWith("hat_") || it.startsWith("outfit_"))) { btn.textContent = wearing ? "Take off" : "Wear"; btn.onclick = () => { act({ t: "wear", [it.startsWith("hat_") ? "hat" : "outfit"]: wearing ? null : it }); sfx("ui"); setTimeout(() => openShop(kind), 250); }; }
    else { btn.textContent = "Buy"; btn.disabled = me.coins < prices[it]; btn.onclick = () => { act({ t: "buy", item: it }); sfx("buy"); setTimeout(() => openShop(kind), 250); }; }
    const left = document.createElement("div"); left.append(b, document.createElement("br"), sm); row.append(left, btn); list.append(row); }
  $("#shop-coins").textContent = `${me.coins} GB · ${rankOf(me.xp || 0)}`; $("#shop").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}
$("#shop-x").addEventListener("click", closeCards);
// Founders Row: 24 lots on their own street in the Landing
const LOTS = []; const lotMeshes = {};
function buildLots(c, base0, dir0) {
  const dir = dir0 !== undefined ? dir0 : heading + 0.3 + Math.PI / 2; const sx = Math.cos(dir), sz = Math.sin(dir); const base = base0 || [c[0] + Math.cos(dir + Math.PI / 2) * 275, c[1] + Math.sin(dir + Math.PI / 2) * 275];
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
  $("#c-body").value = lk.body || "m";
  const preview = () => { const look = { skin: $("#c-skin").value.slice(1), shirt: $("#c-shirt").value.slice(1), pants: $("#c-pants").value.slice(1), hair: +$("#c-hair").value, body: $("#c-body").value }; buildBody(player, look, null, null); return look; };
  for (const id of ["c-skin", "c-shirt", "c-pants", "c-hair", "c-body"]) $("#" + id).oninput = preview;
  $("#c-go").onclick = () => { const look = preview(); localStorage.setItem("g1:look", JSON.stringify(look)); act({ t: "look", look }); $("#creator").classList.remove("on"); sfx("ui"); if (!localStorage.getItem("g1:tut")) startTutorial(); };
  $("#creator").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock();
}

// ───────────────────────────── the fly-in tutorial ─────────────────────────────
const TUT = { on: false, step: 0, cardAt: 0, card: 0 };
const TUT_STEPS = [
  ["Welcome to Genesis One", "You have just landed at Douglas Municipal. Your bag is on the carousel beside you. Follow the green carpet and the EXIT signs through the terminal to step out onto the site. W A S D to walk, mouse to look."],
  ["You are on the land", "This is the real 430 acres. Sky, the tour guide, is right here at the door and will walk you through everything. Press E near anything with a prompt. The compass at the top shows where the hubs are."],
];
const TUT_CARDS = [["The Landing", "Stage 01. Two ring roads of desert-modern homes around the clubhouse, the grand pavilion, the chapel and Founders Row, where you can buy a lot."], ["The Flight Line", "Stage 02. Hangars along the north side of the 6,000 ft runway, hangar homes behind, the diner and the terminal. Every hangar opens: walk up and press E."], ["The Expanse", "Stage 03. Everything south of the runway: Main Street, the Design District gallery walk, the Commons glamping village, Lakeside and Desert Golf."], ["Earn and spend", "You earn GB coins for time on the site and for minigames. Spend them on outfits at the General Store, meals at the diner, art at the gallery, and lots on Founders Row."], ["Ranks", "Passenger, Pilot, Captain, Tower. Play, build and compete to move up. Your rank shows on your name."], ["Play", "Desert Golf, the Cart Course, the Drag Strip and the Sky Obby all keep leaderboards (L). Press C for a cart, space to jump."], ["Talk", "Enter to chat with people near you, V for voice within 60 m, G to sign the guestbook."], ["Landing", "Line up with the runway at the site, ease off W, let the speed drop under 150 km/h and settle. Press F to step out at the tower."]];
function startTutorial() { TUT.on = true; TUT.step = 0; TUT.card = 0; TUT.cardAt = performance.now(); showTut(TUT_STEPS[0][0], TUT_STEPS[0][1]); }
function showTut(h, p) { $("#tut-h").textContent = h; $("#tut-p").textContent = p; $("#tut").classList.add("on"); }
function endTutorial() { TUT.on = false; $("#tut").classList.remove("on"); localStorage.setItem("g1:tut", "done"); }
$("#tut-skip").addEventListener("click", endTutorial);
function updateTutorial(now) {
  if (!TUT.on) return;
  if (TUT.step === 0 && !inside && now - TUT.cardAt > 4000) { TUT.step = 2; TUT.cardAt = now; showTut(...TUT_STEPS[1]); }
  else if (TUT.step === 2 && now - TUT.cardAt > 9000) { TUT.cardAt = now; if (TUT.card < TUT_CARDS.length) { showTut(...TUT_CARDS[TUT.card]); TUT.card++; } else endTutorial(); }
}

// ───────────────────────────── wildlife ─────────────────────────────
const FAUNA = [];
function spawnAnimal(kind, x, z, opts) { if (!MODELS[kind]) return null; const g = makeModel(kind); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.position.set(x, getH(x, z), z); g.rotation.y = rnd() * 6.283; scene.add(g); const a = Object.assign({ kind, g, home: [x, z], target: null, wait: rnd() * 3, speed: 1, range: 40, bob: 0, night: false, hop: false, pack: null }, opts || {}); FAUNA.push(a); return a; }
function buildFauna() {
  const spots = []; for (let i = 0; i < 60; i++) { const a = rnd() * 6.283, d = 250 + rnd() * 800; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (free(x, z, 6)) spots.push([x, z]); }
  let si = 0; const next = () => spots[(si++) % spots.length];
  for (let p = 0; p < 4; p++) { const [x, z] = next(); const lead = spawnAnimal("coyote", x, z, { speed: 3.2, range: 160, night: true, pack: p }); for (let k = 1; k < 3; k++) spawnAnimal("coyote", x + rnd() * 6, z + rnd() * 6, { speed: 3.2, range: 160, night: true, pack: p, follow: lead }); }
  for (let i = 0; i < 8; i++) { const [x, z] = next(); spawnAnimal("roadrunner", x, z, { speed: 6.5, range: 70, dash: true }); }
  for (let i = 0; i < 12; i++) { const [x, z] = next(); spawnAnimal("jackrabbit", x, z, { speed: 4.5, range: 40, hop: true }); }
  for (let h = 0; h < 2; h++) { const [x, z] = next(); const lead = spawnAnimal("javelina", x, z, { speed: 1.1, range: 90, pack: 10 + h }); for (let k = 1; k < 5; k++) spawnAnimal("javelina", x + rnd() * 8 - 4, z + rnd() * 8 - 4, { speed: 1.1, range: 90, pack: 10 + h, follow: lead }); }
  for (let c = 0; c < 3; c++) { const [x, z] = next(); const lead = spawnAnimal("quail", x, z, { speed: 1.8, range: 25, pack: 20 + c }); for (let k = 1; k < 6; k++) spawnAnimal("quail", x + rnd() * 3, z + rnd() * 3, { speed: 1.8, range: 25, pack: 20 + c, follow: lead }); }
  for (let i = 0; i < 6; i++) { const [x, z] = next(); spawnAnimal("tortoise", x, z, { speed: 0.25, range: 15 }); }
  const rocks = (PLACE.boulder || []).length ? PLACE.boulder.slice(0, 14) : spots.slice(0, 14).map((s) => [s[0], 0, s[1]]); for (const e of rocks) { spawnAnimal(rnd() < 0.5 ? "scorpion" : "snake", e[0] + 2.2, e[2] + 1.5, { speed: rnd() < 0.5 ? 0.6 : 0, range: 4, night: true, still: true }); }
}
function updateFauna(dt, now) {
  if (!player) return; const t = now / 1000;
  for (const a of FAUNA) { const g = a.g;
    if (a.night) { const vis = night > 0.35 || a.kind === "snake"; g.visible = vis; if (!vis) continue; }
    const dp = Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z);
    if (a.kind === "snake") { if (dp < 4 && !a.warned) { a.warned = true; sfx("rattle"); setTimeout(() => { a.warned = false; }, 4000); } g.rotation.y = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z); continue; }
    if (a.still && a.speed === 0) continue;
    if (dp > 400) continue;
    // spooked: run from the player
    if (dp < 9 && a.kind !== "tortoise" && a.kind !== "javelina") { a.target = [g.position.x + (g.position.x - player.position.x) / dp * 30, g.position.z + (g.position.z - player.position.z) / dp * 30]; a.run = 1.8; }
    if (a.follow) { const L = a.follow.g; const d = Math.hypot(L.position.x - g.position.x, L.position.z - g.position.z); if (d > 4) a.target = [L.position.x + (rnd() - 0.5) * 3, L.position.z + (rnd() - 0.5) * 3]; else if (!a.target) { a.wait = 1; } }
    if (!a.target) { a.wait -= dt; if (a.wait > 0) { animateIdle(a, t); continue; } const ang = rnd() * 6.283, d = rnd() * a.range; const tx = a.home[0] + Math.cos(ang) * d, tz = a.home[1] + Math.sin(ang) * d; if (!onLand(tx, tz) || nearRoad(tx, tz, 2) || !free(tx, tz, 1)) { a.wait = 0.4; continue; } a.target = [tx, tz]; a.run = a.dash ? 1.6 : 1; }
    const dx = a.target[0] - g.position.x, dz = a.target[1] - g.position.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { a.target = null; a.wait = a.kind === "roadrunner" ? 0.6 + rnd() * 2 : 1.5 + rnd() * 5; a.run = 1; continue; }
    const sp = a.speed * (a.run || 1); const [nx, nz] = collide(g.position.x + dx / d * sp * dt, g.position.z + dz / d * sp * dt, 0.4);
    g.position.x = nx; g.position.z = nz; a.bob += dt * sp * (a.hop ? 6 : 3);
    g.position.y = getH(nx, nz) + (a.hop ? Math.abs(Math.sin(a.bob)) * 0.35 : Math.abs(Math.sin(a.bob)) * 0.04);
    let want = Math.atan2(dx, dz); let dr = want - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); g.rotation.y += dr * Math.min(1, dt * 6);
    g.rotation.z = Math.sin(a.bob) * 0.04;
  }
}
function animateIdle(a, t) { a.g.rotation.y += Math.sin(t * 0.7 + a.home[0]) * 0.002; if (a.kind === "jackrabbit" || a.kind === "quail") a.g.position.y = getH(a.g.position.x, a.g.position.z) + Math.abs(Math.sin(t * 2 + a.home[1])) * 0.01; }

// ───────────────────────────── the tour guide ─────────────────────────────
const GUIDE = { g: null, x: 66, z: -6, tour: null, step: 0 }; const TERM = { pos: [62, -66], rot: 0.86, door: [94, -39], exit: [100, -34] };
const TOUR = [
  ["Welcome to Genesis One", "I am Sky, your guide. This is the former Douglas Municipal Airport, opened in 1928 as one of the first international airports in the United States. Everything you see is a concept built on the real 430 acres: the runway, the ground, the mountains are real. The buildings are what the three stages could become.", [0, 40]],
  ["The Flight Line · Stage 02", "Hangars line the north side of the 6,000 ft runway with direct taxiway access. Hangar homes sit behind them so residents live above their aircraft. The diner and the private aviation terminal are the front door for everyone who flies in, exactly the way you did.", [180, 40]],
  ["The Landing · Stage 01", "The first stage: two ring roads of desert-modern homes around the clubhouse, low and spread out so the desert stays visible between them. The Grand Pavilion hosts the community's gatherings. The Chapel serves the faith communities in the Giveback network.", [252, -457]],
  ["Founders Row", "Twenty-four lots you can own. Buy one with $GBACK you earn on the site, put your name on it and build a villa, dome, pavilion or casita. Everyone sees what you built. Ownership on the real site works the same way, recorded on chain.", [40, -650]],
  ["The Expanse · Stage 03", "Old West streets of saloons, hotels, shops and the bank, on 318 acres of hospitality and commerce. Walk onto any green door mat to step inside. The General Store sells outfits, the kitchens sell meals, the bank shows your balance.", [851, 250]],
  ["The Design District", "An artist district: monumental sculptures on the land, a gallery where you can buy pieces for your lot, and an immersive experience planned for the far edge of the site.", [600, 330]],
  ["How the blockchain works here", "Giveback Ventures builds giving infrastructure on Solana. $GBACK is a utility token: a hard-capped supply of one billion, fully circulating, with no team allocation. Every transaction is recorded on a public ledger anyone can verify. On this site the coins you earn and spend are the same idea in miniature: a permanent, automated, verifiable record.", null],
  ["Land on chain", "The real property is being brought on chain: the parcel, the lots and the memberships are recorded as tokens on Solana, so ownership is transparent and cannot be quietly changed. Membership tiers, Passenger, Pilot, Captain and Tower, are the same names as the ranks you earn here by playing.", null],
  ["Play and earn", "Desert Golf, the Cart Course, the Drag Strip and the Sky Obby all pay $GBACK and XP, and all keep leaderboards under L. You also earn a little just for being here. Spend it in the shops, on meals, on art, or on a lot.", [-160, 1020]],
  ["That is the tour", "From here the site is yours. Press E on anything with a prompt, use the buttons on the right to jump around, Enter to talk to people near you, V for voice. I will be at the terminal door if you need me again.", [66, -2]],
];
function buildGuide() {
  const g = avatar("guide00", "Sky · Tour Guide", { skin: "c98f63", shirt: "4dde6f", pants: "1c1f24", hair: 2 }, "hat_cap", "outfit_flight"); g.position.set(GUIDE.x, getH(GUIDE.x, GUIDE.z), GUIDE.z); g.rotation.y = Math.PI; GUIDE.g = g;
  hotspots.push({ x: GUIDE.x, z: GUIDE.z, r: 6, t: "Sky, your tour guide", k: "Press E to talk", p: "Hi. I can walk you through the whole site: the three stages, what you can own and build, how the blockchain side works, and where to play. Want the tour?", play: "tour" });
}
function startTour() { GUIDE.tour = true; GUIDE.step = 0; closeCards(); showTourStep(); }
function showTourStep() {
  const st = TOUR[GUIDE.step]; if (!st) { GUIDE.tour = null; $("#tour").classList.remove("on"); return; }
  if (st[2]) { const [x, z] = st[2]; warpTo(x, z); if (GUIDE.g) { GUIDE.g.position.set(x + 2.2, getH(x + 2.2, z + 1), z + 1); GUIDE.g.rotation.y = Math.atan2(-2.2, -1); } }
  $("#tour-h").textContent = st[0]; $("#tour-p").textContent = st[1]; $("#tour-n").textContent = `${GUIDE.step + 1} / ${TOUR.length}`; $("#tour").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui");
}
$("#tour-next").addEventListener("click", () => { GUIDE.step++; showTourStep(); });
$("#tour-end").addEventListener("click", () => { GUIDE.tour = null; $("#tour").classList.remove("on"); });
function updateGuide(dt, now) { if (!GUIDE.g) return; if (!GUIDE.tour) { const home = [GUIDE.x, GUIDE.z]; const d = Math.hypot(GUIDE.g.position.x - home[0], GUIDE.g.position.z - home[1]); if (d > 1) { GUIDE.g.position.x += (home[0] - GUIDE.g.position.x) * Math.min(1, dt * 2); GUIDE.g.position.z += (home[1] - GUIDE.g.position.z) * Math.min(1, dt * 2); GUIDE.g.position.y = getH(GUIDE.g.position.x, GUIDE.g.position.z); } } else if (player) { GUIDE.g.rotation.y = Math.atan2(player.position.x - GUIDE.g.position.x, player.position.z - GUIDE.g.position.z); } animateWalk(GUIDE.g, 0, dt); if (player && Math.hypot(player.position.x - GUIDE.g.position.x, player.position.z - GUIDE.g.position.z) < 8 && Math.random() < dt * 0.15) { GUIDE.g.userData.emote.material.map = emojiTex.wave; GUIDE.g.userData.emote.material.needsUpdate = true; GUIDE.g.userData.emote.visible = true; setTimeout(() => { GUIDE.g.userData.emote.visible = false; }, 2000); } }

// ───────────────────────────── residents: people and shuttle carts that live here ─────────────────────────────
const NPC = [];
const CAST = [];   // named characters you can talk to
function castDefs() {
  const T = TERM; const lw = (lx, lz) => [T.pos[0] + lx * Math.cos(T.rot) + lz * Math.sin(T.rot), T.pos[1] - lx * Math.sin(T.rot) + lz * Math.cos(T.rot)];
  const at = (list, i, dx, dz) => { const e = (PLACE[list] || [])[i]; return e ? [e[0] + Math.sin(e[3]) * dz + Math.cos(e[3]) * dx, e[2] + Math.cos(e[3]) * dz - Math.sin(e[3]) * dx] : null; };
  const inRoom = (list, i, lx, lz) => { const e = (PLACE[list] || [])[i]; if (!e) return null; return [e[0] + lx * Math.cos(e[3]) + lz * Math.sin(e[3]), e[2] - lx * Math.sin(e[3]) + lz * Math.cos(e[3])]; };
  const G = "$GBACK";
  return [
    { id: "rosa", name: "Rosa", role: "Check-in · Douglas Municipal", pos: lw(-6, -24), look: { skin: "c98f63", shirt: "e9e2d3", pants: "1c1f24", hair: 1, body: "f" }, hat: null, outfit: "outfit_flight",
      greet: ["Welcome to Douglas Municipal.", "Bags are on the carousel on the left.", "Follow the green carpet to the exit."],
      talk: [{ t: "Welcome to Genesis One. You landed on the same runway that opened in 1928. Anything I can help with?", o: [["Where do I go?", 1], ["What is this place?", 2], ["Thanks", null]] },
             { t: "Follow the green carpet past security to the exit doors. Sky, our tour guide, waits right outside. The shuttle carts by the door run to every stage.", o: [["What is this place?", 2], ["Thanks", null]] },
             { t: "Four hundred and thirty acres, three stages: The Landing north of the runway, the Flight Line here, and the Expanse south of it. Everything is a concept on the real land.", o: [["Where do I go?", 1], ["Thanks", null]] }],
      kw: [[/lot|buy|own/i, "Lots are on Founders Row in The Landing. Elena there can walk you through it."], [/golf/i, "Desert Golf is south past the Commons. Coach Bo runs it."], [/hello|hi|hey/i, "Hi there. Welcome to Genesis One."]] },
    { id: "marcus", name: "Marcus", role: "Gate agent · Gate A2", pos: lw(23, -6), look: { skin: "8d5a3b", shirt: "e9e2d3", pants: "1c1f24", hair: 3, body: "m" }, hat: null, outfit: "outfit_flight",
      greet: ["GB 204 to Phoenix is boarding.", "Gate A2, right here."],
      talk: [{ t: "GB 204 to Sky Harbor is boarding. Not flying today? Home base is sixteen kilometres north-west if you want to take Giveback One up yourself.", o: [["How do I fly?", 1], ["Just looking", null]] },
             { t: "Press F beside any jet on the apron. Hold W to throttle, space to climb once you pass 150, A and D to turn. The runway lights guide you back in.", o: [["Got it", null]] }],
      kw: [[/fly|jet|plane/i, "Press F beside a jet on the apron. W to throttle, space to climb."], [/hello|hi|hey/i, "Hey. Gate A2, boarding now."]] },
    { id: "lupe", name: "Lupe", role: "Sky Cafe", pos: lw(12, 11.6), look: { skin: "c98f63", shirt: "4dde6f", pants: "6d5a3e", hair: 2, body: "f" }, hat: "hat_band", outfit: null,
      greet: ["Coffee's fresh.", "Prickly pear tea, best in Cochise County.", "Breakfast burritos till eleven."],
      talk: [{ t: "Morning. Coffee, a breakfast burrito or the prickly pear tea?", o: [["Coffee, please", 1], ["What's good around here?", 2], ["Nothing, thanks", null]] },
             { t: "Coming up. The diner across the apron does the big plates; I do the quick ones. Tip: the saloon on Main Street pours after sundown.", o: [["Thanks", null]] },
             { t: "The Design District gallery walk at golden hour. The lake at sunrise. And the observatory once it is properly dark, we have some of the darkest skies in the country.", o: [["Thanks", null]] }],
      kw: [[/coffee|food|eat|hungry/i, "Coffee and burritos here, full plates at the diner across the apron."], [/hello|hi|hey/i, "Hola. Coffee?"]] },
    { id: "dale", name: "Officer Dale", role: "Security", pos: lw(-19, 2.5), look: { skin: "e8c19a", shirt: "1c1f24", pants: "1c1f24", hair: 0, body: "m" }, hat: "hat_cap", outfit: "outfit_flight",
      greet: ["Keep it moving, folks.", "Exit is straight ahead."],
      talk: [{ t: "Nothing to declare? Exit is straight ahead, follow the carpet. And keep off the runway on foot, the jets do not stop.", o: [["Is the runway dangerous?", 1], ["Understood", null]] },
             { t: "Traffic lands and departs all day. Use the crossings at either end or the taxiway by the apron. Press M if you want to see the whole field from the tower.", o: [["Understood", null]] }],
      kw: [[/runway|cross/i, "Cross at the ends or the apron taxiway. Watch for traffic."], [/hello|hi|hey/i, "Afternoon."]] },
    { id: "reyes", name: "Captain Reyes", role: "Pilot · JetFinders", pos: [T.exit[0] + Math.cos(T.rot) * 14, T.exit[1] - Math.sin(T.rot) * 14], look: { skin: "c98f63", shirt: "e9e2d3", pants: "1c1f24", hair: 0, body: "m" }, hat: "hat_cap", outfit: "outfit_flight",
      greet: ["Winds calm, runway 21 in use.", "Beautiful day to fly."],
      talk: [{ t: "Six thousand feet of runway and direct taxiway access from every hangar. JetFinders will run the private aviation side: charters in, owners' aircraft at home.", o: [["Can I take a jet up?", 1], ["Tell me about the hangars", 2], ["Clear skies", null]] },
             { t: "Giveback One is on the apron. Press F beside it, throttle with W, climb with space past 150. Try the Sky Rings, ten rings over the site, fastest lap on the board.", o: [["Thanks", null]] },
             { t: "The Flight Line has hangars along the north side with hangar homes behind them, so you live above your aircraft. Every hangar opens: walk up to the door.", o: [["Thanks", null]] }],
      kw: [[/ring/i, "Sky Rings: start at the gold ring over the apron, then follow the green ones in order."], [/jet|fly/i, "Giveback One is right here on the apron. F to board."], [/hello|hi|hey/i, "Captain Reyes. Clear skies."]] },
    { id: "hank", name: "Hank", role: "Bartender · The Saloon", pos: inRoom("saloon", 0, 0, -6), look: { skin: "e8c19a", shirt: "c94a3a", pants: "1c1f24", hair: 1, body: "m" }, hat: "hat_cowboy", outfit: "outfit_ranch",
      greet: ["Pull up a stool.", "Sarsaparilla or something stronger?"],
      talk: [{ t: "Evening. Main Street is the heart of the Expanse: saloons, hotels, the bank, the store. Frontier fronts, but everything behind them is new.", o: [["What can I buy here?", 1], ["How do I earn coins?", 2], ["Just passing", null]] },
             { t: "Meals here and at the restaurant, outfits at the General Store, art at the gallery, and a lot on Founders Row if you have saved up. All paid in " + G + ".", o: [["How do I earn coins?", 2], ["Thanks", null]] },
             { t: "Time on the site pays a little. Golf, the cart course, the drag strip, the obby, the rings, the lake lap and the treasure hunt pay more. Press L for the boards.", o: [["Thanks", null]] }],
      kw: [[/drink|beer|whisk/i, "Sarsaparilla for you, friend. The real bar comes with the real saloon."], [/coin|money|gback|earn/i, "Play the games, they pay in " + G + ". L shows the boards."], [/hello|hi|hey|howdy/i, "Howdy."]] },
    { id: "priya", name: "Priya", role: "Concierge · The Hotel", pos: inRoom("hotel", 0, 0, -5), look: { skin: "8d5a3b", shirt: "e9e2d3", pants: "2b3a4a", hair: 1, body: "f" }, hat: null, outfit: null,
      greet: ["Welcome to the hotel.", "Checking in?"],
      talk: [{ t: "Welcome. Stage Three is hospitality: hotels here on Main Street, the glamping village at the Commons, lake houses at Lakeside, and the flagship pavilion for the signature stay.", o: [["Where should I stay?", 1], ["Thanks", null]] },
             { t: "For the view, the flagship pavilion above the Commons. For the water, a lake house. For the stars, a glamping tent. Every one of them opens, walk in through the green door mat.", o: [["Thanks", null]] }],
      kw: [[/stay|room|sleep|hotel/i, "Glamping tents at the Commons, lake houses at Lakeside, or a room here."], [/hello|hi|hey/i, "Welcome to the hotel."]] },
    { id: "mateo", name: "Mateo", role: "Curator · Design District", pos: at("artpav", 0, 0, 26) || [640, 520], look: { skin: "c98f63", shirt: "1c1f24", pants: "1c1f24", hair: 3, body: "m" }, hat: null, outfit: null,
      greet: ["The corten ring is best at sunset.", "Every piece here is placed on the land itself."],
      talk: [{ t: "The Design District is an artist district: sculpture on the land, a gallery walk, and an immersive off-world experience planned for the far edge. What do you want to know?", o: [["Can I buy art?", 1], ["Who makes the work?", 2], ["Just browsing", null]] },
             { t: "Inside the gallery you can buy pieces for your lot with " + G + ". Once you own a lot on Founders Row, what you build and place there is visible to everyone.", o: [["Thanks", null]] },
             { t: "Resident artists and invited names. The district is meant to be lived in: studios, a gallery, sculpture you walk between rather than look at through glass.", o: [["Thanks", null]] }],
      kw: [[/art|sculpt|gallery/i, "Walk the boardwalk. The gallery sells pieces for your lot."], [/hello|hi|hey/i, "Welcome to the district."]] },
    { id: "bo", name: "Coach Bo", role: "Golf pro · Desert Golf", pos: [GOLF.origin[0] + 18, GOLF.origin[1] - 30], look: { skin: "e8c19a", shirt: "4dde6f", pants: "e9e2d3", hair: 0, body: "m" }, hat: "hat_cap", outfit: null,
      greet: ["Six holes, desert rules.", "Keep it on the fairway, the rough eats balls."],
      talk: [{ t: "Six holes of desert golf. Driver, woods, irons, wedge and putter, and the green is fast. Fewest strokes goes on the board.", o: [["How do I play?", 1], ["Later", null]] },
             { t: "Press E on the first tee. Mouse to aim, hold to charge, release to swing. Number keys change clubs. Sand is slow, rough is worse, out of bounds costs a stroke.", o: [["Got it", null]] }],
      kw: [[/golf|club|tee/i, "First tee is right here. E to start, hold to charge, release to hit."], [/hello|hi|hey/i, "Hey. Grab a club."]] },
    { id: "dee", name: "Dee", role: "Marshal · Cart Course", pos: [COURSE.origin[0] + 10, COURSE.origin[1] + 150], look: { skin: "8d5a3b", shirt: "f4cd5a", pants: "1c1f24", hair: 2, body: "f" }, hat: "hat_cap", outfit: null,
      greet: ["Press C for a cart.", "Shift boosts, but watch the heat."],
      talk: [{ t: "Cart course and drag strip. Press C for your own cart, cross the green gate to start the lap, every gate in order. The strip runs on the lights every thirty seconds.", o: [["Tips?", 1], ["Thanks", null]] },
             { t: "Shift is a boost with a heat bar; let it cool. Ramps launch you, land square. And the lake loop has its own time trial through the arch at Lakeside.", o: [["Thanks", null]] }],
      kw: [[/cart|race|drag/i, "C for a cart, green gate starts the lap. Drag strip goes on the lights."], [/hello|hi|hey/i, "Hey, racer."]] },
    { id: "nate", name: "Nate", role: "Lakeside host", pos: [LAKE.x + 150, LAKE.z + 40], look: { skin: "e8c19a", shirt: "e9e2d3", pants: "3a6ac9", hair: 2, body: "m" }, hat: "hat_band", outfit: null,
      greet: ["Water's warm.", "Every dock has a lake house behind it."],
      talk: [{ t: "A lined, pumped lake with seven lake houses and docks. It is a concept for the Expanse oasis; there is no natural water on the land, so it would be engineered.", o: [["Can I swim?", 1], ["Thanks", null]] },
             { t: "Walk in off any dock. And take the cart round the loop road through the arch for the Lake Lap time trial.", o: [["Thanks", null]] }],
      kw: [[/swim|water|lake/i, "Walk in off a dock. Warm all year."], [/hello|hi|hey/i, "Hey. Enjoy the lake."]] },
    { id: "wyatt", name: "Wyatt", role: "Ranch hand · The Ranch", pos: [-700 + 30, -600 + 20], look: { skin: "e8c19a", shirt: "8a2f26", pants: "6d5a3e", hair: 1, body: "m" }, hat: "hat_cowboy", outfit: "outfit_ranch",
      greet: ["Watch for javelina after dark.", "Rattlers by the rocks. Listen for them."],
      talk: [{ t: "Working ranch on the north edge: horses, hay, the community's own produce. Keep an eye out for the wildlife, it is all real to this desert.", o: [["What lives out here?", 1], ["Thanks", null]] },
             { t: "Roadrunners, jackrabbits, javelina, quail and tortoises by day. Coyotes and scorpions after dark. Rattlesnakes near the boulders; you will hear them before you see them.", o: [["Thanks", null]] }],
      kw: [[/animal|coyote|snake|wild/i, "Coyotes come out after dark. Snakes by the boulders. Give them room."], [/hello|hi|hey|howdy/i, "Howdy."]] },
    { id: "elena", name: "Elena", role: "Founders Row · lots", pos: [33 + 10, -686 + 12], look: { skin: "c98f63", shirt: "e9e2d3", pants: "1c1f24", hair: 2, body: "f" }, hat: null, outfit: null,
      greet: ["Twenty-four lots. A few are still open.", "Own it, name it, build on it."],
      talk: [{ t: "Founders Row: twenty-four lots you can buy with " + G + " you earn on the site. Put your name on it and build a villa, a dome, a pavilion or a casita. Everyone sees what you built.", o: [["How does ownership work for real?", 1], ["How much?", 2], ["Thanks", null]] },
             { t: "On the real site each lot is wrapped in its own LLC and the deed is a single token on Solana that carries the rules with it: who can hold it, the documents, and recovery if a key is lost. The token is evidence of the membership, not a security.", o: [["How much?", 2], ["Thanks", null]] },
             { t: "Press E on any lot sign for the price and what is left. Coins come from time on the site and the games.", o: [["Thanks", null]] }],
      kw: [[/lot|buy|own|land/i, "Press E on a lot sign. Buy, name, build."], [/token|chain|solana|blockchain/i, "One token per lot on Solana. The rules travel with the token."], [/hello|hi|hey/i, "Hi. Looking for a lot?"]] },
    { id: "joe", name: "Pastor Joe", role: "The Chapel", pos: at("chapel", 0, 0, 14) || [420, -370], look: { skin: "8d5a3b", shirt: "1c1f24", pants: "1c1f24", hair: 3, body: "m" }, hat: null, outfit: null,
      greet: ["Doors are open.", "Peace be with you."],
      talk: [{ t: "An adobe chapel for the churches and faith communities in the Giveback network. Giving is the whole point of the protocol; this is where the community gathers around it.", o: [["How does the giving work?", 1], ["Thank you", null]] },
             { t: "Every transaction on the protocol routes a share to nonprofits, automatically, recorded on a public ledger. Permanent, not a campaign.", o: [["Thank you", null]] }],
      kw: [[/give|charity|nonprofit|church/i, "Every transaction gives back, automatically. That is the protocol."], [/hello|hi|hey/i, "Welcome, friend."]] },
    { id: "ada", name: "Ada", role: "Host · The Commons", pos: [285 + 30, 721 + 6], look: { skin: "f3d9c0", shirt: "4dde6f", pants: "6d5a3e", hair: 2, body: "f" }, hat: "hat_band", outfit: "outfit_desert",
      greet: ["Tents open at sundown.", "Fire pit lights at eight."],
      talk: [{ t: "The Commons: tent cabins on timber decks around the pavilion, pool homes on the ring road, and the flagship pavilion on the rise. Pick any tent, walk in.", o: [["Which tent is best?", 1], ["Thanks", null]] },
             { t: "The outer ring faces the desert, the inner ring faces the pavilion and the fire. For the view, walk up to the flagship at the top of the rise.", o: [["Thanks", null]] }],
      kw: [[/tent|glamp|camp/i, "Any tent is open. Walk onto the green mat."], [/hello|hi|hey/i, "Hi. Welcome to the Commons."]] },
    { id: "tomas", name: "Tomas", role: "General Store", pos: inRoom("store", 0, 0, -5), look: { skin: "c98f63", shirt: "d8c39a", pants: "6d5a3e", hair: 0, body: "m" }, hat: null, outfit: "outfit_desert",
      greet: ["Hats, shirts, boots.", "New outfits in the case."],
      talk: [{ t: "General Store. Outfits and hats for " + G + ". Press E at the counter to browse. Wear it and everyone on the site sees it.", o: [["Thanks", null]] }],
      kw: [[/hat|shirt|outfit|cloth|buy/i, "E at the counter. Outfits and hats."], [/hello|hi|hey/i, "Welcome in."]] },
    { id: "vega", name: "Dr. Vega", role: "Astronomer · Observatory", pos: at("observatory", 0, 0, 16) || [532, -690], look: { skin: "8d5a3b", shirt: "2b3a4a", pants: "1c1f24", hair: 3, body: "f" }, hat: null, outfit: null,
      greet: ["Wait for full dark.", "Press N to skip to night if you cannot wait."],
      talk: [{ t: "Douglas sits under some of the darkest skies in the country. The dome opens to residents after sundown. Look up: the Milky Way is drawn from the real band.", o: [["Thanks", null]] }],
      kw: [[/star|sky|night|telescope/i, "Full dark is best. N skips the clock forward."], [/hello|hi|hey/i, "Good evening."]] },
    { id: "milo", name: "Milo", role: "Obby regular", pos: [1040 + 8, 1260 + 9], look: { skin: "e8c19a", shirt: "3a6ac9", pants: "2b3a4a", hair: 2, body: "m" }, hat: "hat_cap", outfit: null,
      greet: ["I got to level twelve once.", "The lava grid gets everyone."],
      talk: [{ t: "Sixteen levels. Space to jump, shift to run, checkered pads are checkpoints. Level six is the lava grid: only the blue tiles hold. Level eight, jump the bars, do not walk into them.", o: [["Thanks", null]] }],
      kw: [[/obby|level|jump/i, "Blue tiles on the lava grid. Jump the bars on eight."], [/hello|hi|hey/i, "Hey! Racing me?"]] },
  ].filter((c) => c.pos);
}
let castCool = new Map(), talkNpc = null;
function buildCast() {
  for (const c of castDefs()) { const g = avatar("cast_" + c.id, c.name, c.look, c.hat, c.outfit); g.position.set(c.pos[0], getH(c.pos[0], c.pos[1]), c.pos[1]); g.userData.label.scale.set(1.9, 0.48, 1); scene.add(g); c.g = g; CAST.push(c);
    hotspots.push({ x: c.pos[0], z: c.pos[1], r: 5, t: c.name, k: c.role + " · press E to talk", p: c.talk[0].t, play: "npc:" + c.id }); }
}
function showTalk(c, idx) { const node = c.talk[idx]; if (!node) { closeTalk(); return; } talkNpc = c; $("#talk-n").textContent = c.name; $("#talk-r").textContent = c.role; $("#talk-p").textContent = node.t; const box = $("#talk-o"); box.innerHTML = "";
  for (const [label, next] of node.o) { const b = document.createElement("button"); b.className = "btn" + (next === null ? " ghost" : ""); b.textContent = label; b.onclick = () => { sfx("ui"); if (next === null) closeTalk(); else showTalk(c, next); }; box.append(b); }
  $("#talk").classList.add("on"); if (document.exitPointerLock) document.exitPointerLock(); sfx("ui"); }
function closeTalk() { $("#talk").classList.remove("on"); talkNpc = null; }
function npcSay(c, text) { const g = c.g; if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(text); g.add(g.userData.bubble); g.userData.bubbleAt = performance.now(); logLine(c.name, text); }
function npcHear(text) {
  let best = null, bd = 1e9; for (const c of CAST) { const d = Math.hypot(c.g.position.x - player.position.x, c.g.position.z - player.position.z); if (d < 9 && d < bd) { bd = d; best = c; } }
  if (!best) return; const hit = best.kw.find(([re]) => re.test(text)); const line = hit ? hit[1] : ["Not sure about that one. Ask Sky at the terminal door, she knows everything.", "Hm. Press E and I will tell you what I know.", "Could be. The tour guide would know."][Math.floor(Math.random() * 3)];
  setTimeout(() => npcSay(best, line), 900 + Math.random() * 600);
}
function updateCast(dt, now) {
  if (!player) return;
  for (const c of CAST) { const g = c.g; const dx = player.position.x - g.position.x, dz = player.position.z - g.position.z; const d = Math.hypot(dx, dz);
    if (d < 9) { const want = Math.atan2(dx, dz); let dr = want - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); g.rotation.y += dr * Math.min(1, dt * 4); }
    if (d < 6 && (castCool.get(c.id) || 0) < now) { castCool.set(c.id, now + 40000 + Math.random() * 30000); npcSay(c, c.greet[Math.floor(Math.random() * c.greet.length)]); }
    if (g.userData.bubble && now - g.userData.bubbleAt > 7000) { g.remove(g.userData.bubble); g.userData.bubble = null; }
    animateWalk(g, 0, dt); }
  if (talkNpc && Math.hypot(talkNpc.g.position.x - player.position.x, talkNpc.g.position.z - player.position.z) > 10) closeTalk();
}
function buildNPC() {
  const names = ["Maya", "Diego", "Harper", "Ezra", "Luna", "Theo", "Nova", "Amir", "Sage", "Cole", "Ivy", "Beau", "Wren", "Otis", "Juno", "Reid", "Elle", "Kai", "Remy", "Zia"];
  const lamps = PLACE.lamp || []; if (lamps.length < 4) return;
  for (let i = 0; i < 36; i++) { const g = avatar("npc" + i.toString(36).padStart(4, "0"), names[i % names.length], { skin: ["e8c19a", "c98f63", "8d5a3b", "f3d9c0"][i % 4], shirt: ["4dde6f", "c94a3a", "3a6ac9", "f4cd5a", "e9e2d3"][i % 5], pants: ["2b3a4a", "6d5a3e", "1c1f24"][i % 3], hair: i % 4 }, ["hat_cap", null, "hat_cowboy", null, "hat_band"][i % 5], [null, "outfit_flight", null, "outfit_ranch", "outfit_desert"][i % 5]); g.userData.label.scale.set(1.6, 0.4, 1); const l = lamps[Math.floor(rnd() * lamps.length)]; g.position.set(l[0], l[1], l[2]); NPC.push({ g, target: null, wait: rnd() * 4, speed: 1.1 + rnd() * 0.6, kind: "walk" }); }
  // two shuttle carts that loop the Landing ring road
  const c = SITE.zones.landing.center; for (let i = 0; i < 2; i++) { const g = makeModel("cart"); scene.add(g); NPC.push({ g, kind: "loop", c, r: 120, a: i * Math.PI, speed: 0.07 }); }
  { const c2 = [285, 721]; for (let i = 0; i < 2; i++) { const g = makeModel("cart"); scene.add(g); NPC.push({ g, kind: "loop", c: c2, r: 165, a: i * Math.PI + 1, speed: 0.06 }); } }
  buildCast();
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
    if (player && Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z) < 4 && (n.cool || 0) < now) { n.cool = now + 60000 + Math.random() * 60000; if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(["Hey!", "Afternoon.", "Nice day for it.", "Have you seen the lake yet?", "Golf later?", "Love what they did with Main Street.", "The obby beat me again.", "Evening."][Math.floor(Math.random() * 8)]); g.add(g.userData.bubble); g.userData.bubbleAt = now; }
    if (g.userData.bubble && now - g.userData.bubbleAt > 6000) { g.remove(g.userData.bubble); g.userData.bubble = null; }
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
AUD.music = mkAudio("/audio/music.m4a", 0.22, true); AUD.wind = mkAudio("/audio/wind.mp3", 0.5, true); AUD.night = mkAudio("/audio/night.mp3", 0.55, true); AUD.plane = mkAudio("/audio/plane.mp3", 0.45, false); AUD.traffic = mkAudio("/audio/plane.mp3", 0.6, true);
// GBACK FM: six stations, R to change, [ ] to step
const STATIONS = [["Genesis Radio", "/audio/music.m4a"], ["Sunset Lo-Fi", "/audio/radio_lofi.m4a"], ["Cochise Country", "/audio/radio_country.m4a"], ["Off-World FM", "/audio/radio_synth.m4a"], ["Dark Sky Ambient", "/audio/radio_ambient.m4a"], ["Frontera", "/audio/radio_tejano.m4a"]];
const RADIO = { i: Math.max(-1, Math.min(STATIONS.length - 1, +(localStorage.getItem("g1:radio") ?? 0))), a: new Audio(), fade: 0 }; RADIO.a.loop = true; RADIO.a.volume = 0; RADIO.a.preload = "auto";
function setStation(i) { const n = STATIONS.length + 1; RADIO.i = (((i + 1) % n) + n) % n - 1; localStorage.setItem("g1:radio", String(RADIO.i)); if (RADIO.i < 0) { RADIO.a.pause(); } else { const src = STATIONS[RADIO.i][1]; if (!RADIO.a.src.endsWith(src)) { RADIO.a.src = src; RADIO.a.currentTime = 0; } if (audioReady) RADIO.a.play().catch(() => {}); } RADIO.fade = 0; updateRadioUI(); sfx("ui"); }
function updateRadioUI() { const el = $("#radio-n"); if (el) el.textContent = RADIO.i < 0 ? "radio off" : STATIONS[RADIO.i][0]; const w = $("#radio"); if (w) w.classList.toggle("off", RADIO.i < 0); }
$("#radio-prev").addEventListener("click", (e) => { e.stopPropagation(); setStation(RADIO.i - 1); }); $("#radio-next").addEventListener("click", (e) => { e.stopPropagation(); setStation(RADIO.i + 1); }); updateRadioUI();
function startAudio() { if (audioReady) return; audioReady = true; for (const k of ["wind", "night"]) AUD[k].play().catch(() => {}); if (RADIO.i >= 0) { RADIO.a.src = STATIONS[RADIO.i][1]; RADIO.a.play().catch(() => {}); } soundOn = localStorage.getItem("g1:sound") !== "off"; updateSoundBtn(); }
function toggleSound() { soundOn = !soundOn; localStorage.setItem("g1:sound", soundOn ? "on" : "off"); if (!audioReady) { audioReady = true; for (const k of ["wind", "night"]) AUD[k].play().catch(() => {}); if (RADIO.i >= 0) { RADIO.a.src = STATIONS[RADIO.i][1]; RADIO.a.play().catch(() => {}); } } updateSoundBtn(); }
function updateSoundBtn() { $("#snd").textContent = soundOn ? "SOUND ON" : "SOUND OFF"; }
function updateAudio(dt) { if (!audioReady) return; const on = soundOn ? 1 : 0, jet = riding && riding.kind === "jet" ? Math.min(1, vSpeed / 60) : 0; const target = { wind: 0.25 + 0.75 * (1 - night) + jet * 1.2, night: night * (1 - jet) }; { const inCar = cartMode || (riding && riding.kind === "cart"); RADIO.fade = Math.min(1, RADIO.fade + dt * 0.5); const want = RADIO.i < 0 ? 0 : on * RADIO.fade * (inCar ? 0.5 : inside ? 0.12 : 0.26) * (jet ? 0.3 : 1); RADIO.a.volume += (want - RADIO.a.volume) * Math.min(1, dt * 2); } for (const k in target) { const a = AUD[k], want = Math.min(1, on * +a.dataset.vol * target[k]); a.volume += (want - a.volume) * Math.min(1, dt * 1.5); } }
addEventListener("pointerdown", (e) => { if (BUILD.on && e.button === 0 && !e.target.closest(".card, .hud")) placeBuild(); }); addEventListener("pointerdown", startAudio); addEventListener("keydown", startAudio); $("#snd").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });

// ───────────────────────────── synthesised sound effects ─────────────────────────────
let ACTX = null, engine = null, engineGain = null, stepTimer = 0;
function actx() { if (!ACTX) { ACTX = new (window.AudioContext || window.webkitAudioContext)(); } if (ACTX.state === "suspended") ACTX.resume(); return ACTX; }
function tone(f, dur, type, vol, slide) { if (!soundOn) return; const c = actx(); const o = c.createOscillator(), g = c.createGain(); o.type = type || "sine"; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + dur); g.gain.value = vol || 0.08; g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur); }
function noise(dur, vol, hp) { if (!soundOn) return; const c = actx(); const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const src = c.createBufferSource(); src.buffer = b; const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 800; const g = c.createGain(); g.gain.value = vol || 0.05; src.connect(f).connect(g).connect(c.destination); src.start(); }
function sfx(name) {
  if (name === "step") noise(0.07, 0.035, 600); else if (name === "jump") tone(240, 0.18, "triangle", 0.05, 480); else if (name === "land") noise(0.09, 0.05, 300);
  else if (name === "coin") { tone(880, 0.12, "sine", 0.06); setTimeout(() => tone(1320, 0.18, "sine", 0.06), 90); } else if (name === "buy") { tone(660, 0.1, "square", 0.04); setTimeout(() => tone(990, 0.16, "square", 0.04), 100); }
  else if (name === "ui") tone(520, 0.06, "sine", 0.04); else if (name === "putt") noise(0.05, 0.08, 1500); else if (name === "rank") { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, "triangle", 0.06), i * 110)); }
  else if (name === "board") tone(300, 0.2, "sawtooth", 0.03, 120); else if (name === "rattle") { for (let i = 0; i < 14; i++) setTimeout(() => noise(0.03, 0.06, 3000), i * 45); } else if (name === "swing") { noise(0.12, 0.07, 400); setTimeout(() => tone(180, 0.05, "square", 0.05), 60); } else if (name === "gate") tone(1200, 0.08, "sine", 0.05);
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
buildWorld().then(() => { const lk = savedLook(); player = avatar(ME, localStorage.getItem("g1:name") || "You", lk, null, null); player.position.set(TERM.exit[0], getH(TERM.exit[0], TERM.exit[1]), TERM.exit[1]); yaw = TERM.rot + Math.PI; $("#load").classList.add("off"); askName(); connect(); frame(); if (!localStorage.getItem("g1:tut") && PLACE.terminal && MODELS.terminal) setTimeout(() => { const e = PLACE.terminal[0]; enterInterior({ kind: "terminal", i: 0, e, r: MODELS.terminal.radius * e[4] }); if (inside) { const lx = -inside.half + 16, lz = -inside.half + 12; player.position.set(e[0] + lx * Math.cos(e[3]) + lz * Math.sin(e[3]), e[1] + 0.05, e[2] - lx * Math.sin(e[3]) + lz * Math.cos(e[3])); yaw = e[3] + Math.PI; player.rotation.y = e[3]; camera.position.copy(player.position).add(new THREE.Vector3(Math.sin(e[3]) * 3, 2, Math.cos(e[3]) * 3)); } }, 600); }).catch((err) => { setStatus("failed to load the site: " + err.message, true); console.error(err); });
