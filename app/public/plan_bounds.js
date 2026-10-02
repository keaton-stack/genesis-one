// plan_bounds.js (round 2, E3): the edge of Genesis One. PLAN mode only; the legacy world never runs these hooks.
//  1. The section: the outer ring of the four parcels (our three plus the City airport), from plan.json parcels.
//  2. The minimap and the site map frame the section only; the land outside is masked dark (no neighbours' aerial) and the
//     section line is drawn crisp. drawMinimap and the #mm click are replaced (map layers: PLAN_BOUNDS.mapLayers).
//  3. The perimeter: a low ranch rail fence on stone pillars 1.2 m inside the section line, broken at every road and walk
//     that enters (tall gate pillars with lanterns at the vehicle gates), GENESIS ONE boundary markers on our own land.
//     Merged per 420 m chunk (timber, stone, cast stone, bronze, lantern), range culled, box solids for the rails.
//  4. The soft stop: walkers, personal carts and bikes, the shared carts and jets on the ground ease to a halt before the
//     fence (the outward part of each step and of the speed is limited, so they can still slide along it or turn back) and a
//     small calm HUD note says so, once per approach. Jets in flight, balloons, the fly-in and rides are exempt.
//  5. Fast travel, map clicks and the Places list never land outside (warpTo and planLandOK), the Grand Loop does not let
//     riders off on the public section roads, and a player who starts outside is brought to the nearest spot inside.
// Client globals are reached by bare name at call time; nothing here runs before client.js has been evaluated.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
if (window.PLAN_MODEL_NEEDS.indexOf("stone_pillar") < 0) window.PLAN_MODEL_NEEDS.push("stone_pillar");
(function () {
  "use strict";
  const HOOKS = window.PLAN_HOOKS;
  const B = (window.PLAN_BOUNDS = window.PLAN_BOUNDS || {});
  B.errs = []; B.mapLayers = B.mapLayers || []; B.ready = false; B.dt = 1 / 60; B.stats = {};
  const INSET = 1.2;                                                   // fence line, metres inside the section line
  const STOP = { walk: 3.4, cart: 4.3, veh: 4.7, jet: 16 };             // where each mover comes to rest (from the section line)
  const ACC = { walk: 7, cart: 8.5, veh: 8.5, jet: 4 };                 // the ease: braking the outward speed, m/s2
  const PILLAR_SP = 24, BAY = 3.0, CHUNK = 520, DS = 0.25;
  const FALLBACK_RING = [[-487.4, -627.6], [27.9, -627.4], [319.6, -627.3], [763.4, -627.2], [1026.0, -627.1], [1126.6, -627.0], [1125.9, 183.7], [1125.2, 994.4], [318.9, 991.2], [-365.6, 987.0], [-484.5, 986.3], [-484.7, 820.6], [-485.6, 178.5], [-485.7, 98.3]];
  function err(where, e) { if (B.errs.length < 40) B.errs.push(where + ": " + ((e && e.message) || e)); if (B.errs.length <= 4) console.error("plan_bounds " + where + ":", (e && e.stack) || e); }

  // ───────────────────────── the section ring and the signed distance ─────────────────────────
  function sectionRing() {
    try {
      const P = window.PLAN && window.PLAN.parcels; if (!P) return FALLBACK_RING.slice();
      const key = (p) => (+p[0]).toFixed(1) + "," + (+p[1]).toFixed(1); const edges = [];
      for (const id in P) { let r = P[id] && P[id].ring; if (!Array.isArray(r) || r.length < 3) continue; r = r.slice(); if (key(r[0]) === key(r[r.length - 1])) r.pop(); for (let i = 0; i < r.length; i++) edges.push([r[i], r[(i + 1) % r.length]]); }
      const has = new Set(edges.map((e) => key(e[0]) + ">" + key(e[1]))); const outer = edges.filter((e) => !has.has(key(e[1]) + ">" + key(e[0])));
      if (outer.length < 4) return FALLBACK_RING.slice();
      const next = new Map(); for (const e of outer) next.set(key(e[0]), e);
      const ring = []; let e = outer[0]; const k0 = key(e[0]);
      for (let n = 0; n <= outer.length; n++) { ring.push([+e[0][0], +e[0][1]]); const nx = next.get(key(e[1])); if (!nx || key(nx[0]) === k0) break; e = nx; }
      if (ring.length !== outer.length) return FALLBACK_RING.slice();
      return ring;
    } catch (e) { err("ring", e); return FALLBACK_RING.slice(); }
  }
  let RING = null, NE = 0; const EX = [], EZ = [], EVX = [], EVZ = [], EIL = [], ENX = [], ENZ = [];   // edges, outward normals
  let AREA_SIGN = 1;
  function setRing(r) {
    RING = r; NE = r.length; let A = 0; for (let i = 0; i < NE; i++) { const a = r[i], b = r[(i + 1) % NE]; A += a[0] * b[1] - b[0] * a[1]; } AREA_SIGN = A >= 0 ? 1 : -1;
    for (let i = 0; i < NE; i++) { const a = r[i], b = r[(i + 1) % NE]; const vx = b[0] - a[0], vz = b[1] - a[1], L = Math.hypot(vx, vz) || 1; EX[i] = a[0]; EZ[i] = a[1]; EVX[i] = vx; EVZ[i] = vz; EIL[i] = 1 / (L * L); ENX[i] = AREA_SIGN * vz / L; ENZ[i] = -AREA_SIGN * vx / L; }   // inward = sign * (-vz, vx): outward is its negative
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of r) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } B.bb = [x0, x1, z0, z1];
    B.ring = r;
  }
  function pip(x, z) { let c = false; for (let i = 0, j = NE - 1; i < NE; j = i++) { const zi = RING[i][1], zj = RING[j][1]; if ((zi > z) !== (zj > z) && x < (RING[j][0] - RING[i][0]) * (z - zi) / (zj - zi) + RING[i][0]) c = !c; } return c; }
  const SD = { d: 0, nx: 0, nz: 0, qx: 0, qz: 0, e: 0 };
  // signed distance to the section line (positive inside) and the outward normal at the nearest point
  function sdist(x, z, o) {
    o = o || SD; let bd = 1e18, bx = 0, bz = 0, bi = 0;
    for (let i = 0; i < NE; i++) { let t = ((x - EX[i]) * EVX[i] + (z - EZ[i]) * EVZ[i]) * EIL[i]; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = EX[i] + EVX[i] * t, qz = EZ[i] + EVZ[i] * t; const dd = (x - qx) * (x - qx) + (z - qz) * (z - qz); if (dd < bd) { bd = dd; bx = qx; bz = qz; bi = i; } }
    const L = Math.sqrt(bd), ins = pip(x, z); o.qx = bx; o.qz = bz; o.e = bi;
    if (L < 1e-4) { o.d = 0; o.nx = ENX[bi]; o.nz = ENZ[bi]; return o; }
    if (ins) { o.d = L; o.nx = (bx - x) / L; o.nz = (bz - z) / L; } else { o.d = -L; o.nx = (x - bx) / L; o.nz = (z - bz) / L; }
    return o;
  }
  // the nearest point at least m metres inside the section line (unchanged when it already is)
  function clampInside(x, z, m) { const s = sdist(x, z, {}); if (s.d >= m) return [x, z]; const k = m - s.d; let nx = x - s.nx * k, nz = z - s.nz * k; for (let i = 0; i < 3; i++) { const t = sdist(nx, nz, {}); if (t.d >= m - 0.05) break; nx -= t.nx * (m - t.d); nz -= t.nz * (m - t.d); } return [nx, nz]; }
  B.sdist = (x, z) => { const s = sdist(x, z, {}); return { d: s.d, nx: s.nx, nz: s.nz }; };
  B.inside = (x, z, m) => sdist(x, z, {}).d >= (m || 0);
  B.clampInside = clampInside;

  // offset the ring inward by d (the fence line)
  function offsetRing(r, d) {
    const n = r.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = r[(i - 1 + n) % n], c = r[i], q = r[(i + 1) % n];
      const t1x = c[0] - p[0], t1z = c[1] - p[1], L1 = Math.hypot(t1x, t1z) || 1, t2x = q[0] - c[0], t2z = q[1] - c[1], L2 = Math.hypot(t2x, t2z) || 1;
      const n1x = -AREA_SIGN * t1z / L1, n1z = AREA_SIGN * t1x / L1, n2x = -AREA_SIGN * t2z / L2, n2z = AREA_SIGN * t2x / L2;   // inward normals
      let bx = n1x + n2x, bz = n1z + n2z; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl; const cs = Math.max(0.3, bx * n1x + bz * n1z);
      out.push([c[0] + bx * d / cs, c[1] + bz * d / cs]);
    }
    return out;
  }

  // ───────────────────────── small helpers ─────────────────────────
  function hash(i) { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function groundY(x, z) { try { const G = window.GP_PARK; if (G && G.inPatch && G.ground && G.inPatch(x, z)) { const y = G.ground(x, z); if (typeof y === "number" && isFinite(y)) return y; } } catch (e) {} try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } }
  function isOurs(x, z) { try { const zn = planZone(x, z); return zn === "land" || zn === "wash"; } catch (e) { return true; } }
  function compass8(dx, dz) { const a = Math.atan2(dx, -dz) * 180 / Math.PI; const i = ((Math.round(a / 45) % 8) + 8) % 8; return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i]; }
  function sideRoad(nx, nz) { if (Math.abs(nz) >= Math.abs(nx)) return nz < 0 ? "North Section Road" : "South Section Road"; return nx > 0 ? "East Section Road" : "N Airport Rd"; }

  // ───────────────────────── textures ─────────────────────────
  function canvasTex(c, srgb, repeat) { const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; try { t.anisotropy = renderer.capabilities.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4; } catch (e) {} t.needsUpdate = true; return t; }
  function normalFromHeight(h, S, k) { const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"); const im = g.createImageData(S, S); const d = im.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const xl = (x - 1 + S) % S, xr = (x + 1) % S, yu = (y - 1 + S) % S, yd = (y + 1) % S; const dx = (h[y * S + xr] - h[y * S + xl]) * k, dy = (h[yd * S + x] - h[yu * S + x]) * k; const L = Math.hypot(dx, dy, 1); const i = (y * S + x) * 4; d[i] = (-dx / L * 0.5 + 0.5) * 255; d[i + 1] = (dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255; }
    g.putImageData(im, 0, 0); return c; }
  // dry-stacked desert ledgestone, 512 px = 1.2 m, tiles both ways
  function makeStone() {
    const S = 512, R = rng(9127); const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"); const h = new Float32Array(S * S);
    g.fillStyle = "#3b3128"; g.fillRect(0, 0, S, S);
    const pal = [[186, 156, 118], [168, 134, 97], [203, 176, 137], [154, 121, 88], [212, 187, 150], [143, 111, 80], [192, 162, 122], [177, 147, 106], [198, 150, 108], [160, 140, 116]];
    const rows = []; let y = 0; while (y < S) { let rh = Math.round(22 + R() * 38); if (S - y - rh < 24) rh = S - y; rows.push([y, rh]); y += rh; }
    for (const [y0, rh] of rows) { let x = -R() * 140; const xEnd = x + S; while (x < xEnd - 8) { let w = 56 + R() * 190; if (x + w > xEnd - 30) w = xEnd - x; const gap = 3 + R() * 2.2, gy = 2.4 + R() * 1.6; const col = pal[Math.floor(R() * pal.length)], j = 0.9 + R() * 0.2, prot = 0.6 + R() * 0.4; const sx = x + gap / 2, sy = y0 + gy / 2, sw = w - gap, sh = rh - gy;
        for (const off of [-S, 0, S]) { const ox = sx + off; if (ox > S || ox + sw < 0) continue; const rr = Math.min(7, sh / 3); g.fillStyle = `rgb(${col[0] * j | 0},${col[1] * j | 0},${col[2] * j | 0})`; g.beginPath(); if (g.roundRect) g.roundRect(ox, sy, sw, sh, rr); else g.rect(ox, sy, sw, sh); g.fill();
          const gr = g.createLinearGradient(0, sy, 0, sy + sh); gr.addColorStop(0, "rgba(255,246,228,0.16)"); gr.addColorStop(0.45, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(40,26,14,0.26)"); g.fillStyle = gr; g.fill(); }
        const rs = R() * 1e9 | 0, R2 = rng(rs);
        for (let k = 0; k < 3; k++) { const ly = sy + sh * (0.2 + R2() * 0.6); g.fillStyle = `rgba(60,40,24,${0.08 + R2() * 0.1})`; for (const off of [-S, 0, S]) g.fillRect(sx + off + sw * R2() * 0.3, ly, sw * (0.4 + R2() * 0.5), 1); }
        for (let k = 0; k < sw * sh / 60; k++) { const px = sx + R2() * sw, py = sy + R2() * sh; g.fillStyle = R2() < 0.5 ? `rgba(255,240,215,${R2() * 0.14})` : `rgba(50,32,18,${R2() * 0.16})`; for (const off of [-S, 0, S]) g.fillRect(px + off, py, 1 + R2() * 2, 1 + R2() * 1.5); }
        for (let py = Math.max(0, Math.floor(sy)); py < Math.min(S, Math.ceil(sy + sh)); py++) for (let qx = Math.floor(sx); qx < Math.ceil(sx + sw); qx++) { const e = Math.min(qx - sx, sx + sw - qx, py - sy, sy + sh - py); if (e <= 0) continue; const f = Math.min(1, e / 5); const px = ((qx % S) + S) % S; h[py * S + px] = prot * (f * f * (3 - 2 * f)) + (R2() - 0.5) * 0.05; }
        x += w; } }
    // broad mottling so no two pillars read as the same tile
    for (let k = 0; k < 26; k++) { const cx = R() * S, cy = R() * S, rr = 40 + R() * 110; const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr); const dark = R() < 0.5; gr.addColorStop(0, dark ? "rgba(70,45,25,0.10)" : "rgba(255,236,200,0.08)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2); g.restore(); } }
    return { map: canvasTex(c, true, true), normal: canvasTex(normalFromHeight(h, S, 3.2), false, true) };
  }
  // cast stone for the caps, 256 px = 0.9 m
  function makeCast() {
    const S = 256, R = rng(4411); const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"); const h = new Float32Array(S * S);
    g.fillStyle = "#d6c9ae"; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 18; k++) { const cx = R() * S, cy = R() * S, rr = 20 + R() * 70; const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, R() < 0.5 ? "rgba(150,128,96,0.12)" : "rgba(255,248,232,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) g.fillRect(cx - rr + ox, cy - rr + oy, rr * 2, rr * 2); }
    for (let k = 0; k < 2600; k++) { const x = R() * S, y = R() * S; g.fillStyle = R() < 0.55 ? `rgba(110,92,66,${R() * 0.28})` : `rgba(255,252,240,${R() * 0.3})`; g.fillRect(x, y, 1 + R() * 1.4, 1 + R() * 1.4); }
    for (let i = 0; i < S * S; i++) h[i] = R() * 0.5; for (let p = 0; p < 2; p++) { const t = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + S) % S) * S + (x + dx + S) % S]; t[y * S + x] = s / 9; } h.set(t); }
    return { map: canvasTex(c, true, true), normal: canvasTex(normalFromHeight(h, S, 2.2), false, true) };
  }
  // bronze plaques: row 0 the boundary marker, rows 1.. the gates; 512 x 128 per row
  const PLAQUE_ROWS = 12;
  function drawPlaques(c, names) {
    const g = c.getContext("2d"); const W = 512, RH = 128;
    for (let i = 0; i < PLAQUE_ROWS; i++) { const y0 = i * RH;
      const gr = g.createLinearGradient(0, y0, 0, y0 + RH); gr.addColorStop(0, "#5b4630"); gr.addColorStop(0.5, "#3f3020"); gr.addColorStop(1, "#2c2116"); g.fillStyle = gr; g.fillRect(0, y0, W, RH);
      g.strokeStyle = "rgba(226,186,112,0.85)"; g.lineWidth = 4; g.strokeRect(9, y0 + 9, W - 18, RH - 18); g.strokeStyle = "rgba(20,14,8,0.6)"; g.lineWidth = 2; g.strokeRect(15, y0 + 15, W - 30, RH - 30);
      const sub = i === 0 ? "DOUGLAS · ARIZONA" : String(names[i - 1] || "").toUpperCase();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "64px Anton, Impact, 'Arial Narrow', sans-serif"; const title = "GENESIS ONE".split("").join(String.fromCharCode(8202));
      g.fillStyle = "rgba(10,6,2,0.55)"; g.fillText(title, W / 2 + 2, y0 + 52 + 2); g.fillStyle = "#e3bd72"; g.fillText(title, W / 2, y0 + 52);
      g.font = "600 19px 'JetBrains Mono', Consolas, monospace"; const sp = sub.split("").join(" "); g.fillStyle = "rgba(10,6,2,0.5)"; g.fillText(sp, W / 2 + 1, y0 + 96 + 1); g.fillStyle = "#d8b67a"; g.fillText(sp, W / 2, y0 + 96); }
  }
  function glowSprite() { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,226,170,1)"); gr.addColorStop(0.25, "rgba(255,196,120,0.55)"); gr.addColorStop(1, "rgba(255,170,90,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return canvasTex(c, true, false); }

  // ───────────────────────── geometry builder ─────────────────────────
  function GB() { this.p = []; this.n = []; this.uv = []; this.ix = []; }
  GB.prototype.quad = function (P, UV, out) {   // P: 4 points [x,y,z] in order around the face; out: expected outward direction
    const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2], bx = P[3][0] - P[0][0], by = P[3][1] - P[0][1], bz = P[3][2] - P[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    let o = [0, 1, 2, 3]; if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) { o = [0, 3, 2, 1]; nx = -nx; ny = -ny; nz = -nz; }
    const b = this.p.length / 3; for (const k of o) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(nx, ny, nz); this.uv.push(UV[k][0], UV[k][1]); } this.ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  GB.prototype.geo = function () { if (!this.ix.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.p.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  // oriented box: centre c, unit axes A (along), U (up), C (across), half sizes; uvf(axis, sign, la, lu, lc) -> [u, v]; skip = face keys to leave out
  function box(G, c, A, U, C, ha, hu, hc, uvf, skip) {
    const ax = [A, U, C], hf = [ha, hu, hc]; const faces = [[0, 1, 1, 2], [0, -1, 1, 2], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];
    for (const [k, s, e1, e2] of faces) { if (skip && skip.indexOf(k * 2 + (s > 0 ? 0 : 1)) >= 0) continue; const P = [], UV = [];
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const l = [0, 0, 0]; l[k] = s * hf[k]; l[e1] = s1 * hf[e1]; l[e2] = s2 * hf[e2]; P.push([c[0] + A[0] * l[0] + U[0] * l[1] + C[0] * l[2], c[1] + A[1] * l[0] + U[1] * l[1] + C[1] * l[2], c[2] + A[2] * l[0] + U[2] * l[1] + C[2] * l[2]]); UV.push(uvf(k, s, l[0], l[1], l[2])); }
      G.quad(P, UV, [ax[k][0] * s, ax[k][1] * s, ax[k][2] * s]); }
  }
  // a frustum on a horizontal base (caps, chamfers, roofs): bottom half sizes (a0, c0) at local height y0, top (a1, c1) at y1
  function frustum(G, c, A, C, a0, c0, a1, c1, y0, y1, uvf, top) {
    const pt = (la, ly, lc) => [c[0] + A[0] * la + C[0] * lc, c[1] + ly, c[2] + A[2] * la + C[2] * lc];
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [sa, sc] of sides) { let P, L; if (sa) L = [[sa * a0, y0, -c0], [sa * a0, y0, c0], [sa * a1, y1, c1], [sa * a1, y1, -c1]]; else L = [[-a0, y0, sc * c0], [a0, y0, sc * c0], [a1, y1, sc * c1], [-a1, y1, sc * c1]]; P = L.map((q) => pt(q[0], q[1], q[2]));
      const UV = L.map((q, i) => uvf(sa ? 0 : 2, sa || sc, q[0], q[1], q[2], i)); const out = [A[0] * sa + C[0] * sc, 0.4, A[2] * sa + C[2] * sc]; G.quad(P, UV, out); }
    if (top !== false && (a1 > 0.001 || c1 > 0.001)) { const L = [[-a1, y1, -c1], [a1, y1, -c1], [a1, y1, c1], [-a1, y1, c1]]; G.quad(L.map((q) => pt(q[0], q[1], q[2])), L.map((q) => uvf(1, 1, q[0], q[1], q[2])), [0, 1, 0]); }
  }

  // ───────────────────────── the fence layout ─────────────────────────
  function layout() {
    const t0 = performance.now();
    const P0 = offsetRing(RING, INSET); const n = P0.length;
    // start the path at the sharpest corner, so no run wraps round the start
    const turn = (i) => { const p = P0[(i - 1 + n) % n], c = P0[i], q = P0[(i + 1) % n]; const a1 = Math.atan2(c[1] - p[1], c[0] - p[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]); let d = a2 - a1; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d); };
    let i0 = 0; for (let i = 1; i < n; i++) if (turn(i) > turn(i0)) i0 = i;
    const P = []; for (let i = 0; i < n; i++) P.push(P0[(i0 + i) % n]);
    const segs = []; let L = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len; segs.push({ a, b, len, tx, tz, nx: -AREA_SIGN * tz, nz: AREA_SIGN * tx, s0: L, corner: turn((i0 + i) % n) > 0.35 }); L += len; }
    const at = (s) => { s = ((s % L) + L) % L; let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].s0 <= s) lo = m; else hi = m - 1; } const g = segs[lo]; const t = Math.min(g.len, s - g.s0); return { x: g.a[0] + g.tx * t, z: g.a[1] + g.tz * t, g }; };
    const project = (x, z) => { let bd = 1e18, bs = 0, bo = 0; for (const g of segs) { let t = (x - g.a[0]) * g.tx + (z - g.a[1]) * g.tz; t = Math.max(0, Math.min(g.len, t)); const qx = g.a[0] + g.tx * t, qz = g.a[1] + g.tz * t; const dd = (x - qx) ** 2 + (z - qz) ** 2; if (dd < bd) { bd = dd; bs = g.s0 + t; bo = (x - qx) * g.nx + (z - qz) * g.nz; } } return { s: bs, d: Math.sqrt(bd), off: bo }; };
    const N = Math.ceil(L / DS); const fl = new Uint8Array(N); const roadOf = new Int16Array(N).fill(-1);   // 1 road, 2 paved, 4 blocked, 8 no post
    const BUCK = 12, NB = Math.ceil(L / BUCK) + 1; const buckets = Array.from({ length: NB }, () => []);
    const addCand = (o, s, ext) => { const b0 = Math.max(0, Math.floor((s - ext - 1) / BUCK)), b1 = Math.min(NB - 1, Math.floor((s + ext + 1) / BUCK)); for (let b = b0; b <= b1; b++) buckets[b].push(o); if (s - ext < 0) for (let b = Math.floor((L + s - ext - 1) / BUCK); b < NB; b++) if (b >= 0) buckets[b].push(o); if (s + ext > L) for (let b = 0; b <= Math.floor((s + ext + 1 - L) / BUCK); b++) buckets[b].push(o); };
    // roads and walks that cross the fence line
    const roads = []; const R = window.ROADS || ROADS;
    for (let ri = 0; ri < R.length; ri++) { const r = R[ri]; if (!r || !r.pts || r.pts.length < 2 || !(r.w > 0)) continue; if (/^pub_/.test(r.plan || "")) continue; const hw = r.w / 2;
      for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1]; const sl = Math.hypot(b[0] - a[0], b[1] - a[1]); if (sl < 0.01) continue; let near = false, ss = 0;
        for (let t = 0; t <= sl + 0.01; t += Math.min(2, sl)) { const x = a[0] + (b[0] - a[0]) * t / sl, z = a[1] + (b[1] - a[1]) * t / sl; const pr = project(x, z); if (pr.d < hw + 3) { near = true; ss = pr.s; break; } }
        if (near) { const o = { k: "road", ri, a, b, hw, w: r.w, plan: r.plan || null, open0: i === 0, open1: i === r.pts.length - 2 }; roads.push(o); addCand(o, ss, hw + sl + 2); } } }
    // solids, colliders, buildings, stop posts
    const obs = [];
    for (const sd of SOLIDS) { if (!sd || sd.tag === "bounds") continue; const pr = project(sd.x, sd.z); const ext = sd.hw + sd.hd; if (pr.d > ext + 2) continue; const gy = groundY(sd.x, sd.z); if (sd.y1 < gy + 0.12 || sd.y0 > gy + 2.2) continue; const o = { k: "solid", sd, thin: Math.min(sd.hw, sd.hd) < 0.2 && Math.max(sd.hw, sd.hd) > 1.5 }; obs.push(o); addCand(o, pr.s, ext + 1); }
    for (const cl of COLLIDERS) { const pr = project(cl[0], cl[1]); if (pr.d > cl[2] + 2) continue; const o = { k: "circle", x: cl[0], z: cl[1], r: cl[2] }; obs.push(o); addCand(o, pr.s, cl[2] + 1); }
    try { for (const b of window.PLAN.buildings || []) { if (!b.poly || b.poly.length < 3) continue; let mn = 1e9; for (const q of b.poly) mn = Math.min(mn, project(q[0], q[1]).d); if (mn > 3) continue; const o = { k: "poly", poly: b.poly }; obs.push(o); let r = 0; for (const q of b.poly) r = Math.max(r, Math.hypot(q[0] - b.x, q[1] - b.z)); addCand(o, project(b.x, b.z).s, r + 1); } } catch (e) {}
    try { for (const st of SITES.stops || []) { const pr = project(st.x, st.z); if (pr.d > 4) continue; const o = { k: "stop", x: st.x, z: st.z }; obs.push(o); addCand(o, pr.s, 3); } } catch (e) {}
    const segDist = (x, z, a, b, o0, o1) => { const vx = b[0] - a[0], vz = b[1] - a[1]; let t = ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1); if ((t < 0 && o0) || (t > 1 && o1)) return 1e9; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); };   // a ribbon ends square: no round cap past its first and last points
    const polyDist = (poly, x, z) => { let mn = 1e9; for (let i = 0; i < poly.length; i++) mn = Math.min(mn, segDist(x, z, poly[i], poly[(i + 1) % poly.length])); return mn; };
    for (let i = 0; i < N; i++) { const s = i * DS; const p = at(s); const x = p.x, z = p.z; let f = 0;
      for (const o of buckets[Math.min(NB - 1, Math.floor(s / BUCK))]) {
        if (o.k === "road") { if (segDist(x, z, o.a, o.b, o.open0, o.open1) < o.hw) { f |= 1; if (roadOf[i] < 0 || o.w > roads[roadOf[i]].w) roadOf[i] = roads.indexOf(o); } }
        else if (o.k === "solid") { const sd = o.sd; const dx = x - sd.x, dz = z - sd.z, c = Math.cos(sd.ry), sn = Math.sin(sd.ry); const lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (o.thin) { if (Math.abs(lx) <= sd.hw + 0.35 && Math.abs(lz) <= sd.hd + 0.35) f |= 8; } else if (Math.abs(lx) <= sd.hw + 0.32 && Math.abs(lz) <= sd.hd + 0.32) f |= 4; }
        else if (o.k === "circle") { const d = Math.hypot(x - o.x, z - o.z); if (o.r > 0.75) { if (d < o.r + 0.3) f |= 4; } else { if (d < o.r + 0.4) f |= 8; if (d < Math.max(0.16, o.r * 0.42)) f |= 4; } }
        else if (o.k === "poly") { if (planInPoly(o.poly, x, z) || polyDist(o.poly, x, z) < 0.5) f |= 4; }
        else if (o.k === "stop") { const d = Math.hypot(x - o.x, z - o.z); if (d < 0.9) f |= 4; else if (d < 1.6) f |= 8; } }
      if (!(f & 1)) { try { const w = walkAt(x, z); if (w !== null && w - getH(x, z) > 0.06) f |= 2; } catch (e) {} }
      fl[i] = f; }
    // openings: roads (with their paved aprons up to 5 m, then any blocker hugging the mouth), short paved runs, blockers
    const open = new Uint8Array(N); const gates = [];
    const tall = []; for (const o of obs) { if (o.k !== "solid" || o.thin) continue; const sd = o.sd; if (sd.y1 - groundY(sd.x, sd.z) < 0.8) continue; const c = Math.cos(sd.ry), sn = Math.sin(sd.ry); let s0 = 1e9, s1 = -1e9, f0 = 1e9, f1 = -1e9; for (const [lx, lz] of [[sd.hw, sd.hd], [sd.hw, -sd.hd], [-sd.hw, sd.hd], [-sd.hw, -sd.hd]]) { const x = sd.x + lx * c + lz * sn, z = sd.z - lx * sn + lz * c; const pr = project(x, z); s0 = Math.min(s0, pr.s); s1 = Math.max(s1, pr.s); f0 = Math.min(f0, pr.off); f1 = Math.max(f1, pr.off); } if (s1 - s0 > 40) continue; tall.push({ s0, s1, off0: f0, off1: f1 }); }
    const runOf = (i, mask) => { let j = i; while (j < N && (fl[j] & mask)) j++; return j; };
    for (let i = 0; i < N;) { if (!(fl[i] & 1)) { i++; continue; } let j = runOf(i, 1); while (j < N - 4) { let k = j; while (k < N && !(fl[k] & 1) && k - j < 4) k++; if (k < N && (fl[k] & 1) && k - j < 4) j = runOf(k, 1); else break; }
      let best = -1; for (let q = i; q < j; q++) if (roadOf[q] >= 0 && (best < 0 || roads[roadOf[q]].w > roads[best].w)) best = roadOf[q]; const rw = best >= 0 ? roads[best].w : 4;
      let pr = null; try { pr = best >= 0 && roads[best].plan ? (PLAN_IDX.road.get(roads[best].plan) || null) : null; } catch (e) {} const isProm = best >= 0 && roads[best].plan && (() => { try { return PLAN_IDX.prom.has(roads[best].plan); } catch (e) { return false; } })();
      const vehicle = rw >= 6 && !isProm && !(pr && /trail/.test(pr.class || ""));
      let a = i, b = j; { let q = a - 1, c = 0; while (q >= 0 && (fl[q] & 2) && !(fl[q] & 1)) { q--; c++; } if (c * DS <= 5) a = q + 1; } { let q = b, c = 0; while (q < N && (fl[q] & 2) && !(fl[q] & 1)) { q++; c++; } if (c * DS <= 5) b = q; }
      const m = Math.round((vehicle ? 1.4 : 0.7) / DS); a = Math.max(0, a - m); b = Math.min(N, b + m);
      for (let pass = 0; pass < 4; pass++) { let q = a - 1, hit = -1; for (let k = 0; k < 2.5 / DS && q >= 0; k++, q--) if (fl[q] & 4) hit = q; if (hit >= 0) { let z = hit; while (z > 0 && (fl[z - 1] & 4)) z--; a = Math.max(0, z - Math.round(0.6 / DS)); } let q2 = b, hit2 = -1; for (let k = 0; k < 2.5 / DS && q2 < N; k++, q2++) if (fl[q2] & 4) hit2 = q2; if (hit2 >= 0) { let z = hit2; while (z < N - 1 && (fl[z + 1] & 4)) z++; b = Math.min(N, z + 1 + Math.round(0.6 / DS)); } if (hit < 0 && hit2 < 0) break; }
      if (vehicle) for (let pass = 0; pass < 2; pass++) for (const t of tall) { if (t.off1 < -0.6 || t.off0 > 3.2) continue; if (t.s1 > a * DS - 3 && t.s0 < a * DS + 1) a = Math.max(0, Math.min(a, Math.floor((t.s0 - 0.8) / DS))); if (t.s0 < b * DS + 3 && t.s1 > b * DS - 1) b = Math.min(N, Math.max(b, Math.ceil((t.s1 + 0.8) / DS))); }
      for (let q = a; q < b; q++) open[q] = vehicle ? 3 : 2;
      let nm = ""; try { const plan = best >= 0 ? roads[best].plan : null; const cand = []; for (const o of roads) if (o.plan && segDist(at((i + j) / 2 * DS).x, at((i + j) / 2 * DS).z, o.a, o.b) < o.hw + 8) cand.push(o.plan); for (const id of [...cand, plan]) { const rr = id && PLAN_IDX.road.get(id); if (rr && /gate/i.test(rr.name || "")) { nm = String(rr.name).replace(/\s*\(.*?\)\s*/g, "").replace(/\s+apron$/i, "").trim(); break; } } if (!nm && pr) nm = String(pr.name || "").replace(/\s*\(.*?\)\s*/g, "").trim(); } catch (e) {}
      const mid = at((a + b) / 2 * DS); gates.push({ s0: a * DS, s1: b * DS, x: mid.x, z: mid.z, vehicle, name: nm, road: best >= 0 ? roads[best].plan : null, width: rw, ours: isOurs(mid.x - mid.g.nx * -6, mid.z - mid.g.nz * -6) });
      i = b; }
    for (let i = 0; i < N;) { if (!(fl[i] & 2) || open[i]) { i++; continue; } let j = i; while (j < N && (fl[j] & 2) && !open[j]) j++; if ((j - i) * DS <= 8) { const m = Math.round(0.6 / DS); for (let q = Math.max(0, i - m); q < Math.min(N, j + m); q++) if (!open[q]) open[q] = 2; const mid = at((i + j) / 2 * DS); gates.push({ s0: i * DS, s1: j * DS, x: mid.x, z: mid.z, vehicle: false, name: "", ped: true }); } i = j; }
    for (let i = 0; i < N; i++) if ((fl[i] & 4) && !open[i]) { let j = i; while (j < N && (fl[j] & 4)) j++; const m = Math.round(0.35 / DS); for (let q = Math.max(0, i - m); q < Math.min(N, j + m); q++) if (!open[q]) open[q] = 1; i = j; }
    // runs of fence between openings, split at the corners
    const cornersS = segs.filter((g) => g.corner).map((g) => g.s0);
    const runs = []; for (let i = 0; i < N;) { if (open[i]) { i++; continue; } let j = i; while (j < N && !open[j]) j++; const s0 = i * DS, s1 = Math.min(L, j * DS); const cuts = [s0, ...cornersS.filter((c) => c > s0 + 0.5 && c < s1 - 0.5), s1];
        const endKind = (q) => (q < 0 || q >= N ? 0 : open[q]);
        for (let c = 0; c < cuts.length - 1; c++) { const a = cuts[c], b = cuts[c + 1]; if (b - a < 1.2) continue; runs.push({ s0: a, s1: b, k0: c === 0 ? endKind(i - 1) : 9, k1: c === cuts.length - 2 ? endKind(j) : 9 }); }
        i = j; }
    // supports: pillars (terminal, corner, every ~24 m) and timber posts every ~3 m; a post never stands in a no-post sample
    const noPost = (s) => { const i = Math.round(s / DS); for (let q = i - 1; q <= i + 1; q++) if (q >= 0 && q < N && (fl[q] & 12)) return true; return false; };
    const shiftFree = (s, lo, hi, maxd) => { if (!noPost(s)) return s; for (let d = DS; d <= maxd; d += DS) { if (s + d < hi && !noPost(s + d)) return s + d; if (s - d > lo && !noPost(s - d)) return s - d; } return null; };
    const rw0 = window.PLAN && window.PLAN.runway; const rwEnds = rw0 ? [rw0.ne, rw0.sw] : [];
    const nearRunwayEnd = (x, z) => rwEnds.some((e) => e && Math.hypot(x - e[0], z - e[1]) < 260);
    const sup = []; let markEvery = 190, nextMark = 60;
    // the path starts and ends on the same corner: a run touching s = 0 and one touching s = L share that corner pillar
    for (const r of runs) { if (r.k0 === 0 && r.s0 < 0.01) r.k0 = 9; if (r.k1 === 0 && r.s1 > L - 0.01) { r.k1 = 9; r.wrap = runs[0] && runs[0].s0 < 0.01; } }
    let firstPillar = null, lastPill = null;
    for (const r of runs) {
      const halfP = 0.37; const a = r.s0 + (r.k0 === 9 ? 0 : halfP), b = r.s1 - (r.k1 === 9 ? 0 : halfP); if (b - a < 0.8) continue;
      const nP = Math.max(1, Math.round((b - a) / PILLAR_SP)); const pills = [];
      for (let k = 0; k <= nP; k++) { let s = a + (b - a) * k / nP; const terminal = k === 0 || k === nP; if (!terminal) { const f = shiftFree(s, a + 2, b - 2, 3); if (f === null) continue; s = f; } else if (!((k === 0 && r.k0 === 9) || (k === nP && r.k1 === 9))) { const f = shiftFree(s, k === 0 ? s - 0.01 : a, k === 0 ? b : s + 0.01, 1.5); if (f !== null) s = f; }
        const p = at(s); const gateEnd = (k === 0 && r.k0 === 3) || (k === nP && r.k1 === 3); const corner = (k === 0 && r.k0 === 9) || (k === nP && r.k1 === 9);
        if (k === nP && r.wrap && firstPillar) { pills.push({ s, x: firstPillar.x, z: firstPillar.z, g: firstPillar.g, type: "pillar", dup: firstPillar }); continue; }
        if (k === 0 && r.k0 === 9 && lastPill && Math.abs(lastPill.s - s) < 0.05) { pills.push({ s, x: lastPill.x, z: lastPill.z, g: p.g, type: "pillar", dup: lastPill }); continue; }
        const pl = { s, x: p.x, z: p.z, g: p.g, type: gateEnd ? "gate" : "pillar", corner }; if (!firstPillar && s < 0.01) firstPillar = pl; pills.push(pl); }
      lastPill = pills.length ? (pills[pills.length - 1].dup || pills[pills.length - 1]) : null;
      for (let k = 0; k < pills.length; k++) { sup.push(pills[k]); if (k === pills.length - 1) break; const s0 = pills[k].s, s1 = pills[k + 1].s; const m = Math.max(1, Math.round((s1 - s0) / BAY)); for (let q = 1; q < m; q++) { let s = s0 + (s1 - s0) * q / m; const f = shiftFree(s, s0 + 0.6, s1 - 0.6, 1.0); if (f === null) continue; s = f; const p = at(s); sup.push({ s, x: p.x, z: p.z, g: p.g, type: "post" }); } }
      sup.push({ brk: true });
    }
    // markers: one pillar in about every 190 m of our own land, away from the gates and the runway ends; the corner pillars on our land too
    let acc = 0, prevS = null;
    for (const q of sup) { if (q.brk || q.type === "post" || q.dup) continue; const ours = isOurs(q.x + q.g.nx * 5, q.z + q.g.nz * 5); q.ours = ours; if (!ours || nearRunwayEnd(q.x, q.z)) { prevS = q.s; continue; } if (prevS !== null) acc += Math.max(0, q.s - prevS); prevS = q.s;
      const nearGate = gates.some((gt) => q.s > gt.s0 - 30 && q.s < gt.s1 + 30);
      if (q.type === "pillar" && (q.corner || (acc >= nextMark && !nearGate))) { q.type = "marker"; if (!q.corner) nextMark = acc + markEvery; } }
    B.stats.layoutMs = Math.round(performance.now() - t0);
    return { L, segs, sup, gates, fl, N, at, project, runs };
  }

  // ───────────────────────── the fence meshes ─────────────────────────
  const WOOD_U = 3.2, BAND = 1 / 12;
  function buildFence(LY) {
    const t0 = performance.now();
    const useModel = typeof MODELS !== "undefined" && !!MODELS.stone_pillar && typeof makeModel === "function";
    const stone = makeStone(), cast = makeCast();
    const plaqueNames = []; for (const gt of LY.gates) if (gt.vehicle && gt.ours && gt.name && plaqueNames.indexOf(gt.name) < 0 && plaqueNames.length < PLAQUE_ROWS - 1) plaqueNames.push(gt.name);
    const pc = document.createElement("canvas"); pc.width = 512; pc.height = 128 * PLAQUE_ROWS; drawPlaques(pc, plaqueNames); const plaqueTex = canvasTex(pc, true, false);
    const redraw = () => { try { drawPlaques(pc, plaqueNames); plaqueTex.needsUpdate = true; } catch (e) {} };
    try { if (document.fonts && document.fonts.load) Promise.all([document.fonts.load("64px Anton"), document.fonts.load("600 19px 'JetBrains Mono'")]).then(redraw).catch(() => {}); } catch (e) {}
    let timber; try { timber = pbr("wood", 1, 1, { color: 0xc59e78 }); } catch (e) { timber = new THREE.MeshStandardMaterial({ color: 0x7a5d44, roughness: 0.95 }); }
    const MAT = { timber,
      stone: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(1.15, 1.15), roughness: 0.94, metalness: 0 }),
      cast: new THREE.MeshStandardMaterial({ map: cast.map, normalMap: cast.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.84, metalness: 0 }),
      bronze: new THREE.MeshStandardMaterial({ map: plaqueTex, color: 0xffffff, roughness: 0.4, metalness: 0.62 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x2a231b, roughness: 0.42, metalness: 0.78 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: new THREE.Color(0xffc27c), emissiveIntensity: 0.05, roughness: 0.18, metalness: 0 }) };
    B.mats = MAT;
    const NCH = Math.ceil(LY.L / CHUNK); const ch = []; for (let i = 0; i < NCH; i++) ch.push({ timber: new GB(), stone: new GB(), cast: new GB(), bronze: new GB(), metal: new GB(), glass: new GB(), x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    const chunkOf = (s) => ch[Math.min(NCH - 1, Math.max(0, Math.floor(s / CHUNK)))];
    const grow = (C, x, z) => { C.x0 = Math.min(C.x0, x); C.x1 = Math.max(C.x1, x); C.z0 = Math.min(C.z0, z); C.z1 = Math.max(C.z1, z); };
    const UP = [0, 1, 0];
    // uv mappers
    const woodRail = (u0, band) => (k, s, la, lu, lc) => { if (k === 2) return [u0 + la / WOOD_U, band + (lu / 0.075 * 0.5 + 0.5) * BAND * 0.92]; if (k === 1) return [u0 + la / WOOD_U, band + (lc / 0.03 * 0.5 + 0.5) * BAND * 0.4]; return [u0 + lc / WOOD_U, band + (lu / 0.075 * 0.5 + 0.5) * BAND * 0.9]; };
    const woodPost = (u0, band, hh) => (k, s, la, lu, lc) => { if (k === 1) return [u0 + la / WOOD_U, band + (lc / hh * 0.5 + 0.5) * BAND * 0.9]; const h = k === 0 ? lc : la; return [u0 + lu / WOOD_U, band + (h / hh * 0.5 + 0.5) * BAND * 0.95]; };
    const stoneUV = (ou, ov, gy0) => (k, s, la, lu, lc) => { if (k === 1) return [ou + la / 1.2, ov + lc / 1.2]; const h = k === 0 ? lc * s : -la * s; return [ou + (h + (k === 0 ? 0.37 : 0)) / 1.2, ov + (lu + gy0) / 1.2]; };
    const castUV = (ou, ov) => (k, s, la, lu, lc) => { if (k === 1) return [ou + la / 0.9, ov + lc / 0.9]; const h = k === 0 ? lc : la; return [ou + h / 0.9, ov + lu / 0.9]; };
    const plainUV = () => [0.5, 0.5];
    const frame = (q) => { const g = q.g; const A = [g.tx, 0, g.tz]; const C = [-g.tz, 0, g.tx]; return { A, C, inX: g.nx, inZ: g.nz }; };   // C = A x up
    const lanterns = []; const pillarsOut = []; const solidsOut = [];
    function pillar(q, idx) {
      const C0 = chunkOf(q.s); const { A, C } = frame(q); const gy = groundY(q.x, q.z); grow(C0, q.x, q.z);
      // footprint relief: sample the corners so the plinth never floats on a slope
      const spec = q.type === "gate" ? { pw: 1.1, pd: 1.1, ph: 0.22, bw: 0.92, bd: 0.92, bh: 2.3, cw: 1.14, cd: 1.14, ct: 0.1, tw: 0.7, td: 0.7, tt: 0.09 }
        : q.type === "marker" ? { pw: 1.26, pd: 0.8, ph: 0.18, bw: 1.1, bd: 0.66, bh: 1.56, cw: 1.26, cd: 0.82, ct: 0.08, tw: 0.98, td: 0.56, tt: 0.08 }
        : { pw: 0.7, pd: 0.7, ph: 0.16, bw: 0.58, bd: 0.58, bh: 1.36, cw: 0.74, cd: 0.74, ct: 0.07, tw: 0.46, td: 0.46, tt: 0.08 };
      let gmin = gy, gmax = gy; for (const [sa, sc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const y = groundY(q.x + A[0] * sa * spec.pw / 2 + C[0] * sc * spec.pd / 2, q.z + A[2] * sa * spec.pw / 2 + C[2] * sc * spec.pd / 2); gmin = Math.min(gmin, y); gmax = Math.max(gmax, y); }
      const base = gmax;   // the pillar stands on the high side; the plinth runs down into the low side
      if (q.type === "gate" && useModel) { const top = base + 2.75; lanterns.push({ x: q.x, y: base + 2.45, z: q.z, dim: 1 }); pillarsOut.push({ x: q.x, z: q.z, y: gmin, top, type: q.type, A, w: 0.7, d: 0.7 }); solidsOut.push([q.x, q.z, Math.atan2(-A[2], A[0]), 0.74, 0.74, gmin - 0.3, top]); q.gy = base; q.top = top; q.hw = 0.35; return; }
      const ou = hash(idx * 7 + 1), ov = hash(idx * 7 + 2);
      const plinthLo = gmin - 0.35, plinthHi = base + spec.ph; const pC = [q.x, (plinthLo + plinthHi) / 2, q.z];
      box(C0.stone, pC, A, UP, C, spec.pw / 2, (plinthHi - plinthLo) / 2, spec.pd / 2, stoneUV(ou, ov, (plinthLo + plinthHi) / 2 - base), [3]);
      const bLo = plinthHi, bHi = base + spec.bh; box(C0.stone, [q.x, (bLo + bHi) / 2, q.z], A, UP, C, spec.bw / 2, (bHi - bLo) / 2, spec.bd / 2, stoneUV(ou + 0.31, ov, (bLo + bHi) / 2 - base), [3]);
      // cap: slab and a shallow chamfer
      frustum(C0.cast, [q.x, 0, q.z], A, C, spec.cw / 2, spec.cd / 2, spec.cw / 2, spec.cd / 2, bHi, bHi + spec.ct, castUV(ou, ov), false);
      { const L2 = [[-spec.cw / 2, bHi, -spec.cd / 2], [spec.cw / 2, bHi, -spec.cd / 2], [spec.cw / 2, bHi, spec.cd / 2], [-spec.cw / 2, bHi, spec.cd / 2]]; C0.cast.quad(L2.map((p) => [q.x + A[0] * p[0] + C[0] * p[2], p[1], q.z + A[2] * p[0] + C[2] * p[2]]), L2.map(() => [ou, ov]), [0, -1, 0]); }
      frustum(C0.cast, [q.x, 0, q.z], A, C, spec.cw / 2, spec.cd / 2, spec.tw / 2, spec.td / 2, bHi + spec.ct, bHi + spec.ct + spec.tt, castUV(ou + 0.2, ov), true);
      const top = bHi + spec.ct + spec.tt;
      if (q.type === "marker") { for (const sgn of [1, -1]) { const pz = sgn * (spec.bd / 2 + 0.006); const pc = [q.x + C[0] * pz, base + 1.0, q.z + C[2] * pz]; const row = 0; const v0 = 1 - (row + 1) / PLAQUE_ROWS, v1 = 1 - row / PLAQUE_ROWS;
          box(C0.bronze, pc, A, UP, C, 0.4, 0.105, 0.012, (k, s, la, lu, lc) => { if (k === 2 && s === sgn) { const u = s > 0 ? la / 0.8 + 0.5 : -la / 0.8 + 0.5; return [u, v0 + (lu / 0.21 + 0.5) * (v1 - v0)]; } return [0.02, v0 + 0.02]; }, [2 * 2 + (sgn > 0 ? 1 : 0)]); } }
      if (q.type === "gate") {
        const lb = top; box(C0.metal, [q.x, lb + 0.025, q.z], A, UP, C, 0.23, 0.025, 0.23, plainUV); box(C0.metal, [q.x, lb + 0.07, q.z], A, UP, C, 0.17, 0.02, 0.17, plainUV);
        box(C0.glass, [q.x, lb + 0.3, q.z], A, UP, C, 0.155, 0.21, 0.155, plainUV);
        for (const [sa, sc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(C0.metal, [q.x + A[0] * sa * 0.175 + C[0] * sc * 0.175, lb + 0.3, q.z + A[2] * sa * 0.175 + C[2] * sc * 0.175], A, UP, C, 0.024, 0.23, 0.024, plainUV);
        box(C0.metal, [q.x, lb + 0.53, q.z], A, UP, C, 0.21, 0.018, 0.21, plainUV);
        frustum(C0.metal, [q.x, 0, q.z], A, C, 0.27, 0.27, 0.06, 0.06, lb + 0.548, lb + 0.72, plainUV, true);
        box(C0.metal, [q.x, lb + 0.77, q.z], A, UP, C, 0.02, 0.05, 0.02, plainUV);
        lanterns.push({ x: q.x, y: lb + 0.3, z: q.z, dim: /Outpost|North Yard|Observatory|Dark Sky/i.test((() => { try { const d = planDistrictAt(q.x, q.z); return (d && d.name) || ""; } catch (e) { return ""; } })()) ? 0.4 : 1 });
        if (q.gateName && q.gateRow > 0) { const row = q.gateRow; const v0 = 1 - (row + 1) / PLAQUE_ROWS, v1 = 1 - row / PLAQUE_ROWS;   // the gate's name, on both faces
          for (const sgn of [1, -1]) { const pz = sgn * (spec.bd / 2 + 0.006); const pc = [q.x + C[0] * pz, base + 1.55, q.z + C[2] * pz];
            box(C0.bronze, pc, A, UP, C, 0.3, 0.075, 0.012, (k, s, la, lu, lc) => { if (k === 2 && s === sgn) { const u = s > 0 ? la / 0.6 + 0.5 : -la / 0.6 + 0.5; return [u, v0 + (lu / 0.15 + 0.5) * (v1 - v0)]; } return [0.02, v0 + 0.02]; }, [2 * 2 + (sgn > 0 ? 1 : 0)]); } }
      }
      pillarsOut.push({ x: q.x, z: q.z, y: gmin, top, type: q.type, A, w: spec.bw, d: spec.bd });
      solidsOut.push([q.x, q.z, Math.atan2(-A[2], A[0]), spec.pw + 0.04, spec.pd + 0.04, gmin - 0.3, top]);
      q.gy = base; q.top = top; q.hw = spec.bw / 2;
    }
    function post(q, idx) { const C0 = chunkOf(q.s); const { A, C } = frame(q); const gy = groundY(q.x, q.z); grow(C0, q.x, q.z); const u0 = hash(idx * 3 + 5), band = Math.floor(hash(idx * 3 + 6) * 11) * BAND;
      const lo = gy - 0.3, hi = gy + 1.2; box(C0.timber, [q.x, (lo + hi) / 2, q.z], A, UP, C, 0.065, (hi - lo) / 2, 0.065, woodPost(u0, band, 0.065), [2]);
      frustum(C0.timber, [q.x, 0, q.z], A, C, 0.065, 0.065, 0.012, 0.012, hi, hi + 0.05, woodPost(u0, band, 0.065), true);
      q.gy = gy; q.top = hi; q.hw = 0.065; }
    // supports
    const gateRows = new Map(); plaqueNames.forEach((nm, i) => gateRows.set(nm, i + 1));
    for (let i = 0; i < LY.sup.length; i++) { const q = LY.sup[i]; if (q.brk) continue; if (q.dup) { q.gy = q.dup.gy; q.hw = q.dup.hw; q.top = q.dup.top; continue; } if (q.type === "gate") { const gt = LY.gates.find((g) => g.vehicle && (Math.abs(g.s0 - q.s) < 3 || Math.abs(g.s1 - q.s) < 3)); if (gt && gt.ours && gt.name && gateRows.has(gt.name)) { q.gateName = gt.name; q.gateRow = gateRows.get(gt.name); } } if (q.type === "post") post(q, i); else pillar(q, i); }
    // rails: three per bay, each end on the support it meets
    const RAILS = [0.34, 0.7, 1.06]; let nRails = 0, span = null;
    for (let i = 0; i < LY.sup.length - 1; i++) { const p = LY.sup[i], q = LY.sup[i + 1]; if (p.brk || q.brk) { span = null; continue; } const C0 = chunkOf(p.s); const dx = q.x - p.x, dz = q.z - p.z, dl = Math.hypot(dx, dz); if (dl < 0.3) continue;
      const hx = dx / dl, hz = dz / dl; const xa = p.x + hx * p.hw * 0.6, za = p.z + hz * p.hw * 0.6, xb = q.x - hx * q.hw * 0.6, zb = q.z - hz * q.hw * 0.6;
      for (let r = 0; r < RAILS.length; r++) { const ya = p.gy + RAILS[r], yb = q.gy + RAILS[r]; const vx = xb - xa, vy = yb - ya, vz = zb - za, vl = Math.hypot(vx, vy, vz); const A = [vx / vl, vy / vl, vz / vl];
        let U = [-A[0] * A[1], 1 - A[1] * A[1], -A[2] * A[1]]; const ul = Math.hypot(U[0], U[1], U[2]); U = [U[0] / ul, U[1] / ul, U[2] / ul]; const C = [A[1] * U[2] - A[2] * U[1], A[2] * U[0] - A[0] * U[2], A[0] * U[1] - A[1] * U[0]];
        const band = Math.floor(hash(i * 5 + r) * 11) * BAND, u0 = hash(i * 5 + r + 77);
        box(C0.timber, [(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2], A, U, C, vl / 2, 0.075, 0.03, woodRail(u0, band), [0, 1]); nRails++; }
      if (!span) span = { x: p.x, z: p.z, lo: p.gy, hi: p.gy }; span.lo = Math.min(span.lo, q.gy); span.hi = Math.max(span.hi, q.gy);
      if (q.type !== "post") { const sx = q.x - span.x, sz = q.z - span.z, sl2 = Math.hypot(sx, sz); if (sl2 > 0.3) solidsOut.push([(span.x + q.x) / 2, (span.z + q.z) / 2, Math.atan2(-sz / sl2, sx / sl2), sl2, 0.3, span.lo - 0.3, span.hi + 1.15]); span = null; } }
    // meshes
    const root = new THREE.Group(); root.name = "planBounds"; root.userData.noCull = true; root.userData.noInst = true;
    B.chunks = [];
    for (const C0 of ch) { if (C0.x0 > C0.x1) continue; const g = new THREE.Group(); g.userData.noInst = true; g.userData.noCull = true;
      const det = [];   // plaques and lanterns: small, only drawn near the camera
      for (const k of ["timber", "stone", "cast", "bronze", "metal", "glass"]) { const geo = C0[k].geo(); if (!geo) continue; const m = new THREE.Mesh(geo, MAT[k]); m.castShadow = k !== "glass"; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.userData.shSet = true; if (k === "glass") m.userData.noShadow = true; g.add(m); if (k === "bronze" || k === "metal" || k === "glass") det.push(m); }
      root.add(g); B.chunks.push({ g, det, cx: (C0.x0 + C0.x1) / 2, cz: (C0.z0 + C0.z1) / 2, hx: (C0.x1 - C0.x0) / 2 + 5, hz: (C0.z1 - C0.z0) / 2 + 5 }); }
    scene.add(root); B.root = root;
    // lantern glow (one additive draw, night only)
    if (lanterns.length) { const pos = new Float32Array(lanterns.length * 3), col = new Float32Array(lanterns.length * 3); lanterns.forEach((l, i) => { pos[i * 3] = l.x; pos[i * 3 + 1] = l.y + 0.02; pos[i * 3 + 2] = l.z; col[i * 3] = l.dim; col[i * 3 + 1] = l.dim; col[i * 3 + 2] = l.dim; });
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.computeBoundingSphere();
      const pm = new THREE.PointsMaterial({ size: 2.4, map: glowSprite(), vertexColors: true, color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      const pts = new THREE.Points(geo, pm); pts.userData.noInst = true; pts.userData.noShadow = true; pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 3; scene.add(pts); B.glow = pts; }
    B.lanterns = lanterns;
    // real light at the gates after dark: pooled by the engine (added before buildLightPool, the nearest few are lit)
    B.lights = []; for (const l of lanterns) { const pl = new THREE.PointLight(0xffc98a, 0, 15, 1.6); pl.position.set(l.x, l.y, l.z); pl.userData.dim = l.dim; pl.castShadow = false; scene.add(pl); B.lights.push(pl); }
    // solids: every rail run and pillar is a real barrier for anyone outside (inside, the soft stop keeps people 2 m clear)
    for (const s of solidsOut) addSolid(s[0], s[1], s[2], s[3], s[4], s[5], s[6], "bounds");
    // the stone_pillar model, once the asset exists: instanced at the gates within 420 m of the camera
    B.pillars = pillarsOut;
    try { if (useModel) setupGateModel(LY); } catch (e) { err("gate model", e); }
    B.stats.buildMs = Math.round(performance.now() - t0); B.stats.pillars = pillarsOut.length; B.stats.posts = LY.sup.filter((q) => q.type === "post").length; B.stats.rails = nRails;
    B.stats.markers = pillarsOut.filter((p) => p.type === "marker").length; B.stats.gatePillars = pillarsOut.filter((p) => p.type === "gate").length; B.stats.lanterns = lanterns.length; B.stats.chunks = B.chunks.length; B.stats.solids = solidsOut.length;
    B.pillars = pillarsOut;
  }
  // the asset team's stone entrance pillar (0.7 x 2.5 x 0.7, lantern on top) replaces the procedural gate pillars near the camera
  function setupGateModel(LY) {
    const src = makeModel("stone_pillar"); if (!src) return; src.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(src); const hgt = Math.max(0.1, bb.max.y - bb.min.y); const sc = 2.75 / hgt;
    const parts = []; src.traverse((o) => { if (o.isMesh && o.geometry) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
    const spots = B.pillars.filter((p) => p.type === "gate"); if (!spots.length || !parts.length) return;
    const meshes = parts.map((pt) => { const im = new THREE.InstancedMesh(pt.geo, pt.mat, spots.length); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.userData.noInst = true; scene.add(im); return im; });
    B.gateModel = { spots, parts, meshes, sc, y0: bb.min.y, at: 0 }; updateGateModel();
  }
  function updateGateModel() {
    const G = B.gateModel; if (!G) return; const cx = camera.position.x, cz = camera.position.z; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(G.sc, G.sc, G.sc), up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(); let n = 0;
    for (const p of G.spots) { if (Math.hypot(p.x - cx, p.z - cz) > 650) continue; q.setFromAxisAngle(up, Math.atan2(p.A[0], p.A[2])); m.compose(new THREE.Vector3(p.x, p.y + 0.02 - G.y0 * G.sc, p.z), q, s); G.meshes.forEach((im, i) => { M.multiplyMatrices(m, G.parts[i].m); im.setMatrixAt(n, M); }); n++; }
    for (const im of G.meshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
  }

  // ───────────────────────── the soft stop ─────────────────────────
  const S0 = { d: 0, nx: 0, nz: 0, qx: 0, qz: 0, e: 0 }, S1 = { d: 0, nx: 0, nz: 0, qx: 0, qz: 0, e: 0 };
  B.push = { at: 0, x0s: 1e9, nx: 0, nz: 0, mode: "" };
  function softStop(p, r) {
    if (!B.ready || !RING || inside) return;
    let mode = null, g = null;
    if (!riding) { if (!player || FLY.on || SITES.ride || SITES.bride || SITES.park || (golf && golf.playing) || RIDE_ON.id || RIDE.on) return; if (r !== (cartMode ? 1.4 : 0.6)) return; g = player; mode = cartMode ? "cart" : "walk"; }
    else { const V = VEH[riding.id]; if (!V || !V.g) return; if (riding.kind === "jet") { if (r !== 4) return; mode = "jet"; } else { if (r !== 1.6) return; mode = "veh"; } g = V.g; }
    const x0 = g.position.x, z0 = g.position.z; let x1 = p[0], z1 = p[1]; const mx = x1 - x0, mz = z1 - z0; if (Math.abs(mx) > 8 || Math.abs(mz) > 8) return;
    sdist(x0, z0, S0); const stop = STOP[mode]; const x0s = S0.d - stop;
    if (x0s > 60) { B.far = true; return; }
    const nx = S0.nx, nz = S0.nz; const u = mx * nx + mz * nz; const vA = x0s > 0 ? Math.sqrt(2 * ACC[mode] * x0s) : 0; const dt = Math.min(0.05, Math.max(0.004, B.dt));
    let clamped = false;
    if (u > 0) { const allow = x0s > 0 ? Math.min(u, vA * dt, x0s) : 0; if (allow < u - 1e-6) { x1 -= nx * (u - allow); z1 -= nz * (u - allow); clamped = true; } }
    sdist(x1, z1, S1); if (S1.d < stop && S1.d < S0.d) { const k = Math.min(stop, S0.d) - S1.d; if (k > 0) { x1 -= S1.nx * k; z1 -= S1.nz * k; clamped = true; } }
    // the speed too, so walkers slow to a stand and carts roll to a halt instead of pressing into an invisible wall
    if (mode === "walk") { const mvn = mv.x * nx + mv.z * nz; if (mvn > vA) { mv.x -= nx * (mvn - vA); mv.z -= nz * (mvn - vA); clamped = clamped || mvn > vA + 0.05; } }
    else { const ry = g.rotation.y; const hn = Math.sin(ry) * nx + Math.cos(ry) * nz; if (mode === "cart") { const ov = cartSpeed * hn; if (ov > vA && Math.abs(hn) > 0.22) { cartSpeed = vA / hn; clamped = true; } } else { const ov = vSpeed * hn; if (ov > vA && Math.abs(hn) > 0.22) { vSpeed = mode === "jet" ? Math.max(0, vA / hn) : vA / hn; clamped = true; } } }
    if (clamped) { B.push.at = performance.now(); B.push.x0s = x0s; B.push.nx = nx; B.push.nz = nz; B.push.mode = mode; B.push.x = x0; B.push.z = z0; }
    p[0] = x1; p[1] = z1;
  }

  // ───────────────────────── the HUD note ─────────────────────────
  function makeNote() {
    if (document.getElementById("edge-note")) return;
    const st = document.createElement("style"); st.textContent = `#edge-note{left:50%;bottom:112px;transform:translate(-50%,10px);display:flex;align-items:center;gap:12px;padding:9px 16px 9px 11px;border-radius:12px;background:var(--glass2,rgba(7,17,12,.8));border:1px solid var(--line,rgba(77,222,111,.3));opacity:0;transition:opacity .7s ease,transform .7s ease;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-width:min(560px,92vw);box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:4}
#edge-note.on{opacity:1;transform:translate(-50%,0)}
#edge-note svg{flex:0 0 auto;display:block}
#edge-note .et{font:700 9.5px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.2em;color:var(--green,#4DDE6F);text-transform:uppercase}
#edge-note .es{font:500 12.5px "Space Grotesk",system-ui,sans-serif;color:var(--cream,#f5f1e6);margin-top:3px;line-height:1.35}
@media (max-width:760px){#edge-note{bottom:112px}#edge-note .es{font-size:11.5px}}`;
    document.head.appendChild(st);
    const el = document.createElement("div"); el.id = "edge-note"; el.className = "hud"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    el.innerHTML = `<svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true"><rect x="1.5" y="5" width="6" height="17" rx="1" fill="#c9ad86" stroke="#0a1610" stroke-width="1"/><rect x="0.5" y="3.2" width="8" height="2.6" rx="0.6" fill="#e8dcc3"/><rect x="26.5" y="5" width="6" height="17" rx="1" fill="#c9ad86" stroke="#0a1610" stroke-width="1"/><rect x="25.5" y="3.2" width="8" height="2.6" rx="0.6" fill="#e8dcc3"/><rect x="16" y="8" width="2.2" height="14" fill="#a8845f"/><g fill="#8a6a4c"><rect x="7" y="9" width="20" height="2"/><rect x="7" y="13.5" width="20" height="2"/><rect x="7" y="18" width="20" height="2"/></g><circle cx="17" cy="2.4" r="1.6" fill="#4DDE6F"/></svg><div><div class="et"></div><div class="es"></div></div>`;
    document.body.appendChild(el); B.note = el;
  }
  function showNote(title, sub, ms) { const el = B.note; if (!el) return; el.querySelector(".et").textContent = title; el.querySelector(".es").textContent = sub; el.classList.add("on"); B.noteUntil = performance.now() + (ms || 5200); B.noteLast = [title, sub]; }
  B.showNote = showNote;
  function nearestGate(x, z, vehicleOnly) { let best = null, bd = 1e9; for (const gt of (B.layout && B.layout.gates) || []) { if (vehicleOnly && !gt.vehicle) continue; const d = Math.hypot(gt.x - x, gt.z - z); if (d < bd) { bd = d; best = gt; } } return best ? { g: best, d: bd } : null; }
  function inGateMouth(x, z) { for (const gt of (B.layout && B.layout.gates) || []) if (Math.hypot(gt.x - x, gt.z - z) < (gt.s1 - gt.s0) / 2 + 4) return gt; return null; }

  // ───────────────────────── the maps ─────────────────────────
  const MAPS = { aerial: null, bg: null, bgKey: "", cssBig: 0, bigAt: -1 };
  function mapFrame(big) { const bb = B.bb; const cx = (bb[0] + bb[1]) / 2, cz = (bb[2] + bb[3]) / 2, w = bb[1] - bb[0], h = bb[3] - bb[2]; if (!big) { const size = Math.max(w, h) + 2 * 52; return { x0: cx - size / 2, z0: cz - size / 2, size }; } const top = 30, bot = 34; const mpp = Math.max(h / (368 - top - bot), w / (368 - 44)); const size = 368 * mpp; return { x0: cx - size / 2, z0: bb[2] - top * mpp - ((368 - top - bot) * mpp - h) / 2, size }; }
  function ringPath(g, px, pz) { g.beginPath(); RING.forEach((q, i) => (i ? g.lineTo(px(q[0]), pz(q[1])) : g.moveTo(px(q[0]), pz(q[1])))); g.closePath(); }
  function mapBg(F, big, k) {
    const cv = mmc.canvas; const img = MAPS.aerial && MAPS.aerial.complete && MAPS.aerial.naturalWidth ? MAPS.aerial : (mmImg && mmImg.complete && mmImg.naturalWidth ? mmImg : null);
    const key = (big ? "b" : "s") + cv.width + ":" + (img ? img.src.length + ":" + img.naturalWidth : "none") + ":" + ROADS_MAIN.length + ":" + PLAN_WALKS.length + ":" + zoneRings.length + ":" + (B.layout ? B.layout.gates.length : 0);
    if (MAPS.bg && MAPS.bgKey === key) return MAPS.bg;
    const c = MAPS.bg || document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const g = c.getContext("2d"); const S = 368; g.setTransform(k, 0, 0, k, 0, 0);
    const px = (x) => ((x - F.x0) / F.size) * S, pz = (z) => ((z - F.z0) / F.size) * S;
    g.fillStyle = "#070f0a"; g.fillRect(0, 0, S, S);
    g.save(); g.strokeStyle = "rgba(245,241,230,0.035)"; g.lineWidth = 0.7; for (let t = -S; t < S * 2; t += 6) { g.beginPath(); g.moveTo(t, 0); g.lineTo(t - S, S); g.stroke(); } g.restore();
    { const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.35)"); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    g.save(); ringPath(g, px, pz); g.clip();
    if (img) { const iw = img.naturalWidth, ih = img.naturalHeight; const W = T.xmax - T.xmin, D = T.zmax - T.zmin; const bb = B.bb; const x0 = Math.max(T.xmin, bb[0] - 10), x1 = Math.min(T.xmax, bb[1] + 10), z0 = Math.max(T.zmin, bb[2] - 10), z1 = Math.min(T.zmax, bb[3] + 10);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(img, (x0 - T.xmin) / W * iw, (z0 - T.zmin) / D * ih, (x1 - x0) / W * iw, (z1 - z0) / D * ih, px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0)); }
    else { g.fillStyle = "#8a7457"; g.fillRect(0, 0, S, S); }
    g.fillStyle = "rgba(10,22,16,0.06)"; g.fillRect(0, 0, S, S);
    ringPath(g, px, pz); g.lineJoin = "round"; g.strokeStyle = "rgba(0,0,0,0.24)"; g.lineWidth = 10; g.stroke(); g.strokeStyle = "rgba(0,0,0,0.2)"; g.lineWidth = 3.6; g.stroke();
    g.restore();
    ringPath(g, px, pz); g.strokeStyle = "rgba(77,222,111,0.13)"; g.lineWidth = 6; g.stroke();
    // the static layers (they never move once the world is built): runway, roads, walks, district lines, the section line and its gates
    g.save(); ringPath(g, px, pz); g.clip();
    g.strokeStyle = "rgba(20,20,22,.9)"; g.lineWidth = 5; g.beginPath(); SITE.runway.forEach((p, i) => (i ? g.lineTo(px(p[0]), pz(p[1])) : g.moveTo(px(p[0]), pz(p[1])))); g.stroke();
    g.strokeStyle = big ? "rgba(222,198,150,.85)" : "rgba(222,198,150,.55)"; g.lineWidth = big ? 2.2 : 1.2; g.lineJoin = "round"; for (const r of ROADS_MAIN) { if (r.length < 2) continue; g.beginPath(); r.forEach((q, i) => (i ? g.lineTo(px(q[0]), pz(q[1])) : g.moveTo(px(q[0]), pz(q[1])))); g.stroke(); }
    g.strokeStyle = big ? "rgba(245,241,230,.8)" : "rgba(245,241,230,.5)"; g.lineWidth = big ? 1.6 : 1; for (const r of PLAN_WALKS) { if (r.length < 2) continue; g.beginPath(); r.forEach((q, i) => (i ? g.lineTo(px(q[0]), pz(q[1])) : g.moveTo(px(q[0]), pz(q[1])))); g.stroke(); }
    for (const z of zoneRings) { g.strokeStyle = z.col || "rgba(77,222,111,.42)"; g.lineWidth = big ? 1.5 : 1.2; g.setLineDash([4, 4]); g.beginPath(); if (z.poly) { z.poly.forEach((q, i) => (i ? g.lineTo(px(q[0]), pz(q[1])) : g.moveTo(px(q[0]), pz(q[1])))); g.closePath(); } else g.arc(px(z.center[0]), pz(z.center[1]), (z.r / F.size) * S, 0, 6.283); g.stroke(); g.setLineDash([]); }
    g.restore();
    g.save(); g.lineJoin = "round"; ringPath(g, px, pz); g.strokeStyle = "rgba(4,10,6,.9)"; g.lineWidth = big ? 3.2 : 2.6; g.stroke(); g.strokeStyle = "rgba(245,241,230,.97)"; g.lineWidth = big ? 1.5 : 1.15; g.stroke();
    if (B.layout) for (const gt of B.layout.gates) { if (!gt.vehicle && !big) continue; const gx = px(gt.x), gz = pz(gt.z); const r0 = gt.vehicle ? (big ? 3.2 : 2.4) : 1.8; g.fillStyle = "#0a1610"; g.beginPath(); g.arc(gx, gz, r0 + 1.1, 0, 6.283); g.fill(); g.fillStyle = gt.vehicle ? "#f4cd5a" : "rgba(245,241,230,.9)"; g.beginPath(); g.arc(gx, gz, r0, 0, 6.283); g.fill(); }
    g.restore();
    MAPS.bg = c; MAPS.bgKey = key; return c;
  }
  function bigBacking() { let css = MAPS.cssBig; if (!css || MAPS.bigAt !== innerWidth * 10000 + innerHeight) { try { css = document.getElementById("mm").getBoundingClientRect().width; } catch (e) {} if (!css || css < 200) css = Math.min(innerHeight * 0.82, innerWidth * 0.92); MAPS.cssBig = css; MAPS.bigAt = innerWidth * 10000 + innerHeight; } return Math.max(368, Math.min(1400, Math.round(css * Math.min(2, window.devicePixelRatio || 1)))); }
  function drawMap() {
    if (!NAV.built) { NAV.built = true; buildPlaces(); }
    const mmEl = $("#mm"); const big = mmEl.classList.contains("big"); const cv = mmc.canvas; const want = big ? bigBacking() : 368; if (cv.width !== want) { cv.width = want; cv.height = want; }
    const S = 368, k = cv.width / S; mmc.setTransform(k, 0, 0, k, 0, 0);
    const F = mapFrame(big); const px = (x) => ((x - F.x0) / F.size) * S, pz = (z) => ((z - F.z0) / F.size) * S; B.mapF = F;
    mmc.clearRect(0, 0, S, S); const bg = mapBg(F, big, k); mmc.setTransform(1, 0, 0, 1, 0, 0); mmc.drawImage(bg, 0, 0); mmc.setTransform(k, 0, 0, k, 0, 0);
    for (const fn of B.mapLayers) { try { fn(mmc, px, pz, S, big); } catch (e) {} }
    { const tx = T.xmax; try { T.xmax = T.xmin + F.size; mapLabels(px, pz, S, big); } finally { T.xmax = tx; } }
    if (NAV.to) { const tx = px(NAV.to.x), tz = pz(NAV.to.z), mx = px(player.position.x), mz = pz(player.position.z); mmc.strokeStyle = "rgba(244,205,90,.9)"; mmc.lineWidth = big ? 2 : 1.5; mmc.setLineDash([6, 5]); mmc.beginPath(); mmc.moveTo(mx, mz); mmc.lineTo(tx, tz); mmc.stroke(); mmc.setLineDash([]); const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300); mmc.fillStyle = "#f4cd5a"; mmc.beginPath(); mmc.moveTo(tx, tz - 9 - pulse * 3); mmc.lineTo(tx + 6, tz); mmc.lineTo(tx, tz + 9 + pulse * 3); mmc.lineTo(tx - 6, tz); mmc.closePath(); mmc.fill(); mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 1.5; mmc.stroke(); }
    if (big) { document.body.classList.add("mapopen"); mmc.fillStyle = "rgba(10,22,16,.82)"; mmc.fillRect(0, 0, S, 24); mmc.fillStyle = "#4DDE6F"; mmc.font = "700 11px 'JetBrains Mono', monospace"; mmc.textAlign = "left"; mmc.textBaseline = "middle"; mmc.fillText("SITE MAP", 10, 12); mmc.fillStyle = "rgba(245,241,230,.75)"; mmc.font = "500 8.5px 'JetBrains Mono', monospace"; mmc.textAlign = "right"; mmc.fillText("place = guide me there · ground = travel", S - 10, 12);
      const sb = 500 / F.size * S; mmc.fillStyle = "rgba(10,22,16,.7)"; mmc.fillRect(8, S - 26, sb + 16, 18); mmc.fillStyle = "#f5f1e6"; mmc.fillRect(16, S - 14, sb, 2); mmc.fillRect(16, S - 18, 1.5, 8); mmc.fillRect(16 + sb, S - 18, 1.5, 8); mmc.font = "500 9px 'JetBrains Mono', monospace"; mmc.textAlign = "left"; mmc.fillText("500 m", 16 + sb + 6, S - 17);
      mmc.fillStyle = "rgba(10,22,16,.7)"; mmc.beginPath(); mmc.arc(S - 22, 44, 14, 0, 6.283); mmc.fill(); mmc.fillStyle = "#f5f1e6"; mmc.beginPath(); mmc.moveTo(S - 22, 33); mmc.lineTo(S - 17, 50); mmc.lineTo(S - 22, 46); mmc.lineTo(S - 27, 50); mmc.closePath(); mmc.fill(); mmc.font = "700 8px 'JetBrains Mono', monospace"; mmc.textAlign = "center"; mmc.fillText("N", S - 22, 27);
      let lx = S - 10; mmc.font = "500 9px 'JetBrains Mono', monospace"; mmc.textAlign = "right"; for (const [cat, names, col] of [...NAV_CATS].reverse()) { const w = mmc.measureText(cat).width; mmc.fillStyle = "rgba(10,22,16,.7)"; mmc.fillRect(lx - w - 18, S - 26, w + 20, 18); mmc.fillStyle = "#f5f1e6"; mmc.fillText(cat, lx - 2, S - 17); mmc.fillStyle = col; mmc.beginPath(); mmc.arc(lx - w - 9, S - 17, 3.5, 0, 6.283); mmc.fill(); lx -= w + 24; void names; }
      const list = $("#places-list"); if (list && performance.now() - NAV.at > 500) { NAV.at = performance.now(); list.querySelectorAll("[data-d]").forEach((el) => { const h = HUBS.find((q) => q[0] === el.dataset.d); if (h) el.textContent = fmtDist(Math.hypot(h[1] - player.position.x, h[2] - player.position.z)); }); } }
    else document.body.classList.remove("mapopen");
    if (SITES.stops) for (const st of SITES.stops) { mmc.fillStyle = "#f5f1e6"; mmc.beginPath(); mmc.arc(px(st.x), pz(st.z), 3, 0, 6.283); mmc.fill(); mmc.strokeStyle = "#4DDE6F"; mmc.lineWidth = 1.5; mmc.stroke(); } if (SITES.carts) for (const c of SITES.carts) { mmc.fillStyle = "#4DDE6F"; mmc.beginPath(); mmc.arc(px(c.g.position.x), pz(c.g.position.z), 3.5, 0, 6.283); mmc.fill(); }
    const inF = (x, y) => x > -4 && y > -4 && x < S + 4 && y < S + 4;
    if (view && view.vehicles) for (const v of Object.values(view.vehicles)) { const vx = px(v.x), vz = pz(v.z); if (!inF(vx, vz)) continue; mmc.fillStyle = v.kind === "jet" ? "#ffd166" : "#9be7ff"; mmc.beginPath(); mmc.arc(vx, vz, 4, 0, 6.283); mmc.fill(); }
    if (view) for (const [id, p] of Object.entries(view.players)) { if (id === ME) continue; const qx = px(p.x), qz = pz(p.z); if (!inF(qx, qz)) continue; mmc.fillStyle = "rgba(245,241,230,.9)"; mmc.beginPath(); mmc.arc(qx, qz, 4, 0, 6.283); mmc.fill(); }
    { let mx = px(player.position.x), mz = pz(player.position.z); const off = mx < 8 || mz < 8 || mx > S - 8 || mz > S - 8; mx = Math.max(8, Math.min(S - 8, mx)); mz = Math.max(8, Math.min(S - 8, mz)); const a = Math.atan2(-Math.sin(yaw), -Math.cos(yaw)); mmc.fillStyle = "rgba(77,222,111,.28)"; mmc.beginPath(); mmc.moveTo(mx, mz); mmc.arc(mx, mz, 26, a - Math.PI / 2 - 0.5, a - Math.PI / 2 + 0.5); mmc.closePath(); mmc.fill(); const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350); mmc.strokeStyle = `rgba(77,222,111,${(0.7 * (1 - pulse)).toFixed(2)})`; mmc.lineWidth = 2; mmc.beginPath(); mmc.arc(mx, mz, 7 + pulse * 9, 0, 6.283); mmc.stroke(); mmc.fillStyle = off ? "rgba(77,222,111,.6)" : "#4DDE6F"; mmc.beginPath(); mmc.arc(mx, mz, 6, 0, 6.283); mmc.fill(); mmc.strokeStyle = "#0a1610"; mmc.lineWidth = 2; mmc.stroke(); }
  }
  function mapClick(e) {
    if (!B.ready || !T) return; e.stopImmediatePropagation(); e.preventDefault(); const mm = $("#mm");
    if (!mm.classList.contains("big")) { mm.classList.add("big"); mm._openedAt = performance.now(); if (document.exitPointerLock) document.exitPointerLock(); setStatus("Site map · click anywhere to travel there · Esc or click again to close"); drawMinimap(); return; }
    if (performance.now() - (mm._openedAt || 0) < 450) return;
    const r = mm.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    { const hx = u * 368, hy = v * 368; const hit = MAP_HITS.find((b) => hx >= b.x - 3 && hx <= b.x + b.w + 3 && hy >= b.y - 3 && hy <= b.y + b.h + 3); if (hit) { mm.classList.remove("big"); document.body.classList.remove("mapopen"); navTo(hit.name); return; } }
    mm.classList.remove("big"); document.body.classList.remove("mapopen");
    const F = mapFrame(true); let x = F.x0 + u * F.size, z = F.z0 + v * F.size; [x, z] = clampInside(x, z, STOP.walk + 10); [x, z] = snapToBuilt(x, z); warpTo(x, z); sfx("ui");
  }

  // ───────────────────────── the hooks ─────────────────────────
  function keepHook() {   // first world hook: the ring and a clear strip along the fence line, before anything is planted
    if (!window.PLAN) return; setRing(sectionRing());
    try { const P = offsetRing(RING, 0.2), Q = offsetRing(RING, 2.5); for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; planKeepout([P[i], P[j], Q[j], Q[i]]); } } catch (e) { err("keepout", e); }
  }
  function worldHook() {
    if (!window.PLAN) return; if (!RING) setRing(sectionRing());
    // overrides (client function declarations are writable globals)
    try { const orig = collide; collide = function (x, z, r) { const out = orig(x, z, r); try { softStop(out, r); } catch (e) { if (!B.softErr) { B.softErr = true; err("softStop", e); } } return out; }; } catch (e) { err("collide", e); }
    try { const orig = warpTo; warpTo = function (x, z, y) { try { if (B.ready && typeof x === "number" && typeof z === "number") [x, z] = clampInside(x, z, STOP.walk + 8); } catch (e) {} return orig.call(this, x, z, y); }; } catch (e) { err("warpTo", e); }
    try { const orig = planLandOK; planLandOK = function (x, z) { if (RING && sdist(x, z, {}).d < STOP.walk + 1.5) return false; return orig.call(this, x, z); }; } catch (e) { err("planLandOK", e); }
    try { const orig = leaveShuttle; leaveShuttle = function () { try { const c = SITES.ride; if (B.ready && c && c.g && sdist(c.g.position.x, c.g.position.z, {}).d < STOP.walk) { const now = performance.now(); if (now - (B.shuttleMsg || 0) > 2500) { B.shuttleMsg = now; setStatus("the shuttle is on the public section road · you can hop off at the next gate"); } return; } } catch (e) {} return orig.apply(this, arguments); }; } catch (e) { err("leaveShuttle", e); }
    try { drawMinimap = drawMap; } catch (e) { err("drawMinimap", e); }
    try { const mm = document.getElementById("mm"); if (mm && !mm._e3) { mm._e3 = true; mm.addEventListener("click", mapClick, true); } } catch (e) { err("map click", e); }
    try { MAPS.aerial = new Image(); MAPS.aerial.decoding = "async"; MAPS.aerial.src = "/ground.jpg"; } catch (e) {}
    try { makeNote(); } catch (e) { err("note", e); }
  }
  function deferHook() {
    if (!window.PLAN || !RING) return;
    try { B.layout = layout(); } catch (e) { err("layout", e); }
    try { if (B.layout) buildFence(B.layout); } catch (e) { err("fence", e); }
    B.ready = true;
  }
  function tickHook(dt) { B.dt = dt || B.dt; }
  let FR = 0;
  function frameHook(dt, now) {
    if (!B.ready || !player) return; FR++; if (!B.readyAt) B.readyAt = now;
    // chunk range culling and the night lanterns
    const jump = B.cullAt ? Math.hypot(camera.position.x - B.cullAt[0], camera.position.z - B.cullAt[1]) > 40 : true;
    if ((FR % 12 === 0 || jump) && B.chunks) { const cx = camera.position.x, cz = camera.position.z; B.cullAt = [cx, cz]; const air = camera.position.y - getH(cx, cz); const R = air > 80 ? 1250 : 540, RD = air > 80 ? 420 : 260;
      for (const c of B.chunks) { const dx = Math.max(0, Math.abs(cx - c.cx) - c.hx), dz = Math.max(0, Math.abs(cz - c.cz) - c.hz); const d2 = dx * dx + dz * dz; c.g.visible = d2 < R * R; const near = d2 < RD * RD; for (const m of c.det) m.visible = near; }
      if (B.gateModel) updateGateModel(); }
    if (B.mats && FR % 6 === 0) { const nk = Math.max(0, Math.min(1, (night - 0.25) / 0.55)); if (Math.abs(nk - (B.nk === undefined ? -1 : B.nk)) > 0.01) { B.nk = nk; B.mats.glass.emissiveIntensity = 0.05 + nk * 2.4; if (B.glow) { B.glow.visible = nk > 0.02; B.glow.material.opacity = nk * 0.9; } if (B.lights) for (const l of B.lights) l.intensity = nk * 1.1 * l.userData.dim; } }
    // the note: once per approach, when the ease has brought you close to the stop line
    const p = B.push; if (now - p.at < 350) { const close = p.mode === "walk" ? 2.2 : p.mode === "jet" ? 30 : 6; if (p.x0s < close && B.armed !== false) { B.armed = false; const gt = inGateMouth(p.x, p.z); const road = sideRoad(p.nx, p.nz);
        showNote("The edge of Genesis One", gt && gt.vehicle ? `This gate opens onto ${road}, a public county road. Turn around to keep exploring.` : `This fence is the section line, with ${road} beyond it. Turn around to keep exploring.`); } }
    if (FR % 15 === 0) { const s = sdist(player.position.x, player.position.z, {}); const onFoot = !riding && !FLY.on && !SITES.ride && !SITES.bride && !inside;
      if (s.d - STOP.walk > 20) B.armed = true;
      if (onFoot && s.d < -1.5) { if (!B.outShown) { B.outShown = true; const ng = nearestGate(player.position.x, player.position.z, true); showNote("Outside Genesis One", ng ? `The nearest gate is ${Math.round(ng.d / 10) * 10} m to the ${compass8(ng.g.x - player.position.x, ng.g.z - player.position.z)}: ${ng.g.name || "a public gate"}.` : "Head back toward the fence line and in through a gate."); } } else if (s.d > 2) B.outShown = false;
      // someone who starts outside (an old saved spot) is brought in once, at the start
      if (!B.rescued && FR > 20 && now - B.readyAt < 30000 && onFoot && s.d < -1.5 && s.d > -2500) { B.rescued = true; try { const [x, z] = clampInside(player.position.x, player.position.z, STOP.walk + 10); warpTo(x, z); } catch (e) {} }
      if (now - B.readyAt > 30000) B.rescued = true; }
    if (B.noteUntil && now > B.noteUntil) { B.noteUntil = 0; if (B.note) B.note.classList.remove("on"); }
  }
  HOOKS.world.unshift({ name: "boundsKeep", fn: () => { try { keepHook(); } catch (e) { err("keep", e); } } });
  HOOKS.world.push({ name: "boundsWorld", fn: () => { try { worldHook(); } catch (e) { err("world", e); } } });
  HOOKS.defer.push({ name: "boundsDefer", fn: () => { try { deferHook(); } catch (e) { err("defer", e); B.ready = !!RING; } } });
  HOOKS.interior.push({ name: "boundsTick", fn: (dt) => { tickHook(dt); } });
  HOOKS.frame.push({ name: "boundsFrame", fn: (dt, now) => { try { frameHook(dt, now); } catch (e) { if (!B.frameErr) { B.frameErr = true; err("frame", e); } } } });
})();
