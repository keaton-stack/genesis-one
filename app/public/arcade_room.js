// Genesis Arcade v2: the room. Builds the blacklight hall (zones, neon, LED floor, signage), the
// physical machines (3D pinball tables, jackpot towers, air-hockey shells, prize counter) and the
// attract-mode animation. Loaded before client.js; it only touches client globals at call time
// (THREE, MODELS, makeModel, textTexture, helpers, ARCADE, ARC, SCREEN, bestFor, arcadeOver, sfx,
// tone, view, ME, rnd, FRAME_N, camera, player).
(function () {
  const R = (window.ARCADE_ROOM = { half: 32, hgt: 8, led: null, blink: [], tubes: null, pinballs: [], towers: [], sfxAt: 0, t: 0 });
  const NEON = { blue: 0x3d7bff, mag: 0xff3ad6, orange: 0xff7a1c, green: 0x4dde6f, cyan: 0x38e8ff, gold: 0xf4cd5a, red: 0xff2d2d };
  const lum = (hex) => 0.2126 * ((hex >> 16) & 255) / 255 + 0.7152 * ((hex >> 8) & 255) / 255 + 0.0722 * (hex & 255) / 255;
  // emissive strength so every colour clears the bloom threshold (luminance > 1.3 in HDR)
  const neonK = (col, want) => Math.min(9, Math.max(2.4, (want || 2.6) / Math.max(0.1, lum(col))));
  const neonMat = (col, want) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: neonK(col, want), roughness: 0.35 });
  const matte = (col, rough) => new THREE.MeshStandardMaterial({ color: col, roughness: rough === undefined ? 0.9 : rough });
  const chrome = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.22, metalness: 0.9 });
  const glassMat = () => new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });

  // ───────── pixel signage: text drawn tiny, scaled up with no smoothing, glowing through emissiveMap ─────────
  function pixelTex(text, col, o) { o = o || {}; const px = o.px || 9; const s = document.createElement("canvas"); const m = s.getContext("2d"); m.font = `bold ${px}px monospace`; const tw = Math.ceil(m.measureText(text).width) + 6; s.width = tw; s.height = px + 6; const sx = s.getContext("2d"); sx.font = `bold ${px}px monospace`; sx.fillStyle = o.bg || "#000"; sx.fillRect(0, 0, s.width, s.height); if (o.border) { sx.strokeStyle = o.border; sx.lineWidth = 1; sx.strokeRect(0.5, 0.5, s.width - 1, s.height - 1); } sx.fillStyle = col; sx.textBaseline = "middle"; sx.fillText(text, 3, s.height / 2 + 1);
    const k = o.scale || 10; const c = document.createElement("canvas"); c.width = s.width * k; c.height = s.height * k; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(s, 0, 0, c.width, c.height); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return { tex: t, aspect: c.width / c.height }; }
  function sign(g, text, col, w, x, y, z, ry, o) { const { tex, aspect } = pixelTex(text, "#" + col.toString(16).padStart(6, "0"), o); const h = w / aspect; const mat = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: (o && o.k) || 2.8, roughness: 0.6 }); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = ry || 0; g.add(m); if (o && o.blink) R.blink.push({ mat, k: mat.emissiveIntensity, rate: o.blink, ph: Math.random() * 6.28 }); return m; }

  // ───────── neon tubes: one instanced box per colour ─────────
  function tubeSet() { const set = {}; return { seg(a, b, col, th) { (set[col] || (set[col] = [])).push([a, b, th || 0.045]); }, build(g) { const geo = new THREE.BoxGeometry(1, 1, 1); const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), D = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), M4 = new THREE.Matrix4(); for (const col in set) { const list = set[col]; const im = new THREE.InstancedMesh(geo, neonMat(+col), list.length); im.userData.noSolid = true; im.frustumCulled = false; list.forEach(([a, b, th], i) => { D.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = D.length(); P.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); Q.setFromUnitVectors(Z, D.normalize()); S.set(th, th, L + th); M4.compose(P, Q, S); im.setMatrixAt(i, M4); }); g.add(im); } } }; }

  // ───────── LED tile floor (the Lava Room), instanced boxes with HDR per-tile colour ─────────
  const LED_PAL = [[0.2, 0.55, 2.4], [2.4, 0.35, 1.9], [0.25, 2.2, 0.9], [2.4, 1.2, 0.2], [0.2, 1.8, 2.4]];
  function ledFloor(g, cx, cz, n, tile) { const gap = 0.05; const geo = new THREE.BoxGeometry(tile - gap, 0.06, tile - gap); const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); const im = new THREE.InstancedMesh(geo, mat, n * n); im.userData.noSolid = true; const M4 = new THREE.Matrix4(); const C = new THREE.Color(); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { M4.makeTranslation(cx + (i - (n - 1) / 2) * tile, 0.08, cz + (j - (n - 1) / 2) * tile); im.setMatrixAt(i * n + j, M4); C.setRGB(0.2, 0.2, 0.3); im.setColorAt(i * n + j, C); } g.add(im); const base = new THREE.Mesh(new THREE.PlaneGeometry(n * tile + 0.6, n * tile + 0.6), matte(0x07070c, 0.7)); base.rotation.x = -Math.PI / 2; base.position.set(cx, 0.052, cz); g.add(base); R.led = { im, n, tile, cx, cz, t: 0, lava: -1, lavaT: 0, seed: 7 }; return im; }
  function ledUpdate(dt) { const L = R.led; if (!L) return; if (L.mode === "round" || L.mode === "over") return ledRound(L, dt); L.t += dt; const n = L.n, C = new THREE.Color(); L.lavaT -= dt; if (L.lavaT <= 0) { L.lavaT = 5 + Math.random() * 4; L.lava = Math.floor(Math.random() * 4); L.seed = Math.floor(Math.random() * 1e6); L.lavaOn = 1.6; } if (L.lavaOn > 0) L.lavaOn -= dt; const wave = L.t * 0.8; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const k = i * n + j; const h = ((i * 73856093) ^ (j * 19349663) ^ L.seed) >>> 0; const ph = (h % 1000) / 1000; const idx = (Math.floor(wave + (i + j) * 0.18 + ph * 2) + (h % 5)) % LED_PAL.length; const p = LED_PAL[idx]; const pulse = 0.55 + 0.45 * Math.sin(wave * 3 + (i - j) * 0.5 + ph * 6.28); let r = p[0] * pulse, gg = p[1] * pulse, b = p[2] * pulse; if (L.lavaOn > 0 && (h % 4) === L.lava) { const q = Math.min(1, L.lavaOn / 0.4) * (0.6 + 0.4 * Math.sin(L.t * 18)); r = 2.6 * q + r * (1 - q); gg = 0.15 * q + gg * (1 - q); b = 0.05 * q + b * (1 - q); } C.setRGB(r, gg, b); L.im.setColorAt(k, C); } L.im.instanceColor.needsUpdate = true; }

  // ───────── 3D pinball: real table geometry, 2D physics on the incline, Machine-compatible ─────────
  const PF = { w: 0.50, len: 1.10, tilt: 0.115, r: 0.0135 };
  function pinballArt() { const W = 512, H = 1024; const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); const grd = x.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#0b1a30"); grd.addColorStop(0.5, "#14103a"); grd.addColorStop(1, "#2a0d2a"); x.fillStyle = grd; x.fillRect(0, 0, W, H); for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`; const r = Math.random() < 0.9 ? 1 : 2; x.fillRect(Math.random() * W, Math.random() * H * 0.7, r, r); } x.strokeStyle = "rgba(77,222,111,.55)"; x.lineWidth = 6; x.beginPath(); x.arc(W / 2, H * 0.27, W * 0.44, Math.PI, 0); x.stroke(); x.fillStyle = "#f4cd5a"; x.font = "900 74px Anton, Impact, sans-serif"; x.textAlign = "center"; x.fillText("GENESIS", W / 2, H * 0.62); x.fillStyle = "#ff3ad6"; x.font = "600 26px 'Space Grotesk', sans-serif"; x.fillText("THE AWAKENING", W / 2, H * 0.66); x.strokeStyle = "rgba(255,58,214,.5)"; x.lineWidth = 3; for (const [px, py] of [[0.30, 0.31], [0.70, 0.33], [0.50, 0.44]]) { x.beginPath(); x.arc(px * W, py * H, 34, 0, 6.283); x.stroke(); } x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(W * 0.905, H * 0.32, W * 0.09, H * 0.68); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  function backglass(M) { const c = M.bgCanvas || (M.bgCanvas = document.createElement("canvas")); c.width = 512; c.height = 300; const x = c.getContext("2d"); const grd = x.createLinearGradient(0, 0, 0, 300); grd.addColorStop(0, "#1a0f3a"); grd.addColorStop(1, "#3a0d2a"); x.fillStyle = grd; x.fillRect(0, 0, 512, 300); x.fillStyle = "#f4cd5a"; x.font = "900 70px Anton, Impact, sans-serif"; x.textAlign = "center"; x.fillText("GENESIS", 256, 92); x.fillStyle = "#4dde6f"; x.font = "600 20px 'Space Grotesk', sans-serif"; x.fillText("P I N B A L L", 256, 124); x.fillStyle = "#08060c"; x.fillRect(66, 150, 380, 78); x.fillStyle = "#ff2d2d"; x.font = "bold 58px 'JetBrains Mono', monospace"; x.fillText(String(M.game ? Math.round(M.game.score) : (M.best ? M.best.v : 0)).padStart(7, "0"), 256, 210); x.fillStyle = "#f5f1e6"; x.font = "bold 18px 'JetBrains Mono', monospace"; x.fillText(M.state === "play" ? `BALL ${4 - (M.game ? M.game.balls : 3)}  OF 3` : M.state === "over" ? "GAME OVER" : M.best ? `TOP  ${M.best.by.slice(0, 12).toUpperCase()}  ${M.best.v}` : "INSERT COIN", 256, 262); if (M.bgTex) M.bgTex.needsUpdate = true; return c; }
  // the generated table has its own painted, slightly raised playfield; cut those faces out once so the procedural field is the only surface there
  function cutPlayfield(kind, box) { const m = MODELS[kind]; if (!m || m.cut) return; m.cut = true; for (const part of m.parts) { const geo = part.geometry; const pos = geo.attributes.position; const idx = geo.index; const n = idx ? idx.count : pos.count; const keep = []; for (let i = 0; i < n; i += 3) { let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(i + k) : i + k; cx += pos.getX(vi); cy += pos.getY(vi); cz += pos.getZ(vi); } cx /= 3; cy /= 3; cz /= 3; const inside = Math.abs(cx) < box.hw && cz > box.z1 && cz < box.z0 && cy > box.y0 && cy < box.y1; if (!inside) { for (let k = 0; k < 3; k++) keep.push(idx ? idx.getX(i + k) : i + k); } } if (keep.length < n) { geo.setIndex(keep); if (!idx) { /* was non-indexed: the index now references the original vertex buffer */ } } } }
  function Pinball3D(def, opts) {
    const g = new THREE.Group(); const M = { def, kind: "pinball2", g, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, lastScore: 0, lastPrize: 0, canvas: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    // cabinet: the generated model when present, else a procedural box on legs; the playfield frame is fitted by PFIT (measured in Blender)
    // measured in Blender on the generated table (game frame, height 1.95): glass top runs from y 0.939 at the front lip (z +0.585) to 1.034 at the backbox (z -0.36); backbox face at z -0.645
    const fit = (window.PFIT && window.PFIT.pinball2) || (MODELS.pinball2 ? { y0: 0.939, y1: 1.052, z0: 0.585, z1: -0.54, w: 0.74, lift: 0.012, bx: [0, 1.52, -0.645], bw: 0.78, bh: 0.66 } : { y0: 0.80, y1: 0.93, z0: 0.56, z1: -0.54, w: 0.50, bx: [0, 1.62, -0.62], bw: 0.56, bh: 0.62 });
    let body; if (MODELS.pinball2) { cutPlayfield("pinball2", { hw: 0.40, z0: 0.60, z1: -0.58, y0: 0.90, y1: 1.16 }); body = makeModel("pinball2"); g.add(body); } else { const dark = matte(0x14121c, 0.7); body = new THREE.Group(); const box = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 1.2), dark); box.position.set(0, 0.72, 0); body.add(box); for (const [sx, sz] of [[-0.25, -0.5], [0.25, -0.5], [-0.25, 0.5], [0.25, 0.5]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.56, 8), chrome()); leg.position.set(sx, 0.28, sz); body.add(leg); } const bb = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.14), dark); bb.position.set(0, 1.62, -0.62); body.add(bb); g.add(body); }
    const bgc = backglass(M); M.bgTex = new THREE.CanvasTexture(bgc); M.bgTex.colorSpace = THREE.SRGBColorSpace; const bg = new THREE.Mesh(new THREE.PlaneGeometry(fit.bw, fit.bh), new THREE.MeshStandardMaterial({ color: 0x000000, map: M.bgTex, emissive: 0xffffff, emissiveMap: M.bgTex, emissiveIntensity: 1.5 })); bg.position.set(fit.bx[0], fit.bx[1], fit.bx[2] + 0.075); g.add(bg); M.bg = bg;
    // the playfield group: origin at the table centre, local -z runs up the table
    const tilt = Math.atan2(fit.y1 - fit.y0, fit.z0 - fit.z1); const pf = new THREE.Group(); pf.position.set(0, (fit.y0 + fit.y1) / 2 + (fit.lift || 0.006), (fit.z0 + fit.z1) / 2); pf.rotation.x = tilt; g.add(pf); M.pf = pf; const LEN = Math.hypot(fit.y1 - fit.y0, fit.z0 - fit.z1), Wd = fit.w; M.LEN = LEN; M.Wd = Wd;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(Wd, LEN), new THREE.MeshStandardMaterial({ map: pinballArt(), roughness: 0.5, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 })); field.rotation.x = -Math.PI / 2; pf.add(field);
    // layout in real metres, proportional to the table: hw half width, hl half length; the ball and every part scale with the width
    const hw = Wd / 2 - 0.01, hl = LEN / 2 - 0.01, top = -hl, bot = hl; const K = Wd / 0.5; const RB = 0.0135 * K; M.RB = RB; const laneW = 2.6 * RB, laneX = hw - laneW; const arcC = top + hw, arcR = hw;
    const rail = matte(0x1c1c22, 0.4); const wallH = 0.035 * K; const wall = (x1, z1, x2, z2, m) => { const L = Math.hypot(x2 - x1, z2 - z1); const b = new THREE.Mesh(new THREE.BoxGeometry(0.008 * K, wallH, L), m || rail); b.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2); b.rotation.y = Math.atan2(x2 - x1, z2 - z1); pf.add(b); return b; };
    const SEGS = [[-hw, arcC, -hw, bot], [hw, arcC, hw, bot], [laneX, bot, laneX, arcC + 0.05], [-hw, bot - 1.0 * hw, -0.5 * hw, bot - 0.32 * hw], [laneX, bot - 1.0 * hw, 0.5 * hw, bot - 0.32 * hw]];
    const SLING = [[-0.76 * hw, bot - 0.95 * hw, -0.54 * hw, bot - 0.62 * hw], [0.76 * hw, bot - 0.95 * hw, 0.54 * hw, bot - 0.62 * hw]];
    for (const s of SEGS) wall(...s); for (const s of SLING) wall(...s, neonMat(NEON.mag, 1.6)); const arcPts = []; for (let i = 0; i <= 24; i++) { const a = Math.PI + i / 24 * Math.PI; arcPts.push([Math.cos(a) * arcR, arcC + Math.sin(a) * arcR]); } for (let i = 0; i < 24; i++) wall(arcPts[i][0], arcPts[i][1], arcPts[i + 1][0], arcPts[i + 1][1]);
    const BR = 0.034 * K; const BUMP = [[-0.40 * hw, arcC + 0.12 * hl], [0.40 * hw, arcC + 0.08 * hl], [0, arcC + 0.40 * hl]].map(([x, z]) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(BR - 0.002, BR + 0.002, 0.03 * K, 20), matte(0x1e2a3a, 0.5)); b.position.set(x, 0.015 * K, z); pf.add(b); const cap = new THREE.Mesh(new THREE.CylinderGeometry(BR * 0.78, BR * 0.78, 0.012 * K, 20), neonMat(NEON.green, 1.4)); cap.position.set(x, 0.036 * K, z); pf.add(cap); return { x, z, r: BR, cap, hit: 0 }; });
    const TGT = [205, 222, 318, 335].map((deg) => { const a = deg * Math.PI / 180; const x = Math.cos(a) * (arcR - 0.10 * hw), z = arcC + Math.sin(a) * (arcR - 0.10 * hw); const m = new THREE.Mesh(new THREE.BoxGeometry(0.03 * K, 0.028 * K, 0.012 * K), neonMat(NEON.orange, 1.5)); m.position.set(x, 0.014 * K, z); m.rotation.y = -a + Math.PI / 2; pf.add(m); return { x, z, m, up: true }; });
    const flipMat = neonMat(NEON.gold, 1.2); const FLEN = 0.46 * hw; const FL = [{ s: -1, px: -0.47 * hw, pz: bot - 0.30 * hw }, { s: 1, px: 0.47 * hw, pz: bot - 0.30 * hw }].map((f) => { const piv = new THREE.Group(); piv.position.set(f.px, 0.012 * K, f.pz); pf.add(piv); const bar = new THREE.Mesh(new THREE.BoxGeometry(FLEN, 0.016 * K, 0.02 * K), flipMat); bar.position.x = -f.s * FLEN / 2; piv.add(bar); return { ...f, piv, k: 0, len: FLEN, rest: 0.5, up: -0.45 }; });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(RB, 18, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 1, envMapIntensity: 1.6 })); pf.add(ball); const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * K, 0.008 * K, 0.06 * K, 8), chrome()); plunger.rotation.x = Math.PI / 2; plunger.position.set(hw - laneW / 2, 0.012 * K, bot + 0.01); pf.add(plunger);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(Wd, LEN), glassMat()); glass.rotation.x = -Math.PI / 2; glass.position.y = 0.06 * K; pf.add(glass);
    const B = { x: hw - laneW / 2, z: bot - 0.06, vx: 0, vy: 0, live: false, plunge: 0, held: false };
    const seg = (x1, z1, x2, z2, kick, moving) => { const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((B.x - x1) * dx + (B.z - z1) * dz) / L2)); const px = x1 + dx * t, pz = z1 + dz * t; const d = Math.hypot(B.x - px, B.z - pz); if (d >= RB + 0.003) return false; const nx = (B.x - px) / (d || 1), nz = (B.z - pz) / (d || 1); const vn = B.vx * nx + B.vy * nz; if (vn < 0) { const e = kick ? 1.9 : 1.6; B.vx -= e * vn * nx; B.vy -= e * vn * nz; if (kick) { B.vx += nx * 0.6 * K; B.vy += nz * 0.6 * K; } } B.x = px + nx * (RB + 0.003); B.z = pz + nz * (RB + 0.003); if (moving) { const kk = Math.sqrt(K); B.vx += nx * (0.7 + 1.6 * t) * kk; B.vy += nz * (0.7 + 1.6 * t) * kk; } return true; };
    const flipSeg = (f) => { const a = f.rest + (f.up - f.rest) * f.k; const dx = -f.s * Math.cos(a) * f.len, dz = Math.sin(a) * f.len; return [f.px, f.pz, f.px + dx, f.pz + dz]; }; M.dbg = { B, FL, flipSeg, SEGS, hw, bot, RB };
    const newBall = () => { B.x = hw - laneW / 2; B.z = bot - 0.06; B.vx = 0; B.vy = 0; B.live = false; B.plunge = 0; for (const t of TGT) { t.up = true; t.m.visible = true; } };
    M.insertCoin = () => { M.game = { score: 0, balls: 3, over: false, lives: 3, flash: 0 }; M.state = "ready"; M.t = 0; newBall(); backglass(M); if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; newBall(); backglass(M); };
    M.physics = (dt, inp) => { const G = M.game; const wl = inp.l ? 1 : 0, wr = inp.r ? 1 : 0; for (const f of FL) { const want = f.s < 0 ? wl : wr; const prev = f.k; f.k += Math.max(-1, Math.min(1, want - f.k)) * Math.min(1, dt * 26); f.moving = f.k > prev + 0.02; f.piv.rotation.y = f.s * (f.rest + (f.up - f.rest) * f.k); }
      // flipper bars point inward from the pivot (toward the centre), rotated around y by the flipper angle measured from the inward axis toward +z (down the table)
      for (const f of FL) { const a = f.rest + (f.up - f.rest) * f.k; f.piv.rotation.y = f.s * a; }
      if (!B.live) { if (inp.a) { B.held = true; B.plunge = Math.min(1, B.plunge + dt * 1.3); } else if (B.held) { B.held = false; B.vy = -(1.6 + B.plunge * 1.6) * Math.sqrt(K); B.live = true; B.plunge = 0; } plunger.position.z = bot + 0.01 + B.plunge * 0.03 * K; return; }
      const steps = 4; const h = dt / steps; const VMAX = 3.4 * Math.sqrt(K); for (let s = 0; s < steps; s++) { B.vy += 1.75 * K * h; const k = Math.exp(-0.10 * h); B.vx *= k; B.vy *= k; const sp = Math.hypot(B.vx, B.vy); if (sp > VMAX) { B.vx *= VMAX / sp; B.vy *= VMAX / sp; } B.x += B.vx * h; B.z += B.vy * h;
        if (B.z < arcC) { const d = Math.hypot(B.x, B.z - arcC); if (d > arcR - RB) { const nx = B.x / d, nz = (B.z - arcC) / d; const vn = B.vx * nx + B.vy * nz; if (vn > 0) { B.vx -= 1.7 * vn * nx; B.vy -= 1.7 * vn * nz; } B.x = nx * (arcR - RB); B.z = arcC + nz * (arcR - RB); } }
        for (const sg of SEGS) seg(sg[0], sg[1], sg[2], sg[3], false, false); for (const sg of SLING) if (seg(sg[0], sg[1], sg[2], sg[3], true, false)) { G.score += 10; }
        for (const bu of BUMP) { const d = Math.hypot(B.x - bu.x, B.z - bu.z); if (d < bu.r + RB) { const nx = (B.x - bu.x) / d, nz = (B.z - bu.z) / d; const spd = Math.max(1.7 * Math.sqrt(K), Math.hypot(B.vx, B.vy) * 1.08); B.vx = nx * spd; B.vy = nz * spd; B.x = bu.x + nx * (bu.r + RB + 0.001); B.z = bu.z + nz * (bu.r + RB + 0.001); G.score += 100; bu.hit = 0.18; G.flash = 0.1; if (M.onScore) M.onScore("bump"); } }
        for (const t of TGT) if (t.up && Math.hypot(B.x - t.x, B.z - t.z) < 0.02 * K + RB) { t.up = false; t.m.visible = false; G.score += 50; const d = Math.hypot(B.x, B.z - arcC) || 1; B.vx = -B.x / d * 0.6 * K; B.vy = Math.abs(B.vy) * 0.5 + 0.4 * K; if (TGT.every((q) => !q.up)) { G.score += 500; G.flash = 0.4; setTimeout(() => { for (const q of TGT) { q.up = true; q.m.visible = true; } }, 900); } }
        for (const f of FL) { const s4 = flipSeg(f); seg(s4[0], s4[1], s4[2], s4[3], false, f.moving && f.k < 0.95); }
        if (B.z > bot + 0.05) { G.balls--; G.lives = G.balls; if (G.balls <= 0) { G.over = true; return; } newBall(); return; } }
      for (const bu of BUMP) { bu.hit = Math.max(0, bu.hit - dt); bu.cap.material.emissiveIntensity = bu.hit > 0 ? 8 : neonK(NEON.green, 1.4); } };
    M.step = (dt, inp) => { M.t += dt; if (M.state === "ready") { if (M.t > 2.2) { M.state = "play"; M.t = 0; backglass(M); } return; }
      if (M.state === "play") { const G = M.game; M.physics(Math.min(0.05, dt), inp); ball.position.set(B.x, RB + 0.002, B.z); if (Math.round(G.score) !== M.shown) { M.shown = Math.round(G.score); if (!M.bgAt || performance.now() - M.bgAt > 120) { M.bgAt = performance.now(); backglass(M); } } if (G.over) { M.state = "over"; M.t = 0; M.lastScore = Math.max(0, Math.round(G.score)); M.lastPrize = Math.max(0, Math.min(60, Math.round(def.prize(M.lastScore)))); if (!M.best || M.lastScore > M.best.v) M.best = { by: (opts && opts.you) || "you", v: M.lastScore }; backglass(M); if (M.onOver) M.onOver(M, M.lastScore, M.lastPrize); } return; }
      if (M.state === "over") { if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; newBall(); backglass(M); } return; }
      // attract: bumper caps chase, flippers twitch now and then
      const ph = Math.floor(M.t * 3) % 3; BUMP.forEach((bu, i) => { bu.cap.material.emissiveIntensity = i === ph ? 6 : 1.4; }); const tw = Math.sin(M.t * 1.3) > 0.985 ? 1 : 0; for (const f of FL) { f.k += (tw - f.k) * Math.min(1, dt * 12); f.piv.rotation.y = f.s * (f.rest + (f.up - f.rest) * f.k); } };
    M.step(0, {}); return M;
  }

  // ───────── Drop 2: Floor Is Lava rounds, Jumpin' Jackpot, the real claw ─────────
  // Three Machine-compatible attractions (state / game / insertCoin / abort / step / onOver) that
  // settle through the normal arcade coin + prize actions. Kind `lava` is free-roam: client.js keeps
  // the avatar walking and passes its room-local position in inp.pos and whether it is airborne in inp.air.
  const D2 = (R.d2 = { lava: null, jacks: [], claws: [] });
  const DEFS2 = {
    lava: { id: "lava", name: "FLOOR IS LAVA", tag: "Rounds", color: "#ff2d2d", blurb: "Stay off the red tiles. The waves get faster.", keys: "W A S D to move · SPACE to jump · watch the floor", prize: (s) => Math.min(60, Math.floor(s / 90)) },
    jackpot: { id: "jackpot", name: "JUMPIN' JACKPOT", tag: "Jump", color: "#f4cd5a", blurb: "Stand on the ring, jump the light as it comes round. 24 fills the column.", keys: "stand on the ring · SPACE to jump the light", prize: (s) => Math.min(60, Math.floor(s / 40)) },
    airhockey: { id: "airhockey", name: "AIR HOCKEY", tag: "Versus", color: "#38e8ff", blurb: "First to 5. The house plays until a challenger takes the other end.", keys: "W A S D or the mouse · first to 5", prize: (s) => Math.min(60, Math.floor(s / 25)) },
    skee: { id: "skee", name: "SKEE-BALL", tag: "Roll", color: "#f4cd5a", blurb: "Nine balls. Roll them up into the rings, 100 in the corners.", keys: "A D aim · hold SPACE for power, release to roll", prize: (s) => Math.min(60, Math.floor(s / 8)) },
    hoops: { id: "hoops", name: "HOOPS", tag: "Shoot", color: "#ff7a1c", blurb: "45 seconds. 2 a basket, 3 in the last 15.", keys: "A D aim · hold SPACE, release at the top of the meter", prize: (s) => Math.min(60, Math.floor(s * 2)) },
    boxer: { id: "boxer", name: "BOXER", tag: "Power", color: "#ff2d2d", blurb: "Three punches. Hit SPACE at the top of the meter.", keys: "SPACE at the top of the meter", prize: (s) => Math.min(60, Math.floor(s / 50)) },
    grab: { id: "grab", name: "REAL CLAW", tag: "Skill", color: "#ff3ad6", blurb: "Line the claw up, drop it, hope it holds. Three drops.", keys: "W A S D move the claw · SPACE drop", prize: (s) => Math.min(60, Math.floor(s / 25)) },
  };
  function registerDefs() {
    for (const k in DEFS2) if (!ARCADE.byId(DEFS2[k].id)) ARCADE.GAMES.push(DEFS2[k]);
    if (typeof CAB_KIND !== "undefined") { for (const k of ["lava", "jackpot", "grab", "airhockey", "skee", "hoops", "boxer"]) CAB_KIND[k] = k; }
    if (typeof SCREEN !== "undefined") {
      SCREEN.lava = SCREEN.lava || { x: 0, y: 1.2, z: 0, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.6, 1.0] };
      SCREEN.jackpot = SCREEN.jackpot || { x: 0, y: 1.5, z: 0, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.55, 2.85] };
      SCREEN.airhockey = SCREEN.airhockey || { x: 0, y: 0.85, z: -1.15, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.85, 0.75] };
      SCREEN.skee = SCREEN.skee || { x: 0, y: 1.0, z: -1.7, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.6, 0.9] };
      SCREEN.hoops = SCREEN.hoops || { x: 0, y: 2.0, z: -1.1, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.6, 1.5] };
      SCREEN.boxer = SCREEN.boxer || { x: 0, y: 1.7, z: -0.55, w: 1, h: 1, tilt: 0, eyeAt: [0, 1.55, 1.1] };
      SCREEN.grab = SCREEN.grab || { x: 0, y: 1.5, z: 0, w: 0.7, h: 0.8, tilt: 0, eyeAt: [0, 1.62, 1.55] };
    }
  }
  // machines set M.hint; updateArcade shows it in place of the default key legend while it is set
  const hdr = (r, g, b) => new THREE.Color(r, g, b);
  const LAVA_COL = { safe: hdr(0.12, 0.28, 0.6), warn: hdr(2.4, 0.95, 0.1), lava: hdr(2.8, 0.14, 0.05) };
  const bestUp = (M, you, score) => { if (!M.best || score > M.best.v) M.best = { by: you || "you", v: score }; };

  // round-mode colours for the LED floor; ledUpdate hands off here while a round is running or just ended
  function ledRound(L, dt) { const im = L.im, n = L.n, C = new THREE.Color(); L.t += dt; const blink = 0.55 + 0.45 * Math.sin(L.t * 22); const over = L.mode === "over";
    if (over) L.overT = (L.overT || 0) + dt;
    for (let k = 0; k < n * n; k++) { if (over) { const f = 0.5 + 0.5 * Math.sin(L.overT * 6 + k * 0.3); C.copy(LAVA_COL.lava).multiplyScalar(0.25 + 0.5 * f); } else if (L.lavaSet && L.lavaSet[k]) C.copy(LAVA_COL.lava).multiplyScalar(0.8 + 0.3 * blink); else if (L.hot && L.hot[k]) C.copy(LAVA_COL.warn).multiplyScalar(blink); else C.copy(LAVA_COL.safe); im.setColorAt(k, C); }
    im.instanceColor.needsUpdate = true; if (over && L.overT > 3) { L.mode = "attract"; L.overT = 0; } }

  // ───────── Drop 3 + 4: shared Lava Room rounds, the ring-chase Jumpin' Jackpot, air hockey, Skee-Ball, Hoops, Boxer ─────────
  const hexOf = (set) => { let s = ""; for (let i = 0; i < set.length; i += 4) { let v = 0; for (let k = 0; k < 4; k++) if (set[i + k]) v |= 1 << k; s += v.toString(16); } return s; };
  const setOf = (hex, n) => { const set = new Uint8Array(n); for (let i = 0; i < hex.length; i++) { const v = parseInt(hex[i], 16); for (let k = 0; k < 4; k++) if (v & (1 << k)) { const j = i * 4 + k; if (j < n) set[j] = 1; } } return set; };
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const roomLocal = () => (typeof inside !== "undefined" && inside && player ? inside.g.worldToLocal(player.position.clone()) : null);
  const meCoins = () => { const p = typeof view !== "undefined" && view && view.players && view.players[ME]; return p ? p.coins || 0 : 0; };
  const hud = (name, big, line) => { const g = $("#game"); if (!g.classList.contains("on")) g.classList.add("on"); if (name !== null) $("#game-n").textContent = name; if (big !== null) $("#game-big").textContent = big; if (line !== null && $("#game-s").textContent !== line) $("#game-s").textContent = line; };

  // ── Floor Is Lava, shared. The starter's client hosts the timeline and pushes every phase into the room state
  //    (view.lava); every client in the arcade renders that and judges its own player against it.
  const LV = (R.lava = { host: null, part: null, seen: null, lastTick: -1, lastAt: 0, tried: -1, said: -1 });
  const lavaView = () => (typeof view !== "undefined" && view && view.lava) || null;
  const lavaStale = (V) => !V || V.phase === "over" || (LV.lastTick === V.tick && performance.now() - LV.lastAt > 15000);
  const myTile = () => { const l = R.led; const p = roomLocal(); if (!l || !p) return -1; const i = Math.round((p.x - l.cx) / l.tile + (l.n - 1) / 2), j = Math.round((p.z - l.cz) / l.tile + (l.n - 1) / 2); return i < 0 || j < 0 || i >= l.n || j >= l.n ? -1 : i * l.n + j; };
  function lavaHostStart() { LV.host = { wave: 0, phase: "count", pt: 3.2, hot: null, lavaSet: null }; act({ t: "lava", op: "start" }); const l = R.led; if (l) { l.mode = "round"; l.hot = null; l.lavaSet = null; } }
  function lavaHostPush(phase, hot) { const H = LV.host; const a = { t: "lava", op: "phase", phase, wave: H.wave }; if (hot) a.hot = hexOf(hot); act(a); }
  function lavaHostEnd() { const H = LV.host; if (!H) return; act({ t: "lava", op: "phase", phase: "over", wave: H.wave }); LV.host = null; const l = R.led; if (l) { l.mode = "over"; l.overT = 0; l.hot = null; l.lavaSet = null; } }
  function lavaHostStep(dt) { const H = LV.host; const l = R.led; if (!H || !l) return; H.pt -= dt;
    const nextWave = () => { const frac = Math.min(0.65, 0.35 + H.wave * 0.03); const set = new Uint8Array(l.n * l.n); for (let k = 0; k < set.length; k++) set[k] = Math.random() < frac ? 1 : 0; H.hot = set; H.lavaSet = null; H.phase = "warn"; H.pt = Math.max(0.6, 1.1 - H.wave * 0.05); l.mode = "round"; l.hot = set; l.lavaSet = null; lavaHostPush("warn", set); };
    if (H.phase === "count") { if (H.pt <= 0) nextWave(); return; }
    if (H.phase === "warn") { if (H.pt <= 0) { H.phase = "lava"; H.pt = 1.0; H.lavaSet = H.hot; H.hot = null; l.lavaSet = H.lavaSet; l.hot = null; lavaHostPush("lava"); sfx("bump"); } }
    else if (H.phase === "lava") { if (H.pt <= 0) { H.wave++; H.phase = "rest"; H.pt = 0.7; H.lavaSet = null; l.lavaSet = null; lavaHostPush("rest"); sfx("blip"); } }
    else if (H.phase === "rest" && H.pt <= 0) { const V = lavaView(); const mine = V && V.by === ME && V.phase !== "over"; const anyAlive = !mine || Object.values(V.players || {}).some((p) => p.alive); if (!anyAlive || H.wave >= 30) return lavaHostEnd(); nextWave(); } }
  function lavaOut(P, why) { if (P.out) return; P.out = true; P.t = 0; const V = lavaView(); const waves = LV.host ? LV.host.wave : V ? V.wave : 0; const score = Math.round(waves * 100 + P.alive * 10); const prize = DEFS2.lava.prize(score); P.score = score; P.prize = prize; P.why = why;
    if (why !== "survived the round") act({ t: "lava", op: "out" }); act({ t: "arcade", op: "prize", game: "lava", v: score, p: prize }); sfx(prize > 0 ? "arc_prize" : "arc_over");
    const line = `${prize > 0 ? "+" + prize + " $GBACK" : "no prize"} · ${why} · ${waves} wave${waves === 1 ? "" : "s"}`; P.hint = line + (P.host ? " · E to play again · Esc or Q to walk away" : ""); if (P.host || P.hud) hud(P.host ? null : "FLOOR IS LAVA", String(score), P.hint);
    logLine("Genesis Arcade", `${(view && view.players[ME] && view.players[ME].name) || "You"} lasted ${waves} wave${waves === 1 ? "" : "s"} on FLOOR IS LAVA${prize ? " and won " + prize + " $GBACK" : ""}`); }
  // per frame while in the arcade: mirror the shared round onto the floor, auto-join a countdown, judge my own player
  function lavaTick(dt) { const l = R.led; if (!l || typeof ME === "undefined") return; const V = lavaView(); const hosting = !!LV.host;
    if (V && V.tick !== LV.lastTick) { LV.lastTick = V.tick; LV.lastAt = performance.now(); }
    const live = V && !lavaStale(V);
    if (hosting && live && V.by !== ME) LV.host = null;
    if (LV.host) lavaHostStep(dt);
    else if (live) { l.mode = "round"; const set = V.hot ? setOf(V.hot, l.n * l.n) : null; if (V.phase === "warn") { l.hot = set; l.lavaSet = null; } else if (V.phase === "lava") { l.lavaSet = set; l.hot = null; } else { l.hot = null; l.lavaSet = null; } if (!LV.seen) { LV.seen = V.tick; if (V.by !== ME && LV.said !== V.tick) { LV.said = V.tick; setStatus("Floor Is Lava round starting · get on the tiles to join"); } } }
    else if (LV.seen !== null) { LV.seen = null; if (l.mode === "round") { l.mode = "over"; l.overT = 0; } l.hot = null; l.lavaSet = null; }
    const gate = D2.lava && ARC.cabs.find((c) => c.kind === "lava"); if (gate) gate.busy = !!(live && V.by !== ME && V.phase !== "count");
    let P = LV.part; const tile = myTile();
    if (!P) { if (live && V.players && V.players[ME] && V.players[ME].alive) P = LV.part = { alive: 0, off: 0, out: false, host: V.by === ME, hud: V.by !== ME, score: 0, t: 0 };
      else if (live && V.phase === "count" && V.by !== ME && tile >= 0 && !ARC.on && LV.tried !== V.tick && meCoins() >= 20) { LV.tried = V.tick; act({ t: "arcade", op: "coin", game: "lava" }); act({ t: "lava", op: "join" }); sfx("arc_coin"); setStatus("FLOOR IS LAVA · 20 $GBACK in · you are in this round"); }
      if (!P) return; }
    if (P.out) { P.t += dt; const gone = !live || !V.players || !V.players[ME]; if (P.t > 4 && (gone || V.phase === "over")) { if (P.hud && !ARC.on) $("#game").classList.remove("on"); LV.part = null; } return; }
    if (ARC.on && !P.host) P.hud = false;
    const phase = hosting ? LV.host.phase : V ? V.phase : "over"; const playing = phase !== "count" && phase !== "over";
    if (playing) P.alive += dt; P.score = Math.round((hosting ? LV.host.wave : V ? V.wave : 0) * 100 + P.alive * 10);
    if (!live && !hosting) return lavaOut(P, "survived the round");
    if (playing && tile < 0) { P.off += dt; if (P.off > 5) return lavaOut(P, "you left the floor"); } else P.off = 0;
    const lavaSet = phase === "lava" ? (hosting ? LV.host.lavaSet : l.lavaSet) : null;
    if (lavaSet && tile >= 0 && lavaSet[tile] && !airborne) return lavaOut(P, "burned");
    P.hint = phase === "count" ? (hosting ? `walk onto the tiles · first wave in ${Math.max(1, Math.ceil(LV.host.pt))}` : "walk onto the tiles · starting soon") : tile < 0 ? "get back on the tiles!" : phase === "warn" ? "orange is about to burn · move!" : phase === "lava" ? "LAVA · stay off the red" : `wave ${hosting ? LV.host.wave : V.wave} clear`;
    if (P.hud) hud("FLOOR IS LAVA", playing ? String(P.score) : "", P.hint + " · " + (Object.values((V && V.players) || {}).filter((p) => p.alive).length) + " in"); }
  // the gate machine: E starts a round (or joins one that is counting down); the HUD mirrors my participation
  function LavaMachine(def, opts) {
    const M = { def, kind: "lava", g: new THREE.Group(), state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: null, onStart: opts && opts.onStart };
    M.insertCoin = () => { const V = lavaView(); const foreign = V && !lavaStale(V) && V.by !== ME; if (foreign && V.phase === "count") { act({ t: "lava", op: "join" }); M.hint = "you are in · walk onto the tiles"; } else { lavaHostStart(); M.hint = "walk onto the tiles"; } LV.part = { alive: 0, off: 0, out: false, host: !foreign, hud: false, score: 0, t: 0 }; M.game = { score: 0, over: false }; M.state = "ready"; M.t = 0; if (M.onStart) M.onStart(M); };
    M.abort = () => { const P = LV.part; if (P && !P.out) lavaOut(P, "walked away"); M.game = null; M.state = "attract"; M.t = 0; M.hint = null; };
    M.step = (dt) => { M.t += dt; const G = M.game; if (!G) return; const P = LV.part; if (P) { G.score = P.score || 0; M.hint = P.hint || M.hint; if (P.out && M.state !== "over") { M.state = "over"; M.t = 0; G.over = true; } else if (!P.out && M.state === "ready" && P.alive > 0.05) { M.state = "play"; M.t = 0; } }
      if (M.state === "over" && M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } };
    return M;
  }

  // ── Jumpin' Jackpot: a light chases around a ring of floor lamps; stand on the ring and jump as it passes under you.
  //    Every clean jump lights one more lamp on the tower column and speeds the chase up; 24 fills the column for the jackpot.
  const JC = { top: hdr(3.0, 2.4, 0.4), lit: hdr(0.4, 2.6, 0.9), topDim: hdr(0.55, 0.42, 0.08), dim: hdr(0.12, 0.12, 0.18), ring: hdr(0.26, 0.2, 0.05), chase: hdr(3.2, 2.2, 0.3) };
  const RING_N = 36, RING_R = 1.75, RING_IN = 1.15, RING_OUT = 2.4, JACK_JUMPS = 24;
  function JackpotMachine(def, opts, tg, faceZ, rg, center) {
    const N = 24, geo = new THREE.BoxGeometry(0.44, 0.06, 0.03), mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); const im = new THREE.InstancedMesh(geo, mat, N); im.userData.noSolid = true; const M4 = new THREE.Matrix4(), C = new THREE.Color(); for (let i = 0; i < N; i++) { M4.makeTranslation(0, 0.32 + i * 0.088, faceZ); im.setMatrixAt(i, M4); im.setColorAt(i, JC.dim); } tg.add(im);
    const rim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), RING_N); rim.userData.noSolid = true; { const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0); for (let i = 0; i < RING_N; i++) { const a = i / RING_N * Math.PI * 2; P.set(Math.cos(a) * RING_R, 0.03, Math.sin(a) * RING_R); Q.setFromAxisAngle(Y, -a - Math.PI / 2); M4.compose(P, Q, S1); rim.setMatrixAt(i, M4); rim.setColorAt(i, JC.ring); } } rg.add(rim);
    const M = { def, kind: "jackpot", g: tg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    const paintCol = (lit, flash) => { for (let i = 0; i < N; i++) { if (flash) C.copy(JC.top).multiplyScalar(0.3 + 0.7 * flash); else C.copy(i < lit ? JC.lit : i === N - 1 ? JC.topDim : JC.dim); im.setColorAt(i, C); } im.instanceColor.needsUpdate = true; };
    const paintRing = (la, mode, k) => { for (let i = 0; i < RING_N; i++) { const d = wrapA(i / RING_N * Math.PI * 2 - la); if (mode === "over") C.copy(LAVA_COL.lava).multiplyScalar(0.3 + 0.5 * k); else if (Math.abs(d) < 0.2) C.copy(JC.chase); else if (d < 0 && d > -0.8) C.copy(JC.chase).multiplyScalar(0.08 + 0.45 * (1 + d / 0.8)); else C.copy(JC.ring); rim.setColorAt(i, C); } rim.instanceColor.needsUpdate = true; };
    const end = (G, why) => { G.over = true; M.state = "over"; M.t = 0; const score = Math.round(G.score); bestUp(M, opts && opts.you, score); M.hint = `${why} · ${G.jumps} jump${G.jumps === 1 ? "" : "s"}`; if (M.onOver) M.onOver(M, score, def.prize(score)); };
    const legend = (G) => `jump when the light comes round · ${G.jumps} of ${JACK_JUMPS}`;
    M.insertCoin = () => { M.game = { score: 0, over: false, jumps: 0, ang: Math.random() * 6.28, w: 1.4, prevD: null, off: 0, pt: 3.2, flash: 0 }; M.state = "ready"; M.t = 0; M.hint = "step onto the ring of lights"; if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; M.hint = null; };
    M.step = (dt, inp) => { M.t += dt; const G = M.game;
      if (!G) { paintRing(M.t * 1.1, "play"); const k = Math.floor(M.t * 5) % (N + 8); paintCol(k < N ? k : 0, 0); return; }
      if (M.state === "ready") { G.pt -= dt; M.hint = `step onto the ring of lights · starts in ${Math.max(1, Math.ceil(G.pt))}`; G.ang += G.w * dt; paintRing(G.ang, "play"); paintCol(0, 0); if (G.pt <= 0) { M.state = "play"; M.t = 0; G.prevD = null; sfx("arc_start"); } return; }
      if (M.state === "over") { G.flash = Math.max(0, G.flash - dt); paintRing(G.ang, "over", 0.5 + 0.5 * Math.sin(M.t * 8)); paintCol(G.jumps, G.flash > 0 ? 0.5 + 0.5 * Math.sin(M.t * 12) : 0); if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } return; }
      G.ang += G.w * dt; if (G.ang > 6.2832) G.ang -= 6.2832;
      const pos = inp && inp.pos; let onRing = false, pa = 0; if (pos) { const dx = pos.x - center[0], dz = pos.z - center[1]; const r = Math.hypot(dx, dz); onRing = r > RING_IN && r < RING_OUT; pa = Math.atan2(dz, dx); }
      if (!onRing) { G.off += dt; G.prevD = null; M.hint = G.off > 0.8 ? "get on the ring of lights!" : legend(G); if (G.off > 5) { paintRing(G.ang, "play"); return end(G, "you left the ring"); } }
      else { G.off = 0; const d = wrapA(G.ang - pa);
        if (G.prevD !== null && G.prevD < 0 && d >= 0 && d - G.prevD < 1.5) { if (inp && inp.air) { G.jumps++; G.score += 50; G.w = Math.min(4.4, G.w * 1.07); sfx("blip"); if (G.jumps >= JACK_JUMPS) { G.score += 1000; G.flash = 2; sfx("arc_prize"); paintRing(G.ang, "play"); paintCol(G.jumps, 1); return end(G, "JACKPOT!"); } } else { paintRing(G.ang, "play"); paintCol(G.jumps, 0); return end(G, "the light caught you"); } }
        G.prevD = d; M.hint = legend(G); }
      paintRing(G.ang, "play"); paintCol(G.jumps, 0); };
    return M;
  }

  // ── Air hockey: two real tables. The host simulates the puck and relays it to the challenger through the room's signal channel.
  const AH = { HL: 1.02, HW: 0.55, GW: 0.36, PR: 0.075, PKR: 0.045, VMAX: 5.2, SPD: 2.6, tables: [] };
  const hockeyView = (i) => { const T = typeof view !== "undefined" && view && view.hockey ? view.hockey[i] : null; return T && T.host ? T : null; };
  R.hockeySignal = (from, d) => { const M = AH.tables[d.table]; if (M && M.onNet) M.onNet(from, d); };
  function HockeyTable(def, opts, g, cx, cz, idx) {
    const tg = new THREE.Group(); tg.position.set(cx, 0, cz); g.add(tg); const H = helpers(tg); const HL = AH.HL, HW = AH.HW;
    H.B(2.0, 0.7, 1.0, matte(0x14121c, 0.85), 0, 0.36, 0); H.B(2.3, 0.14, 1.25, matte(0x0d0d14, 0.35), 0, 0.78, 0); const top = H.B(2.16, 0.02, 1.12, new THREE.MeshStandardMaterial({ color: 0x0b1a26, roughness: 0.25, metalness: 0.1 }), 0, 0.85, 0);
    for (const sz of [-1, 1]) H.B(2.3, 0.05, 0.05, neonMat(NEON.cyan, 1.6), 0, 0.88, sz * (HW + 0.07)); for (const sx of [-1, 1]) { for (const sz of [-1, 1]) H.B(0.05, 0.05, HW - AH.GW / 2 + 0.07, neonMat(NEON.cyan, 1.6), sx * (HL + 0.07), 0.88, sz * (HW / 2 + AH.GW / 4 + 0.035)); H.B(0.02, 0.01, AH.GW, neonMat(NEON.red, 1.4), sx * (HL + 0.06), 0.855, 0); }
    H.B(0.012, 0.004, HW * 2, neonMat(NEON.cyan, 1.0), 0, 0.861, 0); H.add(new THREE.Mesh(new THREE.RingGeometry(0.16, 0.175, 32), neonMat(NEON.cyan, 1.0)), 0, 0.862, 0).rotation.x = -Math.PI / 2;
    const puck = H.C(AH.PKR, AH.PKR, 0.012, neonMat(NEON.red, 2.0), 0, 0.866, 0, 20); const pads = [-1, 1].map((s, i) => { const pm = new THREE.Group(); pm.position.set(s * 0.8, 0.86, 0); tg.add(pm); const pH = helpers(pm); pH.C(AH.PR, AH.PR, 0.03, neonMat(i ? NEON.mag : NEON.green, 1.4), 0, 0.015, 0, 20); pH.C(0.03, 0.035, 0.05, chrome(), 0, 0.055, 0, 12); return pm; });
    const M = { def, kind: "airhockey", g: tg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart, table: idx, lastFrame: -1 };
    const S = M.S = { slow: 0, puck: { x: 0, z: 0, vx: 0, vz: 0 }, pads: [{ x: -0.8, z: 0, vx: 0, vz: 0 }, { x: 0.8, z: 0, vx: 0, vz: 0 }], score: [0, 0], serve: 0, mode: "attract", mine: 0, guest: null, host: null, sentAt: 0, pingAt: 0, aiT: 0, aiX: 0.8, aiZ: 0, bumpAt: 0, seq: 0, netAt: 0 };
    const place = () => { puck.position.set(S.puck.x, 0.866, S.puck.z); for (let i = 0; i < 2; i++) pads[i].position.set(S.pads[i].x, 0.86, S.pads[i].z); };
    const resetPuck = (toward) => { S.puck.x = toward === 0 ? -0.25 : toward === 1 ? 0.25 : 0; S.puck.z = 0; S.puck.vx = 0; S.puck.vz = 0; S.serve = 1.0; };
    const sideSign = (i) => (i ? 1 : -1);
    const clampPad = (i, p) => { const s = sideSign(i); const x0 = s > 0 ? 0.06 : -HL + AH.PR, x1 = s > 0 ? HL - AH.PR : -0.06; p.x = Math.max(x0, Math.min(x1, p.x)); p.z = Math.max(-HW + AH.PR, Math.min(HW - AH.PR, p.z)); };
    const movePad = (i, dx, dz, dt) => { const p = S.pads[i]; const ox = p.x, oz = p.z; p.x += dx; p.z += dz; clampPad(i, p); if (dt > 0) { p.vx = p.vx * 0.5 + ((p.x - ox) / dt) * 0.5; p.vz = p.vz * 0.5 + ((p.z - oz) / dt) * 0.5; } };
    const myInput = (inp, dt) => { const s = sideSign(S.mine); let dx = -s * ((inp.u ? 1 : 0) - (inp.d ? 1 : 0)) * AH.SPD * dt, dz = -s * ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * AH.SPD * dt; if (inp.mdx || inp.mdy) { dx += s * inp.mdy * 0.0035; dz += -s * inp.mdx * 0.0035; } movePad(S.mine, dx, dz, dt); };
    const aiStep = (dt) => { const i = 1 - S.mine, s = sideSign(i), p = S.pads[i], P = S.puck; S.aiT -= dt; if (S.aiT <= 0) { S.aiT = 0.1; const inHalf = P.x * s > 0; const cornered = inHalf && (Math.abs(P.x) > HL - 0.2 || Math.abs(P.z) > HW - 0.16); if (cornered) { S.aiX = s * (HL - 0.42); S.aiZ = -Math.sign(P.z || 1) * 0.12; } else if (inHalf) { S.aiX = P.x + s * 0.09; S.aiZ = P.z + (Math.random() - 0.5) * 0.04; } else { S.aiX = s * (HL - 0.28); S.aiZ = P.z * 0.55; } } const dx = S.aiX - p.x, dz = S.aiZ - p.z, d = Math.hypot(dx, dz), stp = 2.1 * dt; if (d > 1e-4) movePad(i, dx / d * Math.min(d, stp), dz / d * Math.min(d, stp), dt); };
    const goal = (scorer) => { S.score[scorer]++; sfx(scorer === S.mine ? "rank" : "arc_over"); const G = M.game; if (G) G.goals = S.score.slice(); resetPuck(1 - scorer); M.hint = `${S.score[S.mine]} · ${S.score[1 - S.mine]} · first to 5`; if (S.score[scorer] >= 5) finish(scorer); };
    const finish = (winner) => { const G = M.game; if (!G) return; G.over = true; M.state = "over"; M.t = 0; const won = winner === S.mine; const score = S.score[S.mine] * 100 + (won ? 500 : 0); G.score = score; bestUp(M, opts && opts.you, score); const prize = S.mode === "guest" ? (won ? 40 : 0) : S.guest ? (won ? 40 : 0) : (won ? 30 : 0); M.hint = won ? "you win" : "the other side wins"; M.result = { winner, won }; if (S.mode === "host") { netSend(true); act({ t: "hockey", table: idx, op: "leave" }); } if (M.onOver) M.onOver(M, score, prize); };
    const physics = (dt) => { const P = S.puck; if (S.serve > 0) { S.serve -= dt; place(); return; } P.x += P.vx * dt; P.z += P.vz * dt; const f = Math.exp(-0.22 * dt); P.vx *= f; P.vz *= f;
      if (P.z > HW - AH.PKR) { P.z = HW - AH.PKR; P.vz = -Math.abs(P.vz) * 0.92; } if (P.z < -HW + AH.PKR) { P.z = -HW + AH.PKR; P.vz = Math.abs(P.vz) * 0.92; }
      if (P.x > HL - AH.PKR) { if (Math.abs(P.z) < AH.GW / 2) return goal(0); P.x = HL - AH.PKR; P.vx = -Math.abs(P.vx) * 0.92; } if (P.x < -HL + AH.PKR) { if (Math.abs(P.z) < AH.GW / 2) return goal(1); P.x = -HL + AH.PKR; P.vx = Math.abs(P.vx) * 0.92; }
      for (const pd of S.pads) { const dx = P.x - pd.x, dz = P.z - pd.z, d = Math.hypot(dx, dz), min = AH.PR + AH.PKR; if (d < min && d > 1e-4) { const nx = dx / d, nz = dz / d; P.x = pd.x + nx * min; P.z = pd.z + nz * min; const vn = P.vx * nx + P.vz * nz, pvn = pd.vx * nx + pd.vz * nz; if (vn - pvn < 0) { P.vx -= 1.85 * (vn - pvn) * nx; P.vz -= 1.85 * (vn - pvn) * nz; } P.vx += pd.vx * 0.3; P.vz += pd.vz * 0.3; if (performance.now() - S.bumpAt > 120) { S.bumpAt = performance.now(); sfx("bump"); } } }
      P.z = Math.max(-HW + AH.PKR, Math.min(HW - AH.PKR, P.z)); if (Math.abs(P.z) >= AH.GW / 2) P.x = Math.max(-HL + AH.PKR, Math.min(HL - AH.PKR, P.x));
      const sp = Math.hypot(P.vx, P.vz); if (sp > AH.VMAX) { P.vx *= AH.VMAX / sp; P.vz *= AH.VMAX / sp; } if (sp < 0.08) { S.slow += dt; if (S.slow > 1.6) { S.slow = 0; resetPuck(-1); S.serve = 0.6; M.hint = `faceoff · ${S.score[S.mine]} · ${S.score[1 - S.mine]}`; } } else S.slow = 0; };
    const netSend = (force) => { const now = performance.now(); if (!force && now - S.sentAt < 66) return; S.sentAt = now; if (S.mode === "host" && S.guest) send({ type: "signal", to: S.guest, data: { t: "ah", table: idx, p: [S.puck.x, S.puck.z, S.puck.vx, S.puck.vz], a: [S.pads[0].x, S.pads[0].z], b: [S.pads[1].x, S.pads[1].z], s: S.score, st: M.state, w: M.result ? M.result.winner : -1, n: ++S.seq } }); else if (S.mode === "guest" && S.host) send({ type: "signal", to: S.host, data: { t: "ah", table: idx, pad: [S.pads[S.mine].x, S.pads[S.mine].z] } }); };
    M.onNet = (from, d) => { if (S.mode === "host" && from === S.guest && d.pad) { const i = 1 - S.mine; const p = S.pads[i]; const now = performance.now(); const dt = Math.min(0.3, (now - (S.netAt || now)) / 1000) || 0.066; S.netAt = now; const ox = p.x, oz = p.z; p.x = d.pad[0]; p.z = d.pad[1]; clampPad(i, p); p.vx = (p.x - ox) / dt; p.vz = (p.z - oz) / dt; }
      else if (S.mode === "guest" && from === S.host && d.p) { S.puck.x = d.p[0]; S.puck.z = d.p[1]; S.puck.vx = d.p[2]; S.puck.vz = d.p[3]; const i = 1 - S.mine; S.pads[i].x = (i ? d.b : d.a)[0]; S.pads[i].z = (i ? d.b : d.a)[1]; const prev = S.score.slice(); S.score = d.s.slice(); if (M.game) M.game.goals = S.score.slice(); if (S.score[S.mine] > prev[S.mine]) sfx("rank"); else if (S.score[1 - S.mine] > prev[1 - S.mine]) sfx("arc_over"); M.hint = `${S.score[S.mine]} · ${S.score[1 - S.mine]} · first to 5`; if (d.st === "over" && M.state !== "over" && d.w >= 0) finish(d.w); } };
    M.insertCoin = () => { const c = ARC.cab; const end = c && c.end !== undefined ? c.end : 0; const T = hockeyView(idx); const live = T && T.host !== ME; S.mine = end; S.score = [0, 0]; S.pads[0].x = -0.8; S.pads[0].z = 0; S.pads[1].x = 0.8; S.pads[1].z = 0; resetPuck(-1); M.result = null;
      if (live) { S.mode = "guest"; S.host = T.host; act({ t: "hockey", table: idx, op: "join", end }); M.hint = "challenger · W A S D or the mouse · first to 5"; } else { S.mode = "host"; S.guest = null; S.host = null; act({ t: "hockey", table: idx, op: "host", end }); S.pingAt = performance.now(); M.hint = "vs the house · W A S D or the mouse · first to 5"; }
      M.game = { score: 0, over: false, goals: [0, 0] }; M.state = "ready"; M.t = 0; place(); if (M.onStart) M.onStart(M); };
    M.abort = () => { if (S.mode === "host" || S.mode === "guest") act({ t: "hockey", table: idx, op: "leave" }); if (S.mode === "host" && S.guest) netSend(true); S.mode = "attract"; S.guest = null; S.host = null; M.game = null; M.state = "attract"; M.t = 0; M.hint = null; resetPuck(-1); place(); };
    M.step = (dt, inp) => { M.t += dt; const G = M.game;
      if (!G) { S.puck.x = Math.sin(M.t * 0.7) * 0.6; S.puck.z = Math.cos(M.t * 1.1) * 0.3; S.pads[0].x = -0.8 + Math.sin(M.t * 0.9) * 0.1; S.pads[1].x = 0.8 - Math.sin(M.t * 0.9) * 0.1; place(); return; }
      if (M.state === "over") { if (M.t > 4) { if (S.mode === "guest") act({ t: "hockey", table: idx, op: "leave" }); S.mode = "attract"; S.guest = null; S.host = null; M.state = "attract"; M.t = 0; M.game = null; M.hint = null; resetPuck(-1); } place(); return; }
      const T = hockeyView(idx);
      if (S.mode === "host") { const g = T && T.host === ME ? T.guest : null; if (g !== S.guest) { S.guest = g; if (g) { sfx("arc_coin"); setStatus(`${(view.players[g] && view.players[g].name) || "a challenger"} joined the table`); M.hint = `challenger in · ${S.score[S.mine]} · ${S.score[1 - S.mine]} · first to 5`; } else if (M.state === "play") { setStatus("the challenger left · the house takes over"); } } if (performance.now() - S.pingAt > 4000) { S.pingAt = performance.now(); act({ t: "hockey", table: idx, op: "ping" }); } }
      if (S.mode === "guest") { if (!T || T.host !== S.host || (T.guest && T.guest !== ME)) { M.hint = "the host walked away · 20 $GBACK back"; G.over = true; M.state = "over"; M.t = 0; M.result = { winner: -1, won: false }; if (M.onOver) M.onOver(M, S.score[S.mine] * 100, 20); return; } }
      if (M.state === "ready") { if (M.t > 1.5) { M.state = "play"; M.t = 0; resetPuck(-1); } place(); return; }
      if (inp) myInput(inp, dt);
      if (S.mode === "host") { if (!S.guest) aiStep(dt); physics(Math.min(0.05, dt)); netSend(false); }
      else { const P = S.puck; if (S.serve <= 0) { P.x += P.vx * dt; P.z += P.vz * dt; P.x = Math.max(-HL, Math.min(HL, P.x)); P.z = Math.max(-HW, Math.min(HW, P.z)); } netSend(false); }
      G.score = S.score[S.mine] * 100; place(); };
    place(); AH.tables[idx] = M; return M;
  }

  // ── Skee-Ball: A/D aims, hold SPACE for power, release to roll; the ball jumps the hump into the rings
  function SkeeBall(def, opts, g, x, z) {
    const tg = new THREE.Group(); tg.position.set(x, 0.05, z); g.add(tg); const H = helpers(tg); const dark = matte(0x14121c, 0.85), wood = matte(0x7a4a2a, 0.7);
    H.B(0.72, 0.5, 2.5, dark, 0, 0.25, -1.25); H.B(0.62, 0.02, 2.3, wood, 0, 0.51, -1.15); for (const sx of [-1, 1]) H.B(0.05, 0.12, 2.5, matte(0x202028, 0.5), sx * 0.335, 0.56, -1.25); const hump = H.B(0.62, 0.02, 0.4, wood, 0, 0.62, -2.45); hump.rotation.x = 0.55;
    const board = new THREE.Group(); board.position.set(0, 0.7, -2.65); board.rotation.x = 0.95; tg.add(board); const bH = helpers(board); bH.B(0.9, 1.3, 0.06, dark, 0, 0.65, -0.03); const rings = [[0.08, NEON.red, 50], [0.16, NEON.gold, 40], [0.24, NEON.green, 30], [0.32, NEON.cyan, 20]]; for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; const m = new THREE.Mesh(new THREE.RingGeometry(r[0] - 0.012, r[0], 28), neonMat(r[1], 1.2)); m.position.set(0, 0.62, 0.002); board.add(m); } for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.RingGeometry(0.048, 0.06, 20), neonMat(NEON.mag, 1.6)); m.position.set(sx * 0.3, 1.1, 0.002); board.add(m); }
    sign(board, "10  20  30  40  50   100", NEON.gold, 0.8, 0, 1.24, 0.01, 0, { px: 7 });
    const ball = H.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), matte(0x8a6a4a, 0.6)), 0, 0.575, -0.15); const meter = H.B(0.02, 0.02, 0.5, neonMat(NEON.gold, 1.2), 0.42, 0.9, -0.4); meter.scale.z = 0.01;
    const M = { def, kind: "skee", g: tg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    const S = { phase: "aim", aim: 0, pow: 0, charging: false, t: 0, from: null, to: null, arc: 0, pts: 0 };
    const legend = (G) => `ball ${10 - G.balls} of 9 · A D aim · hold SPACE for power`;
    const finish = (G) => { G.over = true; M.state = "over"; M.t = 0; const score = Math.round(G.score); bestUp(M, opts && opts.you, score); M.hint = `${score} points`; if (M.onOver) M.onOver(M, score, def.prize(score)); };
    const landing = (v, aim) => { const L = Math.max(0.05, Math.min(1.0, (v - 2.6) / 2.4)); const lat = aim * 0.3 + (Math.random() - 0.5) * 0.04; let pts = 10; const r = Math.hypot((L - 0.5) * 0.9, lat); if (r < 0.08) pts = 50; else if (r < 0.16) pts = 40; else if (r < 0.24) pts = 30; else if (r < 0.32) pts = 20; if (Math.hypot(Math.abs(lat) - 0.3, (L - 0.86) * 0.9) < 0.07) pts = 100; return { L, lat, pts }; };
    M.insertCoin = () => { M.game = { score: 0, over: false, balls: 9 }; M.state = "ready"; M.t = 0; S.phase = "aim"; S.aim = 0; S.pow = 0; S.charging = false; M.hint = legend(M.game); ball.visible = true; ball.position.set(0, 0.575, -0.15); if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; M.hint = null; S.phase = "aim"; meter.scale.z = 0.01; };
    M.step = (dt, inp) => { M.t += dt; const G = M.game; if (!G) { ball.visible = true; ball.position.set(Math.sin(M.t * 1.3) * 0.2, 0.575, -0.15 - Math.abs(Math.sin(M.t * 0.6)) * 1.9); meter.scale.z = 0.01; return; }
      if (M.state === "ready") { if (M.t > 1.2) { M.state = "play"; M.t = 0; } return; }
      if (M.state === "over") { if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } return; }
      inp = inp || {};
      if (S.phase === "aim") { S.aim = Math.max(-1, Math.min(1, S.aim + ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * 1.8 * dt)); ball.position.set(S.aim * 0.22, 0.575, -0.15); if (inp.a) { S.charging = true; S.pow = Math.min(1, S.pow + dt / 1.1); meter.scale.z = Math.max(0.01, S.pow); M.hint = "power " + "▮".repeat(Math.round(S.pow * 8)) + "▯".repeat(8 - Math.round(S.pow * 8)); } else if (S.charging) { S.charging = false; S.v = 2.6 + S.pow * 2.4; S.phase = "roll"; S.pow = 0; meter.scale.z = 0.01; sfx("swing"); } else M.hint = legend(G); }
      else if (S.phase === "roll") { ball.position.z -= S.v * dt; ball.rotation.x -= S.v * dt / 0.055; if (ball.position.z <= -2.3) { const r = landing(S.v, S.aim); S.pts = r.pts; S.from = ball.position.clone(); const bp = new THREE.Vector3(r.lat, 0.62 + (r.L - 0.5) * 1.0, 0.0); board.localToWorld(bp); tg.worldToLocal(bp); S.to = bp; S.arc = 0; S.phase = "fly"; } }
      else if (S.phase === "fly") { S.arc = Math.min(1, S.arc + dt / 0.55); const k = S.arc; ball.position.lerpVectors(S.from, S.to, k); ball.position.y += Math.sin(k * Math.PI) * 0.5; if (k >= 1) { S.phase = "score"; S.t = 0; G.score += S.pts; M.hint = `+${S.pts}` + (S.pts >= 50 ? " · nice" : ""); sfx(S.pts >= 50 ? "rank" : "blip"); } }
      else if (S.phase === "score") { S.t += dt; ball.position.y -= dt * 0.4; if (S.t > 0.45) { ball.visible = false; S.phase = "return"; S.t = 0; } }
      else if (S.phase === "return") { S.t += dt; if (S.t > 0.7) { G.balls--; if (G.balls <= 0) return finish(G); ball.visible = true; ball.position.set(S.aim * 0.22, 0.575, -0.15); S.phase = "aim"; M.hint = legend(G); } } };
    return M;
  }

  // ── Hoops: hold SPACE for power (the meter swings), A/D aims, release to shoot; 45 seconds, 2 a basket, 3 in the last 15
  function Hoops(def, opts, g, x, z) {
    const tg = new THREE.Group(); tg.position.set(x, 0.05, z); g.add(tg); const H = helpers(tg); const dark = matte(0x14121c, 0.85), steel = chrome();
    H.B(1.3, 0.06, 2.6, dark, 0, 0.03, -0.3); for (const sx of [-1, 1]) { H.B(0.06, 3.1, 0.06, steel, sx * 0.62, 1.55, -1.5); H.B(0.06, 3.1, 0.06, steel, sx * 0.62, 1.55, 0.6); H.B(0.06, 0.06, 2.1, steel, sx * 0.62, 3.1, -0.45); }
    H.B(1.1, 0.8, 0.04, new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5 }), 0, 2.45, -1.32); H.B(0.5, 0.36, 0.045, neonMat(NEON.red, 0.9), 0, 2.36, -1.315); H.B(0.44, 0.3, 0.05, new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5 }), 0, 2.36, -1.316);
    const rim = H.add(new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.014, 8, 28), neonMat(NEON.orange, 1.2)), 0, 2.3, -1.06); rim.rotation.x = Math.PI / 2; const net = H.add(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.32, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true })), 0, 2.13, -1.06);
    sign(tg, "HOOPS", NEON.orange, 0.9, 0, 3.0, -1.35, 0, { px: 8 });
    const ball = H.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.8 })), 0, 1.25, 1.2); const meter = H.B(0.03, 1.0, 0.03, neonMat(NEON.gold, 1.2), 0.66, 1.4, 0.6); meter.scale.y = 0.01;
    const M = { def, kind: "hoops", g: tg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    const S = { phase: "hold", aim: 0, pow: 0, holdT: 0, charging: false, b: { x: 0, y: 1.25, z: 1.2, vx: 0, vy: 0, vz: 0 }, t: 0, scored: false, aboveRim: false };
    const finish = (G) => { G.over = true; M.state = "over"; M.t = 0; const score = Math.round(G.score); bestUp(M, opts && opts.you, score); M.hint = `${score} points · ${G.made} basket${G.made === 1 ? "" : "s"}`; if (M.onOver) M.onOver(M, score, def.prize(score)); };
    const legend = (G) => `${Math.ceil(G.timer)} s · hold SPACE, release at the top of the meter` + (G.timer <= 15 ? " · baskets worth 3" : "");
    M.insertCoin = () => { M.game = { score: 0, over: false, timer: 45, made: 0, shots: 0 }; M.state = "ready"; M.t = 0; S.phase = "hold"; S.aim = 0; S.pow = 0; S.charging = false; ball.visible = true; ball.position.set(0, 1.25, 1.2); M.hint = legend(M.game); if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; M.hint = null; S.phase = "hold"; meter.scale.y = 0.01; ball.visible = true; ball.position.set(0, 1.25, 1.2); };
    M.step = (dt, inp) => { M.t += dt; const G = M.game; if (!G) { ball.visible = true; ball.position.set(0, 1.25 + Math.abs(Math.sin(M.t * 2)) * 0.15, 1.2); meter.scale.y = 0.01; return; }
      if (M.state === "ready") { if (M.t > 1.2) { M.state = "play"; M.t = 0; } return; }
      if (M.state === "over") { if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } return; }
      inp = inp || {}; G.timer -= dt; if (G.timer <= 0) { G.timer = 0; return finish(G); }
      if (S.phase === "hold") { ball.position.set(0, 1.25, 1.2);
        if (inp.a) { S.charging = true; S.holdT += dt; S.pow = 0.5 - 0.5 * Math.cos(S.holdT * 4.2); meter.scale.y = Math.max(0.01, S.pow); M.hint = "power " + "▮".repeat(Math.round(S.pow * 8)) + "▯".repeat(8 - Math.round(S.pow * 8)); }
        else if (S.charging) { S.charging = false; S.holdT = 0; const v0 = 3.6 + S.pow * 2.3, ang = 1.0; const b = S.b; b.x = 0; b.y = 1.25; b.z = 1.2; b.vx = (Math.random() - 0.5) * 0.08; b.vy = v0 * Math.sin(ang); b.vz = -v0 * Math.cos(ang); S.phase = "fly"; S.t = 0; S.scored = false; S.aboveRim = false; G.shots++; meter.scale.y = 0.01; sfx("swing"); }
        else M.hint = legend(G); }
      else if (S.phase === "fly") { const b = S.b; S.t += dt; b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.z < -1.32 + 0.12 && b.y > 2.05 && b.y < 2.85 && b.vz < 0) { b.z = -1.32 + 0.12; b.vz = -b.vz * 0.45; b.vx *= 0.8; sfx("bump"); }
        const dr = Math.hypot(b.x, b.z + 1.06); if (b.y > 2.3 + 0.12) S.aboveRim = true; if (!S.scored && S.aboveRim && b.vy < 0 && b.y <= 2.3 && b.y > 2.3 - 0.2) { if (dr < 0.17) { S.scored = true; const pts = G.timer <= 15 ? 3 : 2; G.score += pts; G.made++; M.hint = `+${pts} · swish`; sfx("rank"); b.vx *= 0.2; b.vz *= 0.2; b.vy = -1.2; } else if (dr < 0.23 + 0.12 && dr > 0.23 - 0.12) { const nx = b.x / (dr || 1), nz = (b.z + 1.06) / (dr || 1); b.vx += nx * 1.2; b.vz += nz * 1.2; b.vy = Math.abs(b.vy) * 0.35; sfx("bump"); } }
        ball.position.set(b.x, b.y, b.z); if (b.y < 0.12 || S.t > 3.2) { S.phase = "reset"; S.t = 0; if (!S.scored) M.hint = "miss"; } }
      else if (S.phase === "reset") { S.t += dt; if (S.t > 0.8) { S.phase = "hold"; ball.position.set(0, 1.25, 1.2); M.hint = legend(G); } } };
    return M;
  }

  // ── Boxer: the meter sweeps up and down, faster each punch; SPACE at the peak. Three punches, up to 999 each.
  function Boxer(def, opts, g, x, z) {
    const tg = new THREE.Group(); tg.position.set(x, 0.05, z); g.add(tg); const H = helpers(tg); const dark = matte(0x14121c, 0.85), steel = chrome();
    H.B(1.2, 0.5, 0.8, dark, 0, 0.25, -0.5); for (const sx of [-1, 1]) H.B(0.08, 2.6, 0.08, steel, sx * 0.5, 1.8, -0.7); H.B(1.1, 0.08, 0.08, steel, 0, 3.05, -0.7);
    const piv = new THREE.Group(); piv.position.set(0, 3.0, -0.55); tg.add(piv); const pH = helpers(piv); pH.C(0.012, 0.012, 0.6, steel, 0, -0.3, 0, 6); pH.C(0.19, 0.16, 0.62, new THREE.MeshStandardMaterial({ color: 0xc9262b, roughness: 0.55 }), 0, -0.92, 0, 18); pH.C(0.2, 0.2, 0.05, chrome(), 0, -0.62, 0, 18);
    const NL = 20, lg = new THREE.BoxGeometry(0.16, 0.05, 0.03), lm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); const lights = new THREE.InstancedMesh(lg, lm, NL); lights.userData.noSolid = true; { const M4 = new THREE.Matrix4(); for (let i = 0; i < NL; i++) { M4.makeTranslation(-0.5, 0.62 + i * 0.115, -0.64); lights.setMatrixAt(i, M4); lights.setColorAt(i, JC.dim); } } tg.add(lights);
    sign(tg, "BOXER", NEON.red, 0.9, 0, 3.25, -0.72, 0, { px: 8, blink: 1.2 });
    const M = { def, kind: "boxer", g: tg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    const S = { m: 0, dir: 1, speed: 0.9, swing: 0, swingV: 0, hold: 0 }; const C = new THREE.Color();
    const paint = (m, flash) => { const lit = Math.round(m * NL); for (let i = 0; i < NL; i++) { if (flash) C.copy(JC.top).multiplyScalar(0.3 + 0.7 * flash); else C.copy(i < lit ? (i >= NL - 3 ? JC.top : i >= NL - 8 ? JC.chase : JC.lit) : JC.dim); lights.setColorAt(i, C); } lights.instanceColor.needsUpdate = true; };
    const finish = (G) => { G.over = true; M.state = "over"; M.t = 0; const score = Math.round(G.score); bestUp(M, opts && opts.you, score); M.hint = `${score} total`; if (M.onOver) M.onOver(M, score, def.prize(score)); };
    const legend = (G) => `punch ${4 - G.punches} of 3 · SPACE at the top of the meter`;
    M.insertCoin = () => { M.game = { score: 0, over: false, punches: 3, flash: 0 }; M.state = "ready"; M.t = 0; S.m = 0; S.dir = 1; S.speed = 0.9; S.hold = 0; M.hint = legend(M.game); if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; M.hint = null; };
    M.step = (dt, inp) => { M.t += dt; S.swingV -= S.swing * 9 * dt; S.swingV *= Math.exp(-1.6 * dt); S.swing += S.swingV * dt; piv.rotation.x = S.swing; const G = M.game;
      if (!G) { paint(0.5 + 0.5 * Math.sin(M.t * 1.5), 0); return; }
      if (M.state === "ready") { if (M.t > 1.0) { M.state = "play"; M.t = 0; } paint(0, 0); return; }
      if (M.state === "over") { G.flash = Math.max(0, G.flash - dt); paint(1, G.flash > 0 ? 0.5 + 0.5 * Math.sin(M.t * 12) : 0); if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } return; }
      if (S.hold > 0) { S.hold -= dt; paint(S.m, 0); if (S.hold <= 0) { G.punches--; if (G.punches <= 0) return finish(G); S.speed *= 1.35; S.m = 0; S.dir = 1; M.hint = legend(G); } return; }
      S.m += S.dir * S.speed * dt; if (S.m >= 1) { S.m = 1; S.dir = -1; } if (S.m <= 0) { S.m = 0; S.dir = 1; }
      if (inp && inp.ja) { const pts = Math.round(S.m * 999); G.score += pts; S.swingV = -(0.6 + S.m * 1.6); S.hold = 1.3; M.hint = `${pts}` + (pts >= 950 ? " · KNOCKOUT" : pts >= 800 ? " · big hit" : ""); sfx(pts >= 800 ? "rank" : "bump"); if (pts >= 950) G.flash = 1; }
      paint(S.m, 0); };
    return M;
  }

  // The real claw: a gantry, carriage and three-finger claw inside the open cabinet; the catchable plush sit on top of the model's own plush pile (dims.y0 is the pile top)
  function ClawMachine(def, opts, cg, dims) {
    const bw = dims.w, bd = dims.d, y0 = dims.y0, y1 = dims.y1; const mech = new THREE.Group(); cg.add(mech);
    const steel = chrome(); const railM = matte(0x1a1a22, 0.5);
    for (const z of [-bd, bd]) { const r = new THREE.Mesh(new THREE.BoxGeometry(bw * 2 + 0.1, 0.03, 0.03), railM); r.position.set(0, y1, z); mech.add(r); }
    const car = new THREE.Group(); mech.add(car); const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, bd * 2 + 0.06), railM); bridge.position.y = y1; car.add(bridge);
    const head = new THREE.Group(); car.add(head); head.position.y = y1 - 0.02; const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), steel); head.add(cable);
    const claw = new THREE.Group(); head.add(claw); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 12), steel); hub.position.y = -0.02; claw.add(hub);
    const fingers = []; for (let i = 0; i < 3; i++) { const piv = new THREE.Group(); piv.rotation.y = i * 2.094; claw.add(piv); const f = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.012), steel); f.position.set(0.028, -0.075, 0); f.rotation.z = 0.5; piv.add(f); fingers.push(f); }
    const PSZ = [0.05, 0.065, 0.085], PPTS = [150, 250, 450], PODD = [0.85, 0.72, 0.55], COLS = [0xff9180, 0xf4cd5a, 0x4dde6f, 0x8fd8ff, 0xc7b6ff, 0xff9e4a, 0xff3ad6];
    const plush = []; const spawn = (p) => { let tries = 20; do { p.x = (Math.random() * 2 - 1) * (bw - p.r - 0.02); p.z = (Math.random() * 2 - 1) * (bd - p.r - 0.02); tries--; } while (tries > 0 && (Math.hypot(p.x + bw - 0.06, p.z - bd + 0.06) < 0.13 || plush.some((q) => q !== p && q.m.visible && Math.hypot(q.x - p.x, q.z - p.z) < q.r + p.r))); p.m.position.set(p.x, y0 + p.r, p.z); p.m.visible = true; p.held = false; };
    for (let i = 0; i < 9; i++) { const s = i % 3; const m = new THREE.Mesh(new THREE.SphereGeometry(PSZ[s], 12, 10), new THREE.MeshStandardMaterial({ color: COLS[i % COLS.length], roughness: 0.95 })); mech.add(m); const p = { m, r: PSZ[s], s, x: 0, z: 0, held: false }; plush.push(p); spawn(p); }
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.12), neonMat(NEON.mag, 1.6)); chute.position.set(-bw + 0.06, y0 + 0.004, bd - 0.06); mech.add(chute);
    const M = { def, kind: "grab", g: cg, state: "attract", t: 0, game: null, best: (opts && opts.best) || null, canvas: null, hint: null, onOver: opts && opts.onOver, onStart: opts && opts.onStart };
    const S = { x: 0, z: 0, y: y1 - 0.1, open: 1, phase: "idle", pt: 0, held: null }; const setOpen = (k) => { for (const f of fingers) f.rotation.z = 0.15 + 0.45 * k; };
    const place = () => { car.position.x = S.x; head.position.z = S.z; claw.position.y = S.y - (y1 - 0.02); cable.scale.y = Math.max(0.01, (y1 - 0.02) - S.y); cable.position.y = -cable.scale.y / 2; setOpen(S.open); if (S.held) S.held.m.position.set(S.x, S.y - 0.09 - S.held.r * 0.4, S.z); };
    const dropHint = (G) => `drop ${4 - G.drops} of 3 · W A S D to move · SPACE to drop`;
    const finish = (G) => { G.over = true; M.state = "over"; M.t = 0; const score = Math.round(G.score); bestUp(M, opts && opts.you, score); M.hint = `${G.caught} of 3 caught · ${score} points`; if (M.onOver) M.onOver(M, score, def.prize(score)); };
    M.insertCoin = () => { M.game = { score: 0, over: false, drops: 3, caught: 0 }; M.state = "ready"; M.t = 0; S.phase = "idle"; S.x = 0; S.z = 0; S.y = y1 - 0.1; S.open = 1; S.held = null; M.hint = dropHint(M.game); place(); if (M.onStart) M.onStart(M); };
    M.abort = () => { M.game = null; M.state = "attract"; M.t = 0; M.hint = null; if (S.held) { S.held.held = false; spawn(S.held); S.held = null; } S.phase = "idle"; S.y = y1 - 0.1; S.open = 1; place(); };
    M.step = (dt, inp) => { M.t += dt; const G = M.game;
      if (!G) { S.x = Math.sin(M.t * 0.6) * (bw - 0.08); S.z = Math.cos(M.t * 0.45) * (bd - 0.08); S.open = 0.6 + 0.4 * Math.sin(M.t * 2); place(); return; }
      if (M.state === "ready") { if (M.t > 1.2) { M.state = "play"; M.t = 0; } place(); return; }
      if (M.state === "over") { if (M.t > 4) { M.state = "attract"; M.t = 0; M.game = null; M.hint = null; } return; }
      const sp = 0.26 * dt;
      if (S.phase === "idle") { if (inp) { if (inp.l) S.x -= sp; if (inp.r) S.x += sp; if (inp.u) S.z -= sp; if (inp.d) S.z += sp; } S.x = Math.max(-bw + 0.06, Math.min(bw - 0.06, S.x)); S.z = Math.max(-bd + 0.06, Math.min(bd - 0.06, S.z)); if (inp && inp.ja) { S.phase = "drop"; M.hint = "dropping"; sfx("arc_start"); } }
      else if (S.phase === "drop") { S.y -= 0.5 * dt; if (S.y <= y0 + 0.075) { S.y = y0 + 0.075; S.phase = "close"; S.pt = 0.4; } }
      else if (S.phase === "close") { S.pt -= dt; S.open = Math.max(0, S.pt / 0.4); if (S.pt <= 0) { let best = null, bd2 = 0.09; for (const p of plush) if (p.m.visible && !p.held) { const d = Math.hypot(p.x - S.x, p.z - S.z); if (d < bd2) { bd2 = d; best = p; } } if (best && Math.random() < PODD[best.s]) { best.held = true; S.held = best; sfx("rank"); M.hint = "got one · carrying it to the chute"; } else { sfx("arc_over"); M.hint = best ? "slipped out" : "missed"; } S.phase = "lift"; } }
      else if (S.phase === "lift") { S.y += 0.5 * dt; if (S.y >= y1 - 0.1) { S.y = y1 - 0.1; S.phase = S.held ? "carry" : "done"; S.pt = 0.5; } }
      else if (S.phase === "carry") { const tx = -bw + 0.06, tz = bd - 0.06; const dx = tx - S.x, dz = tz - S.z, d = Math.hypot(dx, dz); const stp = 0.42 * dt; if (d <= stp) { S.x = tx; S.z = tz; S.phase = "release"; S.pt = 0.5; } else { S.x += dx / d * stp; S.z += dz / d * stp; } }
      else if (S.phase === "release") { S.pt -= dt; S.open = Math.min(1, 1 - S.pt / 0.5); if (S.pt <= 0) { const p = S.held; S.held = null; p.held = false; p.m.visible = false; G.score += PPTS[p.s]; G.caught++; sfx("arc_prize"); M.hint = `+${PPTS[p.s]}`; setTimeout(() => spawn(p), 2500); S.phase = "done"; S.pt = 0.4; } }
      else if (S.phase === "done") { S.open = Math.min(1, S.open + dt * 3); S.pt -= dt; if (S.pt <= 0) { G.drops--; if (G.drops <= 0) finish(G); else { S.phase = "idle"; M.hint = dropHint(G); } } }
      place();
    };
    place(); return M;
  }

  // ───────── the room ─────────
  R.AISLES = [];
  R.build = function (g, half, hgt) {
    R.half = half; R.hgt = hgt; R.blink = []; R.pinballs = []; R.towers = []; R.led = null; R.AISLES = []; const H = helpers(g); const T = tubeSet(); const you = (view && view.players[ME] && view.players[ME].name) || "you";
    const dark = matte(0x14121c, 0.85), steel = chrome(), rubber = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.95 });
    // ceiling neon: perimeter rails in three colours, two big triangles and a bar like the reference photo, chevrons down the centre
    const yC = hgt - 0.14; for (const [col, inset] of [[NEON.blue, 0.6], [NEON.mag, 1.3], [NEON.orange, 2.0]]) { const a = half - inset; T.seg([-a, yC, -a], [a, yC, -a], col); T.seg([a, yC, -a], [a, yC, a], col); T.seg([a, yC, a], [-a, yC, a], col); T.seg([-a, yC, a], [-a, yC, -a], col); }
    const tri = (cx, cz, s, col) => { const p = [[cx - s, cz + s * 0.6], [cx + s, cz + s * 0.6], [cx, cz - s * 0.9]]; for (let i = 0; i < 3; i++) T.seg([p[i][0], yC - 0.25, p[i][1]], [p[(i + 1) % 3][0], yC - 0.25, p[(i + 1) % 3][1]], col, 0.06); }; tri(-13, 10, 6, NEON.blue); tri(13, 10, 6, NEON.blue); tri(0, -8, 8, NEON.cyan); for (let i = 0; i < 5; i++) { const z = 20 - i * 9; T.seg([-5, yC - 0.4, z + 1.5], [0, yC - 0.4, z - 1.5], NEON.orange, 0.06); T.seg([0, yC - 0.4, z - 1.5], [5, yC - 0.4, z + 1.5], NEON.orange, 0.06); }
    // wall stripes at three heights, the doorway framed in green
    for (const [col, y] of [[NEON.mag, 3.3], [NEON.blue, 3.55], [NEON.orange, 3.8]]) { for (const side of [-1, 1]) T.seg([side * (half - 0.12), y, -half + 0.3], [side * (half - 0.12), y, half - 0.3], col); T.seg([-half + 0.3, y, -half + 0.12], [half - 0.3, y, -half + 0.12], col); }
    for (const sx of [-1, 1]) T.seg([sx * 3.9, 0.1, half - 0.3], [sx * 3.9, hgt - 3.4, half - 0.3], NEON.green, 0.07); T.seg([-3.9, hgt - 3.4, half - 0.3], [3.9, hgt - 3.4, half - 0.3], NEON.green, 0.07);
    // marquee and the inside welcome sign
    sign(g, "GENESIS ARCADE", NEON.green, 16, 0, hgt - 1.3, -half + 0.22, 0, { k: 3.2 }); sign(g, "INSERT COIN", NEON.gold, 5, 0, hgt - 2.5, -half + 0.22, 0, { blink: 1.6 });
    sign(g, "PLAYS 20 · PRIZES TO 60 $GBACK", NEON.gold, 8, 0, hgt - 2.6, half - 0.22, Math.PI, { px: 8 });
    // zone signs on the walls
    sign(g, "CABINET ROW", NEON.cyan, 6, 0, 5.0, -half + 0.22, 0); sign(g, "PINBALL ALLEY", NEON.mag, 6.5, -half + 0.22, 5.2, 8, Math.PI / 2); sign(g, "THE FLOOR IS LAVA", NEON.orange, 11, -18, 5.2, -half + 0.22, 0, { blink: 0.5 }); sign(g, "PRIZE LANE", NEON.mag, 5.5, 20, 5.9, -half + 0.22, 0); sign(g, "JUMP ZONE", NEON.orange, 6, half - 0.22, 5.4, -3, -Math.PI / 2); sign(g, "MULTIPLAYER", NEON.blue, 7, half - 0.22, 5.4, 14, -Math.PI / 2, { blink: 2.4 });
    // high-score board beside the prize counter
    ARC.board = H.label([{ text: "HIGH SCORES", size: 70, y: 0.12, color: "#f4cd5a" }], 7, 5.2, half - 4.4, 3.0, -half + 0.3, 0, "#0a1610", "#4DDE6F"); ARC.board.userData.w = 7; ARC.board.userData.h = 5.2;
    // change machine and benches by the door
    H.B(0.8, 1.9, 0.6, dark, -half + 2.4, 0.95, half - 3); H.label([{ text: "$GBACK", size: 90, y: 0.35, color: "#4DDE6F" }, { text: "TOKENS", size: 70, y: 0.7, color: "#f4cd5a" }], 0.7, 0.7, -half + 2.4, 1.35, half - 2.68, 0, "#0a1610", "#4DDE6F"); H.B(0.9, 2.0, 0.7, steel, -half + 3.6, 1.0, half - 3); H.B(0.8, 1.5, 0.05, glassMat(), -half + 3.6, 1.15, half - 2.64);
    for (const bx of [-9, 9]) { H.B(3, 0.1, 0.5, dark, bx, 0.48, half - 2.2); H.B(3, 0.5, 0.06, dark, bx, 0.72, half - 1.96); for (const lx of [-1.3, 1.3]) H.B(0.08, 0.45, 0.45, steel, bx + lx, 0.24, half - 2.2); }
    // ── Cabinet Row: three back-to-back islands down the centre
    registerDefs(); D2.lava = null; D2.jacks = []; D2.claws = []; LV.host = null; LV.part = null; LV.seen = null;
    const uprights = ARCADE.GAMES.filter((d) => !CAB_KIND[d.id]); let ui = 0; const next = () => uprights[(ui++) % uprights.length]; const cabKind = MODELS.cab2 ? "cab2" : "cab";
    const island = (z0, n, sp) => { for (let i = 0; i < n; i++) { const lx = (i - (n - 1) / 2) * sp; R.placeCab(g, cabKind, next(), lx, z0 + 0.42, 0, you); R.placeCab(g, cabKind, next(), lx, z0 - 0.42, Math.PI, you); } R.AISLES.push(z0 + 4.5); };
    island(15, 9, 1.5); island(5, 9, 1.5); island(-5, 9, 1.5); R.AISLES.push(-9.5);
    // ── Pinball Alley along the left wall: eight real tables facing the aisle
    const pinDef = ARCADE.byId("pinball") || { id: "pinball", name: "GENESIS PINBALL", tag: "Classic", color: "#f4cd5a", blurb: "Three balls.", keys: "◀ ▶ flippers · hold A to launch", prize: (s) => Math.min(60, Math.floor(s / 90)) };
    for (let i = 0; i < 8; i++) { const lz = 18 - i * 2.35; const M = Pinball3D(pinDef, { you, best: bestFor(pinDef.id), onOver: arcadeOver, onStart: () => sfx("arc_start") }); M.g.position.set(-half + 1.05, 0.05, lz); M.g.rotation.y = Math.PI / 2; g.add(M.g); ARC.cabs.push({ kind: "pinball2", def: pinDef, M, tex: null, g: M.g, scr: null, lx: -half + 1.05, lz, ry: Math.PI / 2, i: ARC.cabs.length }); R.pinballs.push(M); }
    T.seg([-half + 0.2, 2.6, 19.6], [-half + 0.2, 2.6, -1.4], NEON.mag, 0.05);
    // ── the Lava Room: LED grid fenced by a low neon rail with the gate at the front
    const LCX = -18, LCZ = -20, LN = 12, LT = 1.45; ledFloor(g, LCX, LCZ, LN, LT); const L2 = LN * LT / 2 + 0.6; const postM = matte(0x202028, 0.5); const rail = (x1, z1, x2, z2) => { T.seg([x1, 0.92, z1], [x2, 0.92, z2], NEON.red, 0.05); H.B(0.06, 0.9, 0.06, postM, x1, 0.45, z1); }; rail(LCX - L2, LCZ - L2, LCX + L2, LCZ - L2); rail(LCX + L2, LCZ - L2, LCX + L2, LCZ + L2); rail(LCX - L2, LCZ + L2, LCX - L2, LCZ - L2); rail(LCX - L2, LCZ + L2, LCX - 2, LCZ + L2); rail(LCX + 2, LCZ + L2, LCX + L2, LCZ + L2); H.B(0.06, 0.9, 0.06, postM, LCX + L2, 0.45, LCZ + L2);
    sign(g, "FLOOR IS LAVA · 20 $GBACK · ROUNDS SHARED", NEON.red, 5, LCX, 1.6, LCZ + L2 + 0.05, 0, { px: 8, blink: 1.1 });
    { const gate = new THREE.Group(); gate.position.set(LCX, 0.05, LCZ + L2 + 1.6); g.add(gate); const pad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), neonMat(NEON.red, 1.4)); pad.position.set(0, 0.03, 1.0); pad.userData.noSolid = true; gate.add(pad); const M = LavaMachine(DEFS2.lava, { you, best: bestFor("lava"), onOver: arcadeOver, onStart: () => sfx("arc_start") }); D2.lava = M; ARC.cabs.push({ kind: "lava", def: DEFS2.lava, M, tex: null, g: gate, scr: null, lx: LCX, lz: LCZ + L2 + 1.6, ry: 0, i: ARC.cabs.length }); }
    // ── Prize Lane at the back right: the counter model (or the old procedural one), plush shelves
    if (MODELS.prizecounter) { const pc = makeModel("prizecounter"); pc.position.set(half - 12, 0.05, -half + 1.5); g.add(pc); } else { H.B(9, 1.05, 0.9, dark, half - 12, 0.52, -half + 3.2); H.B(9, 0.06, 1.0, steel, half - 12, 1.07, -half + 3.2); H.B(9, 2.2, 0.35, dark, half - 12, 1.1, -half + 0.4); for (let k = 0; k < 3; k++) H.B(8.6, 0.05, 0.5, steel, half - 12, 1.4 + k * 0.6, -half + 0.6); const cols = [0xff9180, 0xf4cd5a, 0x4dde6f, 0x8fd8ff, 0xc7b6ff, 0xff9e4a]; for (let k = 0; k < 3; k++) for (let i = 0; i < 12; i++) { const m = new THREE.MeshStandardMaterial({ color: cols[(i + k) % cols.length], roughness: 0.95 }); H.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m), half - 16 + i * 0.7, 1.58 + k * 0.6, -half + 0.6); } }
    // the two screen claws flank the prize counter; the two open-cabinet claws by the door are the real ones (Drop 2)
    const clawDef = ARCADE.byId("claw"); if (clawDef) { R.placeCab(g, "claw", clawDef, 9, -half + 2.4, 0, you); R.placeCab(g, "claw", clawDef, 12.5, -half + 2.4, 0, you); }
    if (MODELS.claw2) cutPlayfield("claw2", { hw: 0.45, z0: 0.5, z1: -0.5, y0: 1.28, y1: 1.85 });
    if (MODELS.claw2) for (const sx of [-1, 1]) { const c = makeModel("claw2"); c.position.set(sx * 7.5, 0.05, half - 4.2); const ry = sx < 0 ? Math.PI / 2 : -Math.PI / 2; c.rotation.y = ry; g.add(c); sign(g, "REAL CLAW", NEON.mag, 1.6, sx * 7.5, 2.55, half - 4.2, ry, { px: 8, blink: 1.3 });
      const md = MODELS.claw2; const dims = { w: Math.max(0.2, md.sx * 0.34), d: Math.max(0.16, md.sz * 0.30), y0: md.height * 0.575, y1: md.height * 0.8 }; const M = ClawMachine(DEFS2.grab, { you, best: bestFor("grab"), onOver: arcadeOver, onStart: () => sfx("arc_start") }, c, dims); D2.claws.push(M); ARC.cabs.push({ kind: "grab", def: DEFS2.grab, M, tex: null, g: c, scr: null, lx: sx * 7.5, lz: half - 4.2, ry, i: ARC.cabs.length }); }
    // ── Jump Zone on the right wall: three Jumpin' Jackpot towers (light column on the face, pad toward the aisle), rubber floor
    { const fl = new THREE.Mesh(new THREE.PlaneGeometry(10, 16), rubber); fl.rotation.x = -Math.PI / 2; fl.position.set(half - 5.2, 0.055, -3); g.add(fl); for (let i = 0; i < 3; i++) { const z = -9 + i * 6; const tg = new THREE.Group(); tg.position.set(half - 3.2, 0.05, z); tg.rotation.y = -Math.PI / 2; g.add(tg); let faceZ = 0.3; if (MODELS.jackpot) { const t = makeModel("jackpot"); tg.add(t); R.towers.push(t); faceZ = Math.max(0.12, MODELS.jackpot.sz * 0.5 + 0.02); } else { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.5), dark); b.position.set(0, 1.3, -1.8); tg.add(b); faceZ = -1.53; } const rg = new THREE.Group(); rg.position.set(half - 3.2, 0.05, z); g.add(rg);
        const M = JackpotMachine(DEFS2.jackpot, { you, best: bestFor("jackpot"), onOver: arcadeOver, onStart: () => sfx("arc_start") }, tg, faceZ, rg, [half - 3.2, z]); D2.jacks.push(M); ARC.cabs.push({ kind: "jackpot", def: DEFS2.jackpot, M, tex: null, g: tg, scr: null, lx: half - 3.2, lz: z, ry: -Math.PI / 2, i: ARC.cabs.length }); } sign(g, "JUMPIN' JACKPOT · JUMP THE LIGHT", NEON.red, 5.5, half - 0.22, 3.0, -3, -Math.PI / 2, { px: 8, blink: 0.9 }); }
    // ── Multiplayer Corner: racers and two air-hockey table shells
    const dash = ARCADE.byId("dash"); if (dash) for (let i = 0; i < 3; i++) R.placeCab(g, "racer", dash, half - 3.4, 8 + i * 2.7, -Math.PI / 2, you);
    AH.tables = []; [17, 21].forEach((z, i) => { const cx = half - 8; const M = HockeyTable(DEFS2.airhockey, { you, best: bestFor("airhockey"), onOver: arcadeOver, onStart: () => sfx("arc_start") }, g, cx, z, i); for (const end of [0, 1]) { const eg = new THREE.Group(); eg.position.set(cx + (end ? 1.15 : -1.15), 0.05, z); eg.rotation.y = end ? Math.PI / 2 : -Math.PI / 2; g.add(eg); ARC.cabs.push({ kind: "airhockey", def: DEFS2.airhockey, M, tex: null, g: eg, scr: null, lx: cx + (end ? 1.15 : -1.15), lz: z, ry: eg.rotation.y, i: ARC.cabs.length, end, table: i }); } });
    sign(g, "AIR HOCKEY · FIRST TO 5", NEON.cyan, 4.2, half - 0.22, 2.6, 19, -Math.PI / 2, { px: 8 });
    // ── Drop 4 along the back wall: three Skee-Ball lanes, two Hoops units, the Boxer
    { const mk = (kind, F, x, z) => { const M = F(DEFS2[kind], { you, best: bestFor(kind), onOver: arcadeOver, onStart: () => sfx("arc_start") }, g, x, z); ARC.cabs.push({ kind, def: DEFS2[kind], M, tex: null, g: M.g, scr: null, lx: x, lz: z, ry: 0, i: ARC.cabs.length }); return M; };
      for (const x of [-7.2, -6.0, -4.8]) mk("skee", SkeeBall, x, -half + 3.7); sign(g, "SKEE-BALL", NEON.gold, 3.4, -6, 4.2, -half + 0.22, 0, { px: 8 });
      for (const x of [-2.6, -0.9]) mk("hoops", Hoops, x, -half + 2.1); mk("boxer", Boxer, 1.4, -half + 1.4); }
    T.build(g); ARC.enteredAt = performance.now(); updateArcadeBoard(true);
  };
  // a screen cabinet with its canvas game, same contract the old furnishArcade used
  R.placeCab = function (g, kind, def, lx, lz, ry, you) { if (!MODELS[kind] || !def) return; const m = makeModel(kind); m.position.set(lx, 0.05, lz); m.rotation.y = ry; g.add(m); const sc = SCREEN[kind]; const M = ARCADE.Machine(def, { you, best: bestFor(def.id), onOver: arcadeOver, onStart: () => sfx("arc_start") }); const tex = new THREE.CanvasTexture(M.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; const scr = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); scr.position.set(sc.x, sc.y, sc.z); scr.rotation.x = -sc.tilt; m.add(scr); const mq = sc.marquee || [0, 1.93, 0.08]; const marq = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.16), new THREE.MeshBasicMaterial({ map: textTexture([{ text: def.name, size: 92, y: 0.52, color: def.color }], 512, 112, { bg: "#07110b", border: def.color }), toneMapped: false })); marq.position.set(mq[0], mq[1], mq[2]); m.add(marq); ARC.cabs.push({ kind, def, M, tex, g: m, scr, lx, lz, ry, i: ARC.cabs.length }); };
  // per-frame: LED floor cycle, sign blink, attract chatter from nearby cabinets
  R.update = function (dt) { R.t += dt; if ((FRAME_N % 3) === 0) ledUpdate(dt * 3); lavaTick(dt); if ((FRAME_N % 10) === 0) for (const c of ARC.cabs) if (c.kind === "airhockey") { const T = hockeyView(c.table); c.busy = !!(T && T.host !== ME && (c.end === T.hostEnd || (T.guest && T.guest !== ME))); } for (const b of R.blink) b.mat.emissiveIntensity = b.k * (Math.sin(R.t * b.rate * 6.283 + b.ph) > -0.2 ? 1 : 0.08);
    if (typeof soundOn !== "undefined" && soundOn && performance.now() - R.sfxAt > 1400) { R.sfxAt = performance.now() + Math.random() * 1200; const near = ARC.cabs.filter((c) => c.kind !== "pinball2" && (!ARC.on || c !== ARC.cab)); if (near.length) { const c = near[Math.floor(Math.random() * near.length)]; const f = c.g.getWorldPosition(new THREE.Vector3()); const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z); if (d < 12) { const v = 0.02 * (1 - d / 12); const seq = [[880, 0.05], [1320, 0.05], [660, 0.08]][Math.floor(Math.random() * 3)]; tone(seq[0], seq[1], "square", v, seq[0] * 1.4); } } } };
})();
