/* GENESIS ONE · concept walkthrough client, v3
   Real terrain (USGS 3DEP) + real aerial (NAIP) + real runway (OSM), the
   surrounding 96 km of real Arizona mountains, generated 3D buildings placed
   by the hundreds through instancing, shared golf carts and a flyable jet. */

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
const seen = new Map();
let introduced = false, riding = null;   // riding = { id, kind, driver }
const chatSeen = new Map();
function onState(msg) {
  connected = msg.connected || 1;
  $("#online").textContent = String(connected);
  if (!msg.view) return;
  view = msg.view;
  const now = performance.now();
  for (const [id, p] of Object.entries(view.players)) {
    const s = seen.get(id);
    if (!s || s.t !== p.t) seen.set(id, { t: p.t, at: now });
    if (p.say && p.sayTick && chatSeen.get(id) !== p.sayTick) { chatSeen.set(id, p.sayTick); if (introduced) logLine(p.name, p.say); }
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
  const mine = view.players[ME];
  if (mine) {
    const v = mine.veh && view.vehicles && view.vehicles[mine.veh];
    if (v && (!riding || riding.id !== mine.veh)) enterVehicle(mine.veh, v);
    if (!v && riding) exitVehicle();
    if (riding) riding.driver = v.driver === ME;
  }
  if (gbOpen) renderGuestbook();
}
function logLine(name, text) {
  const log = $("#log"); const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = name + " "; d.append(b, document.createTextNode(text)); log.append(d);
  while (log.children.length > 6) log.removeChild(log.firstChild);
  setTimeout(() => { if (d.parentNode) d.remove(); }, 14000);
}

// ───────────────────────────── three.js scene ─────────────────────────────
const canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe7d6bd, 0.00030);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 90000);
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7d6b4c, 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 1.25); sun.position.set(-600, 500, 300); scene.add(sun);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0); moon.position.set(400, 500, -300); scene.add(moon);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

// sky dome: a gradient shader, coloured by the time of day
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color(0x9fc4e8) }, horizon: { value: new THREE.Color(0xe7d6bd) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffd9a0) }, glow: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y, -0.05, 1.0); float t = pow(max(h, 0.0), 0.55); vec3 c = mix(horizon, top, t);
      float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0); c += sunCol * glow * (pow(s, 220.0) * 1.6 + pow(s, 8.0) * 0.35 * (1.0 - t)); gl_FragColor = vec4(c, 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), skyMat); scene.add(skyDome);
const starGeo = new THREE.BufferGeometry(); { const a = []; for (let i = 0; i < 2200; i++) { const t = Math.random() * 6.283, u = Math.random() * 0.92 + 0.06; const r = 50000; a.push(Math.cos(t) * Math.sqrt(1 - u * u) * r, u * r, Math.sin(t) * Math.sqrt(1 - u * u) * r); } starGeo.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 60, transparent: true, opacity: 0, fog: false, sizeAttenuation: true })); scene.add(stars);

// ───────────────────────────── site + region data ─────────────────────────────
let SITE = null, H = null, T = null, HR = null, TR = null;
function sampleGrid(h, t, x, z) {
  const u = ((x - t.xmin) / (t.xmax - t.xmin)) * (t.cols - 1), v = ((z - t.zmin) / (t.zmax - t.zmin)) * (t.rows - 1);
  const c = Math.max(0, Math.min(t.cols - 2, Math.floor(u))), r = Math.max(0, Math.min(t.rows - 2, Math.floor(v)));
  const fu = Math.max(0, Math.min(1, u - c)), fv = Math.max(0, Math.min(1, v - r));
  const i = r * t.cols + c;
  return (h[i] * (1 - fu) + h[i + 1] * fu) * (1 - fv) + (h[i + t.cols] * (1 - fu) + h[i + t.cols + 1] * fu) * fv;
}
function getH(x, z) {
  if (H && x > T.xmin && x < T.xmax && z > T.zmin && z < T.zmax) return sampleGrid(H, T, x, z);
  if (HR) return sampleGrid(HR, TR, x, z) - 3;
  return 0;
}
let seed = 20260910; function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const loadbar = $("#loadbar"); const setLoad = (p, m) => { loadbar.style.width = Math.round(p * 100) + "%"; if (m) $("#loadmsg").textContent = m; };

// ───────────────────────────── materials ─────────────────────────────
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.95 }),
  taxi:    new THREE.MeshStandardMaterial({ color: 0x4a4b4f, roughness: 0.95 }),
  apron:   new THREE.MeshStandardMaterial({ color: 0x5a5b5e, roughness: 0.95 }),
  dirt:    new THREE.MeshStandardMaterial({ color: 0xb99b6f, roughness: 1 }),
  stripe:  new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 }),
  green:   new THREE.MeshStandardMaterial({ color: 0x4dde6f, roughness: 0.5, emissive: 0x1b7a35, emissiveIntensity: 0.4 }),
  scrub:   new THREE.MeshStandardMaterial({ color: 0x6f7d4b, roughness: 1 }),
  lampGlow:new THREE.MeshStandardMaterial({ color: 0xffd48a, emissive: 0xffb84d, emissiveIntensity: 0 }),
  rwLight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }),
  rwLightB:new THREE.MeshStandardMaterial({ color: 0x9fd7ff, emissive: 0x6ec2ff, emissiveIntensity: 0 }),
  steel:   new THREE.MeshStandardMaterial({ color: 0x8e9aa4, roughness: 0.45, metalness: 0.7 }),
  roof:    new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.8 }),
  stucco:  new THREE.MeshStandardMaterial({ color: 0xe6dac4, roughness: 0.9 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x1c3a2f, roughness: 0.2, metalness: 0.6 }),
};
const buildingMats = [];   // generated-model materials, tinted at night

// ───────────────────────────── geometry helpers ─────────────────────────────
function ribbon(points, width, mat, lift, dashed) {
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

// ───────────────────────────── generated 3D models (instanced) ─────────────────────────────
// size = real-world footprint width in metres (or height for tall things).
const MODEL_SPECS = {
  home:        { size: 15 }, clubhouse: { size: 38 }, hangar: { size: 24 }, dome: { size: 13 }, pavilion: { size: 18 },
  store:       { size: 11 }, saloon: { size: 15 }, tower: { height: 27, solid: 6 },
  bigtent:     { size: 58 }, hangarhome: { size: 34 }, diner: { size: 30 }, chapel: { size: 16 }, hotel: { size: 26 },
  barn:        { size: 22 }, gallery: { size: 30 }, observatory: { size: 12 }, amphitheater: { size: 40, solid: 0 },
  windmill:    { height: 14, solid: 2 }, solar: { size: 26, solid: 0 }, fbo: { size: 36 },
  saguaro:     { height: 7, solid: 0.6, prop: true }, paloverde: { height: 8, solid: 0.6, prop: true },
  sculpture:   { height: 7, solid: 1.5, prop: true }, lamp: { height: 4.2, solid: 0.3, prop: true },
  cart:        { size: 3.2, vehicle: true, rot: Math.PI / 2 }, jet: { size: 22, vehicle: true, rot: Math.PI / 2 }, gbjet: { size: 22, vehicle: true, rot: Math.PI / 2 },
};
const MODELS = {};          // kind -> { parts:[{geometry, material}], radius, height }
const PLACE = {};           // kind -> [[x,y,z,rot,scale]]
const COLLIDERS = [];       // [x,z,r]
async function loadModels() {
  if (!THREE.GLTFLoader) return;
  const loader = new THREE.GLTFLoader();
  const kinds = Object.keys(MODEL_SPECS); let done = 0;
  await Promise.all(kinds.map((k) => new Promise((res) => {
    loader.load(`/models/${k}.glb`, (g) => {
      const root = g.scene; root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root); const sz = new THREE.Vector3(); box.getSize(sz); const c = new THREE.Vector3(); box.getCenter(c);
      const spec = MODEL_SPECS[k];
      const s = spec.height ? spec.height / sz.y : spec.size / Math.max(sz.x, sz.z);
      const norm = new THREE.Matrix4().makeRotationY(spec.rot || 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().copy(norm).multiply(o.matrixWorld));
        const mat = o.material.clone(); mat.side = THREE.DoubleSide; mat.transparent = false; mat.depthWrite = true; mat.roughness = 0.85; mat.metalness = 0;
        if (mat.map) { mat.map.encoding = THREE.sRGBEncoding; mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffb870); mat.emissiveIntensity = 0; }
        if (!spec.prop && !spec.vehicle) buildingMats.push(mat);
        parts.push({ geometry: geo, material: mat });
      });
      MODELS[k] = { parts, radius: Math.max(sz.x, sz.z) * s / 2, height: sz.y * s };
      setLoad(0.2 + 0.4 * (++done / kinds.length)); res();
    }, undefined, () => { setLoad(0.2 + 0.4 * (++done / kinds.length)); res(); });
  })));
}
function put(kind, x, z, rot, scale) {
  const sc = scale || 1;
  (PLACE[kind] || (PLACE[kind] = [])).push([x, getH(x, z), z, rot || 0, sc]);
  const spec = MODEL_SPECS[kind], m = MODELS[kind];
  const solid = spec.solid !== undefined ? spec.solid * sc : (m ? m.radius * 0.6 * sc : 4);
  if (solid > 0) COLLIDERS.push([x, z, solid]);
  return true;
}
function buildInstances() {
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const kind in PLACE) {
    const m = MODELS[kind], list = PLACE[kind]; if (!m || !list.length) continue;
    for (const part of m.parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((e, i) => { p.set(e[0], e[1], e[2]); q.setFromAxisAngle(up, e[3]); s.setScalar(e[4]); mtx.compose(p, q, s); inst.setMatrixAt(i, mtx); });
      inst.frustumCulled = false; scene.add(inst);
    }
  }
}
function makeModel(kind) {   // a standalone (non-instanced) copy for vehicles
  const m = MODELS[kind]; const g = new THREE.Group(); if (!m) return g;
  for (const part of m.parts) g.add(new THREE.Mesh(part.geometry, part.material));
  return g;
}
function collide(x, z, r) {   // push a point out of building footprints
  for (const c of COLLIDERS) { const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz), min = c[2] + r; if (d < min && d > 0.001) { x = c[0] + dx / d * min; z = c[1] + dz / d * min; } }
  return [x, z];
}

// ───────────────────────────── layout ─────────────────────────────
const hotspots = [], zoneRings = [], vehiclesMeta = {};
let runwayMid, U, Nn, heading;
function along(t, s) { return [runwayMid[0] + U[0] * t + Nn[0] * s, runwayMid[1] + U[1] * t + Nn[1] * s]; }
function distToRunway(x, z) {
  const rw = SITE.runway; let best = 1e9;
  for (let i = 0; i < rw.length - 1; i++) {
    const [ax, az] = rw[i], [bx, bz] = rw[i + 1]; const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}
function free(x, z, gap) {
  if (distToRunway(x, z) < 95) return false;
  if (x < T.xmin + 40 || x > T.xmax - 40 || z < T.zmin + 40 || z > T.zmax - 40) return false;
  for (const c of COLLIDERS) if (Math.hypot(c[0] - x, c[1] - z) < c[2] + gap) return false;
  return true;
}
function scatter(kind, cx, cz, r, n, gap, scaleFn, rotFn) {
  let placed = 0, tries = 0;
  while (placed < n && tries++ < n * 60) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!free(x, z, gap)) continue;
    put(kind, x, z, rotFn ? rotFn(x, z) : rnd() * 6.283, scaleFn ? scaleFn() : 1); placed++;
  }
}
function street(cx, cz, dir, len, kinds, spacing, lamps) {
  const sx = Math.cos(dir), sz = Math.sin(dir);
  scene.add(ribbon([[cx - sx * (len / 2 + 20), cz - sz * (len / 2 + 20)], [cx + sx * (len / 2 + 20), cz + sz * (len / 2 + 20)]], 11, M.dirt, 0.22));
  let i = 0;
  for (let t = -len / 2; t <= len / 2; t += spacing) {
    for (const side of [-1, 1]) {
      const kind = kinds[(i++) % kinds.length];
      const off = 8 + (MODELS[kind] ? MODELS[kind].radius : 6);
      const x = cx + sx * t - sz * side * off, z = cz + sz * t + sx * side * off;
      put(kind, x, z, Math.atan2(sz * side, -sx * side));
    }
    if (lamps && Math.round((t + len / 2) / spacing) % 2 === 0) for (const side of [-1, 1]) put("lamp", cx + sx * t - sz * side * 6.5, cz + sz * t + sx * side * 6.5, Math.atan2(sz * side, -sx * side));
  }
}

async function buildWorld() {
  setLoad(0.03, "Reading the survey");
  const [site, hbuf, region, rbuf] = await Promise.all([
    fetch("/site.json").then((r) => r.json()), fetch("/height.bin").then((r) => r.arrayBuffer()),
    fetch("/region.json").then((r) => r.json()).catch(() => null), fetch("/region_height.bin").then((r) => r.arrayBuffer()).catch(() => null),
  ]);
  SITE = site; T = site.terrain; H = new Float32Array(hbuf);
  if (region && rbuf) { TR = region; HR = new Float32Array(rbuf); }
  U = site.runway_dir; Nn = [-U[1], U[0]]; heading = Math.atan2(U[0], U[1]);
  runwayMid = [(site.runway[0][0] + site.runway[site.runway.length - 1][0]) / 2, (site.runway[0][1] + site.runway[site.runway.length - 1][1]) / 2];
  setLoad(0.12, "Raising the buildings");
  await loadModels();
  setLoad(0.62, "Laying the ground");

  // terrain (site) + region (96 km of real Arizona)
  const W = T.xmax - T.xmin, D = T.zmax - T.zmin;
  const geo = new THREE.PlaneGeometry(W, D, T.cols - 1, T.rows - 1); geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, H[i]); geo.computeVertexNormals();
  const texLoader = new THREE.TextureLoader();
  const tex = await new Promise((res) => texLoader.load("/ground.jpg", res));
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.position.set((T.xmin + T.xmax) / 2, 0, (T.zmin + T.zmax) / 2); scene.add(ground);
  if (HR) {
    const WR = TR.xmax - TR.xmin, DR = TR.zmax - TR.zmin;
    const rg = new THREE.PlaneGeometry(WR, DR, TR.cols - 1, TR.rows - 1); rg.rotateX(-Math.PI / 2);
    const ra = rg.attributes.position; for (let i = 0; i < ra.count; i++) ra.setY(i, HR[i] - 3); rg.computeVertexNormals();
    const rtex = await new Promise((res) => texLoader.load("/region_ground.jpg", res)); rtex.encoding = THREE.sRGBEncoding; rtex.anisotropy = 4;
    const regionMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: rtex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    regionMesh.position.set((TR.xmin + TR.xmax) / 2, 0, (TR.zmin + TR.zmax) / 2); scene.add(regionMesh);
  } else {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0xc2a97f, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; scene.add(floor);
  }
  setLoad(0.7, "Painting the runway");

  // runway, taxiways, aprons, runway edge lights
  scene.add(ribbon(site.runway, 30, M.asphalt, 0.35));
  scene.add(ribbon(site.runway, 0.9, M.stripe, 0.55, true));
  for (const tw of site.taxiways) scene.add(ribbon(tw, 12, M.taxi, 0.3));
  for (const ap of site.aprons) if (ap.length >= 3) scene.add(polygon(ap, M.apron, 0.28));
  { const L = 1758, n = Math.floor(L / 60), lg = new THREE.SphereGeometry(0.35, 6, 5); const inst = new THREE.InstancedMesh(lg, M.rwLight, n * 2 + 2); const mt = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i <= n; i++) for (const s of [-16.5, 16.5]) { const p = along(-L / 2 + i * 60, s); mt.makeTranslation(p[0], getH(p[0], p[1]) + 0.6, p[1]); inst.setMatrixAt(k++, mt); }
    inst.count = k; scene.add(inst);
    const tg = new THREE.SphereGeometry(0.4, 6, 5); const ti = new THREE.InstancedMesh(tg, M.rwLightB, 60); let kk = 0;
    for (const tw of site.taxiways) for (let i = 0; i < tw.length - 1 && kk < 60; i++) { const p = tw[i]; mt.makeTranslation(p[0] + 6.5, getH(p[0], p[1]) + 0.6, p[1]); ti.setMatrixAt(kk++, mt); }
    ti.count = kk; scene.add(ti); }

  const Z = site.zones;
  const roads = [[Z.tower.center, Z.flightline.center], [Z.tower.center, Z.landing.center], [Z.landing.center, Z.expanse.center], [Z.flightline.center, Z.expanse.center], [Z.expanse.center, [Z.expanse.center[0] - 260, Z.expanse.center[1] + 330]], [[Z.expanse.center[0] - 260, Z.expanse.center[1] + 330], Z.landing.center]];
  for (const r of roads) scene.add(ribbon(r, 7, M.dirt, 0.2));
  setLoad(0.78, "Building the stages");

  // ── THE TOWER + apron ──
  put("tower", 0, 0, 0);
  put("fbo", 60, -30, heading + Math.PI);
  put("diner", -70, -10, heading);
  hotspots.push({ x: 0, z: 0, r: 34, t: "The Tower", k: "Genesis One · overlook", p: "The heart of the site, on the original airport apron. Press M anywhere for the tower view of all 430 acres. Everything you see is concept: the land is real, the buildings are illustrations of what the three stages could become." });
  hotspots.push({ x: 60, z: -30, r: 30, t: "Private Aviation Terminal", k: "Arrivals · the front door", p: "Fly in on the 6,000 ft runway and step straight into the community. The terminal handles arrivals, a pilot lounge and the shuttle carts that run between the stages." });
  hotspots.push({ x: -70, z: -10, r: 26, t: "Flight Line Diner", k: "Stage 02 · The Flight Line", p: "A mid-century diner beside the apron where pilots, residents and visitors meet. Butterfly roof, full glass front and a patio facing the runway." });

  // ── THE FLIGHT LINE: hangar rows both sides, hangar homes, jets ──
  for (let i = 0; i < 13; i++) { const [x, z] = along(-380 + i * 54, 118); put("hangar", x, z, heading + Math.PI / 2); if (i % 2 === 0) { const [jx, jz] = along(-380 + i * 54, 84); put("jet", jx, jz, heading + Math.PI / 2 + (rnd() - 0.5) * 0.4); } }
  for (let i = 0; i < 8; i++) { const [x, z] = along(60 + i * 54, -118); put("hangar", x, z, heading - Math.PI / 2); if (i % 3 === 1) { const [jx, jz] = along(60 + i * 54, -84); put("jet", jx, jz, heading - Math.PI / 2 + (rnd() - 0.5) * 0.4); } }
  for (let i = 0; i < 7; i++) { const [x, z] = along(-330 + i * 62, 182); put("hangarhome", x, z, heading + Math.PI / 2); }
  { const [x, z] = along(-120, 118); hotspots.push({ x, z, r: 70, t: "Hangar Row", k: "Stage 02 · The Flight Line · 52 acres", p: "Hangars line both sides of the runway with direct taxiway access, and hangar homes sit behind them so you can live above your aircraft. Press F beside a parked jet or a cart to ride." }); }
  { const [x, z] = along(140, 160); put("solar", x, z, heading); put("windmill", x + 40, z + 20, 0); }
  zoneRings.push({ ...Z.flightline, k: "Stage 02 · 52 acres" });

  // ── THE LANDING: homes around the clubhouse and the grand tent ──
  { const c = Z.landing.center;
    put("clubhouse", c[0], c[1], heading + 0.3);
    put("bigtent", c[0] - 150, c[1] - 70, heading + 0.8);
    put("chapel", c[0] + 170, c[1] + 120, heading + 2.4);
    put("amphitheater", c[0] - 60, c[1] + 190, heading + 3.6);
    put("observatory", c[0] + 260, c[1] - 200, 0);
    put("windmill", c[0] - 250, c[1] + 60, 0);
    hotspots.push({ x: c[0], z: c[1], r: 50, t: "The Landing Clubhouse", k: "Stage 01 · The Landing · 66 acres", p: "The first stage: themed residential lots around a clubhouse. Desert-modern homes on dirt roads, low and spread out so the desert stays visible between them." });
    hotspots.push({ x: c[0] - 150, z: c[1] - 70, r: 60, t: "The Grand Pavilion", k: "Stage 01 · gatherings", p: "A tensile fabric pavilion for the whole community: concerts, markets, film nights and the annual gathering under the desert sky." });
    hotspots.push({ x: c[0] + 170, z: c[1] + 120, r: 30, t: "The Chapel", k: "Faith communities", p: "An adobe chapel for the churches and faith communities that are part of the Giveback network." });
    hotspots.push({ x: c[0] + 260, z: c[1] - 200, r: 30, t: "Dark Sky Observatory", k: "Stage 01 · the night", p: "Douglas sits under some of the darkest skies in the country. The observatory opens to residents after sundown." });
    scatter("home", c[0], c[1], 330, 96, 12, () => 0.85 + rnd() * 0.35);
    scatter("dome", c[0] + 140, c[1] - 110, 130, 14, 6, () => 0.7 + rnd() * 0.6);
    scatter("pavilion", c[0] - 170, c[1] + 70, 110, 5, 8, () => 0.7 + rnd() * 0.5);
  }
  zoneRings.push({ ...Z.landing, k: "Stage 01 · 66 acres" });

  // ── THE EXPANSE: two Old West streets, homes, domes, design district ──
  { const c = Z.expanse.center; const dir = heading + Math.PI / 2;
    street(c[0], c[1], dir, 340, ["store", "saloon", "store", "hotel", "store", "barn", "saloon", "store"], 30, true);
    const c2 = [c[0] + Math.cos(dir + Math.PI / 2) * 150, c[1] + Math.sin(dir + Math.PI / 2) * 150];
    street(c2[0], c2[1], dir + Math.PI / 2, 220, ["store", "hotel", "saloon", "store", "barn"], 32, true);
    hotspots.push({ x: c[0], z: c[1], r: 70, t: "Main Street", k: "Stage 03 · The Expanse · 318 acres", p: "Old West frontier storefronts on a dirt main street: hospitality, commerce and gathering places for the community and its visitors." });
    const art = [c[0] + 60, c[1] - 230];
    put("gallery", art[0] - 70, art[1] + 10, dir + Math.PI);
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283, rr = 24 + (i % 2) * 22; put("sculpture", art[0] + Math.cos(a) * rr, art[1] + Math.sin(a) * rr, rnd() * 6.283, 0.7 + rnd() * 0.7); }
    hotspots.push({ x: art[0], z: art[1], r: 60, t: "The Design District", k: "Stage 03 · The Expanse", p: "An artist design district: a gallery and sculptures placed on the land itself, with an immersive experience concept planned for the far edge of the site." });
    put("bigtent", c[0] - 260, c[1] + 330, dir);
    put("amphitheater", c[0] + 300, c[1] + 120, dir + 2);
    put("solar", c[0] - 320, c[1] - 60, dir); put("solar", c[0] - 320, c[1] - 30, dir);
    put("windmill", c[0] + 340, c[1] - 160, 0); put("chapel", c[0] - 180, c[1] + 180, dir + 1);
    scatter("home", c[0], c[1], 400, 70, 12, () => 0.85 + rnd() * 0.35);
    scatter("dome", c[0] + 230, c[1] + 60, 160, 20, 6, () => 0.7 + rnd() * 0.6);
    scatter("pavilion", c[0] - 200, c[1] - 140, 130, 4, 8, () => 0.8 + rnd() * 0.5);
  }
  zoneRings.push({ ...Z.expanse, k: "Stage 03 · 318 acres" });

  hotspots.push({ x: (site.runway[0][0] + site.runway[6][0]) / 2, z: (site.runway[0][1] + site.runway[6][1]) / 2, r: 70, t: "Runway 03/21", k: "6,000 ft · Douglas Municipal", p: "The real runway, traced from survey data. Douglas Municipal opened in 1928 as one of the first international airports in the United States, and the runway returns to use as the spine of Genesis One." });

  // vegetation: saguaros and palo verde across the whole site
  setLoad(0.86, "Planting the desert");
  scatter("saguaro", 0, 0, 1000, 420, 2, () => 0.6 + rnd() * 0.9);
  scatter("paloverde", 0, 0, 1000, 300, 3, () => 0.7 + rnd() * 0.8);
  buildInstances();
  const scrubGeo = new THREE.IcosahedronGeometry(1, 0); scrubGeo.scale(1, 0.7, 1);
  const inst = new THREE.InstancedMesh(scrubGeo, M.scrub, 1600); const mtx = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 8000 && k < 1600; i++) {
    const x = T.xmin + rnd() * W, z = T.zmin + rnd() * D;
    if (distToRunway(x, z) < 50 || Math.hypot(x, z) < 90) continue;
    const s = 0.8 + rnd() * 1.6; mtx.makeRotationY(rnd() * 6.283); mtx.scale(new THREE.Vector3(s, s, s)); mtx.setPosition(x, getH(x, z) + s * 0.5, z); inst.setMatrixAt(k++, mtx);
  }
  inst.count = k; scene.add(inst);
  setLoad(1, "Opening the gates");
}

// ───────────────────────────── day / night ─────────────────────────────
const DAY_SECONDS = 24 * 60; let timeOffset = 0;
function dayT() { return ((((Date.now() / 1000 + timeOffset) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS; }
const C = (h) => new THREE.Color(h);
const HORIZON = [[0.00, C(0x0a0f1e)], [0.21, C(0x1a1a3a)], [0.26, C(0xf08a5a)], [0.31, C(0xf3c9a0)], [0.40, C(0xe7d6bd)], [0.62, C(0xe4d2b8)], [0.72, C(0xf5b070)], [0.77, C(0xe0644c)], [0.82, C(0x3a2050)], [0.88, C(0x0a0f1e)], [1.00, C(0x0a0f1e)]];
const TOP     = [[0.00, C(0x05070f)], [0.21, C(0x0b1030)], [0.26, C(0x5a4a8a)], [0.31, C(0x8fb2e0)], [0.40, C(0x8fbde8)], [0.62, C(0x86b6e6)], [0.72, C(0x7e86c8)], [0.77, C(0x5a3a78)], [0.82, C(0x18142e)], [0.88, C(0x05070f)], [1.00, C(0x05070f)]];
function rampAt(R, t) { for (let i = 0; i < R.length - 1; i++) if (t >= R[i][0] && t <= R[i + 1][0]) return R[i][1].clone().lerp(R[i + 1][1], (t - R[i][0]) / (R[i + 1][0] - R[i][0])); return R[0][1].clone(); }
let night = 0;
function updateSky() {
  const t = dayT(), el = -Math.cos(t * 6.283), az = t * 6.283;
  const hor = rampAt(HORIZON, t), top = rampAt(TOP, t);
  skyMat.uniforms.horizon.value.copy(hor); skyMat.uniforms.top.value.copy(top); scene.fog.color.copy(hor);
  const day = Math.max(0, Math.min(1, (el + 0.12) / 0.4)); night = 1 - day;
  const sdir = new THREE.Vector3(Math.cos(az), el, Math.sin(az) * 0.45).normalize();
  skyMat.uniforms.sunDir.value.copy(sdir); skyMat.uniforms.glow.value = Math.max(0, el + 0.15) > 0 ? 1 : 0;
  skyMat.uniforms.sunCol.value.setHSL(0.08, 0.9, 0.55 + 0.25 * Math.min(1, Math.max(0, el)));
  sun.position.copy(sdir).multiplyScalar(900); sun.position.y = Math.max(sun.position.y, 30);
  sun.intensity = 1.3 * day; sun.color.setHSL(0.09, 0.6, 0.55 + 0.35 * Math.min(1, Math.max(0, el)));
  moon.intensity = 0.55 * night; hemi.intensity = 0.62 * day + 0.3; hemi.color.setHSL(0.6, 0.35, 0.55 + 0.35 * day);
  renderer.toneMappingExposure = 0.9 - 0.22 * night;
  stars.material.opacity = Math.max(0, night - 0.35) * 1.4;
  const glow = Math.max(0, night - 0.2) / 0.8;
  for (const m of buildingMats) m.emissiveIntensity = 0.45 * glow;
  M.lampGlow.emissiveIntensity = 2.5 * glow; M.rwLight.emissiveIntensity = 3 * glow; M.rwLightB.emissiveIntensity = 3 * glow; M.green.emissiveIntensity = 0.4 + 1.6 * night;
  const hh = Math.floor(t * 24), mm = Math.floor((t * 24 - hh) * 60);
  $("#clock").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} site time`;
}

// ───────────────────────────── avatars ─────────────────────────────
function makeLabel(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d");
  x.font = "600 30px Space Grotesk, system-ui, sans-serif"; x.textAlign = "center"; x.fillStyle = "rgba(10,22,16,.55)";
  const w = Math.min(240, x.measureText(text).width + 28); x.beginPath(); x.roundRect ? x.roundRect(128 - w / 2, 10, w, 44, 12) : x.rect(128 - w / 2, 10, w, 44); x.fill();
  x.fillStyle = "#f5f1e6"; x.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(2.2, 0.55, 1); s.position.y = 2.3; return s;
}
function makeBubble(text) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96; const x = c.getContext("2d");
  x.font = "500 28px Space Grotesk, system-ui, sans-serif"; x.textAlign = "center"; let t = text; while (x.measureText(t).width > 470 && t.length > 4) t = t.slice(0, -2);
  const w = x.measureText(t).width + 36; x.fillStyle = "rgba(245,241,230,.95)"; x.beginPath(); x.roundRect ? x.roundRect(256 - w / 2, 14, w, 56, 16) : x.rect(256 - w / 2, 14, w, 56); x.fill();
  x.fillStyle = "#0a1610"; x.fillText(t, 256, 52);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false })); s.scale.set(4.4, 0.83, 1); s.position.y = 3.05; return s;
}
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
  const label = makeLabel(name); g.add(label);
  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, depthTest: false, transparent: true })); emote.scale.set(1.4, 1.4, 1); emote.position.y = 3.2; emote.visible = false; g.add(emote);
  g.userData = { walk, label, emote, name, bubble: null, bubbleTick: 0 };
  scene.add(g); return g;
}
function setName(g, name) { if (g.userData.name === name) return; g.remove(g.userData.label); const l = makeLabel(name); g.add(l); g.userData.label = l; g.userData.name = name; }
function setBubble(g, p) {
  if (p.say && p.sayTick && g.userData.bubbleTick !== p.sayTick) { if (g.userData.bubble) g.remove(g.userData.bubble); g.userData.bubble = makeBubble(p.say); g.add(g.userData.bubble); g.userData.bubbleTick = p.sayTick; g.userData.bubbleAt = performance.now(); }
  if (g.userData.bubble && performance.now() - g.userData.bubbleAt > 8000) { g.remove(g.userData.bubble); g.userData.bubble = null; }
}
const emoteShown = new Map();
function showEmote(g, p) {
  const key = g.uuid, prev = emoteShown.get(key);
  if (p.emote && p.emoteTick && (!prev || prev.tick !== p.emoteTick)) { emoteShown.set(key, { tick: p.emoteTick, at: performance.now() }); g.userData.emote.material.map = emojiTex[p.emote]; g.userData.emote.material.needsUpdate = true; g.userData.emote.visible = true; }
  const e = emoteShown.get(key); if (e && performance.now() - e.at > 3000) g.userData.emote.visible = false;
}

// ───────────────────────────── vehicles ─────────────────────────────
const VEH = {};   // id -> { g, kind, tx,tz,ty,try,tp, driverLabel }
const SEAT = { cart: [[0.4, 0.28, 0.25], [-0.4, 0.28, 0.25], [0.4, 0.28, -0.75], [-0.4, 0.28, -0.75]], jet: [[0, 1.2, 4], [0, 1.2, 2.5], [0, 1.2, 1], [0, 1.2, -0.5]] };
function ensureVehicle(id, v) {
  if (VEH[id]) return VEH[id];
  const kind = v.kind === "jet" ? "gbjet" : "cart";
  const g = makeModel(MODELS[kind] ? kind : (v.kind === "jet" ? "jet" : "cart"));
  if (!g.children.length) { const b = new THREE.Mesh(new THREE.BoxGeometry(v.kind === "jet" ? 4 : 1.5, 1, v.kind === "jet" ? 16 : 2.4), M.steel); b.position.y = 0.8; g.add(b); }
  const label = makeLabel(v.kind === "jet" ? "Giveback One" : "Shuttle cart"); label.position.y = v.kind === "jet" ? 5.5 : 2.6; g.add(label);
  g.position.set(v.x, getH(v.x, v.z) + v.y, v.z); g.rotation.y = v.ry;
  scene.add(g);
  VEH[id] = { g, kind: v.kind, tx: v.x, tz: v.z, ty: v.y, try: v.ry, tp: v.pitch || 0, label, seatsUsed: [] };
  return VEH[id];
}
function updateVehicles(dt) {
  if (!view || !view.vehicles) return;
  for (const [id, v] of Object.entries(view.vehicles)) {
    const V = ensureVehicle(id, v);
    const mineDriving = riding && riding.id === id && riding.driver;
    if (!mineDriving) {
      V.tx = v.x; V.tz = v.z; V.ty = v.y || 0; V.try = v.ry; V.tp = v.pitch || 0;
      const k = Math.min(1, dt * 6);
      V.g.position.x += (V.tx - V.g.position.x) * k; V.g.position.z += (V.tz - V.g.position.z) * k;
      const gy = getH(V.g.position.x, V.g.position.z); V.g.position.y += (gy + V.ty - V.g.position.y) * k;
      let d = V.try - V.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); V.g.rotation.y += d * k;
      V.g.rotation.x += (V.tp - V.g.rotation.x) * k;
    }
    const occupants = [v.driver, ...v.riders].filter((pid) => pid && view.players[pid] && view.players[pid].veh === id);
    const names = occupants.map((pid) => view.players[pid].name);
    const txt = (v.kind === "jet" ? "Giveback One" : "Shuttle cart") + (names.length ? " · " + names.join(", ") : " · free");
    if (V.labelText !== txt) { V.g.remove(V.label); V.label = makeLabel(txt); V.label.position.y = v.kind === "jet" ? 5.5 : 2.6; V.label.scale.set(4.4, 1.1, 1); V.g.add(V.label); V.labelText = txt; }
    // seat the occupants
    occupants.forEach((pid, i) => {
      const a = pid === ME ? player : avatars.get(pid) && avatars.get(pid).g; if (!a) return;
      const seat = SEAT[v.kind][i] || SEAT[v.kind][0];
      const local = new THREE.Vector3(seat[0], seat[1], seat[2]); V.g.localToWorld(local);
      a.position.copy(local); a.rotation.y = V.g.rotation.y; a.userData.walk.visible = v.kind !== "jet"; a.userData.label.visible = false;
    });
  }
}
function nearestVehicle() {
  if (!view || !view.vehicles) return null; let best = null, bd = 12;
  for (const [id, v] of Object.entries(view.vehicles)) { const d = Math.hypot(player.position.x - v.x, player.position.z - v.z); if (d < bd) { bd = d; best = id; } }
  return best;
}
let vSpeed = 0, vVertical = 0, bank = 0;
function enterVehicle(id, v) { riding = { id, kind: v.kind, driver: v.driver === ME }; vSpeed = 0; vVertical = 0; $("#veh").classList.add("on"); $("#veh-n").textContent = v.kind === "jet" ? "GIVEBACK ONE" : "SHUTTLE CART"; }
function exitVehicle() { riding = null; $("#veh").classList.remove("on"); player.userData.walk.visible = true; player.userData.label.visible = true; if (view && view.players[ME]) { player.position.x = view.players[ME].x; player.position.z = view.players[ME].z; } }
function toggleRide() {
  if (riding) { act({ t: "leave" }); return; }
  const id = nearestVehicle(); if (id) act({ t: "board", v: id }); else setStatus("no cart or jet nearby", true);
}
let lastDrive = 0;
function driveVehicle(dt) {
  const V = VEH[riding.id]; if (!V) return;
  const g = V.g, isJet = riding.kind === "jet";
  let throttle = 0, steer = 0;
  if (keys.KeyW || keys.ArrowUp) throttle += 1; if (keys.KeyS || keys.ArrowDown) throttle -= 1;
  if (keys.KeyA || keys.ArrowLeft) steer += 1; if (keys.KeyD || keys.ArrowRight) steer -= 1;
  if (joy.active) { throttle -= joy.dy; steer -= joy.dx; }
  if (!isJet) {
    const maxS = 26, accel = 14;
    if (throttle) vSpeed += throttle * accel * dt; else vSpeed -= Math.sign(vSpeed) * Math.min(Math.abs(vSpeed), 10 * dt);
    vSpeed = Math.max(-8, Math.min(maxS, vSpeed));
    g.rotation.y += steer * 1.8 * dt * Math.min(1, Math.abs(vSpeed) / 6) * Math.sign(vSpeed || 1);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt;
    nx = Math.max(T.xmin + 10, Math.min(T.xmax - 10, nx)); nz = Math.max(T.zmin + 10, Math.min(T.zmax - 10, nz));
    [nx, nz] = collide(nx, nz, 1.6);
    g.position.set(nx, getH(nx, nz), nz);
    $("#veh-s").textContent = `${Math.round(Math.abs(vSpeed) * 3.6)} km/h · W S drive · A D steer · F step out`;
  } else {
    const gy = getH(g.position.x, g.position.z), onGround = g.position.y <= gy + 0.05;
    const maxS = 140, accel = 22;
    if (throttle > 0) vSpeed += accel * dt; else if (throttle < 0) vSpeed -= accel * 1.4 * dt; else if (onGround) vSpeed -= Math.min(vSpeed, 8 * dt);
    vSpeed = Math.max(0, Math.min(maxS, vSpeed));
    const flying = vSpeed > 42;
    let climb = 0; if (keys.Space) climb += 1; if (keys.KeyQ || keys.ShiftLeft) climb -= 1; climb += -pitchInput;
    const turn = steer * (onGround ? 1.2 * Math.min(1, vSpeed / 10) : 0.9) * dt; g.rotation.y += turn;
    bank += ((onGround ? 0 : -steer * 0.6) - bank) * Math.min(1, dt * 3); g.rotation.z = bank;
    if (flying) vVertical += (climb * 26 - vVertical) * Math.min(1, dt * 1.5); else vVertical = onGround ? 0 : vVertical - 30 * dt;
    if (!flying && !onGround && vSpeed < 42) vVertical = Math.min(vVertical, -6);
    const pitch = Math.max(-0.5, Math.min(0.45, flying ? vVertical / 40 : 0)); g.rotation.x += (-pitch - g.rotation.x) * Math.min(1, dt * 3);
    let nx = g.position.x + Math.sin(g.rotation.y) * vSpeed * dt, nz = g.position.z + Math.cos(g.rotation.y) * vSpeed * dt, ny = g.position.y + vVertical * dt;
    nx = Math.max(-5900, Math.min(5900, nx)); nz = Math.max(-5900, Math.min(5900, nz));
    const gy2 = getH(nx, nz); if (ny <= gy2) { ny = gy2; if (vVertical < -12) vSpeed *= 0.6; vVertical = 0; }
    if (!flying && ny <= gy2 + 0.05 && !onGround) { g.rotation.x = 0; bank = 0; }
    ny = Math.min(ny, gy2 + 2400);
    if (onGround && ny <= gy2 + 0.05) { [nx, nz] = collide(nx, nz, 4); }
    g.position.set(nx, ny, nz);
    const alt = Math.round(ny - gy2);
    $("#veh-s").textContent = `${Math.round(vSpeed * 3.6)} km/h · ${alt} m · W throttle · S brake · A D turn · space / Q climb & dive · F leave${flying ? "" : (vSpeed > 0 ? " · gaining speed" : "")}`;
  }
  // camera + own avatar follow the vehicle
  player.position.copy(g.position); yaw = g.rotation.y;
  const now = performance.now();
  if (now - lastDrive > 100) {
    lastDrive = now;
    const gy = getH(g.position.x, g.position.z);
    act({ t: "drive", x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), y: isJet ? +Math.max(0, g.position.y - gy).toFixed(2) : 0, ry: +g.rotation.y.toFixed(3), pitch: +g.rotation.x.toFixed(3) });
  }
}

// ───────────────────────────── player + controls ─────────────────────────────
let player = null, yaw = 0, pitch = 0.18, towerView = false, pitchInput = 0;
const keys = {};
const avatars = new Map();
let chatOpen = false;
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") { if (e.code === "Escape") { e.target.blur(); closeChat(); } return; }
  keys[e.code] = true;
  if (e.code === "KeyF") toggleRide();
  if (e.code === "KeyM") towerView = !towerView;
  if (e.code === "KeyE") openNearest();
  if (e.code === "KeyG") toggleGuestbook();
  if (e.code === "KeyN") timeOffset += DAY_SECONDS / 2;
  if (e.code === "KeyX") toggleSound();
  if (e.code === "KeyH") document.body.classList.toggle("photo");
  if (e.code === "KeyP") snapshot();
  if (e.code === "Enter") openChat();
  if (e.code === "Escape") closeCards();
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
addEventListener("mousemove", (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-0.35, Math.min(0.9, pitch + e.movementY * 0.0018)); if (riding && riding.kind === "jet") { VEH[riding.id].g.rotation.y -= e.movementX * 0.0015; pitchInput = Math.max(-1, Math.min(1, pitchInput + e.movementY * 0.004)); } });
setInterval(() => { pitchInput *= 0.85; }, 50);
const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 }; const look = { id: null, x: 0, y: 0 };
const joyEl = $("#joy"), joyKnob = joyEl.querySelector("i");
if ("ontouchstart" in window) document.body.classList.add("touch");
canvas.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) { if (t.clientX < innerWidth / 2 && joy.id === null) { joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY; joy.active = true; } else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.dx = Math.max(-1, Math.min(1, (t.clientX - joy.cx) / 50)); joy.dy = Math.max(-1, Math.min(1, (t.clientY - joy.cy) / 50)); joyKnob.style.transform = `translate(${joy.dx * 30}px,${joy.dy * 30}px)`; } else if (t.identifier === look.id) { yaw -= (t.clientX - look.x) * 0.005; pitch = Math.max(-0.35, Math.min(0.9, pitch + (t.clientY - look.y) * 0.004)); look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
canvas.addEventListener("touchend", (e) => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; joyKnob.style.transform = ""; } if (t.identifier === look.id) look.id = null; } }, { passive: true });
document.querySelectorAll("#tbtns button").forEach((b) => {
  const k = b.dataset.k;
  const fire = () => { if (k === "KeyF") toggleRide(); else if (k === "KeyM") towerView = !towerView; else if (k === "KeyE") openNearest(); else if (k === "KeyG") toggleGuestbook(); else if (k === "Digit1") act({ t: "emote", e: "wave" }); else if (k === "KeyN") timeOffset += DAY_SECONDS / 2; else if (k === "Enter") openChat(); };
  if (k === "Space" || k === "KeyQ") { b.addEventListener("touchstart", (e) => { e.preventDefault(); keys[k] = true; }, { passive: false }); b.addEventListener("touchend", () => { keys[k] = false; }); }
  else b.addEventListener("click", fire);
});
document.querySelectorAll("#warp button").forEach((b) => b.addEventListener("click", () => { const z = SITE && SITE.zones[b.dataset.w]; if (z) warpTo(z.center[0] + 20, z.center[1] + 30); }));
function warpTo(x, z) { if (riding) { setStatus("leave the vehicle first", true); return; } [x, z] = collide(x, z, 1); player.position.x = x; player.position.z = z; act({ t: "warp", x: +x.toFixed(2), z: +z.toFixed(2) }); lastSent.x = x; lastSent.z = z; }
$("#mm").addEventListener("click", (e) => { if (!T) return; const r = e.currentTarget.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; warpTo(T.xmin + u * (T.xmax - T.xmin), T.zmin + v * (T.zmax - T.zmin)); });

// ───────────────────────────── HUD: cards, guestbook, zones, minimap ─────────────────────────────
let gbOpen = false;
function closeCards() { $("#info").classList.remove("on"); $("#gb").classList.remove("on"); gbOpen = false; }
function openNearest() {
  if (!player) return; let best = null, bd = 1e9;
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
function askName() { if (localStorage.getItem("g1:name")) return; $("#name").classList.add("on"); $("#name-in").focus(); }
$("#name-go").addEventListener("click", () => { const v = $("#name-in").value.trim().replace(/[^A-Za-z0-9 _.\-]/g, "").slice(0, 18); if (!v) return; localStorage.setItem("g1:name", v); act({ t: "name", name: v }); $("#name").classList.remove("on"); });
$("#name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-go").click(); });

let zoneShown = null, zoneTimer = 0;
function updateZone(dt) {
  if (!player) return; let inZone = null;
  for (const z of zoneRings) if (Math.hypot(player.position.x - z.center[0], player.position.z - z.center[1]) < z.r) inZone = z;
  if (inZone && inZone !== zoneShown) { zoneShown = inZone; $("#zone-n").textContent = inZone.name; $("#zone-k").textContent = inZone.k; $("#zone").classList.add("on"); zoneTimer = 3.5; }
  if (!inZone) zoneShown = null;
  if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) $("#zone").classList.remove("on"); }
  let near = null;
  for (const h of hotspots) if (Math.hypot(player.position.x - h.x, player.position.z - h.z) < h.r) near = h;
  const nv = !riding && nearestVehicle();
  const show = (near || nv) && !$("#info").classList.contains("on");
  $("#prompt").classList.toggle("on", !!show);
  if (show) $("#prompt-t").innerHTML = (nv ? `<b>F</b> &nbsp;ride the ${view.vehicles[nv].kind === "jet" ? "jet" : "cart"}` : "") + (nv && near ? " &nbsp;·&nbsp; " : "") + (near ? `<b>E</b> &nbsp;${near.t}` : "");
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
  if (view && view.vehicles) for (const v of Object.values(view.vehicles)) { mmc.fillStyle = v.kind === "jet" ? "#ffd166" : "#9be7ff"; mmc.beginPath(); mmc.arc(px(v.x), pz(v.z), 4, 0, 6.283); mmc.fill(); }
  if (view) for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; mmc.fillStyle = "rgba(245,241,230,.9)"; mmc.beginPath(); mmc.arc(px(p.x), pz(p.z), 4, 0, 6.283); mmc.fill(); }
  mmc.fillStyle = "#4DDE6F"; mmc.beginPath(); mmc.arc(px(player.position.x), pz(player.position.z), 6, 0, 6.283); mmc.fill(); mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 2; mmc.stroke();
}

// ───────────────────────────── movement + net sync ─────────────────────────────
let lastSent = { x: 0, z: 48, ry: 0, at: 0 };
function pushMove(force) {
  if (!player || riding) return;
  const now = performance.now();
  const moved = Math.hypot(player.position.x - lastSent.x, player.position.z - lastSent.z) > 0.08 || Math.abs(yaw - lastSent.ry) > 0.02;
  if (force || (moved && now - lastSent.at > 120) || now - lastSent.at > 3000) {
    act({ t: "move", x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +yaw.toFixed(3) });
    lastSent = { x: player.position.x, z: player.position.z, ry: yaw, at: now };
  }
}
let lastT = performance.now(), bob = 0;
const camTarget = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!player) { renderer.render(scene, camera); return; }
  let L = 0;
  if (riding && riding.driver) driveVehicle(dt);
  else if (!riding) {
    let fx = 0, fz = 0;
    if (!chatOpen) { if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1; if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1; }
    if (joy.active) { fx += joy.dx; fz -= joy.dy; }
    L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? 11 : 5.5;
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
    let nx = player.position.x + (fwd[0] * fz + right[0] * fx) * speed * dt, nz = player.position.z + (fwd[1] * fz + right[1] * fx) * speed * dt;
    nx = Math.max(T.xmin + 8, Math.min(T.xmax - 8, nx)); nz = Math.max(T.zmin + 8, Math.min(T.zmax - 8, nz));
    [nx, nz] = collide(nx, nz, 0.6);
    player.position.x = nx; player.position.z = nz;
    const gh = getH(nx, nz); bob += L * dt * 9;
    player.position.y = gh + (L ? Math.abs(Math.sin(bob)) * 0.08 : 0);
    if (L > 0.01) player.rotation.y = Math.atan2(fwd[0] * fz + right[0] * fx, fwd[1] * fz + right[1] * fx);
    pushMove(false);
  }
  updateVehicles(dt);
  // camera
  const px = player.position.x, pz = player.position.z, gh = getH(px, pz);
  if (towerView) {
    const tx = Math.sin(now * 0.00012) * 220, tz = Math.cos(now * 0.00012) * 220;
    camera.position.set(tx, getH(tx, tz) + 160, tz); camera.lookAt(px, gh + 20, pz);
  } else if (riding) {
    const V = VEH[riding.id]; const isJet = riding.kind === "jet";
    const dist = isJet ? 30 : 11, h = isJet ? 9 : 4;
    const back = new THREE.Vector3(-Math.sin(V.g.rotation.y) * dist, h, -Math.cos(V.g.rotation.y) * dist);
    camTarget.copy(V.g.position).add(back); camTarget.y = Math.max(camTarget.y, getH(camTarget.x, camTarget.z) + 1.5);
    camera.position.lerp(camTarget, isJet ? 0.12 : 0.25);
    camera.lookAt(V.g.position.x, V.g.position.y + (isJet ? 2 : 1.2), V.g.position.z);
  } else {
    const dist = 9.5, h = 3.2 + pitch * 4, fwd = [-Math.sin(yaw), -Math.cos(yaw)];
    const cx = px - fwd[0] * dist * Math.cos(pitch), cz = pz - fwd[1] * dist * Math.cos(pitch);
    const cy = Math.max(getH(cx, cz) + 1.2, gh + h);
    camera.position.lerp(camTarget.set(cx, cy, cz), 0.35); camera.lookAt(px, gh + 1.6, pz);
  }
  $("#coords").textContent = `${Math.round(px)} E · ${Math.round(pz)} S · ${Math.round(gh + (T.base_elev_m || 0))} m`;
  // remote players
  if (view) {
    for (const [id, p] of Object.entries(view.players)) {
      if (id === ME) { if (player.userData.name !== p.name) setName(player, p.name); showEmote(player, p); setBubble(player, p); continue; }
      const s = seen.get(id); const stale = !s || now - s.at > 12000;
      let a = avatars.get(id);
      if (!a) { a = { g: avatar(id, p.name) }; a.g.position.set(p.x, getH(p.x, p.z), p.z); avatars.set(id, a); }
      a.g.visible = !stale; setName(a.g, p.name); showEmote(a.g, p); setBubble(a.g, p);
      if (p.veh && view.vehicles && view.vehicles[p.veh]) continue;   // seated by updateVehicles
      a.g.userData.walk.visible = true; a.g.userData.label.visible = true;
      a.g.position.x += (p.x - a.g.position.x) * 0.12; a.g.position.z += (p.z - a.g.position.z) * 0.12; a.g.position.y = getH(a.g.position.x, a.g.position.z);
      const dx = p.x - a.g.position.x, dz = p.z - a.g.position.z; if (dx * dx + dz * dz > 0.02) a.g.rotation.y = Math.atan2(dx, dz);
    }
    for (const [id, a] of avatars) if (!view.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  updateZone(dt); drawMinimap(); updateSky(); updateAudio(dt);
  renderer.render(scene, camera);
}

// ───────────────────────────── ambient audio ─────────────────────────────
const AUD = {}; let soundOn = false, audioReady = false, planeTimer = 40 + Math.random() * 60;
function mkAudio(src, vol, loop) { const a = new Audio(src); a.loop = loop; a.volume = 0; a.preload = "auto"; a.dataset.vol = vol; return a; }
AUD.music = mkAudio("/audio/music.m4a", 0.22, true); AUD.wind = mkAudio("/audio/wind.mp3", 0.5, true); AUD.night = mkAudio("/audio/night.mp3", 0.55, true); AUD.plane = mkAudio("/audio/plane.mp3", 0.45, false);
function startAudio() { if (audioReady) return; audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); soundOn = localStorage.getItem("g1:sound") !== "off"; updateSoundBtn(); }
function toggleSound() { soundOn = !soundOn; localStorage.setItem("g1:sound", soundOn ? "on" : "off"); if (!audioReady) { audioReady = true; for (const k of ["music", "wind", "night"]) AUD[k].play().catch(() => {}); } updateSoundBtn(); }
function updateSoundBtn() { $("#snd").textContent = soundOn ? "SOUND ON" : "SOUND OFF"; }
function updateAudio(dt) {
  if (!audioReady) return;
  const on = soundOn ? 1 : 0, jet = riding && riding.kind === "jet" ? Math.min(1, vSpeed / 60) : 0;
  const target = { music: 1, wind: 0.25 + 0.75 * (1 - night) + jet * 1.2, night: night * (1 - jet) };
  for (const k in target) { const a = AUD[k], want = Math.min(1, on * +a.dataset.vol * target[k]); a.volume += (want - a.volume) * Math.min(1, dt * 1.5); }
  planeTimer -= dt;
  if (planeTimer <= 0) { planeTimer = 70 + Math.random() * 90; if (soundOn && night < 0.6) { AUD.plane.volume = +AUD.plane.dataset.vol; AUD.plane.currentTime = 0; AUD.plane.play().catch(() => {}); } }
}
addEventListener("pointerdown", startAudio); addEventListener("keydown", startAudio);
$("#snd").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });

// ───────────────────────────── boot ─────────────────────────────
buildWorld().then(() => {
  player = avatar(ME, localStorage.getItem("g1:name") || "You");
  player.position.set(0, getH(0, 48), 48);
  $("#load").classList.add("off");
  askName(); connect(); frame();
}).catch((err) => { setStatus("failed to load the site: " + err.message, true); console.error(err); });
