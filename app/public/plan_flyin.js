// plan_flyin.js · F (round 2, 25 Sep 2026): the fly-in as a cinematic arrival, and a true large-cabin business jet inside.
//
// Owns, in PLAN mode (installed from a PLAN_HOOKS.world hook; the legacy world keeps client.js's fly-in untouched):
//   buildCabin, warmCabin, startFlyIn, updateFlyIn, flyCamera, flySpot, flyStand, orderDrink, serveDrink (the cabin crew) and a
//   wrapper round endFlyIn (the arrival hand-off into the terminal stays client.js's). The flight itself (planFlyPath,
//   planFlyPos, flyPath: the Runway 21 left-hand circuit over The Expanse, the rollout and the taxi to Gate A2) is unchanged.
// The jets in the world: the plan's parked jets (instanced), the AI traffic, the rideable Giveback One and the jets inside the
//   hangar interiors switch to jet_heavy / jet_mid / jet_light / gbjet2 as soon as those models exist (MODELS[kind]); until
//   then everything keeps today's jet and gbjet. The cabin uses cab_seat, cab_divan, cab_table, cab_galley, cab_credenza and
//   cab_bulkhead when they exist and its own procedural pieces until then (the kinds are declared in PLAN_MODEL_NEEDS below).
// Rendering: every cabin material maps its depth into the front slice of the depth range (the cabin always encloses the
//   camera, so it can never be behind the world). The camera can sit 3 cm from a window without touching camera.near, and the
//   world seen through the windows keeps today's depth precision. The cabin is lit by its own image-based light (a PMREM of a
//   small model of the lit cabin), ambient occlusion baked into vertex colours, pooled reading and cove lights, the real sun
//   through the windows (shadow maps, a tight shadow box round the cabin while you are aboard) and additive light shafts;
//   the outdoor sky fill is turned down inside. The fly-in runs at golden hour and gives the site clock back on arrival.
// Classic script loaded before client.js: no top-level const/let; everything lives in the IIFE and on window.FLYIN.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
window.FLYIN = window.FLYIN || {};
(function () {
  "use strict";
  const F = window.FLYIN;
  const NEEDS = ["jet_heavy", "jet_mid", "jet_light", "gbjet2", "cab_seat", "cab_divan", "cab_table", "cab_galley", "cab_credenza", "cab_bulkhead"];
  for (const k of NEEDS) if (window.PLAN_MODEL_NEEDS.indexOf(k) < 0) window.PLAN_MODEL_NEEDS.push(k);
  F.version = "r2";
  if (F.golden === undefined) F.golden = true;          // hold the site clock at golden hour for the whole flight
  if (!F.goldenT) F.goldenT = 0.712;                    // day fraction: early evening; the sun stands off the left side on the downwind (shafts through the windows)
  F.errs = []; F.debugT = null; F.cam = null; F.U = { sun: { value: 1 }, hemi: { value: 0.3 } };
  F.coveK = 0.55; F.envK = 1.0; F.beamK = 1.0; F.mapHz = 3; F.fogK = 0.38; F.hazeK = 0.65;
  try { if (!document.getElementById("g1-fraunces")) { const l = document.createElement("link"); l.id = "g1-fraunces"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,400&display=swap"; document.head.appendChild(l); } } catch (e) {}

  // ───────────────────────────── small helpers ─────────────────────────────
  function log(tag, e) { try { if (F.errs.length < 40) F.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); if (F.errs.length <= 6) console.warn("plan_flyin " + tag, e); } catch (x) {} }
  function has(k) { try { return !!(MODELS[k] && MODELS[k].parts && MODELS[k].parts.length); } catch (e) { return false; } }
  function first(list) { for (const k of list) if (k && has(k)) return k; return null; }
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sm = (e0, e1, x) => { const t = cl((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const nz = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 2.1) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.2;
  const V3 = (x, y, z) => new THREE.Vector3(x || 0, y || 0, z || 0);
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

  // ───────────────────────────── cabin materials: depth slice, light balance ─────────────────────────────
  // ndc z = -0.6 + 0.4 * (A - B / zv) for view depth zv in [NC, FC], i.e. clip z = K1 * zv - K2: affine in the view position, so
  // triangles that reach behind the camera clip exactly like with a normal projection matrix
  const NC = 0.025, FC = 60; const A0 = (FC + NC) / (FC - NC), B0 = (2 * FC * NC) / (FC - NC);
  const K1 = (-0.6 + 0.4 * A0).toFixed(9), K2 = (0.4 * B0).toFixed(9);
  const DEPTH_GLSL = "gl_Position.z = " + K1 + " * (-mvPosition.z) - " + K2 + ";\n";
  F.DEPTH_GLSL = DEPTH_GLSL;
  function cabObc(sh) {
    /* cabin depth slice v2 (three.js keys the program cache on this function's source: bump the tag when the shader code changes) */
    sh.uniforms.uCabSun = F.U.sun; sh.uniforms.uCabHemi = F.U.hemi;
    sh.vertexShader = sh.vertexShader.replace("#include <logdepthbuf_vertex>", F.DEPTH_GLSL + "#include <logdepthbuf_vertex>");
    let fs = sh.fragmentShader;
    if (fs.indexOf("#include <lights_fragment_begin>") >= 0) fs = fs.replace("#include <lights_fragment_begin>", THREE.ShaderChunk.lights_fragment_begin);
    fs = fs.split("getDirectionalLightInfo( directionalLight, directLight );").join("getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= uCabSun;");
    fs = fs.split("getDirectionalLightInfo( directionalLights[0], directLight );").join("getDirectionalLightInfo( directionalLights[0], directLight ); directLight.color *= uCabSun;");
    fs = fs.split("irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );").join("irradiance += uCabHemi * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );");
    sh.fragmentShader = "uniform float uCabSun;\nuniform float uCabHemi;\n" + fs;
  }
  function userObc(m) { if (Object.prototype.hasOwnProperty.call(m, "_csmObc")) return m._userObc || null; const o = m.onBeforeCompile; return o && o !== THREE.Material.prototype.onBeforeCompile ? o : null; }
  function setObc(m, fn, prev) {
    const csm = Object.prototype.hasOwnProperty.call(m, "_csmObc");
    if (!prev) m.onBeforeCompile = fn;
    else { const f = function (sh, r) { prev.call(this, sh, r); fn.call(this, sh, r); }; m.onBeforeCompile = f; const key = (csm ? "csm|" : "") + "cabz|" + prev.toString(); m.customProgramCacheKey = function () { return key; }; }
    m.needsUpdate = true; return m;
  }
  function cab(m) { if (!m || (m.userData && m.userData.cabZ)) return m; m.userData.cabZ = true; return setObc(m, cabObc, null); }
  // a material that is not ours (a model's, a character's): a cabin copy that keeps its own shader hook
  function cabClone(m) { if (!m) return m; if (Array.isArray(m)) return m.map(cabClone); if (m.userData && m.userData.cabZ) return m; if (m.isSpriteMaterial || m.isShaderMaterial) return m; const prev = userObc(m); const c = m.clone(); c.userData = Object.assign({}, m.userData, { cabZ: true }); return setObc(c, cabObc, prev); }
  function cabTree(root) { root.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.material) { o.material = cabClone(o.material); o.frustumCulled = false; } }); }
  F.cabTree = cabTree;

  // ───────────────────────────── textures ─────────────────────────────
  function tex(path, rx, ry, srgb) {
    F.texC = F.texC || {}; F.texB = F.texB || {}; const k = path + "|" + rx + "|" + ry; if (F.texC[k]) return F.texC[k];
    let base = F.texB[path]; if (!base) { base = texLoader0.load(path); base.wrapS = base.wrapT = THREE.RepeatWrapping; base.anisotropy = typeof MAX_ANISO === "number" ? MAX_ANISO : 8; base.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; F.texB[path] = base; }
    const t = base.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; F.texC[k] = t; return t;
  }
  function canvasTex(w, h, fn, srgb, rep) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); fn(x, w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; return t; }
  // a fine grain normal map (leather, suede) from a few octaves of value noise
  function grainNormal(seed, k, oct) {
    F.gn = F.gn || {}; const key = seed + ":" + k; if (F.gn[key]) return F.gn[key];
    const S = 256, H = new Float32Array(S * S), r = rng(seed);
    for (let o = 0; o < (oct || 4); o++) { const g = 4 << o, cells = []; for (let i = 0; i < g * g; i++) cells.push(r()); const amp = 1 / (1 << o); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const fx = x / S * g, fy = y / S * g; const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; const a = cells[(y0 % g) * g + (x0 % g)], b = cells[(y0 % g) * g + ((x0 + 1) % g)], c = cells[((y0 + 1) % g) * g + (x0 % g)], d = cells[((y0 + 1) % g) * g + ((x0 + 1) % g)]; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); H[y * S + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy); } }
    const t = canvasTex(S, S, (x) => { const im = x.createImageData(S, S); for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) { const hx = H[y * S + (xx + 1) % S] - H[y * S + (xx + S - 1) % S], hy = H[((y + 1) % S) * S + xx] - H[((y + S - 1) % S) * S + xx]; let nx = -hx * k, ny = -hy * k, nzv = 1; const L = Math.hypot(nx, ny, nzv); nx /= L; ny /= L; nzv /= L; const i = (y * S + xx) * 4; im.data[i] = (nx * 0.5 + 0.5) * 255; im.data[i + 1] = (ny * 0.5 + 0.5) * 255; im.data[i + 2] = (nzv * 0.5 + 0.5) * 255; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); }, false);
    F.gn[key] = t; return t;
  }
  function glowTex() { if (F.glowT) return F.glowT; F.glowT = canvasTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.55)"); g.addColorStop(0.45, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }, true); return F.glowT; }
  function smokeTex() { if (F.smokeT) return F.smokeT; const r = rng(77); F.smokeT = canvasTex(128, 128, (x) => { x.clearRect(0, 0, 128, 128); for (let i = 0; i < 26; i++) { const a = r() * 6.283, d = r() * 26, px = 64 + Math.cos(a) * d, py = 64 + Math.sin(a) * d, rr = 16 + r() * 26; const g = x.createRadialGradient(px, py, 0, px, py, rr); const al = 0.10 + r() * 0.12; g.addColorStop(0, `rgba(255,255,255,${al})`); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); } }, true); return F.smokeT; }
  // the cove glow on the headliner: bright at both edges (the LED coves), falling off toward the centre line
  function coveTex() { if (F.coveT) return F.coveT; F.coveT = canvasTex(256, 4, (x) => { const im = x.createImageData(256, 4); for (let i = 0; i < 256; i++) { const u = i / 255, e = Math.min(u, 1 - u); const v = Math.exp(-e * 7.5) * 0.95 + 0.05; for (let j = 0; j < 4; j++) { const k = (j * 256 + i) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = v * 255; im.data[k + 3] = 255; } } x.putImageData(im, 0, 0); }, false); F.coveT.wrapS = THREE.ClampToEdgeWrapping; return F.coveT; }
  // the down-wash under the valance: the upper sidewall glows just below the PSU line
  function washTex() { if (F.washT) return F.washT; F.washT = canvasTex(4, 256, (x) => { const im = x.createImageData(4, 256); for (let j = 0; j < 256; j++) { const v = j / 255; const b = Math.pow(v, 5) * 0.9; for (let i = 0; i < 4; i++) { const k = (j * 4 + i) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = b * 255; im.data[k + 3] = 255; } } x.putImageData(im, 0, 0); }, false); F.washT.wrapT = THREE.ClampToEdgeWrapping; F.washT.flipY = false; return F.washT; }
  function goldLogo() { if (F.goldT) return F.goldT; try { const img = LOGO_TEX && LOGO_TEX.image; if (img && img.width) { F.goldT = canvasTex(img.width, img.height, (x, w, h) => { x.drawImage(img, 0, 0, w, h); x.globalCompositeOperation = "source-in"; x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); }, true); F.goldT.wrapS = F.goldT.wrapT = THREE.ClampToEdgeWrapping; return F.goldT; } } catch (e) {} return LOGO_TEX; }
  function pleatTex() { if (F.pleatT) return F.pleatT; const r = rng(9); F.pleatT = canvasTex(128, 128, (x) => { x.fillStyle = "#f6efe3"; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 128; i++) { x.fillStyle = `rgba(120,100,70,${0.02 + r() * 0.03})`; x.fillRect(0, i, 128, 1); } for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.08})`; x.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1); } }, true, [4, 6]); return F.pleatT; }

  function mats() {
    if (F.M) return F.M;
    const S = (o) => cab(new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, envMapIntensity: 1 }, o)));
    const M = {};
    M.carpet = S({ map: tex("/tex/jet_carpet.jpg", 1.7, 1.7, true), normalMap: tex("/tex/jet_carpet_n.jpg", 1.7, 1.7), normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: tex("/tex/jet_carpet_r.jpg", 1.7, 1.7), roughness: 1, color: 0xd6c9b8 });
    M.wall = S({ map: tex("/tex/jet_wall.jpg", 1.3, 1.3, true), normalMap: grainNormal(3, 1.6, 4), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.92, color: 0xf6efe2 });
    M.wallLo = S({ map: tex("/tex/jet_wall.jpg", 1.3, 1.3, true), normalMap: grainNormal(3, 1.6, 4), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.95, color: 0xcdbfa9 });
    { const a0 = arcY(1.46), a1 = arcY(1.8); const wt = washTex(); wt.repeat.set(1, 1 / (a1 - a0)); wt.offset.set(0, -a0 / (a1 - a0)); }
    M.wash = S({ map: tex("/tex/jet_wall.jpg", 1.3, 1.3, true), roughness: 0.92, color: 0xf6efe2, emissive: 0xffd9ae, emissiveMap: washTex(), emissiveIntensity: 0.35 });
    M.ceil = S({ map: tex("/tex/jet_wall.jpg", 1.6, 1.6, true), normalMap: grainNormal(5, 1.2, 4), normalScale: new THREE.Vector2(0.2, 0.2), roughness: 1, color: 0xfbf7ef, emissive: 0xffd6a4, emissiveMap: coveTex(), emissiveIntensity: F.coveK });
    M.leatherQ = S({ map: tex("/tex/jet_leather.jpg", 2.3, 2.3, true), normalMap: tex("/tex/jet_leather_n.jpg", 2.3, 2.3), normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: tex("/tex/jet_leather_r.jpg", 2.3, 2.3), roughness: 0.85, color: 0xfff9ee });
    M.leather = S({ color: 0xefe4d0, roughness: 0.52, normalMap: grainNormal(11, 3.2, 5), normalScale: new THREE.Vector2(0.55, 0.55) });
    M.leatherD = S({ color: 0xd9ccb5, roughness: 0.58, normalMap: grainNormal(11, 3.2, 5), normalScale: new THREE.Vector2(0.55, 0.55) });
    M.accent = S({ color: 0x8a735a, roughness: 0.8, normalMap: grainNormal(13, 2.4, 5), normalScale: new THREE.Vector2(0.8, 0.8) });
    M.cashmere = S({ color: 0x6d5a48, roughness: 0.95, normalMap: grainNormal(17, 1.4, 5), normalScale: new THREE.Vector2(1, 1) });
    M.walnut = cab(new THREE.MeshPhysicalMaterial({ vertexColors: true, map: tex("/tex/jet_walnut.jpg", 1.1, 1.1, true), normalMap: tex("/tex/jet_walnut_n.jpg", 1.1, 1.1), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.045, color: 0xc9ab97, envMapIntensity: 1.1 }));
    M.gold = S({ map: tex("/tex/jet_gold.jpg", 1, 1, true), metalness: 1, roughness: 0.26, color: 0xf2dfb2 });
    M.chrome = S({ color: 0xe9e4d9, metalness: 1, roughness: 0.1 });
    M.black = S({ color: 0x0b0c0e, metalness: 0.3, roughness: 0.22 });
    M.seam = S({ map: tex("/tex/jet_wall.jpg", 1.3, 1.3, true), color: 0xb3a590, roughness: 0.95 });
    M.steel = S({ color: 0xc9cdd1, metalness: 0.9, roughness: 0.32 });
    M.stone = S({ map: tex("/tex/travertine.jpg", 1.6, 1.6, true), color: 0xfbf8f3, roughness: 0.14, metalness: 0 });
    M.porcelain = S({ color: 0xfdfbf7, roughness: 0.16 });
    M.reveal = S({ color: 0xf3ede2, roughness: 0.42 });
    M.led = cab(new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: 0xffdcae, emissiveIntensity: 2.6, roughness: 0.6 }));
    M.ledDim = cab(new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: 0xffd7a0, emissiveIntensity: 0.9, roughness: 0.6 }));
    M.green = cab(new THREE.MeshStandardMaterial({ color: 0x4dde6f, emissive: 0x4dde6f, emissiveIntensity: 1.3 }));
    M.leaf = S({ color: 0x3d6b34, roughness: 0.55 });
    M.petal = S({ color: 0xfcf8f4, roughness: 0.5, emissive: 0x2a2620, emissiveIntensity: 0.3 });
    M.fruitO = S({ color: 0xf08a24, roughness: 0.45 }); M.fruitR = S({ color: 0xa4192a, roughness: 0.35 }); M.fruitG = S({ color: 0x8fbf3a, roughness: 0.4 });
    M.coffee = S({ color: 0x3a2214, roughness: 0.15 }); M.juice = S({ color: 0xf29b1a, roughness: 0.12 });
    M.folio = S({ color: 0x2c2420, roughness: 0.55, normalMap: grainNormal(11, 3.2, 5), normalScale: new THREE.Vector2(0.6, 0.6) });
    M.crystal = cab(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6 }));
    M.bubbly = cab(new THREE.MeshStandardMaterial({ color: 0xf3dd98, roughness: 0.08, transparent: true, opacity: 0.75, depthWrite: false }));
    M.glass = cab(new THREE.MeshStandardMaterial({ color: 0xe8f0f4, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.09, depthWrite: false, envMapIntensity: 1.2 }));
    M.shadeL = cab(new THREE.MeshStandardMaterial({ map: pleatTex(), color: 0xf3eadb, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0 }));
    M.shadeR = cab(new THREE.MeshStandardMaterial({ map: pleatTex(), color: 0xf3eadb, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0 }));
    F.M = M; return M;
  }

  // ───────────────────────────── geometry ─────────────────────────────
  function geoFrom(P, N, UV, I) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); return g; }
  function ensureAttrs(g) { if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.index) { const n = g.attributes.position.count, a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(a); } return g; }
  function flipWinding(g) { const ix = g.index; if (!ix) return g; const a = ix.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } ix.needsUpdate = true; return g; }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _sv = new THREE.Vector3(), _pv = new THREE.Vector3();
  function xf(g, x, y, z, rx, ry, rz, sx, sy, sz) { ensureAttrs(g); _pv.set(x || 0, y || 0, z || 0); _eu.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_eu); const s0 = sx === undefined ? 1 : sx; _sv.set(s0, sy === undefined ? s0 : sy, sz === undefined ? s0 : sz); _m4.compose(_pv, _q, _sv); g.applyMatrix4(_m4); if (_sv.x * _sv.y * _sv.z < 0) flipWinding(g); return g; }
  function xm(g, m) { ensureAttrs(g); g.applyMatrix4(m); if (m.determinant() < 0) flipWinding(g); return g; }
  // make every triangle face along a reference normal (the analytic one stored in the normal attribute, or refFn(x, y, z))
  function orient(g, refFn, renorm) { const p = g.attributes.position, n = g.attributes.normal, ix = g.index.array; const A = V3(), B = V3(), C = V3(), e1 = V3(), e2 = V3(), fn = V3(), r = V3();
    for (let i = 0; i < ix.length; i += 3) { A.fromBufferAttribute(p, ix[i]); B.fromBufferAttribute(p, ix[i + 1]); C.fromBufferAttribute(p, ix[i + 2]); fn.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A)); if (refFn) { const q = refFn((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3); r.set(q[0], q[1], q[2]); } else { r.set(n.getX(ix[i]) + n.getX(ix[i + 1]) + n.getX(ix[i + 2]), n.getY(ix[i]) + n.getY(ix[i + 1]) + n.getY(ix[i + 2]), n.getZ(ix[i]) + n.getZ(ix[i + 1]) + n.getZ(ix[i + 2])); } if (fn.dot(r) < 0) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
    g.index.needsUpdate = true; if (renorm) g.computeVertexNormals(); return g; }
  // box-projected UVs in metres
  function boxUV(g, sc) { const p = g.attributes.position, n = g.attributes.normal; const uv = new Float32Array(p.count * 2); const k = sc || 1; for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v; if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); } uv[i * 2] = u * k; uv[i * 2 + 1] = v * k; } g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return g; }
  // a rounded box (the three.js RoundedBoxGeometry construction), centred, UVs in metres
  function rbox(w, h, d, r, seg, bulge) {
    seg = seg || 3; r = Math.max(0.001, Math.min(r, w / 2, h / 2, d / 2) * 0.999); const S = seg * 2 + 1;
    const g = new THREE.BoxGeometry(1, 1, 1, S, S, S).toNonIndexed(); const P = g.attributes.position.array, N = g.attributes.normal.array; const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, half = 0.5 / S; const n = V3();
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; n.set(x - Math.sign(x) * half, y - Math.sign(y) * half, z - Math.sign(z) * half).normalize(); let X = hx * Math.sign(x) + n.x * r, Y = hy * Math.sign(y) + n.y * r, Z = hz * Math.sign(z) + n.z * r; if (bulge && n.y > 0.2) { const fx = cl(X / (w / 2), -1, 1), fz = cl(Z / (d / 2), -1, 1); Y += bulge * (1 - fx * fx) * (1 - fz * fz) * n.y; } P[i] = X; P[i + 1] = Y; P[i + 2] = Z; N[i] = n.x; N[i + 1] = n.y; N[i + 2] = n.z; }
    boxUV(g); return ensureAttrs(g);
  }
  function cyl(rt, rb, h, seg, open) { return ensureAttrs(new THREE.CylinderGeometry(rt, rb, h, seg || 24, 1, !!open)); }
  function lathe(pts, seg) { return ensureAttrs(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg || 28)); }
  function sphere(r, ws, hs) { return ensureAttrs(new THREE.SphereGeometry(r, ws || 14, hs || 10)); }
  function torus(R, r, rs, ts, arc) { return ensureAttrs(new THREE.TorusGeometry(R, r, rs || 8, ts || 32, arc || Math.PI * 2)); }
  // an extruded outline (x, y) pushed along z by depth, centred on z
  function extrude(pts, depth, holes) { const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1]))); for (const h of holes || []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1])))); const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 }); g.translate(0, 0, -depth / 2); boxUV(g); return ensureAttrs(g); }
  function mergeGeos(list) {
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), C = new Float32Array(nv * 3), I = new Uint32Array(ni); let ov = 0, oi = 0;
    for (const g of list) { const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color, ix = g.index.array; for (let i = 0; i < p.count; i++) { const o = (ov + i) * 3; P[o] = p.getX(i); P[o + 1] = p.getY(i); P[o + 2] = p.getZ(i); N[o] = n.getX(i); N[o + 1] = n.getY(i); N[o + 2] = n.getZ(i); UV[(ov + i) * 2] = u ? u.getX(i) : 0; UV[(ov + i) * 2 + 1] = u ? u.getY(i) : 0; if (c) { C[o] = c.getX(i); C[o + 1] = c.getY(i); C[o + 2] = c.getZ(i); } else { C[o] = C[o + 1] = C[o + 2] = -1; } } for (let i = 0; i < ix.length; i++) I[oi + i] = ix[i] + ov; ov += p.count; oi += ix.length; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.BufferAttribute(N, 3)); g.setAttribute("uv", new THREE.BufferAttribute(UV, 2)); g.setAttribute("color", new THREE.BufferAttribute(C, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere(); return g;
  }

  // ───────────────────────────── the fuselage cross-section (left side, +x; mirrored for the right) ─────────────────────────────
  // a large-cabin business jet: 2.47 m wide at the window line, 1.93 m high on the aisle (Gulfstream G650 / Global 7500 class)
  const PROF = [[0.97, 0], [1.04, 0.18], [1.10, 0.42], [1.14, 0.60], [1.19, 0.78], [1.226, 0.96], [1.235, 1.08], [1.216, 1.26], [1.172, 1.44], [1.105, 1.58], [1.02, 1.70], [0.93, 1.78], [0.90, 1.80]];
  const PM = PROF.map((p, i) => { const a = PROF[Math.max(0, i - 1)], b = PROF[Math.min(PROF.length - 1, i + 1)]; return (b[0] - a[0]) / (b[1] - a[1]); });
  function wallX(y) { y = cl(y, 0, 1.8); for (let i = 0; i < PROF.length - 1; i++) { const a = PROF[i], b = PROF[i + 1]; if (y <= b[1]) { const h = b[1] - a[1], t = (y - a[1]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * a[0] + (t3 - 2 * t2 + t) * h * PM[i] + (-2 * t3 + 3 * t2) * b[0] + (t3 - t2) * h * PM[i + 1]; } } return PROF[PROF.length - 1][0]; }
  function wallDX(y) { const a = Math.max(0, y - 0.004), b = Math.min(1.8, y + 0.004); return (wallX(b) - wallX(a)) / (b - a); }
  const ARC = (() => { const a = [0]; let s = 0; for (let i = 1; i <= 180; i++) { const y0 = (i - 1) / 100, y1 = i / 100; s += Math.hypot(wallX(y1) - wallX(y0), y1 - y0); a.push(s); } return a; })();
  function arcY(y) { const f = cl(y, 0, 1.8) * 100, i = Math.floor(f); return i >= 180 ? ARC[180] : ARC[i] + (ARC[i + 1] - ARC[i]) * (f - i); }
  const HEAD = (x) => 1.86 + 0.07 * (1 - Math.pow(Math.min(1, Math.abs(x) / 0.86), 2));   // the headliner vault
  function wallN(side, y) { const dx = wallDX(y), l = Math.hypot(1, dx); return [-side / l, dx / l, 0]; }
  function wallStrip(side, z0, z1, y0, y1, dz, dy, inset) {
    const nzs = Math.max(1, Math.ceil((z1 - z0) / dz)), nys = Math.max(1, Math.ceil((y1 - y0) / dy)); const P = [], N = [], UV = [], I = [];
    for (let j = 0; j <= nys; j++) { const y = y0 + (y1 - y0) * j / nys; const x = wallX(y) - (inset || 0), n = wallN(side, y); for (let i = 0; i <= nzs; i++) { const z = z0 + (z1 - z0) * i / nzs; P.push(side * x, y, z); N.push(n[0], n[1], n[2]); UV.push(z, arcY(y)); } }
    for (let j = 0; j < nys; j++) for (let i = 0; i < nzs; i++) { const a = j * (nzs + 1) + i, b = a + 1, c = a + nzs + 1, d = c + 1; I.push(a, b, c, b, d, c); }
    return orient(geoFrom(P, N, UV, I));
  }
  // a wall bay [z0, z1] x [y0, y1] with an oval window hole (a along z, b along y), rings from the oval out to the bay edge
  function wallBay(side, z0, z1, y0, y1, win, inset) {
    const per = [], NZ = 16, NY = 14;
    for (let i = 0; i < NZ; i++) per.push([z0 + (z1 - z0) * i / NZ, y0]); for (let i = 0; i < NY; i++) per.push([z1, y0 + (y1 - y0) * i / NY]);
    for (let i = 0; i < NZ; i++) per.push([z1 - (z1 - z0) * i / NZ, y1]); for (let i = 0; i < NY; i++) per.push([z0, y1 - (y1 - y0) * i / NY]);
    const K = per.length, M = 6; const P = [], N = [], UV = [], I = [];
    for (let k = 0; k < K; k++) { const [rz, ry] = per[k]; const th = Math.atan2((ry - win.y) / win.b, (rz - win.z) / win.a); const ez = win.z + win.a * Math.cos(th), ey = win.y + win.b * Math.sin(th);
      for (let r = 0; r <= M; r++) { const f = Math.pow(r / M, 1.5); const z = lerp(ez, rz, f), y = lerp(ey, ry, f); const x = wallX(y) - (inset || 0), n = wallN(side, y); P.push(side * x, y, z); N.push(n[0], n[1], n[2]); UV.push(z, arcY(y)); } }
    for (let k = 0; k < K; k++) { const k2 = (k + 1) % K; for (let r = 0; r < M; r++) { const a = k * (M + 1) + r, b = a + 1, c = k2 * (M + 1) + r, d = c + 1; I.push(a, c, b, b, c, d); } }
    return orient(geoFrom(P, N, UV, I));
  }
  // the window reveal: a soft bezel lip on the wall, then a tapering tunnel out to the pane
  function revealTube(side, win, xGlass, shrink) {
    const K = 64, rings = [[1.06, -0.005], [1.0, -0.009], [0.985, 0.012], [0.955, 0.4], [shrink, 1]];   // [scale, depth fraction (<0: metres proud of the wall)]
    const P = [], N = [], UV = [], I = [];
    for (let k = 0; k <= K; k++) { const th = k / K * Math.PI * 2, cz = Math.cos(th), sy = Math.sin(th); for (let r = 0; r < rings.length; r++) { const [s, f] = rings[r]; const y = win.y + win.b * sy * s, z = win.z + win.a * cz * s; const xw = wallX(win.y + win.b * sy); const x = f < 0 ? xw + f : lerp(xw, xGlass, f); P.push(side * x, y, z); N.push(0, 0, 0); UV.push(k / K * 2.4, r * 0.05); } }
    const R = rings.length; for (let k = 0; k < K; k++) for (let r = 0; r < R - 1; r++) { const a = k * R + r, b = a + 1, c = (k + 1) * R + r, d = c + 1; I.push(a, c, b, b, c, d); }
    const g = geoFrom(P, N, UV, I); return orient(g, (x, y, z) => [-side * 0.6, (win.y - y) / win.b, (win.z - z) / win.a], true);
  }
  function revealTrim(side, win) {   // a thin brushed champagne ring just outside the bezel
    const K = 64, P = [], N = [], UV = [], I = [];
    for (let k = 0; k <= K; k++) { const th = k / K * Math.PI * 2; for (const s of [1.075, 1.1]) { const y = win.y + win.b * Math.sin(th) * s, z = win.z + win.a * Math.cos(th) * s; const x = wallX(y) - 0.003; const n = wallN(side, y); P.push(side * x, y, z); N.push(n[0], n[1], n[2]); UV.push(k / K * 3, s); } }
    for (let k = 0; k < K; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, c, b, b, c, d); } return orient(geoFrom(P, N, UV, I));
  }
  // a ribbon laid on the curved wall along a (z, y) path, inset toward the cabin
  function wallRibbon(side, path, w, inset) {
    const P = [], N = [], UV = [], I = []; let s = 0;
    for (let i = 0; i < path.length; i++) { const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)]; let tz = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tz, ty) || 1; tz /= L; ty /= L; const oz = -ty * w / 2, oy = tz * w / 2; if (i) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); for (const sg of [-1, 1]) { const z = path[i][0] + oz * sg, y = path[i][1] + oy * sg; const x = wallX(y) - inset, n = wallN(side, y); P.push(side * x, y, z); N.push(n[0], n[1], n[2]); UV.push(s, sg * 0.5 + 0.5); } }
    for (let i = 0; i < path.length - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, c, b, b, c, d); } return orient(geoFrom(P, N, UV, I));
  }
  // a pleated shade, top edge at y = 0, hanging to y = -1 (scaled per window), 1 m wide along z, pleats +-6 mm in x
  function pleatGeo(np) { const P = [], N = [], UV = [], I = []; const rows = np * 2; for (let j = 0; j <= rows; j++) { const y = -j / rows, x = (j % 2 ? 0.006 : -0.006); for (const z of [-0.5, 0.5]) { P.push(x, y, z); N.push(-1, 0, 0); UV.push(z + 0.5, -y); } } for (let j = 0; j < rows; j++) { const a = j * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, b, c, b, d, c); } const g = geoFrom(P, N, UV, I); g.computeVertexNormals(); return g; }
  // the cabin cross-section outline (x, y) between |x| >= xMin on one side, for bulkhead panels
  function sectionHalf(xMin, top) { const pts = [[xMin, 0]]; for (let y = 0; y <= 1.8 + 1e-6; y += 0.06) pts.push([wallX(y), y]); pts.push([0.9, 1.86]); for (let x = 0.86; x >= xMin - 1e-6; x -= 0.05) pts.push([x, Math.min(top || 9, HEAD(x))]); pts.push([xMin, Math.min(top || 9, HEAD(xMin))]); return pts; }

  // ───────────────────────────── the cabin builder: buckets by material, baked occlusion, merge ─────────────────────────────
  function Builder() { this.b = new Map(); this.occ = []; this.extra = []; }
  Builder.prototype.add = function (mat, g, noAO) { if (!g) return; ensureAttrs(g); if (!this.b.has(mat)) this.b.set(mat, []); if (noAO) { const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(1); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); } this.b.get(mat).push(g); return g; };
  Builder.prototype.sphere = function (x, y, z, r, k) { this.occ.push([x, y, z, r, k || 1]); };
  // occlusion at a point: furniture spheres, the floor-wall corner, surfaces near the floor, undersides
  Builder.prototype.ao = function (x, y, z, nx, ny, nz) {
    let occ = 0; for (const o of this.occ) { const vx = o[0] - x, vy = o[1] - y, vz = o[2] - z; const d2 = vx * vx + vy * vy + vz * vz, r2 = o[3] * o[3]; if (d2 < r2 * 0.8 || d2 > r2 * 30) continue; const d = Math.sqrt(d2); const c = (vx * nx + vy * ny + vz * nz) / d; if (c <= 0) continue; occ += c * r2 / d2 * o[4]; }
    const wx = wallX(y) - Math.abs(x); if (ny > 0.6 && y < 0.1) occ += 0.55 * Math.exp(-Math.max(0, wx) / 0.16);
    if (Math.abs(ny) < 0.7 && y < 0.5) occ += 0.3 * Math.exp(-y / 0.12);
    if (ny < -0.4) occ += 0.35;
    if (ny < -0.6 && y > 1.7) occ -= 0.3;                                              // the valance underside is lit by the reading lights
    for (const zb of this.bulk || []) { const dz = Math.abs(z - zb); if (dz < 0.6 && Math.abs(nz) < 0.7) occ += 0.12 * Math.exp(-dz / 0.15) * (y < 0.3 ? 1.6 : 0.6); }
    return cl(1 - occ * 0.85, 0.3, 1);
  };
  Builder.prototype.build = function (group) {
    for (const [mat, list] of this.b) { const g = mergeGeos(list); const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
      for (let i = 0; i < p.count; i++) { if (c.getX(i) >= 0) continue; const a = this.ao(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)); c.setXYZ(i, a, a * 0.985, a * 0.955); }
      c.needsUpdate = true; if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; } const m = new THREE.Mesh(g, mat); m.castShadow = !mat.transparent; m.receiveShadow = true; m.frustumCulled = false; m.userData.noCull = true; group.add(m); }
  };
  // a model placed in the cabin: its geometry copied into the buckets (per material), fitted into a slot
  function modelInto(B, kind, x, y, z, ry, slot) {
    const m = MODELS[kind]; if (!m) return false; const s = Math.min(slot[0] / Math.max(0.05, m.sx), slot[1] / Math.max(0.05, m.height), slot[2] / Math.max(0.05, m.sz)); const M4 = new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), V3(s, s, s));
    F.mc = F.mc || new Map(); for (const part of m.parts) { let mt = F.mc.get(part.material); if (!mt) { mt = cabClone(part.material); mt.vertexColors = true; F.mc.set(part.material, mt); } const g = part.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k); xm(g, M4); B.add(mt, g); }
    return true;
  }

  // ── the layout: +z forward (flight deck), +x the left side, floor at y = 0. Seats face f (the sitter looks along (sin f, cos f)). ──
  const Z = { fd: 8.40, gb: 5.80, ab: -6.30 };
  const WIN = [5.0, 3.95, 2.9, 1.85, 0.8, -0.25, -1.3, -2.35, -3.4, -4.45, -5.5];
  const WA = 0.355, WB = 0.26, WY = 1.02;                  // the oval windows: 71 x 52 cm, centred 1.02 m above the floor
  const SEATS = [   // [x, z, f, zone]
    [0.60, 3.05, 0, "club"], [-0.60, 3.05, 0, "club"], [0.60, 5.0, Math.PI, "club"], [-0.60, 5.0, Math.PI, "club"],
    [0.60, 1.80, Math.PI, "conf"], [-0.60, 1.80, Math.PI, "conf"], [0.60, -0.25, 0, "conf"], [-0.60, -0.25, 0, "conf"],
    [0.60, -2.45, Math.PI, "lounge"], [0.60, -5.40, 0, "lounge"]];
  F.layout = { Z, WIN, SEATS };

  function seatParts(B, M, x, z, f) {
    const Mx = new THREE.Matrix4().compose(V3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f, 0)), V3(1, 1, 1));
    const put = (mat, g) => B.add(mat, xm(g, Mx));
    const back = new THREE.Matrix4().makeRotationX(-0.2);
    const tb = (g, y, zz) => { g.applyMatrix4(back); g.translate(0, y, zz); return g; };
    put(M.chrome, cyl(0.27, 0.29, 0.025, 36).translate(0, 0.0125, -0.02));
    put(M.leatherD, rbox(0.54, 0.31, 0.56, 0.05, 3).translate(0, 0.18, -0.02));
    put(M.leatherQ, rbox(0.53, 0.15, 0.6, 0.065, 3, 0.02).translate(0, 0.405, 0.03));
    put(M.leather, rbox(0.57, 0.17, 0.08, 0.035, 3).translate(0, 0.4, 0.31));
    put(M.leather, tb(rbox(0.58, 0.7, 0.2, 0.08, 3), 0.8, -0.28));
    put(M.leatherQ, tb(rbox(0.47, 0.54, 0.06, 0.028, 3, 0.012), 0.79, -0.175));
    put(M.leather, tb(rbox(0.42, 0.2, 0.15, 0.07, 3), 1.16, -0.37));
    for (const sd of [-1, 1]) { put(M.leather, rbox(0.12, 0.24, 0.68, 0.05, 3).translate(sd * 0.315, 0.5, -0.03)); put(M.walnut, rbox(0.105, 0.028, 0.38, 0.012, 2).translate(sd * 0.315, 0.628, 0.12)); put(M.chrome, rbox(0.012, 0.012, 0.66, 0.005, 1).translate(sd * 0.376, 0.52, -0.03)); }
    put(M.chrome, rbox(0.05, 0.012, 0.09, 0.004, 1).translate(-0.315, 0.644, -0.12));
    const w = V3(0, 0.4, 0.02).applyMatrix4(Mx), wb = V3(0, 0.82, -0.28).applyMatrix4(Mx); B.sphere(w.x, w.y, w.z, 0.34, 1); B.sphere(wb.x, wb.y, wb.z, 0.32, 0.9);
    for (const sd of [-1, 1]) { const a = V3(sd * 0.315, 0.5, 0).applyMatrix4(Mx); B.sphere(a.x, a.y, a.z, 0.13, 0.8); }
  }
  function tableParts(B, M, x, z, w, l) {
    B.add(M.walnut, rbox(w, 0.034, l, 0.1, 4).translate(x, 0.735, z));
    B.add(M.gold, rbox(w + 0.008, 0.012, l + 0.008, 0.104, 4).translate(x, 0.716, z));
    B.add(M.chrome, cyl(0.035, 0.035, 0.7, 20).translate(x + Math.sign(x) * 0.12, 0.36, z)); B.add(M.chrome, cyl(0.2, 0.22, 0.018, 32).translate(x + Math.sign(x) * 0.12, 0.009, z));
    B.sphere(x, 0.6, z, 0.42, 0.9);
  }
  function orchid(B, M, x, y, z, h) {
    B.add(M.porcelain, lathe([[0, 0], [0.06, 0], [0.075, 0.02], [0.08, 0.11], [0.07, 0.12], [0, 0.12]], 24).translate(x, y, z));
    B.add(M.leaf, rbox(0.16, 0.012, 0.05, 0.006, 1).translate(x, y + 0.125, z + 0.02)); B.add(M.leaf, rbox(0.14, 0.012, 0.05, 0.006, 1).translate(x, y + 0.13, z - 0.03).rotateY(0.3));
    for (let s = 0; s < 2; s++) { const a = s * 2.6 + 0.4, ca = Math.cos(a), sa = Math.sin(a); const sx = x + ca * 0.015, sz = z + sa * 0.015; const top = y + 0.12 + h * (0.95 + s * 0.12);
      B.add(M.leaf, cyl(0.003, 0.0035, top - y - 0.12, 5).translate(sx, (top + y + 0.12) / 2, sz));
      for (let k = 0; k < 5; k++) { const f = k / 4, ox = ca * (0.02 + f * 0.13), oz = sa * (0.02 + f * 0.13), px = sx + ox, py = top + 0.02 * Math.sin(f * 2.4) - f * f * 0.09, pz = sz + oz; const R = 0.024 - k * 0.002;
        if (k) B.add(M.leaf, cyl(0.0022, 0.0022, 0.04, 4).rotateZ(0.9).rotateY(-a).translate(px - ca * 0.018, py + 0.01, pz - sa * 0.018));
        for (let p = 0; p < 5; p++) { const pa = p / 5 * Math.PI * 2; const pg = sphere(R * 0.62, 6, 4); pg.scale(1, 1, 0.32); pg.translate(Math.cos(pa) * R * 0.7, Math.sin(pa) * R * 0.7, 0); pg.rotateY(Math.PI / 2 - a); B.add(M.petal, pg.translate(px, py, pz)); }
        B.add(M.fruitO, sphere(R * 0.28, 6, 5).translate(px + ca * 0.004, py, pz + sa * 0.004)); } }
  }
  function flute(B, M, x, y, z, fill) { B.add(M.crystal, lathe([[0, 0], [0.032, 0], [0.034, 0.004], [0.004, 0.012], [0.003, 0.11], [0.022, 0.13], [0.027, 0.2], [0.025, 0.21]], 18).translate(x, y, z)); if (fill) B.add(M.bubbly, lathe([[0, 0.125], [0.02, 0.13], [0.024, 0.18], [0, 0.18]], 16).translate(x, y, z)); }
  function place(B, M, x, y, z) { B.add(M.porcelain, lathe([[0, 0], [0.1, 0], [0.13, 0.012], [0.14, 0.018], [0.12, 0.014], [0, 0.008]], 32).translate(x, y, z)); }

  function buildCabinR2() {
    const M = mats(); const g = new THREE.Group(); g.name = "cabinR2"; const B = new Builder(); B.bulk = [Z.gb, Z.fd, Z.ab]; const seats = [], blocks = [], windows = [];
    g.userData.noCull = true;
    // floor, carpet edge trims and the floor path lights
    { const P = [], N = [], UV = [], I = []; const nx = 18, nzs = Math.ceil((Z.fd - Z.ab) / 0.12); for (let j = 0; j <= nzs; j++) { const z = Z.ab + (Z.fd - Z.ab) * j / nzs; for (let i = 0; i <= nx; i++) { const x = -0.99 + 1.98 * i / nx; P.push(x, 0, z); N.push(0, 1, 0); UV.push(x, z); } } for (let j = 0; j < nzs; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, c, b, b, c, d); } B.add(M.carpet, orient(geoFrom(P, N, UV, I))); }
    for (const sd of [-1, 1]) { B.add(M.gold, rbox(0.03, 0.012, Z.fd - Z.ab, 0.004, 1).translate(sd * 0.955, 0.006, (Z.fd + Z.ab) / 2)); B.add(M.ledDim, rbox(0.012, 0.01, Z.gb - Z.ab - 0.4, 0.003, 1).translate(sd * 0.975, 0.035, (Z.gb + Z.ab) / 2), true); }
    // the walls: the dado, the window belt (oval windows in the seating zones, the entry door window forward left), the upper sidewall with the down-wash, the valance lip
    const bayW = 1.05, belt = [0.6, 1.46];
    for (const sd of [-1, 1]) {
      B.add(M.wallLo, wallStrip(sd, Z.ab, Z.fd, 0, belt[0], 0.12, 0.05));
      B.add(M.wash, wallStrip(sd, Z.ab, Z.fd, belt[1], 1.8, 0.12, 0.03));
      const zTop = WIN[0] + bayW / 2, zBot = WIN[WIN.length - 1] - bayW / 2;
      for (const wz of WIN) { const w = { z: wz, y: WY, a: WA, b: WB }; B.add(M.wall, wallBay(sd, wz - bayW / 2, wz + bayW / 2, belt[0], belt[1], w)); B.add(M.reveal, revealTube(sd, w, 1.34, 0.9)); B.add(M.gold, revealTrim(sd, w)); windows.push({ side: sd, x: sd * 1.2, z: wz, y: WY, k: 0, want: 0 }); }
      B.add(M.wall, wallStrip(sd, Z.ab, zBot, belt[0], belt[1], 0.12, 0.05));
      for (let i = 0; i <= WIN.length; i++) { const zs = i < WIN.length ? WIN[i] + bayW / 2 : zBot; const path = []; for (let y = belt[0] + 0.02; y <= belt[1] - 0.01; y += 0.06) path.push([zs, y]); B.add(M.seam, wallRibbon(sd, path, 0.004, 0.0012)); }
      if (sd > 0) { const dw = { z: 7.0, y: 1.32, a: 0.13, b: 0.16 }; B.add(M.wall, wallStrip(sd, zTop, 6.55, belt[0], belt[1], 0.12, 0.05)); B.add(M.wall, wallBay(sd, 6.55, 7.45, belt[0], belt[1], dw)); B.add(M.reveal, revealTube(sd, dw, 1.33, 0.9)); B.add(M.gold, revealTrim(sd, dw)); B.add(M.wall, wallStrip(sd, 7.45, Z.fd, belt[0], belt[1], 0.12, 0.05)); F.doorWin = dw; }
      else B.add(M.wall, wallStrip(sd, zTop, Z.fd, belt[0], belt[1], 0.12, 0.05));
      // the belt trim above the windows and the valance: a leather lip, the hidden cove LED behind it
      B.add(M.gold, wallRibbon(sd, [[Z.ab, 1.475], [Z.fd, 1.475]], 0.012, 0.004));
      B.add(M.leather, rbox(0.03, 0.1, Z.fd - Z.ab, 0.012, 2).translate(sd * 0.895, 1.83, (Z.fd + Z.ab) / 2));
      B.add(M.led, rbox(0.02, 0.008, Z.fd - Z.ab - 0.2, 0.003, 1).translate(sd * 0.925, 1.842, (Z.fd + Z.ab) / 2), true);
      // the ledge under the windows: walnut cap, polished nosing, leather fascia (not behind the divan)
      const ledges = sd > 0 ? [[Z.ab + 0.05, Z.gb - 0.05]] : [[-1.93, Z.gb - 0.05], [Z.ab + 0.05, -4.22]];
      for (const [a, b] of ledges) { const L = b - a, zc = (a + b) / 2; B.add(M.walnut, rbox(0.19, 0.045, L, 0.012, 2).translate(sd * 1.055, 0.6, zc)); B.add(M.chrome, cyl(0.008, 0.008, L, 8).rotateX(Math.PI / 2).translate(sd * 0.962, 0.618, zc)); B.add(M.leather, rbox(0.03, 0.14, L, 0.01, 2).translate(sd * 0.975, 0.51, zc)); }
    }
    // the headliner: a suede vault from cove to cove, a raised centre raceway with downlights
    { const P = [], N = [], UV = [], I = []; const nx = 24, nzs = Math.ceil((Z.fd - Z.ab) / 0.25); for (let j = 0; j <= nzs; j++) { const z = Z.ab + (Z.fd - Z.ab) * j / nzs; for (let i = 0; i <= nx; i++) { const u = -1 + 2 * i / nx, x = u * 0.9, y = HEAD(x); const dy = -0.07 * 2 * (x / 0.86) / 0.86 * (Math.abs(x) < 0.86 ? 1 : 0); const l = Math.hypot(dy, 1); P.push(x, y, z); N.push(dy / l, -1 / l, 0); UV.push((u + 1) / 2, z); } } for (let j = 0; j < nzs; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, b, c, b, d, c); } const hg = orient(geoFrom(P, N, UV, I)); B.add(M.ceil, hg, true); }
    B.add(M.ceil, rbox(0.34, 0.02, Z.fd - Z.ab - 0.1, 0.008, 2).translate(0, 1.925, (Z.fd + Z.ab) / 2), true);
    for (let z = Z.ab + 0.9; z < Z.fd - 0.4; z += 1.25) { B.add(M.chrome, torus(0.045, 0.008, 6, 24).rotateX(Math.PI / 2).translate(0, 1.912, z)); B.add(M.led, cyl(0.04, 0.04, 0.004, 20).translate(0, 1.914, z), true); }
    // reading lights and gaspers in the PSU line above each seat
    const psu = (sd, z) => { const y = 1.745, x = wallX(y) - 0.004; for (const dz of [-0.09, 0.09]) { B.add(M.chrome, torus(0.028, 0.006, 6, 20).rotateY(Math.PI / 2).rotateZ(sd * 0.9).translate(sd * x, y, z + dz)); B.add(M.ledDim, cyl(0.024, 0.024, 0.004, 16).rotateZ(Math.PI / 2 + sd * 0.9).translate(sd * (x - 0.002), y, z + dz), true); } B.add(M.chrome, sphere(0.018, 10, 8).translate(sd * (x - 0.01), y - 0.05, z)); };
    // bulkheads: the galley bulkhead (moving map screen on the right panel, the GIVEBACK mark in gold leaf on the left), the flight deck door, the aft lavatory door
    const bulkhead = (zc, half, doorM) => { for (const sd of [-1, 1]) { const pts = sectionHalf(half).map((p) => [sd * p[0], p[1]]); B.add(M.walnut, extrude(pts, 0.08).translate(0, 0, zc)); B.add(M.gold, rbox(0.012, 1.82, 0.086, 0.004, 2).translate(sd * (half + 0.004), 0.91, zc)); }
      const hdr = []; for (let x = -half; x <= half + 1e-6; x += half / 6) hdr.push([x, HEAD(x) + 0.01]); hdr.push([half, 1.82], [-half, 1.82]); B.add(M.walnut, extrude(hdr, 0.08).translate(0, 0, zc)); B.add(M.gold, rbox(half * 2 + 0.02, 0.012, 0.086, 0.004, 2).translate(0, 1.82, zc));
      if (doorM) { B.add(M.walnut, rbox(half * 2 - 0.02, 1.8, 0.04, 0.01, 2).translate(0, 0.905, zc)); B.add(M.chrome, rbox(0.02, 0.24, 0.03, 0.008, 2).translate(half * 0.72, 1.02, zc + Math.sign(-zc) * 0.035)); } };
    bulkhead(Z.gb, 0.39, false); bulkhead(Z.fd + 0.04, 0.31, true); bulkhead(Z.ab - 0.04, 0.31, true);
    // the asset team's cab_bulkhead (a full-width walnut partition with a central screen, screen side +Z) closes the lounge aft, facing forward
    F.aftModel = modelInto(B, "cab_bulkhead", 0, 0, Z.ab + 0.16, 0, [2.46, 1.95, 0.32]);
    // the galley, forward right: walnut cabinets, stone counter, a sink, two ovens and an espresso machine behind black glass, crystal storage, work lights
    { const x0 = -0.98, x1 = -0.4, z0 = 5.92, z1 = 8.28, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, L = z1 - z0;
      if (modelInto(B, "cab_galley", xc, 0, zc, Math.PI / 2, [L, 1.78, 0.62])) { const m = MODELS.cab_galley, s = Math.min(L / m.sx, 1.78 / m.height, 0.62 / m.sz), gl = m.sx * s; for (const [za, zb] of [[z0, zc - gl / 2], [zc + gl / 2, z1]]) if (zb - za > 0.04) { B.add(M.walnut, rbox(x1 - x0, 1.72, zb - za, 0.012, 2).translate(xc, 0.86, (za + zb) / 2)); B.add(M.stone, rbox(x1 - x0 + 0.02, 0.03, zb - za, 0.006, 1).translate(xc + 0.01, 0.92, (za + zb) / 2)); } }
      else {
        B.add(M.walnut, rbox(x1 - x0, 0.88, L, 0.012, 2).translate(xc, 0.46, zc)); B.add(M.black, rbox(x1 - x0 - 0.02, 0.06, L - 0.02, 0.01, 1).translate(xc, 0.03, zc));
        for (let i = 0; i < 4; i++) { const zz = z0 + L * (i + 0.5) / 4; B.add(M.black, rbox(0.004, 0.84, 0.006, 0.001, 1).translate(x1 + 0.002, 0.46, z0 + L * i / 4)); B.add(M.gold, rbox(0.018, 0.02, 0.22, 0.006, 1).translate(x1 + 0.014, 0.82, zz)); B.add(M.black, rbox(0.004, 0.006, L / 4 - 0.02, 0.001, 1).translate(x1 + 0.002, 0.58, zz)); }
        B.add(M.stone, rbox(x1 - x0 + 0.04, 0.035, L + 0.02, 0.008, 2).translate(xc + 0.02, 0.918, zc)); B.add(M.steel, rbox(0.34, 0.012, 0.42, 0.02, 2).translate(xc, 0.93, 6.3)); B.add(M.chrome, torus(0.07, 0.009, 6, 20, Math.PI).rotateY(Math.PI / 2).translate(x0 + 0.12, 1.08, 6.3)); B.add(M.chrome, cyl(0.011, 0.013, 0.16, 10).translate(x0 + 0.12, 1.0, 6.23));
        B.add(M.stone, rbox(0.02, 0.4, L, 0.004, 1).translate(x0 + 0.01, 1.13, zc));
        B.add(M.walnut, rbox(0.38, 0.4, 7.36 - z0, 0.012, 2).translate(x0 + 0.19, 1.53, (z0 + 7.36) / 2)); B.add(M.walnut, rbox(0.38, 0.4, z1 - 8.08, 0.012, 2).translate(x0 + 0.19, 1.53, (z1 + 8.08) / 2)); B.add(M.ledDim, rbox(0.3, 0.006, L - 0.1, 0.002, 1).translate(x0 + 0.2, 1.327, zc), true);
        B.add(M.walnut, rbox(0.02, 0.4, 0.72, 0.004, 1).translate(x0 + 0.01, 1.53, 7.72)); for (const yy of [1.34, 1.72]) B.add(M.walnut, rbox(0.38, 0.02, 0.72, 0.004, 1).translate(x0 + 0.19, yy, 7.72)); B.add(M.crystal, rbox(0.36, 0.008, 0.7, 0.002, 1).translate(x0 + 0.19, 1.53, 7.72)); B.add(M.ledDim, rbox(0.3, 0.006, 0.66, 0.002, 1).translate(x0 + 0.2, 1.705, 7.72), true);
        for (const [zz, w] of [[6.25, 0.46], [6.8, 0.46]]) { B.add(M.black, rbox(0.012, 0.3, w, 0.01, 2).translate(x0 + 0.385, 1.53, zz)); B.add(M.steel, rbox(0.014, 0.03, w - 0.06, 0.006, 1).translate(x0 + 0.393, 1.66, zz)); B.add(M.green, rbox(0.006, 0.012, 0.05, 0.002, 1).translate(x0 + 0.394, 1.41, zz + w / 2 - 0.06), true); }
        B.add(M.steel, rbox(0.3, 0.34, 0.34, 0.03, 2).translate(x0 + 0.23, 1.11, 7.35)); B.add(M.black, rbox(0.01, 0.1, 0.12, 0.004, 1).translate(x0 + 0.385, 1.2, 7.35)); B.add(M.chrome, cyl(0.02, 0.02, 0.06, 10).translate(x0 + 0.3, 1.0, 7.3));
        B.add(M.crystal, rbox(0.008, 0.36, 0.7, 0.003, 1).translate(x0 + 0.382, 1.53, 7.72)); for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) flute(B, M, x0 + 0.2, 1.352 + r * 0.182, 7.47 + c * 0.125, false); }
      B.sphere(xc, 0.5, 6.4, 0.4, 0.8); B.sphere(xc, 0.5, 7.5, 0.4, 0.8); for (let zz = z0 + 0.3; zz < z1; zz += 0.5) blocks.push([xc + 0.05, zz, 0.36]); }
    // forward left: the coat closet and the entry door with its lever
    { B.add(M.walnut, rbox(0.52, 1.72, 0.55, 0.012, 2).translate(0.74, 0.86, 6.18)); B.add(M.gold, rbox(0.018, 0.3, 0.02, 0.006, 1).translate(0.475, 1.05, 6.36)); blocks.push([0.74, 6.18, 0.36]);
      const door = [[6.62, 0.08], [7.38, 0.08], [7.38, 1.72], [6.62, 1.72], [6.62, 0.08]]; B.add(M.black, wallRibbon(1, door, 0.012, 0.006)); B.add(M.chrome, rbox(0.04, 0.05, 0.36, 0.015, 2).translate(wallX(1.05) - 0.05, 1.05, 7.0)); B.add(M.chrome, cyl(0.02, 0.02, 0.05, 10).rotateZ(Math.PI / 2).translate(wallX(1.05) - 0.025, 1.05, 7.16)); }
    // the moving map, the gold-leaf mark, plaques
    F.mapTex = F.mapTex || mapCanvas();
    { const scrM = cab(new THREE.MeshBasicMaterial({ map: F.mapTex, color: new THREE.Color(1.25, 1.25, 1.25), toneMapped: true }));
      B.add(M.black, rbox(0.72, 0.43, 0.022, 0.01, 2).translate(-0.78, 1.36, Z.gb - 0.05)); const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.672, 0.378), scrM); s1.position.set(-0.78, 1.36, Z.gb - 0.062); s1.rotation.y = Math.PI; s1.frustumCulled = false; g.add(s1);
      const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), cab(new THREE.MeshStandardMaterial({ map: goldLogo(), color: 0xf6dfa6, metalness: 1, roughness: 0.22, transparent: true, alphaTest: 0.3 }))); lg.position.set(0.8, 1.38, Z.gb - 0.042); lg.rotation.y = Math.PI; lg.frustumCulled = false; g.add(lg);
      const plaque = (txt, x, y, z, ry) => { try { const t = textTexture([{ text: txt, size: 104, y: 0.6, color: "#f5f1e6", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 512, 160, { planks: false, border: "#c9a24d" }); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.094), cab(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.2 }))); m.position.set(x, y, z); m.rotation.y = ry; m.frustumCulled = false; g.add(m); } catch (e) {} };
      plaque("FLIGHT DECK", 0, 1.872, Z.fd - 0.004, Math.PI); if (!F.aftModel) plaque("LAVATORY", 0, 1.872, Z.ab + 0.004, 0); plaque("GALLEY", -0.78, 1.72, Z.gb + 0.05, 0);
      F.scrM = scrM; }
    // seats: the forward club four, the conference four with tables, the lounge pair
    for (const [x, z, f, zone] of SEATS) { const k = modelInto(B, "cab_seat", x, 0, z, f, [0.8, 1.14, 0.88]); if (!k) seatParts(B, M, x, z, f); else { B.sphere(x, 0.45, z, 0.36, 1); } seats.push({ x, z, f, zone, sit: true }); blocks.push([x, z, 0.38]); psu(Math.sign(x), z + Math.cos(f) * -0.05); }
    // the conference tables: breakfast laid on the left, a folio and two flutes on the right
    let tableTop = 0.753; for (const sd of [-1, 1]) { const x = sd * 0.64, z = 0.775; if (!modelInto(B, "cab_table", x, 0, z, Math.PI / 2, [1.04, 0.76, 0.86])) tableParts(B, M, x, z, 0.7, 1.02); else { const m = MODELS.cab_table; tableTop = m.height * Math.min(1.04 / m.sx, 0.76 / m.height, 0.86 / m.sz) + 0.001; } blocks.push([x, z, 0.44], [x, z + 0.35, 0.36], [x, z - 0.35, 0.36]); }
    { const y = tableTop; for (const dz of [0.33, -0.33]) { place(B, M, 0.64, y, 0.775 + dz); B.add(M.porcelain, lathe([[0, 0], [0.028, 0], [0.036, 0.05], [0.04, 0.065], [0, 0.065]], 20).translate(0.78, y + 0.004, 0.775 + dz * 0.7)); B.add(M.coffee, cyl(0.035, 0.035, 0.004, 16).translate(0.78, y + 0.058, 0.775 + dz * 0.7), false); B.add(M.chrome, rbox(0.012, 0.004, 0.17, 0.002, 1).translate(0.5, y + 0.004, 0.775 + dz)); B.add(M.chrome, rbox(0.012, 0.004, 0.18, 0.002, 1).translate(0.78, y + 0.004, 0.775 + dz)); B.add(M.leather, rbox(0.1, 0.02, 0.16, 0.008, 1).translate(0.52, y + 0.014, 0.775 + dz * 1.05)); flute(B, M, 0.86, y, 0.775 + dz * 0.45, true); }
      B.add(M.porcelain, lathe([[0, 0], [0.05, 0], [0.1, 0.045], [0.11, 0.05], [0.09, 0.05], [0, 0.02]], 28).translate(0.62, y, 0.775)); const fr = [[M.fruitO, 0.02, 0.01], [M.fruitR, -0.03, 0.03], [M.fruitG, 0.01, -0.035], [M.fruitO, -0.02, -0.01]]; for (const [m, ox, oz] of fr) B.add(m, sphere(0.032, 12, 10).translate(0.62 + ox, y + 0.06, 0.775 + oz));
      orchid(B, M, 0.46, y, 0.775, 0.22);
      B.add(M.folio, rbox(0.24, 0.018, 0.32, 0.01, 2).translate(-0.6, y + 0.009, 0.62)); B.add(M.black, rbox(0.17, 0.008, 0.24, 0.008, 2).translate(-0.64, y + 0.004, 0.98)); flute(B, M, -0.84, y, 0.72, true); flute(B, M, -0.84, y, 0.86, true); }
    // the stowed club tables' tops in the ledge, a crystal tumbler on the ledge by the club seats
    for (const sd of [-1, 1]) { B.add(M.crystal, lathe([[0, 0], [0.035, 0], [0.038, 0.09], [0.035, 0.09], [0.032, 0.006], [0, 0.006]], 18).translate(sd * 1.02, 0.623, 4.05)); B.add(M.chrome, cyl(0.045, 0.045, 0.004, 20).translate(sd * 1.02, 0.623, 4.05)); }
    // the divan, aft right: walnut plinth, quilted cushions, a leather back rail, bolsters, throw pillows and a cashmere throw
    { const x0 = -0.98, x1 = -0.36, z0 = -4.2, z1 = -1.95, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, L = z1 - z0;
      if (!modelInto(B, "cab_divan", -0.63, 0, zc, Math.PI / 2, [L, 0.92, 0.88])) {
        B.add(M.walnut, rbox(x1 - x0, 0.1, L, 0.012, 2).translate(xc, 0.05, zc)); B.add(M.gold, rbox(0.012, 0.016, L - 0.02, 0.004, 1).translate(x1 + 0.004, 0.09, zc)); B.add(M.leatherD, rbox(x1 - x0 - 0.02, 0.24, L - 0.02, 0.04, 3).translate(xc, 0.22, zc));
        for (let i = 0; i < 3; i++) { const zz = z0 + 0.14 + (L - 0.28) * (i + 0.5) / 3; B.add(M.leatherQ, rbox(0.56, 0.14, (L - 0.3) / 3 - 0.01, 0.06, 3, 0.018).translate(xc + 0.02, 0.405, zz)); const bk = rbox(0.14, 0.34, (L - 0.3) / 3 - 0.012, 0.06, 3, 0); bk.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.2)); B.add(M.leatherQ, bk.translate(-0.86, 0.66, zz)); }
        B.add(M.leather, rbox(0.2, 0.05, L, 0.02, 2).translate(-1.0, 0.84, zc)); B.add(M.walnut, rbox(0.2, 0.03, L, 0.01, 2).translate(-1.0, 0.875, zc));
        for (const zz of [z0 + 0.07, z1 - 0.07]) { B.add(M.leather, rbox(0.6, 0.3, 0.14, 0.06, 3).translate(xc, 0.55, zz)); B.add(M.walnut, rbox(0.56, 0.025, 0.12, 0.01, 2).translate(xc, 0.713, zz)); } }
      const pil = (x, y, z, rz, ry, m) => { const p = rbox(0.34, 0.34, 0.1, 0.05, 3, 0); p.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, ry, rz, "YXZ"))); B.add(m, p.translate(x, y, z)); };
      pil(-0.78, 0.66, -2.3, -0.25, Math.PI / 2 + 0.1, M.accent); pil(-0.8, 0.64, -2.55, -0.15, Math.PI / 2 - 0.12, M.cashmere); pil(-0.78, 0.66, -3.85, -0.2, Math.PI / 2 - 0.08, M.accent);
      { const th = rbox(0.5, 0.035, 0.42, 0.015, 2, 0.01); th.applyMatrix4(new THREE.Matrix4().makeRotationY(0.08)); B.add(M.cashmere, th.translate(-0.64, 0.492, -3.55)); }
      for (let i = 0; i < 3; i++) { const zz = -2.4 - i * 0.68; seats.push({ x: -0.62, z: zz, f: Math.PI / 2, zone: "divan", sit: true }); }
      for (let zz = z0 + 0.25; zz < z1; zz += 0.45) blocks.push([xc - 0.02, zz, 0.34]); B.sphere(xc, 0.4, zc - 0.6, 0.45, 0.8); B.sphere(xc, 0.4, zc + 0.6, 0.45, 0.8);
      psu(-1, -2.4); psu(-1, -3.08); psu(-1, -3.76); }
    // the credenza, aft left: walnut, stone top, orchids in a crystal vase, a rising monitor with the moving map
    { const x0 = 0.42, x1 = 0.98, z0 = -4.5, z1 = -3.25, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, L = z1 - z0;
      let credTop = 0.76; if (modelInto(B, "cab_credenza", xc, 0, zc, -Math.PI / 2, [L, 0.76, 0.56])) { const m = MODELS.cab_credenza; credTop = m.height * Math.min(L / m.sx, 0.76 / m.height, 0.56 / m.sz); } else { B.add(M.walnut, rbox(x1 - x0, 0.72, L, 0.014, 2).translate(xc, 0.37, zc)); B.add(M.stone, rbox(x1 - x0 + 0.02, 0.03, L + 0.02, 0.008, 2).translate(xc, 0.745, zc)); for (const zz of [z0 + L / 3, z0 + 2 * L / 3]) B.add(M.black, rbox(0.004, 0.66, 0.006, 0.001, 1).translate(x0 - 0.002, 0.37, zz)); B.add(M.gold, rbox(0.016, 0.018, 0.22, 0.005, 1).translate(x0 - 0.012, 0.62, zc)); B.add(M.black, rbox(0.004, 0.02, L - 0.04, 0.001, 1).translate(x0 - 0.002, 0.03, zc)); }
      orchid(B, M, 0.66, credTop, -3.5, 0.3);
      blocks.push([xc, zc - 0.35, 0.36], [xc, zc + 0.35, 0.36]); B.sphere(xc, 0.4, zc, 0.5, 0.8); }
    // the drink station aft right: a walnut cabinet, champagne on ice, flutes
    { const x0 = -0.98, x1 = -0.5, z0 = -6.08, z1 = -4.45, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, L = z1 - z0; B.add(M.walnut, rbox(x1 - x0, 0.92, L, 0.014, 2).translate(xc, 0.47, zc)); B.add(M.stone, rbox(x1 - x0 + 0.02, 0.03, L + 0.02, 0.008, 2).translate(xc, 0.945, zc)); B.add(M.gold, rbox(0.016, 0.018, 0.3, 0.005, 1).translate(x1 + 0.012, 0.8, zc));
      B.add(M.chrome, lathe([[0, 0], [0.09, 0], [0.11, 0.2], [0.115, 0.21], [0.105, 0.21], [0, 0.02]], 28).translate(-0.72, 0.96, -5.1)); B.add(M.black, lathe([[0, 0], [0.04, 0], [0.042, 0.2], [0.02, 0.26], [0.014, 0.33], [0, 0.33]], 16).translate(-0.72, 1.02, -5.1)); B.add(M.gold, cyl(0.016, 0.016, 0.05, 10).translate(-0.72, 1.33, -5.1));
      for (let i = 0; i < 4; i++) flute(B, M, -0.66 - (i % 2) * 0.08, 0.96, -5.55 + Math.floor(i / 2) * 0.1, i === 0); blocks.push([xc, zc - 0.4, 0.34], [xc, zc + 0.4, 0.34]); B.sphere(xc, 0.5, zc, 0.5, 0.7); }
    // the lounge's second screen side lamp glow and the aft bulkhead orchid shelf
    if (!F.aftModel) { B.add(M.walnut, rbox(0.34, 0.025, 0.14, 0.008, 2).translate(-0.66, 1.2, Z.ab + 0.07)); orchid(B, M, -0.66, 1.212, Z.ab + 0.08, 0.18);
      B.add(M.black, rbox(0.6, 0.36, 0.02, 0.01, 2).translate(0.68, 1.34, Z.ab + 0.01)); const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.315), F.scrM); s2.position.set(0.68, 1.34, Z.ab + 0.021); s2.frustumCulled = false; g.add(s2); }
    else { const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.54), F.scrM); s2.position.set(0, 1.22, Z.ab + 0.325); s2.frustumCulled = false; g.add(s2); }
    B.build(g);
    // the windows: glass panes (one mesh per side) and the pleated shades (instanced, one per side)
    { const glassG = { "1": [], "-1": [] }; for (const w of windows) { const eg = new THREE.CircleGeometry(1, 48); eg.rotateY(w.side > 0 ? -Math.PI / 2 : Math.PI / 2); eg.scale(1, WB * 0.9, WA * 0.9); eg.translate(w.side * 1.34, w.y, w.z); glassG[String(w.side)].push(ensureAttrs(eg)); }
      if (F.doorWin) { const dw = F.doorWin; const eg = new THREE.CircleGeometry(1, 40); eg.rotateY(-Math.PI / 2); eg.scale(1, dw.b * 0.9, dw.a * 0.9); eg.translate(1.33, dw.y, dw.z); glassG["1"].push(ensureAttrs(eg)); }
      for (const sd of ["1", "-1"]) { const gg = mergeGeos(glassG[sd]); gg.attributes.color.array.fill(1); const m = new THREE.Mesh(gg, M.glass); m.frustumCulled = false; m.renderOrder = 2; g.add(m); }
      const pg = pleatGeo(26); F.shades = {}; for (const sd of [1, -1]) { const list = windows.filter((w) => w.side === sd); const im = new THREE.InstancedMesh(pg, sd > 0 ? M.shadeL : M.shadeR, list.length); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; list.forEach((w, i) => { w.inst = im; w.ii = i; }); g.add(im); F.shades[sd] = im; }
      g.userData.windows = windows; for (const w of windows) setShade(w, 0); }
    // light shafts through the windows (one mesh per side, sheared along the sun each frame)
    try { F.beams = buildBeams(g, windows); } catch (e) { log("beams", e); }
    // lights: warm fill along the aisle, reading pools over the seats and tables, the galley work light (all pooled by the engine)
    const pl = (x, y, z, c, i, d, dec) => { const l = new THREE.PointLight(c, i, d, dec); l.position.set(x, y, z); g.add(l); return l; };
    for (const z of [7.0, 3.9, 0.8, -2.4, -5.2]) pl(0, 1.72, z, 0xffe6c6, 0.34, 6.5, 1.4);
    for (const s of seats) if (s.zone !== "divan") pl(s.x * 0.95, 1.66, s.z, 0xffdcae, 0.22, 2.2, 2);
    pl(0.64, 1.6, 0.775, 0xffdcae, 0.38, 2.4, 2); pl(-0.64, 1.6, 0.775, 0xffdcae, 0.38, 2.4, 2); pl(-0.7, 1.55, -3.05, 0xffdcae, 0.3, 2.6, 2); pl(-0.6, 1.25, 7.0, 0xfff0dc, 0.3, 2.2, 2);
    // the cabin's own image-based light
    try { const env = cabinEnv(); if (env) g.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.material.envMap = env; o.material.envMapIntensity = (o.material.userData.envK || 1) * F.envK * (o.material.metalness > 0.5 ? 1.25 : 1); o.material.needsUpdate = true; } }); } catch (e) { log("env", e); }
    g.userData.seats = seats; g.userData.blocks = blocks; g.userData.L = Z.fd - Z.ab; g.userData.hw = 1.2; g.userData.zmin = Z.ab + (F.aftModel ? 0.55 : 0.3); g.userData.zmax = Z.fd; g.userData.r2 = true;
    return g;
  }
  F.buildCabinR2 = buildCabinR2;
  function setShade(w, k) { w.k = k; const im = w.inst; if (!im) return; const H = 0.64, W = 0.84; const top = w.y + WB + 0.06; const m = new THREE.Matrix4().compose(V3(w.side * 1.272, top, w.z), new THREE.Quaternion(), V3(1, H * (0.07 + 0.93 * k), W)); im.setMatrixAt(w.ii, m); im.instanceMatrix.needsUpdate = true; }

  // the cabin model the probe sees: a warm vault, cream walls, dark carpet, bright windows along both sides, the cove glow
  function cabinEnv() {
    if (F.env) return F.env; if (typeof pmrem === "undefined" || !pmrem) return null;
    const S = new THREE.Scene(); const bm = (r, g2, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g2, b), side: THREE.DoubleSide });
    const add = (geo, m, x, y, z, rx, ry) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, 0); S.add(o); };
    const eye = 1.15;
    add(new THREE.PlaneGeometry(1.8, 16), bm(1.05, 0.95, 0.8), 0, 1.92 - eye, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(2.0, 16), bm(0.1, 0.085, 0.07), 0, -eye, 0, -Math.PI / 2);
    for (const sd of [-1, 1]) { add(new THREE.PlaneGeometry(16, 1.9), bm(0.62, 0.56, 0.47), sd * 1.22, 0.95 - eye, 0, 0, Math.PI / 2); add(new THREE.PlaneGeometry(16, 0.03), bm(3.2, 2.5, 1.7), sd * 0.9, 1.85 - eye, 0, Math.PI / 2 * 0, Math.PI / 2);
      for (const z of WIN) add(new THREE.CircleGeometry(1, 24).scale(WA, WB, 1), bm(2.1, 1.95, 1.7), sd * 1.21, WY - eye, z - 1.0, 0, Math.PI / 2); }
    for (const z of [8, -8]) add(new THREE.PlaneGeometry(2.4, 2), bm(0.42, 0.28, 0.2), 0, 0.95 - eye, z);
    const rt = pmrem.fromScene(S, 0.03, 0.05, 40); F.envRT = rt; F.env = rt.texture; S.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); return F.env;
  }

  // light shafts: per side, one sheared prism per window (three nested shells for a soft edge), additive
  function buildBeams(g, windows) {
    const out = {};
    for (const sd of [1, -1]) { const list = windows.filter((w) => w.side === sd); const P = [], T = [], W = [], S = [], I = []; const K = 28;
      list.forEach((w, wi) => { for (const [shell, s] of [[0, 1.0], [1, 0.72], [2, 0.44]]) { const base = P.length / 3; for (let k = 0; k <= K; k++) { const th = k / K * Math.PI * 2; const y = w.y + WB * 0.9 * s * Math.sin(th), z = w.z + WA * 0.9 * s * Math.cos(th); for (const t of [0, 1]) { P.push(t, y, z); T.push(t); W.push(wi); S.push(shell); } } for (let k = 0; k < K; k++) { const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, c, b, b, c, d); } } });
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("aT", new THREE.Float32BufferAttribute(T, 1)); geo.setAttribute("aWin", new THREE.Float32BufferAttribute(W, 1)); geo.setAttribute("aShell", new THREE.Float32BufferAttribute(S, 1)); geo.setIndex(I);
      const u = { uCol: { value: new THREE.Color(1, 0.78, 0.5) }, uI: { value: 0 }, uShade: { value: new Array(list.length).fill(0) }, uTime: { value: 0 } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        vertexShader: `attribute float aT; attribute float aWin; attribute float aShell; uniform float uShade[${list.length}]; varying float vT; varying float vS; varying float vShell; varying vec3 vW;
          void main(){ vT = aT; vShell = aShell; vS = uShade[int(aWin + 0.5)]; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition; ${DEPTH_GLSL} }`,
        fragmentShader: `uniform vec3 uCol; uniform float uI; uniform float uTime; varying float vT; varying float vS; varying float vShell; varying vec3 vW;
          float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y), mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
          void main(){ float t = clamp(vT, 0.0, 1.0); float a = uI * clamp(1.0 - vS, 0.0, 1.0) * pow(1.0 - t, 1.8) * smoothstep(0.0, 0.12, t) * (vShell < 0.5 ? 0.3 : vShell < 1.5 ? 0.5 : 0.8);
            float d = n3(vW * 3.0 + vec3(0.0, uTime * 0.05, uTime * 0.03)); float mote = pow(clamp(n3(vW * 60.0 + uTime * 0.25), 0.0, 1.0), 16.0) * 9.0;
            a = max(a * (0.65 + 0.5 * d + mote), 0.0); gl_FragColor = vec4(uCol * a, 1.0); }` });
      const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = 3; m.visible = false; g.add(m); out[sd] = { m, u, list }; }
    return out;
  }
  const _sunL = new THREE.Vector3(), _iq = new THREE.Quaternion();
  function updateBeams(g, t) {
    const B = F.beams; if (!B || !g) return; let sd = skyMat.uniforms.sunDir.value; _sunL.copy(sd).normalize(); g.getWorldQuaternion(_iq); _iq.invert(); _sunL.applyQuaternion(_iq);
    const el = sd.y / Math.max(0.001, sd.length()); const up = sm(0.02, 0.12, el) * (1 - (typeof night === "number" ? night : 0));
    for (const s of [1, -1]) { const b = B[s]; if (!b) continue; const into = _sunL.x * s; const on = into > 0.08 && up > 0.01; b.m.visible = on && F.beamK > 0; if (!on) continue;
      const d = V3(-_sunL.x, -_sunL.y, -_sunL.z); const across = 2.2 / Math.max(0.2, Math.abs(d.x)); const down = d.y < -0.02 ? (WY - 0.02) / -d.y : 9; const L = Math.min(3.2, across, down);
      b.m.matrix.set(d.x * L, 0, 0, s * 1.33, d.y * L, 1, 0, 0, d.z * L, 0, 1, 0, 0, 0, 0, 1); b.m.matrixWorldNeedsUpdate = true;
      b.u.uI.value = 0.13 * up * sm(0.08, 0.35, into) * F.beamK * (F.shotKind === "cab" ? 1 : 0); b.u.uTime.value = t; b.list.forEach((w, i) => { b.u.uShade.value[i] = w.k; });
      const sc = typeof POST !== "undefined" && POST.sunCol ? POST.sunCol : null; if (sc) b.u.uCol.value.setRGB(1, 0.82, 0.58); }
    // closed shades glow when the sun is on their side
    const M = F.M; if (M) { M.shadeL.emissiveIntensity = 0.55 * up * cl(_sunL.x * 1.5, 0, 1) + 0.05; M.shadeR.emissiveIntensity = 0.55 * up * cl(-_sunL.x * 1.5, 0, 1) + 0.05; }
  }

  // ───────────────────────────── the moving map ─────────────────────────────
  function mapCanvas() { const c = document.createElement("canvas"); c.width = 1024; c.height = 576; F.mapC = c; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; F.mapView = null; return t; }
  function drawMap(pth) {
    const c = F.mapC; if (!c) return; const x = c.getContext("2d"); const W = c.width, H = c.height; const P = window.PLAN || {}; const pp = FLY.pp;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#07131c"); g.addColorStop(1, "#0c2231"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const site = [280, 180]; const ax = pth.x, az = pth.z; const dx = Math.abs(ax - site[0]), dz = Math.abs(az - site[1]);
    const want = { cx: (ax + site[0]) / 2, cz: (az + site[1]) / 2, half: cl(Math.max(dx, dz * 1.78) * 0.62 + 650, 900, 3400) };
    const v = F.mapView || (F.mapView = Object.assign({}, want)); const k = 0.25; v.cx += (want.cx - v.cx) * k; v.cz += (want.cz - v.cz) * k; v.half += (want.half - v.half) * k;
    const top = 64, bot = 92, mh = H - top - bot; const s = W / (2 * v.half); const X = (wx) => W / 2 + (wx - v.cx) * s, Y = (wz) => top + mh / 2 + (wz - v.cz) * s;
    x.save(); x.beginPath(); x.rect(0, top, W, mh); x.clip();
    x.strokeStyle = "rgba(111,214,232,0.07)"; x.lineWidth = 1; const gs = v.half > 1800 ? 1000 : 500; for (let gx = Math.floor((v.cx - v.half) / gs) * gs; gx < v.cx + v.half; gx += gs) { x.beginPath(); x.moveTo(X(gx), top); x.lineTo(X(gx), top + mh); x.stroke(); } for (let gz = Math.floor((v.cz - v.half) / gs) * gs; gz < v.cz + v.half; gz += gs) { x.beginPath(); x.moveTo(0, Y(gz)); x.lineTo(W, Y(gz)); x.stroke(); }
    const stageCol = (d) => { try { const st = planStageOf(d); return (PLAN_STAGE[st] && PLAN_STAGE[st][1]) || "#f5f1e6"; } catch (e) { return "#f5f1e6"; } };
    for (const d of P.districts || []) { if (!d.poly || d.poly.length < 3) continue; x.beginPath(); d.poly.forEach((p, i) => (i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])))); x.closePath(); const col = stageCol(d); x.fillStyle = col + "22"; x.fill(); x.strokeStyle = col + "66"; x.lineWidth = 1; x.stroke(); }
    x.lineCap = "round"; x.lineJoin = "round";
    for (const r of P.roads || []) { if (!r.pts || r.pts.length < 2 || r.class === "tunnel") continue; x.beginPath(); r.pts.forEach((p, i) => (i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])))); x.strokeStyle = r.class === "taxilane" ? "rgba(200,205,212,0.35)" : "rgba(245,241,230,0.3)"; x.lineWidth = Math.max(1, (r.width || 8) * s * 0.9); x.stroke(); }
    if (P.runway && P.runway.ne) { const a = P.runway.ne, b = P.runway.sw; x.strokeStyle = "#cfd3d8"; x.lineWidth = Math.max(4, 45 * s); x.beginPath(); x.moveTo(X(a[0]), Y(a[1])); x.lineTo(X(b[0]), Y(b[1])); x.stroke(); x.strokeStyle = "#2b3137"; x.setLineDash([8, 8]); x.lineWidth = 1.5; x.beginPath(); x.moveTo(X(a[0]), Y(a[1])); x.lineTo(X(b[0]), Y(b[1])); x.stroke(); x.setLineDash([]);
      x.font = "600 20px 'JetBrains Mono', monospace"; x.fillStyle = "#f5f1e6"; x.textAlign = "center"; const ux = b[0] - a[0], uz = b[1] - a[1], L = Math.hypot(ux, uz); x.fillText("21", X(a[0] - ux / L * 70), Y(a[1] - uz / L * 70) + 7); x.fillText("03", X(b[0] + ux / L * 70), Y(b[1] + uz / L * 70) + 7); }
    if (pp && pp.pts) { const pts = pp.pts; x.lineWidth = 4; x.strokeStyle = "#4DDE6F"; x.beginPath(); let started = false; for (let i = 0; i < pts.length; i += 4) { const q = pts[i]; if (q.t > FLY.t) break; if (!started) { x.moveTo(X(q.x), Y(q.z)); started = true; } else x.lineTo(X(q.x), Y(q.z)); } x.lineTo(X(ax), Y(az)); x.stroke();
      x.setLineDash([10, 9]); x.lineWidth = 2.5; x.strokeStyle = "rgba(245,241,230,0.75)"; x.beginPath(); x.moveTo(X(ax), Y(az)); for (let i = 0; i < pts.length; i += 4) { const q = pts[i]; if (q.t <= FLY.t) continue; x.lineTo(X(q.x), Y(q.z)); } x.stroke(); x.setLineDash([]); }
    x.font = "600 17px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "left";
    for (const [n, px, pz] of [["Terminal", 94, -39], ["Arrivals Court", 129, -142], ["Founders Row", 432, -474], ["Main Street", 744, 311], ["Four Corners", 668, 153], ["The Genesis Ring", 995, 833], ["The Commons", 285, 721], ["Genesis Park", -212, -372], ["Launch Complex", 896, -190]]) { const sx = X(px), sy = Y(pz); if (sx < 10 || sx > W - 120 || sy < top + 10 || sy > top + mh - 10) continue; x.fillStyle = "rgba(245,241,230,0.9)"; x.beginPath(); x.arc(sx, sy, 3.5, 0, 6.283); x.fill(); x.fillStyle = "rgba(245,241,230,0.82)"; x.fillText(n, sx + 8, sy + 5); }
    { const sx = X(ax), sy = Y(az); x.save(); x.translate(sx, sy); x.rotate(-pth.heading + Math.PI); const gl = x.createRadialGradient(0, 0, 2, 0, 0, 30); gl.addColorStop(0, "rgba(77,222,111,0.55)"); gl.addColorStop(1, "rgba(77,222,111,0)"); x.fillStyle = gl; x.beginPath(); x.arc(0, 0, 30, 0, 6.283); x.fill(); x.fillStyle = "#ffffff"; x.beginPath(); x.moveTo(0, -18); x.lineTo(3, -8); x.lineTo(17, 2); x.lineTo(17, 5); x.lineTo(3, 1); x.lineTo(2.5, 11); x.lineTo(7, 15); x.lineTo(7, 17); x.lineTo(0, 15); x.lineTo(-7, 17); x.lineTo(-7, 15); x.lineTo(-2.5, 11); x.lineTo(-3, 1); x.lineTo(-17, 5); x.lineTo(-17, 2); x.lineTo(-3, -8); x.closePath(); x.fill(); x.restore(); }
    x.restore();
    x.fillStyle = "rgba(5,12,18,0.92)"; x.fillRect(0, 0, W, top); x.fillRect(0, H - bot, W, bot); x.fillStyle = "#4DDE6F"; x.fillRect(0, top - 2, W, 2); x.fillRect(0, H - bot, W, 2);
    x.textAlign = "left"; x.fillStyle = "#f5f1e6"; x.font = "36px Anton, Impact, sans-serif"; x.fillText("GIVEBACK ONE", 24, 46); x.font = "600 18px 'JetBrains Mono', monospace"; x.fillStyle = "rgba(245,241,230,0.6)"; x.fillText("MOVING MAP", 262, 44); x.textAlign = "right"; x.fillStyle = "#4DDE6F"; x.fillText("DOUGLAS MUNICIPAL · RUNWAY 21", W - 24, 44);
    const P2 = flyPath(FLY.t + 0.5); const spd = Math.hypot(P2.x - pth.x, P2.z - pth.z) / 0.5 * 1.944; const agl = Math.max(0, (F.jetP ? F.jetP.y - getH(pth.x, pth.z) : 0)) * 3.281; const tt = pp ? pp.tTD - FLY.t : 0;
    const phase = FLY.t < FLY_T.approach ? (tt > 0 ? `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, "0")}` : "0:00") : FLY.t < FLY_T.roll ? "LANDED" : FLY.t < FLY_T.taxi ? "TAXI" : "GATE A2";
    const cells = [["GROUND SPEED", `${Math.round(spd)} KT`], ["ALTITUDE", FLY.t < FLY_T.approach ? `${Math.round(agl / 10) * 10} FT AGL` : "ON THE GROUND"], [FLY.t < FLY_T.approach ? "TIME TO TOUCHDOWN" : "STATUS", phase], ["DESTINATION", "GATE A2"]];
    cells.forEach(([k2, v2], i) => { const cx = 24 + i * (W - 48) / 4; x.textAlign = "left"; x.fillStyle = "rgba(245,241,230,0.55)"; x.font = "600 14px 'JetBrains Mono', monospace"; x.fillText(k2, cx, H - bot + 32); x.fillStyle = "#f5f1e6"; x.font = "30px Anton, Impact, sans-serif"; x.fillText(v2, cx, H - bot + 70); });
    { const bx = W - 150, by = top + 30; x.fillStyle = "rgba(245,241,230,0.8)"; x.font = "600 14px 'JetBrains Mono', monospace"; x.textAlign = "center"; x.fillText("N", bx + 100, by - 6); x.beginPath(); x.moveTo(bx + 100, by); x.lineTo(bx + 94, by + 16); x.lineTo(bx + 106, by + 16); x.closePath(); x.fill(); const km = 1000 * s; x.fillRect(bx + 100 - km, top + mh - 26, km, 3); x.fillText("1 KM", bx + 100 - km / 2, top + mh - 34); }
    F.mapTex.needsUpdate = true;
  }

  // ───────────────────────────── the exterior jet: model, lights, tyre smoke ─────────────────────────────
  function heroKind() { return first(["gbjet2", "gbjet", "jet"]); }
  function measure(kind) {
    F.meas = F.meas || {}; if (F.meas[kind]) return F.meas[kind]; const m = MODELS[kind]; const r = { span: m.sx, len: m.sz, h: m.height, tip: [m.sx / 2, m.height * 0.3, -m.sz * 0.1], fin: [0, m.height, -m.sz * 0.42], nose: [0, m.height * 0.3, m.sz / 2], gear: [m.sx * 0.12, -m.sz * 0.04] };
    try { let tipV = null, finV = null, noseV = null; const gear = []; for (const p of m.parts) { const a = p.geometry.attributes.position; const step = Math.max(1, Math.floor(a.count / 6000)); for (let i = 0; i < a.count; i += step) { const x = a.getX(i), y = a.getY(i), z = a.getZ(i); if (!tipV || Math.abs(x) > Math.abs(tipV[0])) tipV = [x, y, z]; if (!finV || y > finV[1]) finV = [x, y, z]; if (!noseV || z > noseV[2]) noseV = [x, y, z]; if (y < m.height * 0.08 && Math.abs(x) > m.sx * 0.03) gear.push([Math.abs(x), z]); } }
      if (tipV) r.tip = [Math.abs(tipV[0]), tipV[1], tipV[2]]; if (finV) r.fin = finV; if (noseV) r.nose = noseV; if (gear.length > 8) { const gx = gear.reduce((s, q) => s + q[0], 0) / gear.length, gz = gear.reduce((s, q) => s + q[1], 0) / gear.length; r.gear = [gx, gz]; } } catch (e) { log("measure", e); }
    F.meas[kind] = r; return r;
  }
  function heroJet() {
    const kind = heroKind(); if (!kind) return null; const j = makeModel(kind); j.name = "flyinJet"; const sw = new Map();
    j.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; let m = sw.get(o.material); if (!m) { m = o.material.clone(); if (!m.roughnessMap) { m.roughness = 0.26; m.metalness = Math.max(m.metalness || 0, 0.35); } m.envMapIntensity = 1.15; if (m.emissive) m.emissiveIntensity = 0; sw.set(o.material, m); } o.material = m; });
    const me = measure(kind); j.userData.kind = kind; j.userData.me = me; const gt = glowTex();
    const spr = (col, size, x, y, z) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.set(size, size, 1); s.position.set(x, y, z); j.add(s); return s; };
    j.userData.nav = [spr(0xff2a2a, 1.1, me.tip[0] - 0.1, me.tip[1], me.tip[2]), spr(0x2aff5a, 1.1, -me.tip[0] + 0.1, me.tip[1], me.tip[2])];
    j.userData.strobe = [spr(0xffffff, 3.2, me.tip[0] - 0.1, me.tip[1], me.tip[2] - 0.2), spr(0xffffff, 3.2, -me.tip[0] + 0.1, me.tip[1], me.tip[2] - 0.2), spr(0xffffff, 2.4, me.fin[0], me.fin[1] + 0.1, me.fin[2] - 0.3)];
    j.userData.beacon = spr(0xff3030, 1.4, 0, me.h * 0.42, me.nose[2] * 0.1);
    j.userData.landing = [spr(0xfff6e8, 4.8, me.span * 0.13, me.h * 0.22, me.nose[2] * 0.45), spr(0xfff6e8, 4.8, -me.span * 0.13, me.h * 0.22, me.nose[2] * 0.45), spr(0xfff6e8, 3.2, 0, me.h * 0.1, me.nose[2] * 0.75)];
    return j;
  }
  function jetLights(j, t, landingOn) { const u = j.userData; if (!u.nav) return; const ph = t % 1.3; for (const s of u.strobe) s.visible = ph < 0.06 || (ph > 0.16 && ph < 0.2); u.beacon.visible = (t % 1.0) < 0.12; for (const s of u.landing) s.visible = landingOn; }
  function smokeSys() {
    if (F.smoke) return F.smoke; const N = 160; const geo = new THREE.BufferGeometry(); const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: smokeTex() }, uScale: { value: 600 }, uCol: { value: new THREE.Color(0.9, 0.87, 0.82) } }, transparent: true, depthWrite: false,
      vertexShader: "attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); }",
      fragmentShader: "uniform sampler2D uMap; uniform vec3 uCol; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uCol, t.a * vA); if (gl_FragColor.a < 0.004) discard; }" });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 4; pts.visible = false; scene.add(pts);
    F.smoke = { pts, geo, pos, size, alpha, vel: new Float32Array(N * 3), age: new Float32Array(N).fill(99), life: new Float32Array(N).fill(1), s0: new Float32Array(N), s1: new Float32Array(N), n: N, i: 0 }; return F.smoke;
  }
  function puff(x, y, z, vx, vy, vz, s0, s1, life) { const S = smokeSys(); const i = S.i = (S.i + 1) % S.n; S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z; S.vel[i * 3] = vx; S.vel[i * 3 + 1] = vy; S.vel[i * 3 + 2] = vz; S.age[i] = 0; S.life[i] = life; S.s0[i] = s0; S.s1[i] = s1; }
  function updateSmoke(dt) {
    const S = F.smoke; if (!S) return; let any = false; for (let i = 0; i < S.n; i++) { if (S.age[i] >= S.life[i]) { S.alpha[i] = 0; continue; } any = true; S.age[i] += dt; const k = S.age[i] / S.life[i]; const drag = Math.exp(-dt * 1.6); S.vel[i * 3] *= drag; S.vel[i * 3 + 2] *= drag; S.vel[i * 3 + 1] = S.vel[i * 3 + 1] * Math.exp(-dt * 0.8) + 0.12 * dt; S.pos[i * 3] += (S.vel[i * 3] + 0.6) * dt; S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt; S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt; S.size[i] = lerp(S.s0[i], S.s1[i], 1 - Math.pow(1 - k, 2.2)); S.alpha[i] = 0.62 * Math.pow(1 - k, 1.6) * sm(0, 0.06, k); }
    S.pts.visible = any; S.geo.attributes.position.needsUpdate = true; S.geo.attributes.aSize.needsUpdate = true; S.geo.attributes.aAlpha.needsUpdate = true; S.pts.material.uniforms.uScale.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
  }
  function tyreSmoke(k) { const j = FLY.jet; if (!j) return; const me = j.userData.me || { gear: [2, -0.5], span: 20 }; j.updateMatrixWorld(true); const fw = V3(0, 0, 1).applyQuaternion(j.quaternion);
    for (const sd of [-1, 1]) { const p = V3(sd * me.gear[0], 0.3, me.gear[1]).applyMatrix4(j.matrixWorld); for (let n = 0; n < 7 * k; n++) { const r = Math.random; puff(p.x + (r() - 0.5) * 0.8, p.y + r() * 0.3, p.z + (r() - 0.5) * 0.8, -fw.x * (8 + r() * 10) + (r() - 0.5) * 2, 0.4 + r() * 1.2, -fw.z * (8 + r() * 10) + (r() - 0.5) * 2, 0.8 + r() * 0.8, 6 + r() * 5, 2.6 + r() * 1.6); } } }

  // ───────────────────────────── overlay: letterbox, titles, lower thirds, dips ─────────────────────────────
  function ui() {
    if (F.ui) return F.ui; const css = document.createElement("style"); css.id = "g1cine-css";
    css.textContent = `#g1cine{position:fixed;inset:0;pointer-events:none;z-index:14;font-family:"Space Grotesk",system-ui,sans-serif;color:#f5f1e6}
#g1cine .lb{position:absolute;left:0;right:0;height:6.2vh;background:#000;transition:transform 1.2s cubic-bezier(.2,.7,.2,1)}
#g1cine .lb.t{top:0;transform:translateY(-100%)}#g1cine .lb.b{bottom:0;transform:translateY(100%)}#g1cine.bars .lb{transform:none}
#g1cine .ttl{position:absolute;left:0;right:0;top:22%;text-align:center;opacity:0;transition:opacity 1.6s ease}#g1cine .ttl.hi{top:13%}
#g1cine .ttl.on{opacity:1}#g1cine .ttl .a{font-family:Anton,Impact,sans-serif;font-size:clamp(46px,7.4vw,118px);letter-spacing:.2em;line-height:1;text-shadow:0 4px 40px rgba(0,0,0,.45);transition:letter-spacing 7s ease-out}
#g1cine .ttl.on .a{letter-spacing:.26em}#g1cine .ttl .b{font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:300;font-variation-settings:'opsz' 72;font-size:clamp(20px,2.3vw,36px);margin-top:.5em;color:#f4cd5a;text-shadow:0 2px 18px rgba(0,0,0,.5)}
#g1cine .ttl .c{font-family:"JetBrains Mono",monospace;font-size:clamp(10px,.9vw,13px);letter-spacing:.34em;margin-top:1.6em;color:rgba(245,241,230,.8)}
#g1cine .low{position:absolute;left:5.5vw;bottom:17vh;opacity:0;transform:translateY(10px);transition:opacity .9s ease,transform .9s ease;max-width:46vw}
#g1cine .low.on{opacity:1;transform:none}#g1cine .low .k{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.28em;color:#4DDE6F;padding-left:14px;border-left:2px solid #4DDE6F}
#g1cine .low .n{font-family:Anton,Impact,sans-serif;font-size:clamp(20px,2.1vw,32px);letter-spacing:.05em;margin-top:6px;text-shadow:0 2px 16px rgba(0,0,0,.6)}#g1cine .low .s{font-size:14px;margin-top:4px;color:rgba(245,241,230,.85);text-shadow:0 1px 10px rgba(0,0,0,.7)}
#g1cine .cap{position:absolute;left:0;right:0;bottom:2.1vh;text-align:center;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.32em;color:rgba(245,241,230,.78);opacity:0;transition:opacity .8s}#g1cine .cap.on{opacity:1}
#g1cine .dip{position:absolute;inset:0;background:#fff3e0;opacity:0}#g1cine .grain{position:absolute;inset:0;opacity:.05;background-image:radial-gradient(rgba(0,0,0,.6) 1px,transparent 1px);background-size:3px 3px;mix-blend-mode:multiply}
#g1cine .vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 58%,rgba(0,0,0,.28) 100%);opacity:0;transition:opacity 1s}#g1cine.bars .vig{opacity:1}
body.g1fly .hud:not(#skipfly):not(#prompt){opacity:0!important;transition:opacity .7s}body.g1fly.g1ext #prompt{opacity:0!important}body.g1fly #skipfly{z-index:16}`;
    document.head.appendChild(css);
    const r = document.createElement("div"); r.id = "g1cine"; r.innerHTML = `<div class="vig"></div><div class="lb t"></div><div class="lb b"></div><div class="ttl"><div class="a"></div><div class="b"></div><div class="c"></div></div><div class="low"><div class="k"></div><div class="n"></div><div class="s"></div></div><div class="cap"></div><div class="dip"></div>`; document.body.appendChild(r);
    const q = (s) => r.querySelector(s); F.ui = { r, ttl: q(".ttl"), ta: q(".ttl .a"), tb: q(".ttl .b"), tc: q(".ttl .c"), low: q(".low"), lk: q(".low .k"), ln: q(".low .n"), ls: q(".low .s"), cap: q(".cap"), dip: q(".dip"), capT: "", lowT: "", lowUntil: 0 }; return F.ui;
  }
  function lower(k, n, s, secs) { const U = ui(); U.lk.textContent = k || ""; U.ln.textContent = n || ""; U.ls.textContent = s || ""; U.low.classList.add("on"); U.lowUntil = performance.now() + (secs || 6) * 1000; }
  F.lower = lower;

  // ───────────────────────────── the shot list ─────────────────────────────
  function shots() {
    const P = planFlyPath(); const tTD = P.tTD, tEnd = P.tEnd;
    const L = [["establish", 0, 6.8, "ext"], ["wing", 6.8, 11.2, "ext"], ["tail", 11.2, 15.4, "ext"], ["window", 15.4, 19.0, "ext"], ["cabin", 19.0, tTD - 10.2, "cab"], ["touch", tTD - 10.2, tTD + 5.2, "ext"], ["cabin2", tTD + 5.2, tEnd - 9.5, "cab"], ["arrive", tEnd - 9.5, 1e9, "ext"]];
    return L.map(([id, t0, t1, kind]) => ({ id, t0, t1, kind }));
  }
  function shotAt(t) { const S = F.shots || (F.shots = shots()); for (const s of S) if (t >= s.t0 && t < s.t1) return s; return S[S.length - 1]; }
  // the touchdown point, the runway frame and the arrival stop, from the path
  function pathMarks() {
    const P = planFlyPath(); const pts = P.pts; let td = pts[pts.length - 1]; for (const q of pts) if (q.t >= P.tTD) { td = q; break; } const end = pts[pts.length - 1];
    const u = [U[0], U[1]], n = [Nn[0], Nn[1]]; let a = pts[pts.length - 2]; for (let i = pts.length - 2; i >= 0; i--) { a = pts[i]; if (Math.hypot(end.x - a.x, end.z - a.z) > 6) break; }
    F.marks = { td: [td.x, td.z], end: [end.x, end.z], endH: Math.atan2(end.x - a.x, end.z - a.z), u, n }; return F.marks;
  }

  // ───────────────────────────── start ─────────────────────────────
  function startFlyInR2() {
    if (FLY.on || !T) return; if (F.active) cleanup();   // a previous flight whose clean-up frame has not run yet closeCards(); if (inside) leaveInterior(); if (cartMode) toggleCart(); towerView = false; if (SIT.on) { SIT.on = false; } RIDE_ON.id = null;
    const nflights = +(localStorage.getItem("g1:flights") || 0); FLY.route = 0; planFlyTimes(); localStorage.setItem("g1:flights", String(nflights + 1));
    F.shots = shots(); FLY_T.ext = F.shots[4].t0; pathMarks(); F.dipL = dips();
    if (!FLY.g) { FLY.g = buildCabin(); scene.add(FLY.g); }
    FLY.on = true; FLY.t = 0; FLY.seenLm = {}; FLY.order = null; FLY.start = performance.now(); FLY.done = false; FLY.phase = "ext";
    if (!FLY.warm) { try { FLY.g.visible = true; FLY.g.updateMatrixWorld(true); collectLights(); updateLightPool(); renderer.compile(scene, camera); } catch (e) {} }
    FLY.g.visible = false; FLY.pr = renderer.getPixelRatio(); renderer.setPixelRatio(Math.min(1, FLY.pr)); if (POST.resize) POST.resize(); player.userData.label.visible = false;
    if (FLY.jet) { scene.remove(FLY.jet); FLY.jet = null; } try { FLY.jet = heroJet(); if (FLY.jet) scene.add(FLY.jet); } catch (e) { log("hero jet", e); }
    const seats = FLY.g.userData.seats; const q0 = seats[0]; FLY.seat = q0; FLY.local.set(q0.x, 0, q0.z); pitch = 0.1;
    // the cabin crew: Ava, in her galley
    for (const c of [...FLY.g.children]) if (c.userData && c.userData.id === "fa_ava") FLY.g.remove(c);
    try { const fa = avatar("fa_ava", "Ava · Flight attendant", { body: "f", skin: "c98f63", shirt: "1c1f24", pants: "1c1f24", hair: 1, hairc: "2a1a10" }, null, "outfit_flight"); fa.userData.label.scale.set(1.6, 0.4, 1); fa.userData.label.visible = false; fa.position.set(-0.12, 0, 7.0); fa.rotation.y = -Math.PI / 2; FLY.g.add(fa); cabTree(fa);
      FLY.fa = { g: fa, name: "Ava", id: "fa_ava", mode: "galley", pause: 6, tz: 7.0, lines: ["Good evening, and welcome aboard Giveback One. We are joining the circuit for Runway 21 at Douglas Municipal.", "Champagne, a Sonoran Sunrise or an espresso? I can bring it to your seat.", "Look out the left side: that is The Expanse, with the Genesis Ring in the far corner.", "Main Street runs straight at the Ring. Four Corners is the crossroads halfway down.", "We turn base over the open desert, then final over the North Section Road.", "Sky, your guide, meets you at Arrivals Court, just out of the terminal's landside door."], li: 0 }; } catch (e) { log("crew", e); FLY.fa = null; }
    FLY.spots = [{ lx: -0.15, lz: 6.95, r: 0.9, t: "ask Ava for a drink", fn: orderDrinkR2 }, { lx: 0, lz: 8.05, r: 0.8, t: "flight deck door", fn: () => { lower("CAPTAIN", "Cleared to land, Runway 21", "Left-hand circuit over The Expanse. Enjoy the view.", 5); sfx("ui"); } },
      { lx: -0.45, lz: 5.35, r: 0.75, t: "the moving map", fn: () => { lower("MOVING MAP", "Giveback One on the circuit", "The map draws the real layout of Genesis One and our path to Gate A2.", 6); sfx("ui"); } },
      { lx: 0, lz: F.aftModel ? -5.7 : -5.95, r: 0.75, t: F.aftModel ? "the aft cabin" : "lavatory", fn: () => { lower("AFT CABIN", "The lavatory", "Walnut, onyx and a window of its own, behind the aft bulkhead. Please be seated for landing.", 5); sfx("ui"); } },
      { lx: -0.35, lz: -5.2, r: 0.8, t: "champagne on ice", fn: () => { lower("THE DRINKS CABINET", "Champagne on ice", "Ava will pour you a glass. Welcome to Genesis One.", 5); sfx("buy"); } },
      { lx: 0.25, lz: 0.78, r: 0.7, t: "the dining table", fn: () => { lower("DINING", "The table is laid", "Champagne, espresso and fresh fruit on the walnut table.", 5); sfx("ui"); } }];
    for (const w of FLY.g.userData.windows) { w.want = 0; setShade(w, 0); }
    // name labels and speech bubbles are drawn without a depth test: from the air they would show through the fuselage and speckle
    // every exterior shot, so they go to an unrendered layer for the flight (Ava's own bubbles are created later and stay visible)
    F.labels = []; hideLabels();
    F.active = true; F.saved = { timeOffset: timeOffset, aoLevel: QUAL.q, ao: QUAL.q.ao, up: camera.up.clone() }; F.lmAt = 0; F.fired = {}; F.shot = null; F.shotKind = "ext"; F.mapAt = 0; F.mapView = null; F.yawL = Math.PI + 0.8; F.lastH = null; F.camS = null;
    document.body.classList.add("g1fly", "g1ext"); const U2 = ui(); U2.r.style.display = ""; U2.dip.style.transition = "none"; U2.dip.style.background = "#000"; U2.dip.style.opacity = 1;
    yaw = Math.PI; player.userData.walk.visible = false; $("#skipfly").style.display = ""; setStatus("Giveback One · joining the circuit for Runway 21, Douglas Municipal"); sfx("ui");
    try { if (!("ontouchstart" in window) && canvas.requestPointerLock) { const pl = canvas.requestPointerLock(); if (pl && pl.catch) pl.catch(() => {}); } } catch (e) {}
    FLY.hum = null; holdGolden(true);
  }
  function isIn(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }
  function hideLabels() { try { const L = F.labels || (F.labels = []); scene.traverse((o) => { if (o.isSprite && o.material && o.material.depthTest === false && !o.layers.isEnabled(29) && !(FLY.g && isIn(o, FLY.g))) { o.layers.set(29); L.push(o); } }); } catch (e) { log("labels", e); } }
  function holdGolden(force) { if (!F.golden || !F.active) return; timeOffset = F.goldenT * DAY_SECONDS - ((Date.now() / 1000) % DAY_SECONDS); if (force) { try { updateSky(0); } catch (e) {} try { updateEnvironment(performance.now(), true); } catch (e) {} } }

  // ───────────────────────────── the frame: attitude, shots, the passenger, the crew, the overlay ─────────────────────────────
  const _jq = new THREE.Quaternion(), _je = new THREE.Euler(0, 0, 0, "YXZ"), _jp = new THREE.Vector3(), _cm = new THREE.Matrix4(), _cv = new THREE.Vector3();
  function attitude(t) {
    const P = planFlyPath(); const tTD = P.tTD; const pth = flyPath(t); const air = t < tTD;
    const bank = air ? (planFlyBank(t) + Math.sin(t * 0.37) * 0.018 + Math.sin(t * 1.3) * 0.005) * (1 - sm(tTD - 3, tTD - 0.6, t)) : 0;
    const nose = air ? -0.03 - 0.02 * Math.sin(t * 0.5) * (1 - sm(tTD - 8, tTD - 4, t)) - 0.055 * sm(tTD - 5, tTD - 0.4, t) : -0.085 * (1 - sm(tTD + 0.25, tTD + 1.9, t));
    const surf = planGroundAt(pth.x, pth.z); let wb = air ? Math.max(pth.y - 1.35, surf) : surf; const me = FLY.jet && FLY.jet.userData.me; const gz = me ? me.gear[1] : -0.5; wb += Math.max(0, gz * Math.sin(nose));
    const rolling = !air && t < FLY_T.roll; if (rolling) wb += (Math.random() - 0.5) * 0.02 * (1 - sm(tTD, FLY_T.roll, t)) + (t - tTD < 0.35 ? -0.05 * Math.sin((t - tTD) / 0.35 * Math.PI) : 0);
    _je.set(nose, pth.heading, bank, "YXZ"); _jq.setFromEuler(_je); _jp.set(pth.x, wb, pth.z);
    F.jetP = _jp; F.jetQ = _jq; F.heading = pth.heading; return pth;
  }
  function updateFlyInR2(dt) {
    const g = FLY.g; if (!g) return; const now = performance.now(); const prev = FLY.t;
    if (F.debugT !== null && F.debugT !== undefined) { FLY.t = F.debugT; FLY.start = now - FLY.t * 1000; } else FLY.t = Math.min(FLY.t + 0.25, (now - FLY.start) / 1000);
    holdGolden(false); const t = FLY.t; const P = planFlyPath();
    const pth = attitude(t);
    if (FLY.jet) { FLY.jet.position.copy(F.jetP); FLY.jet.quaternion.copy(F.jetQ); FLY.jet.updateMatrixWorld(true); }
    _cm.compose(F.jetP, F.jetQ, _sv.set(1, 1, 1)); g.position.copy(_cv.set(0, 1.55, 0).applyMatrix4(_cm)); g.quaternion.copy(F.jetQ); g.updateMatrixWorld(true);
    // shots and hand-offs
    const S = shotAt(t); if (S !== F.shot) enterShot(S);
    const cabin = S.kind === "cab"; FLY.phase = cabin ? "in" : "ext"; F.shotKind = S.kind; g.visible = cabin; if (FLY.jet) FLY.jet.visible = !cabin;
    document.body.classList.toggle("g1ext", !cabin);
    // keep the passenger's view fixed to the cabin through the turns
    if (F.lastH !== null) { const dh = wrapA(pth.heading - F.lastH); if (cabin) yaw += dh; } F.lastH = pth.heading;
    try { events(prev, t, P); } catch (e) { log("events", e); }
    passenger(dt, pth, cabin);
    try { crew(dt, cabin); } catch (e) { log("crew", e); }
    try { if (cabin) { for (const w of g.userData.windows) if (Math.abs(w.k - w.want) > 0.002) setShade(w, w.k + (w.want - w.k) * Math.min(1, dt * 1.6)); updateBeams(g, now / 1000); } else if (F.beams) { F.beams[1].m.visible = F.beams[-1].m.visible = false; } } catch (e) { log("shades", e); }
    try { if (FLY.jet) jetLights(FLY.jet, t, t > P.tFinal - 4 && t < FLY_T.roll + 2); updateSmoke(dt); } catch (e) { log("jet fx", e); }
    try { if (cabin && now - F.mapAt > 1000 / F.mapHz) { F.mapAt = now; drawMap(pth); } } catch (e) { log("map", e); }
    try { overlay(t, S, cabin); } catch (e) { log("overlay", e); }
    const left = Math.max(0, FLY_T.approach - t); const label = t < FLY_T.approach ? `touchdown in ${Math.ceil(left)} s` : t < FLY_T.roll ? "landing roll" : t < FLY_T.taxi ? "taxiing to Gate A2" : "arrived";
    const sp2 = cabin ? flySpotR2() : null; F.promptH = (sp2 ? `<b>E</b> &nbsp;${sp2.t} &nbsp;·&nbsp; ` : "") + label;
    if (t >= FLY.dur) endFlyIn(false);
  }
  function enterShot(S) {
    const U2 = ui(); const was = F.shot; F.shot = S; F.shotT0 = performance.now(); F.camS = null;
    const bars = S.kind === "ext"; U2.r.classList.toggle("bars", bars);
    if (S.kind === "cab") { if (!was || was.kind !== "cab") { yaw = F.heading + (F.yawL !== undefined ? F.yawL : Math.PI); } }
    else { if (was && was.kind === "cab") F.yawL = wrapA(yaw - F.heading); }
    if (S.id === "cabin" && !F.fired.welcome) { F.fired.welcome = 1; cabinChime(); if (soundOn) { try { const a = new Audio("/audio/ava_welcome.m4a"); a.volume = Math.min(1, 0.9 * VOL.master); a.play().catch(() => {}); FLY.voice = a; } catch (e) {} } }
  }
  // the dips between shots, as a function of flight time: [cut time, fade-in before, fade-out after, colour]
  function dips(P) { return [[0, 0, 1.8, "#000"], [F.shots[4].t0, 0.7, 0.9, "#fff3e0"], [F.shots[5].t0, 0.45, 0.7, "#000"], [F.shots[6].t0, 0.45, 0.9, "#000"], [F.shots[7].t0, 0.45, 0.8, "#000"]]; }
  function dipAt(t) { let best = 0, col = "#000"; for (const [T, a, b, c] of F.dipL || []) { let o = 0; if (t < T) o = a > 0 ? sm(T - a, T, t) : 0; else o = 1 - sm(T, T + b, t); if (T === 0 && t < 0.02) o = 1; if (o > best) { best = o; col = c; } } return [best, col]; }
  function events(prev, t, P) {
    const cross = (x) => prev < x && t >= x; const tTD = P.tTD;
    if (cross(24.5)) { cabinChime(); lower("CAPTAIN", "Joining the left-hand downwind, Runway 21", "The Expanse is off our left side. The Outpost and the Genesis Ring are furthest out.", 7); }
    if (cross(P.tBase + 1)) { cabinChime(); lower("CAPTAIN", "Turning base over the open desert", "Stage One, The Landing, passes below us on final.", 6); }
    if (cross(P.tFinal + 1.5)) { cabinChime(); lower("CAPTAIN", "Established on final, Runway 21", "Crossing the North Section Road. Cabin crew, please take your seats for landing.", 6); }
    if (cross(tTD)) { sfx("land"); F.shake = 1; tyreSmoke(1.4); } if (cross(tTD + 0.12)) tyreSmoke(1); if (t > tTD && t < tTD + 0.9 && Math.random() < 0.6) tyreSmoke(0.25);
    if (t > tTD && t < FLY_T.roll && FX && FX.dust && Math.random() < 0.3 && F.jetP) emitDust(F.jetP.x, getH(F.jetP.x, F.jetP.z), F.jetP.z, 1, 3, 0.6);
    if (cross(tTD + 8)) { cabinChime(); lower("CAPTAIN", "Welcome to Douglas Municipal", "The 1928 airfield. We are taxiing to Gate A2, beside the terminal. Please stay seated.", 7); }
    if (cross(P.tEnd - 1.2)) { cabinChime(); }
  }
  function overlay(t, S, cabin) {
    const U2 = ui(); const P = planFlyPath(); const now = performance.now();
    { const [o, c] = dipAt(t); if (U2.dip.style.background !== c) U2.dip.style.background = c; U2.dip.style.opacity = o.toFixed(3); }
    const title = S.id === "establish" && t > 0.9 && t < 5.9; if (title) { if (U2.ta.textContent !== "GENESIS ONE") { U2.ta.style.fontSize = ""; U2.ta.textContent = "GENESIS ONE"; U2.tb.textContent = "The Awakening"; U2.tc.textContent = "DOUGLAS MUNICIPAL AIRPORT · DOUGLAS, ARIZONA"; } }
    const arrive = S.id === "arrive" && t > P.tEnd - 6.5; if (arrive && U2.ta.textContent !== "WELCOME TO GENESIS ONE") { U2.ta.textContent = "WELCOME TO GENESIS ONE"; U2.tb.textContent = "Sky meets you at Arrivals Court"; U2.tc.textContent = "GATE A2 · DOUGLAS MUNICIPAL AIRPORT"; U2.ta.style.fontSize = "clamp(34px,5vw,80px)"; }
    U2.ttl.classList.toggle("on", title || arrive); U2.ttl.classList.toggle("hi", arrive);
    const caps = { wing: [7.4, 10.8, "GIVEBACK ONE · INBOUND FOR RUNWAY 21"], tail: [11.8, 15.0, "AHEAD: GENESIS ONE, ON THE 1928 AIRFIELD AT DOUGLAS"], window: [15.8, 18.2, "JOINING THE LEFT-HAND CIRCUIT OVER THE EXPANSE"], touch: [P.tTD - 9, P.tTD - 2.5, "RUNWAY 21 · DOUGLAS MUNICIPAL AIRPORT"] };
    const c = caps[S.id]; const capOn = !!(c && t > c[0] && t < c[1]); if (c && U2.capT !== c[2]) { U2.capT = c[2]; U2.cap.textContent = c[2]; } U2.cap.classList.toggle("on", capOn);
    if (S.id === "cabin" && t > S.t0 + 1.5 && !F.fired.aboard) { F.fired.aboard = 1; lower("WELCOME ABOARD", "Giveback One", "Take a window seat: The Expanse passes on the left. Walk the cabin, or press E by Ava for a drink.", 7); }
    if (U2.lowUntil && now > U2.lowUntil) { U2.low.classList.remove("on"); U2.lowUntil = 0; }
    if (cabin) captions(flyPath(t));
  }
  // the view out of the windows: as a landmark passes, a lower third says which side to look out of
  function captions(pth) { if (performance.now() - (F.lmAt || 0) < 8000 || (F.jetP && F.jetP.y - (FLY.thrH || 0) > 700)) return; if (ui().lowUntil) return; const hx = Math.sin(pth.heading), hz = Math.cos(pth.heading);
    for (const [name, x, z, R] of PLAN_LANDMARKS) { if (FLY.seenLm[name]) continue; const dx = x - pth.x, dz = z - pth.z, d = Math.hypot(dx, dz); if (d > R) continue; const al = (dx * hx + dz * hz) / d; if (Math.abs(al) > 0.75) continue; const cross = dx * hz - dz * hx; FLY.seenLm[name] = true; F.lmAt = performance.now(); lower(`OUT THE ${cross > 0 ? "LEFT" : "RIGHT"} WINDOWS`, name.charAt(0).toUpperCase() + name.slice(1), "", 6); cabinChime(); return; } }

  // the passenger: seated or walking the aisle (cabin coordinates), kept clear of the furniture and the bulkheads
  function passenger(dt, pth, cabin) {
    const g = FLY.g; if (FLY.seat && keys.Space && !FLY.spaceHeld && cabin) flyStandR2(); FLY.spaceHeld = !!keys.Space;
    if (cabin && !FLY.seat) { let fx = 0, fz = 0; if (!chatOpen && !arcFrozen()) { if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1; if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1; } const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
      const ly = yaw - pth.heading; const vx = fx * Math.cos(ly) - fz * Math.sin(ly), vz = -fx * Math.sin(ly) - fz * Math.cos(ly); const sp = 1.7 * dt; let nx = FLY.local.x + vx * sp, nz = FLY.local.z + vz * sp;
      nx = cl(nx, -0.82, 0.82); nz = cl(nz, g.userData.zmin, Z.fd - 0.32); for (const zb of [Z.gb]) { const a = FLY.local.z - zb, b = nz - zb; if ((Math.abs(b) < 0.14 || a * b < 0) && Math.abs(nx) > 0.3) { nz = FLY.local.z; if (Math.abs(nz - zb) < 0.14) nz = zb + Math.sign(a || 1) * 0.14; } }
      for (const [bx, bz, br] of g.userData.blocks) { const ddx = nx - bx, ddz = nz - bz, d = Math.hypot(ddx, ddz); if (d < br + 0.2 && d > 0.001) { nx = bx + ddx / d * (br + 0.2); nz = bz + ddz / d * (br + 0.2); } }
      FLY.local.x = cl(nx, -0.82, 0.82); FLY.local.z = cl(nz, g.userData.zmin, Z.fd - 0.32); animateWalk(player, (fx || fz) ? 1.7 : 0, dt); } else animateWalk(player, 0, dt);
    const wp = g.localToWorld(FLY.local.clone()); player.position.copy(wp); player.rotation.y = yaw; player.userData.sit = !!FLY.seat; player.userData.air = false; player.userData.swim = false; pushMove(false);
  }
  function flyStandR2() { const q = FLY.seat; if (!q) return; FLY.seat = null; FLY.local.set(cl(q.x * 0.1, -0.1, 0.1), 0, q.z + (q.zone === "divan" ? 0 : Math.cos(q.f) * 0.55)); if (q.zone === "divan") FLY.local.set(0, 0, q.z); player.userData.sit = false; }
  function flySpotR2() {
    const g = FLY.g; if (!g) return null; const Lx = FLY.local.x, Lz = FLY.local.z;
    if (FLY.seat) { let w = null, wd = 1.1; for (const win of g.userData.windows || []) { if (Math.sign(win.x) !== Math.sign(FLY.seat.x)) continue; const d = Math.abs(win.z - FLY.seat.z); if (d < wd) { wd = d; w = win; } } if (w) return { t: (w.want > 0.5 ? "open the shade" : "close the shade") + " (space to stand)", fn: () => { w.want = w.want > 0.5 ? 0 : 1; sfx("ui"); } }; return { t: "stand up", fn: flyStandR2 }; }
    for (const q of g.userData.seats) { const sx = q.zone === "divan" ? q.x + 0.3 : q.x * 0.35, sz = q.zone === "divan" ? q.z : q.z + Math.cos(q.f) * 0.5; if (Math.hypot(sx - Lx, sz - Lz) < 0.55) return { t: q.zone === "divan" ? "sit on the divan" : "take a seat", fn: () => { FLY.seat = q; FLY.local.set(q.x, 0, q.z); yaw = F.heading + q.f + Math.PI; pitch = 0.08; player.userData.sit = true; sfx("ui"); } }; }
    if (FLY.fa && Math.hypot(FLY.fa.g.position.x - Lx, FLY.fa.g.position.z - Lz) < 1.5) return { t: "talk to Ava", fn: () => { npcSay(FLY.fa, FLY.fa.lines[FLY.fa.li++ % FLY.fa.lines.length]); FLY.fa.pause = 4; } };
    for (const sp of FLY.spots) if (Math.hypot(sp.lx - Lx, sp.lz - Lz) < sp.r) return sp; return null;
  }
  // the seated and standing eye, rolling and pitching with the cabin
  const _lq = new THREE.Quaternion(), _le = new THREE.Euler(0, 0, 0, "YXZ"), _gq = new THREE.Quaternion();
  function cabinCam() {
    const g = FLY.g; g.updateMatrixWorld(true); const q = FLY.seat; let ex = FLY.local.x, ez = FLY.local.z, ey = 1.6;
    if (q) { ey = 1.17; ex = q.x - Math.sin(q.f) * 0.1; ez = q.z - Math.cos(q.f) * 0.1; if (q.zone === "divan") { ey = 1.12; ex = q.x - 0.12; } }
    const shake = F.shake || 0; const tt = performance.now() / 1000; const air = FLY.t < FLY_T.approach;
    ey += (air ? nz(tt * 0.6, 1) * 0.004 : 0) + shake * nz(tt * 9, 2) * 0.01;
    camera.position.copy(g.localToWorld(_cv.set(ex, ey, ez)));
    const yl = yaw - F.heading; _le.set(-Math.atan(1.4 * pitch) + (air ? nz(tt * 0.5, 4) * 0.002 : 0), yl, shake * nz(tt * 8, 3) * 0.004, "YXZ"); _lq.setFromEuler(_le); g.getWorldQuaternion(_gq); camera.quaternion.copy(_gq).multiply(_lq);
    const fov = FOV_BASE() + 2; if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }
  // the exterior shots
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function jetLocal(x, y, z, out) { _cm.compose(F.jetP, F.jetQ, _sv.set(1, 1, 1)); return (out || V3()).set(x, y, z).applyMatrix4(_cm); }
  function cabLocal(x, y, z, out) { return (out || V3()).set(x, y, z).applyMatrix4(FLY.g.matrixWorld); }
  function look(pos, tgt, fov, upV, smooth) { camera.up.copy(upV || _up); camera.position.copy(pos); camera.lookAt(tgt); camera.up.set(0, 1, 0); setFov(fov); }
  function flyCameraR2(dt) {
    const g = FLY.g; if (!g) return; g.updateMatrixWorld(true); CAM.init = false; player.userData.walk.visible = false;
    if (F.cam) { const c = F.cam; if (c.local) { camera.position.copy(cabLocal(c.p[0], c.p[1], c.p[2])); camera.up.copy(V3(0, 1, 0).applyQuaternion(g.quaternion)); camera.lookAt(cabLocal(c.t[0], c.t[1], c.t[2])); camera.up.set(0, 1, 0); } else { camera.position.set(c.p[0], c.p[1], c.p[2]); camera.lookAt(c.t[0], c.t[1], c.t[2]); } setFov(c.fov || 60); return; }
    const S = F.shot || shotAt(FLY.t); const t = FLY.t; const k = cl((t - S.t0) / Math.max(0.01, Math.min(60, S.t1 - S.t0)), 0, 1); const P = planFlyPath();
    if (S.kind === "cab") { cabinCam(); return; }
    const me = (FLY.jet && FLY.jet.userData.me) || { span: 22, len: 20, h: 6, tip: [11, 1.5, -1], fin: [0, 6, -8], nose: [0, 2, 10], gear: [2, -0.5] };
    const hf = V3(Math.sin(F.heading), 0, Math.cos(F.heading)), hl = V3(Math.cos(F.heading), 0, -Math.sin(F.heading)); const sd = skyMat.uniforms.sunDir.value; const sunSide = (sd.x * hl.x + sd.z * hl.z) >= 0 ? 1 : -1; const jp = F.jetP; const tt = performance.now() / 1000;
    const jup = V3(0, 1, 0).applyQuaternion(F.jetQ);
    if (S.id === "establish") { const e = sm(0, 1, k); const pos = _a.copy(jp).addScaledVector(hf, -(64 - 22 * e)).addScaledVector(hl, sunSide * (31 - 7 * e)); pos.y += 9 - 3 * e + nz(tt * 0.4, 1) * 0.35; const tgt = _b.copy(jp).addScaledVector(hf, 26); tgt.y += 7.5; look(pos, tgt, 36 + 4 * e); return; }
    if (S.id === "wing") { const s = sunSide; const pos = jetLocal(s * (me.tip[0] + 1.35), me.tip[1] + 0.95 + nz(tt * 3, 2) * 0.02, me.tip[2] - 2.3 + 1.5 * k, _a); const tgt = jetLocal(s * 0.5, me.h * 0.12, me.len * 0.38, _b); look(pos, tgt, 58, jup); return; }
    if (S.id === "tail") { const pos = jetLocal(1.6 * sunSide, me.fin[1] + 3.4 - 0.6 * k, me.fin[2] - 9.5 + 3.2 * k, _a); const tgt = jetLocal(0, -me.h * 1.1, me.len * 6, _b); look(pos, tgt, 52, jup); return; }
    if (S.id === "window") { const zw = FLY.seat ? FLY.seat.z - 0.1 : 2.9; const e = sm(0, 1, k); const pos = cabLocal(1.3 + 9.5 - 5.2 * e, 1.25 + 1.2 - 0.9 * e, zw - 6.0 + 3.8 * e, _a); const tgt = cabLocal(1.25, 1.0, zw + 0.5, _b); look(pos, tgt, 34 - 9 * e, jup); return; }
    if (S.id === "touch") { const M2 = F.marks || pathMarks(); const cx = M2.td[0] + M2.u[0] * 58 + M2.n[0] * 38, cz = M2.td[1] + M2.u[1] * 58 + M2.n[1] * 38; const pos = _a.set(cx, planGroundAt(cx, cz) + 1.25, cz); const tgt = _b.copy(jp); tgt.y += me.h * 0.35;
      if (!F.camS) F.camS = tgt.clone(); F.camS.lerp(tgt, Math.min(1, dt * 7)); const d = pos.distanceTo(F.camS); const fov = cl(2 * Math.atan(me.len * 1.25 / d) * 57.3, 6.5, 46); const sh = 0.02 * (40 / fov); pos.x += nz(tt * 2.1, 1) * sh * 0.1; pos.y += nz(tt * 2.3, 2) * sh * 0.1; look(pos, F.camS, fov); return; }
    if (S.id === "arrive") { const M2 = F.marks || pathMarks(); const st = M2.end; let dx = Math.sin(M2.endH), dz = Math.cos(M2.endH);
      if (!F.arrCam) F.arrCam = arrivalCam(st, -dx, -dz);
      const c2 = F.arrCam; const pos = _a.set(c2.cx, planGroundAt(c2.cx, c2.cz) + 2.3 - 0.5 * k, c2.cz); const tgt = _b.set(lerp(jp.x, st[0], 0.3), jp.y + me.h * 0.45, lerp(jp.z, st[1], 0.3)); if (!F.camS) F.camS = tgt.clone(); F.camS.lerp(tgt, Math.min(1, dt * 3)); const d = pos.distanceTo(F.camS); look(pos, F.camS, cl(2 * Math.atan(me.span * 0.95 / d) * 57.3, 30, 56)); return; }
    cabinCam();
  }

  // the arrival camera: somewhere south-east of the stand with the terminal behind the jet and a clear line to the stop point
  function arrivalCam(st, dx, dz) {
    const obst = []; for (const k of COLLIDERS) if (Math.abs(k[0] - st[0]) < 110 && Math.abs(k[1] - st[1]) < 110) obst.push([k[0], k[1], k[2]]);
    for (const kd of ["jet", "jet_heavy", "jet_mid", "jet_light"]) for (const e of PLACE[kd] || []) obst.push([e[0], e[2], (MODELS[kd] ? MODELS[kd].radius : 11) * 0.95]);
    // posts, flags, canopies and sculptures that carry no collider (the terminal's porte-cochere, a lattice)
    try { const bs = new THREE.Sphere(); scene.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || !o.visible || !o.geometry) return; if (FLY.g && o.parent === FLY.g) return; const gg = o.geometry; if (!gg.boundingSphere) gg.computeBoundingSphere(); if (!gg.boundingSphere) return; bs.copy(gg.boundingSphere).applyMatrix4(o.matrixWorld); if (bs.radius > 14 || bs.radius < 0.25) return; if (Math.abs(bs.center.x - st[0]) > 70 || Math.abs(bs.center.z - st[1]) > 70) return; if (bs.center.y + bs.radius < getH(bs.center.x, bs.center.z) + 1) return; obst.push([bs.center.x, bs.center.z, Math.min(bs.radius, 2.5)]); }); } catch (e) {}
    const tp = TERM && TERM.pos ? TERM.pos : [63, -65]; const away = ((-dz) * (tp[0] - st[0]) + dx * (tp[1] - st[1])) > 0 ? -1 : 1;
    const score = (cx, cz) => { let c = 1e9; for (const [x, z, r] of obst) { const vx = st[0] - cx, vz = st[1] - cz, L2 = vx * vx + vz * vz; const t = cl(((x - cx) * vx + (z - cz) * vz) / L2, 0, 0.86); c = Math.min(c, Math.hypot(x - (cx + vx * t), z - (cz + vz * t)) - r); } return c; };
    const own = (cx, cz) => { let c = 1e9; for (const [x, z, r] of obst) c = Math.min(c, Math.hypot(x - cx, z - cz) - r); return c; };
    let best = null; for (const d of [30, 38, 24, 46]) for (const s0 of [8, 14, 3, 20]) for (const s of [s0 * away, -s0 * away]) { const cx = st[0] - dx * d + (-dz) * s, cz = st[1] - dz * d + dx * s; if (distToRunway(cx, cz) < 60) continue; const c = Math.min(score(cx, cz), own(cx, cz) - 3); if (!best || c > best.c + 0.5) best = { cx, cz, c }; if (c > 5) return { cx, cz, c }; }
    return best || { cx: st[0] - dx * 50, cz: st[1] - dz * 50, c: 0 }; }

  // ───────────────────────────── the cabin crew ─────────────────────────────
  const DRINKS_AM = ["a glass of champagne", "a Sonoran Sunrise", "an espresso", "sparkling water with lime", "a prickly pear margarita"];
  function orderDrinkR2() { if (!FLY.on || !FLY.fa) return; if (FLY.order) { lower("AVA", "On her way", "", 3); return; } const drink = DRINKS_AM[(FLY.orderN = ((FLY.orderN || 0) + 1)) % DRINKS_AM.length]; FLY.order = { drink, stage: 0, t: 0 }; npcSay(FLY.fa, `${drink.charAt(0).toUpperCase() + drink.slice(1)}, coming right up.`); FLY.fa.pause = 0; sfx("ui"); }
  function walkTo(a, tx, tz, near, dt, sp) { const dx = tx - a.position.x, dz = tz - a.position.z; const d = Math.hypot(dx, dz); if (d < near) return true; const s = Math.min(d, (sp || 0.9) * dt); a.position.x += dx / d * s; a.position.z += dz / d * s; const want = Math.atan2(dx, dz); a.rotation.y += wrapA(want - a.rotation.y) * Math.min(1, dt * 8); animateWalk(a, sp || 0.9, dt); return false; }
  function crew(dt, cabin) {
    const fa = FLY.fa; if (!fa) return; const a = fa.g; const P = planFlyPath(); const seated = FLY.t > P.tTD - 14 && FLY.t < FLY_T.roll + 4;
    if (a.userData.bubble && performance.now() - a.userData.bubbleAt > 6500) { a.remove(a.userData.bubble); a.userData.bubble = null; }
    if (FLY.order) { serveDrinkR2(fa, dt); return; }
    if (seated) { if (walkTo(a, -0.12, 7.25, 0.08, dt, 1.0)) { a.rotation.y += wrapA(Math.PI - a.rotation.y) * Math.min(1, dt * 4); animateWalk(a, 0, dt); } return; }
    if (fa.mode === "galley") { if (!walkTo(a, -0.12, 7.0, 0.06, dt, 0.8)) return; a.rotation.y += wrapA(-Math.PI / 2 - a.rotation.y) * Math.min(1, dt * 4); animateWalk(a, 0, dt); fa.pause -= dt; if (fa.pause <= 0 && cabin) { fa.mode = "aisle"; fa.tz = FLY.local.z + (FLY.local.z > 1 ? -0.9 : 0.9); fa.tz = cl(fa.tz, Z.ab + 0.6, Z.gb - 0.4); } return; }
    if (fa.mode === "aisle") { if (walkTo(a, 0, fa.tz, 0.06, dt, 0.8)) { fa.mode = "pause"; fa.pause = 5 + Math.random() * 4; } return; }
    if (fa.mode === "pause") { animateWalk(a, 0, dt); const dx = FLY.local.x - a.position.x, dz = FLY.local.z - a.position.z; if (Math.hypot(dx, dz) < 2.6) a.rotation.y += wrapA(Math.atan2(dx, dz) - a.rotation.y) * Math.min(1, dt * 4); if (cabin && Math.hypot(dx, dz) < 2.2 && !a.userData.bubble && performance.now() - (fa.lastSay || 0) > 11000) { fa.lastSay = performance.now(); npcSay(fa, fa.lines[fa.li++ % fa.lines.length]); } fa.pause -= dt; if (fa.pause <= 0) { fa.mode = "galley"; fa.pause = 8 + Math.random() * 8; } }
  }
  function serveDrinkR2(fa, dt) {
    const O = FLY.order; const a = fa.g; O.t += dt;
    if (O.stage === 0) { if (walkTo(a, -0.12, 7.0, 0.07, dt, 1.0)) { O.stage = 1; O.t = 0; } }
    else if (O.stage === 1) { animateWalk(a, 0, dt); a.rotation.y += wrapA(-Math.PI / 2 - a.rotation.y) * Math.min(1, dt * 5); if (O.t > 1.8) { O.stage = 2; } }
    else if (O.stage === 2) { const q = FLY.seat; const tz = q ? q.z + (q.zone === "divan" ? 0 : Math.cos(q.f) * 0.55) : FLY.local.z + 0.7; const tx = q && q.zone === "divan" ? -0.05 : 0; if (walkTo(a, tx, cl(tz, Z.ab + 0.5, Z.gb - 0.3), 0.08, dt, 1.0)) { O.stage = 3; O.t = 0; npcSay(fa, `Here you are: ${O.drink}. Enjoy the view.`); sfx("buy"); placeDrink(q); } }
    else { animateWalk(a, 0, dt); const dx = FLY.local.x - a.position.x, dz = FLY.local.z - a.position.z; a.rotation.y += wrapA(Math.atan2(dx, dz) - a.rotation.y) * Math.min(1, dt * 5); if (O.t > 2.6) { FLY.order = null; fa.mode = "galley"; fa.pause = 6; } }
  }
  // the drink lands on the ledge or the table beside your seat
  function placeDrink(q) { try { const M = mats(); const g = FLY.g; if (F.drinkM) { F.drinkM.parent && F.drinkM.parent.remove(F.drinkM); } const grp = new THREE.Group(); const glass = new THREE.Mesh(lathe([[0, 0], [0.034, 0], [0.037, 0.1], [0.034, 0.1], [0.031, 0.006], [0, 0.006]], 18), M.crystal); const fill = new THREE.Mesh(lathe([[0, 0.006], [0.03, 0.006], [0.033, 0.07], [0, 0.07]], 16), M.juice); grp.add(glass, fill);
      let x = 0.9, y = 0.623, z = 3.05; if (q) { if (q.zone === "conf") { x = q.x * 1.13; y = 0.753; z = 0.775 + (q.f === 0 ? -0.2 : 0.2); } else if (q.zone === "divan") { x = -0.62; y = 0.5; z = -3.4; } else { x = Math.sign(q.x) * 1.02; y = 0.623; z = q.z + Math.cos(q.f) * 0.2; } }
      grp.position.set(x, y, z); grp.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); g.add(grp); F.drinkM = grp; } catch (e) { log("drink", e); } }

  // ───────────────────────────── the end of the flight ─────────────────────────────
  function cleanup() {
    if (!F.active) return; F.active = false; try { delete $("#prompt-t").dataset.fly; } catch (e) {}
    try { const s = F.saved || {}; if (typeof s.timeOffset === "number") timeOffset = s.timeOffset; if (s.aoLevel) s.aoLevel.ao = s.ao; if (s.up) camera.up.copy(s.up); } catch (e) { log("restore", e); }
    try { document.body.classList.remove("g1fly", "g1ext"); const U2 = ui(); U2.r.classList.remove("bars"); U2.ttl.classList.remove("on"); U2.low.classList.remove("on"); U2.cap.classList.remove("on"); U2.dip.style.transition = "none"; U2.dip.style.opacity = 0; } catch (e) {}
    try { if (F.smoke) { F.smoke.age.fill(99); F.smoke.pts.visible = false; } if (F.drinkM && F.drinkM.parent) F.drinkM.parent.remove(F.drinkM); F.drinkM = null; } catch (e) {}
    try { for (const o of F.labels || []) o.layers.set(0); F.labels = null; F.fresh = null; scene.traverse((o) => { if (o.isSprite && o.layers.mask === (1 << 29)) o.layers.set(0); }); } catch (e) {}
    try { for (const l of (CSMX.csm && CSMX.csm.lights) || []) if (l.userData.nb0 !== undefined) { l.shadow.normalBias = l.userData.nb0; delete l.userData.nb0; } if (sun.userData.nb0 !== undefined) { sun.shadow.normalBias = sun.userData.nb0; delete sun.userData.nb0; } } catch (e) {}
    F.arrCam = null; F.shot = null; F.debugT = null; F.cam = null; FLY.fa = null;
    try { updateSky(0); updateEnvironment(performance.now(), true); } catch (e) {}
  }
  F.cleanup = cleanup;
  // while aboard: a tight shadow box round the cabin (crisp window light on the medium tier), little normal bias on the near cascade
  function frameAboard(dt) {
    if (!F.active) return; const g = FLY.g; if (!g || !FLY.on) return; const cabin = F.shotKind === "cab";
    { const now = performance.now(); if (now - (F.labAt || 0) > 2500) { F.labAt = now; hideLabels(); } if (F.fresh && F.fresh.length) { for (const s of F.fresh) if (isIn(s, g)) s.layers.set(0); F.fresh = []; } }
    try { const pr = $("#prompt"); pr.classList.toggle("on", cabin); const pt = $("#prompt-t"); if (cabin && F.promptH && (F.promptSet !== F.promptH || pt.dataset.fly !== "1")) { pt.innerHTML = F.promptH; pt.dataset.fly = "1"; F.promptSet = F.promptH; } } catch (e) {}
    try { const s = F.saved; if (s && s.aoLevel === QUAL.q) QUAL.q.ao = cabin ? false : s.ao; } catch (e) {}
    try { if (cabin && !CSMX.on && sun.castShadow) { const half = FLY.t < FLY_T.approach ? 10 : 34; const sc = sun.shadow.camera; if (sc.right !== half) { sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix(); } if (sun.userData.nb0 === undefined) sun.userData.nb0 = sun.shadow.normalBias; sun.shadow.normalBias = 0.02; } else if (sun.userData.nb0 !== undefined) { sun.shadow.normalBias = sun.userData.nb0; delete sun.userData.nb0; } } catch (e) {}
    try { if (CSMX.on && CSMX.csm) { const l0 = CSMX.csm.lights[0]; if (l0) { if (cabin) { if (l0.userData.nb0 === undefined) l0.userData.nb0 = l0.shadow.normalBias; l0.shadow.normalBias = 0.03; } else if (l0.userData.nb0 !== undefined) { l0.shadow.normalBias = l0.userData.nb0; delete l0.userData.nb0; } } } } catch (e) {}
    const lowTier = !(QUAL.q && QUAL.q.shadow); F.U.sun.value = lowTier ? 0.22 : 1; F.U.hemi.value = 0.3;
    // the exterior shots carry the jet's own engines (the traffic engine loop; updateTraffic set it just before this hook runs)
    try { const A = typeof AUD !== "undefined" && AUD.traffic; if (A && typeof audioReady !== "undefined" && audioReady) { let k = 0; const id = F.shot && F.shot.id; if (!cabin) { k = id === "wing" ? 0.9 : id === "tail" ? 0.75 : id === "window" ? 0.65 : id === "establish" ? 0.55 : 0.4; if ((id === "touch" || id === "arrive") && F.jetP) { const d = camera.position.distanceTo(F.jetP); k = Math.max(0.12, Math.min(1, 90 / Math.max(20, d))) * (id === "arrive" ? 0.45 : 1); } } const want = soundOn ? +(A.dataset.vol || 0.6) * k : 0; A.volume = Math.max(0, Math.min(1, want)); if (want > 0.01 && A.paused) A.play().catch(() => {}); } } catch (e) {}
    try { const fu = POST.mFinal && POST.mFinal.uniforms; if (fu && fu.uFog && fu.uHazeK) { fu.uFog.value.x *= F.fogK; fu.uHazeK.value *= F.hazeK; } } catch (e) {}
    if (F.shake) F.shake = Math.max(0, F.shake - (dt || 0.016) * 0.5);
  }

  // ───────────────────────────── the jets in the world ─────────────────────────────
  // the plan's parked jets: heavy on the Club Ramp, mid and light on the Gate A2 stands and tie-downs (sizes that fit their stands)
  const PLAN_JET_CLASS = { b0045: "H", b0046: "H", b0011: "M", b0012: "L", b0059: "M", b0060: "L", b0058: "M", b0061: "L", b0056: "L", b0057: "M" };
  function kindForClass(c) { return c === "H" ? first(["jet_heavy", "jet_mid"]) : c === "L" ? first(["jet_light", "jet_mid"]) : first(["jet_mid", "jet_light"]); }
  function jetSolids(x, z, ry, kind, tag) { const m = MODELS[kind]; if (!m) return; const gy = typeof planGroundAt === "function" ? planGroundAt(x, z) : getH(x, z); const fw = Math.max(2.2, m.sx * 0.1), fl = m.sz * 0.92; addSolid(x, z, ry, fw, fl, gy - 0.5, gy + Math.max(2.6, m.height * 0.42), tag); addSolid(x - Math.sin(ry) * m.sz * 0.05, z - Math.cos(ry) * m.sz * 0.05, ry, m.sx * 0.9, Math.max(1.8, m.sz * 0.12), gy + 1.0, gy + 2.1, tag); }
  function upgradePlanJets() {
    const list = PLACE.jet; if (!list || !list.length) return 0; let n = 0, i = 0; const keep = [];
    for (const e of list) { const c = PLAN_JET_CLASS[e.plan] || (i++ % 2 ? "L" : "M"); const k = e.plan ? kindForClass(c) : null; if (!k) { keep.push(e); continue; } (PLACE[k] || (PLACE[k] = [])).push(e); const rec = PLAN_IDX && PLAN_IDX.bld && PLAN_IDX.bld.get(e.plan); if (rec) rec.kind = k; jetSolids(e[0], e[2], e[3], k, "world"); n++; }
    PLACE.jet = keep; F.planJets = n; return n;
  }
  // parked jets stand on their stand's paving, not in it
  function seatPlanJets() { let n = 0; for (const S of INSTSET) { if (!/^(jet|jet_heavy|jet_mid|jet_light|gbjet2)$/.test(S.kind)) continue; const m = MODELS[S.kind]; for (let i = 0; i < S.list.length; i++) { const e = S.list[i]; const lift = Math.max(0, roadLiftAt(e[0], e[2])); S.mats[i * 16 + 13] = e[1] + lift - (m.sink || 0); n++; } S.n = -1; } if (n) updateCulling(true); F.seated = n; }
  function swapMeshes(g, kind, keep) { for (const c of [...g.children]) if (c.isMesh && !keep.includes(c)) g.remove(c); const src = makeModel(kind); for (const c of [...src.children]) { c.castShadow = true; c.receiveShadow = true; g.add(c); } }
  function trafficKind() { const opts = [["jet_mid", 0.45], ["jet_light", 0.35], ["jet_heavy", 0.2]].filter((o) => has(o[0])); if (!opts.length) return null; let r = Math.random() * opts.reduce((s, o) => s + o[1], 0); for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; } return opts[0][0]; }
  function upgradeTraffic(j) { const k = trafficKind(); if (!k || !j || !j.g) return; swapMeshes(j.g, k, [j.beacon, j.land]); const m = MODELS[k]; j.beacon.position.set(0, m.height * 0.42, m.sz * 0.05); j.land.position.set(0, m.height * 0.12, m.sz * 0.46); j.g.userData.r2 = k; }
  function upgradeVehicle(V) { const k = first(["gbjet2"]); if (!k || !V || V.kind !== "jet" || V.g.userData.r2) return; swapMeshes(V.g, k, [V.label]); V.g.userData.r2 = k; if (V.label) V.label.position.y = MODELS[k].height + 0.8; }
  function frameJets() {
    try { for (const j of TRAFFIC.jets) { const x = j.g.position.x, z = j.g.position.z; const gy = planGroundAt(x, z); const alt = j.phase === "approach" || j.phase === "takeoff" ? Math.max(0, j.alt || 0) : 0; j.g.position.y = gy + alt; if (j.g.userData.r2 && j.phase === "gate" && !j.r2s && j.id) { j.r2s = true; jetSolids(j.px || x, j.pz || z, j.g.rotation.y, j.g.userData.r2, "aijet:" + j.id); } if (j.phase !== "gate") j.r2s = false; } } catch (e) { log("traffic", e); }
    try { if (view && view.vehicles) for (const [id, v] of Object.entries(view.vehicles)) { const V = VEH[id]; if (!V || V.kind !== "jet") continue; if (!V.g.userData.r2) upgradeVehicle(V); if ((v.y || 0) > 0.05 || (riding && riding.id === id && riding.driver)) continue; V.g.position.y = planGroundAt(V.g.position.x, V.g.position.z); } } catch (e) { log("vehicle", e); }
  }
  function upgradeInteriorJet(g, kind) {
    if (!/^(hangar|hangarhome|hangarhome2)$/.test(kind) || !MODELS.jet) return; const k = kind === "hangar" ? first(["jet_mid", "jet_light"]) : first(["jet_light", "jet_mid"]); if (!k) return; const geo0 = MODELS.jet.parts[0].geometry;
    for (const c of [...g.children]) { if (!c.isGroup || !c.children.length || c.children[0].geometry !== geo0) continue; const n = makeModel(k); n.position.copy(c.position); n.rotation.copy(c.rotation); n.scale.setScalar(c.scale.x * Math.min(1.1, MODELS.jet.radius / MODELS[k].radius)); n.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.remove(c); g.add(n); }
  }

  // ───────────────────────────── install ─────────────────────────────
  // every override dispatches through F.impl, so a new copy of this file evaluated in a running page takes over (hot reload in tests)
  F.impl = { buildCabinR2, startFlyInR2, updateFlyInR2, flyCameraR2, flySpotR2, flyStandR2, orderDrinkR2, serveDrinkR2, upgradeTraffic, upgradeVehicle, upgradeInteriorJet, upgradePlanJets, seatPlanJets, cleanup, frameAboard, frameJets, smokeSys, heroJet, ui, log };
  function install() {
    if (F.installed) return; F.installed = true; const I = () => F.impl;
    const orig = { buildCabin, warmCabin, startFlyIn, updateFlyIn, flyCamera, endFlyIn, flySpot, flyStand, orderDrink, serveDrink, spawnTrafficJet, ensureVehicle, furnish, makeLabel, makeBubble };
    F.orig = orig; const mine = () => FLY.g && FLY.g.userData.r2 && F.active;
    buildCabin = function () { try { if (F.cabin && !F.cabin.parent) return F.cabin; const g = I().buildCabinR2(); F.cabin = g; return g; } catch (e) { I().log("buildCabin", e); return orig.buildCabin.apply(this, arguments); } };
    warmCabin = function () { const r = orig.warmCabin.apply(this, arguments); try { const s = I().smokeSys(); s.pts.visible = true; renderer.compile(s.pts, camera, scene); s.pts.visible = false; const j = I().heroJet(); if (j) { scene.add(j); j.position.copy(camera.position); j.updateMatrixWorld(true); renderer.compile(j, camera, scene); scene.remove(j); } } catch (e) { I().log("warm", e); } return r; };
    startFlyIn = function () { try { return I().startFlyInR2.apply(this, arguments); } catch (e) { I().log("startFlyIn", e); try { I().cleanup(); } catch (x) {} if (!FLY.on) return orig.startFlyIn.apply(this, arguments); } };
    updateFlyIn = function (dt) { if (!mine()) return orig.updateFlyIn.apply(this, arguments); return I().updateFlyInR2(dt); };
    flyCamera = function (dt) { if (!mine()) return orig.flyCamera.apply(this, arguments); return I().flyCameraR2(dt); };
    flySpot = function () { if (!mine()) return orig.flySpot.apply(this, arguments); return I().flySpotR2(); };
    flyStand = function () { if (!mine()) return orig.flyStand.apply(this, arguments); return I().flyStandR2(); };
    orderDrink = function () { if (!mine()) return orig.orderDrink.apply(this, arguments); return I().orderDrinkR2(); };
    serveDrink = function (fa, dt) { if (!mine()) return orig.serveDrink.apply(this, arguments); return I().serveDrinkR2(fa, dt); };
    endFlyIn = function (skipped) { const r = orig.endFlyIn.apply(this, arguments); try { if (F.active) { const U2 = I().ui(); U2.ttl.classList.remove("on"); U2.low.classList.remove("on"); U2.cap.classList.remove("on"); } } catch (e) {} return r; };
    spawnTrafficJet = function () { const j = orig.spawnTrafficJet.apply(this, arguments); try { I().upgradeTraffic(j); } catch (e) { I().log("spawn", e); } return j; };
    ensureVehicle = function (id, v) { const had = !!VEH[id]; const V = orig.ensureVehicle.apply(this, arguments); try { if (!had) I().upgradeVehicle(V); } catch (e) { I().log("vehicle", e); } return V; };
    furnish = function (g, kind, r) { const res = orig.furnish.apply(this, arguments); try { I().upgradeInteriorJet(g, kind); } catch (e) { I().log("furnish", e); } return res; };
    // labels and bubbles made during the flight start parked (the frame hook releases the ones that end up inside the cabin, i.e. Ava's)
    const park = (s) => { try { if (F.active && s && s.isSprite) { s.layers.set(29); (F.labels || (F.labels = [])).push(s); (F.fresh || (F.fresh = [])).push(s); } } catch (e) {} return s; };
    makeLabel = function () { return park(orig.makeLabel.apply(this, arguments)); };
    makeBubble = function () { return park(orig.makeBubble.apply(this, arguments)); };
  }
  F.install = install;
  if (!F.hooked) { F.hooked = true;
    window.PLAN_HOOKS.world.push({ name: "flyinWorld", fn: function () { F.install(); try { F.impl.upgradePlanJets(); } catch (e) { F.impl.log("plan jets", e); } } });
    window.PLAN_HOOKS.defer.push({ name: "flyinDefer", fn: function () { try { F.impl.seatPlanJets(); } catch (e) { F.impl.log("seat jets", e); } } });
    window.PLAN_HOOKS.frame.push({ name: "flyinFrame", fn: function (dt) { const I = F.impl; if (F.active && !FLY.on) I.cleanup(); I.frameAboard(dt); I.frameJets(); } }); }
})();
