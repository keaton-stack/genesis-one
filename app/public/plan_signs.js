// Genesis One master plan: the wayfinding system (B1) from PLAN.signs, PLAN.sign_families and
// PLAN.genesis_park.sign_family_variants. Loaded before client.js; classic script, so everything lives in one IIFE
// and only window.PLAN_HOOKS / window.PLAN_SIGNS are touched at load. Client globals are reached by bare name at hook time.
//
// world hook : read the 741 signs, resolve each one to a free spot (never on a carriageway, never inside a building,
//              lamp, tree or another sign), orient it (junction lines, street tangents, plazas, portals) and reserve
//              colliders so nothing is scattered through it.
// defer hook : build every family at the final ground height as instanced structure (posts, blades, walls, slabs,
//              cabinets, bollards) plus merged totems (and the brass line only when plan_outpost.js, which owns it,
//              is absent); text is not built here. Signs listed in window.PLAN_SKIP are left to other modules.
// frame hook : a small pool of canvas text planes per family follows the camera: only signs within about 60 m get
//              their text drawn (a few ms when a sign enters range, nothing otherwise); night glow; the live kiosk map.
(function () {
  "use strict";
  window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
  const HOOKS = window.PLAN_HOOKS;
  const API = (window.PLAN_SIGNS = window.PLAN_SIGNS || {});
  const ST = { recs: [], tunnel: [], placed: false, built: false, pools: {}, frame: 0, glow: -1, nudged: [], unresolved: [], lines: [], byName: new Map(), meshes: 0, fontsOk: false };
  API.state = ST;

  // ------------------------- constants -------------------------
  const HEX = { S1: "#4DDE6F", S2: "#f4cd5a", S3: "#6fd6e8", AIRPORT: "#f5f1e6", GP: "#c47a45" };
  const NAMED = { "stage one green": HEX.S1, "stage two gold": HEX.S2, "stage three cyan": HEX.S3, "genesis park copper": HEX.GP, "city airport white": HEX.AIRPORT };
  const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const NUMW = { One: "01", Two: "02", Three: "03" };
  const VEHICLE = new Set(["perimeter", "taxilane", "gateway", "street", "avenue", "service", "lane", "parkway", "tunnel"]);
  const FD = "Anton, Impact, 'Arial Narrow', sans-serif";
  const FB = "'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
  const FM = "'JetBrains Mono', Consolas, ui-monospace, monospace";
  const FS = "Georgia, 'Times New Roman', serif";
  const HL_WALKS = ["sun_gate_walk", "hl1_club_walk", "hl3_main_street", "hl4_sculpture_ave", "hl5_launch_walk"];
  // text pools: canvas size per family, pool ceiling, text radius (m)
  const KIND = {
    fp: { w: 448, h: 7 * 92, max: 12, R: 60 },
    bl: { w: 384, h: 4 * 84, max: 12, R: 55 },
    ki: { w: 512, h: 832, max: 4, R: 60 },
    mo: { w: 1024, h: 436, max: 3, R: 95 },
    dm: { w: 192, h: 584, max: 10, R: 60 },
    tb: { w: 192, h: 288, max: 8, R: 40 },
    tm: { w: 512, h: 128, max: 4, R: 85 },
    rw: { w: 1536, h: 320, max: 5, R: 95 },
  };

  // ------------------------- small helpers -------------------------
  const clean = (t) => String(t == null ? "" : t).replace(/[\u2014\u2013]/g, ", ").replace(/\s*\(a City sign by agreement\)/gi, "").replace(/\s{2,}/g, " ").trim();
  const hexOf = (name) => NAMED[String(name || "").toLowerCase().trim()] || null;
  const dirOf = (deg) => { const a = deg * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };   // bearing (0 north, 90 east) -> world (x, z)
  const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
  function segDist(x, z, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1e-9; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); const px = ax + vx * t, pz = az + vz * t; return [Math.hypot(x - px, z - pz), px, pz, t]; }
  function inPoly(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function polyEdgeDist(poly, x, z) { let d = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1])[0]); return d; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  // a tiny spatial hash for points / segments
  function Grid(C) { this.C = C; this.m = new Map(); }
  Grid.prototype.key = function (cx, cz) { return cx * 100003 + cz; };
  Grid.prototype.addBox = function (x0, z0, x1, z1, item) { const C = this.C; for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) { const k = this.key(cx, cz); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(item); } };
  Grid.prototype.near = function (x, z, r, fn) { const C = this.C; const seen = new Set(); for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) { const a = this.m.get(this.key(cx, cz)); if (!a) continue; for (const it of a) { if (seen.has(it)) continue; seen.add(it); if (fn(it) === true) return true; } } return false; };

  // the walkable surface: terrain, or the top of any ribbon / plaza mesh (the walk grid is the real mesh height)
  function surf(x, z) { let y = getH(x, z); try { const w = walkAt(x, z); if (w !== null && w > y - 0.6 && w < y + 3) y = Math.max(y, w); } catch (e) {} return y; }
  function baseY(x, z, th, pts) { let y = 1e9; const c = Math.cos(th), s = Math.sin(th); for (const [lx, lz] of pts) y = Math.min(y, surf(x + lx * c + lz * s, z - lx * s + lz * c)); return y; }

  function parseFace(f) {
    const p = clean(f).split("|").map((q) => q.trim()).filter(Boolean);
    if (p.length >= 5 && COMPASS[p[1]] !== undefined) return { kind: "dir", name: p[0], dir: p[1], bearing: COMPASS[p[1]], dist: p[2], mins: p[3], colour: hexOf(p[4]) || HEX.S1, vias: p.slice(5) };
    let colour = null; const lines = []; for (const q of p) { const h = hexOf(q); if (h) colour = h; else lines.push(q); }
    return { kind: "info", lines, colour: colour || HEX.AIRPORT };
  }

  // ------------------------- world hook: place -------------------------
  function gatherLines(P) {
    const out = [];
    for (const r of P.roads || []) if (r.pts && r.pts.length > 1 && r.class !== "tunnel") out.push({ id: r.id, name: clean(r.name), cls: r.class, veh: VEHICLE.has(r.class) || /rover/i.test(r.surface || ""), w: r.width || 6, pts: r.pts, prom: false });
    for (const r of P.promenades || []) if (r.pts && r.pts.length > 1) out.push({ id: r.id, name: clean(r.name), cls: "prom", veh: false, w: r.width || 8, pts: r.pts, prom: true });
    return out;
  }
  function nearestLine(x, z, pred, maxD) {
    let best = null; ST.lineGrid.near(x, z, maxD || 80, (sg) => { const L = sg.L; if (pred && !pred(L)) return; const r = segDist(x, z, sg.ax, sg.az, sg.bx, sg.bz); if (!best || r[0] < best.d) { const len = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) || 1; best = { d: r[0], px: r[1], pz: r[2], tx: (sg.bx - sg.ax) / len, tz: (sg.bz - sg.az) / len, L }; } });
    return best;
  }
  // directions of the lines leaving a junction (for fingerpost arms: each arm points down the walk you take)
  function junctionDirs(jx, jz) {
    const out = []; ST.lineGrid.near(jx, jz, 12, (sg) => { const r = segDist(jx, jz, sg.ax, sg.az, sg.bx, sg.bz); if (r[0] > Math.max(4, sg.L.w / 2 + 1.5)) return; const len = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) || 1; const tx = (sg.bx - sg.ax) / len, tz = (sg.bz - sg.az) / len;
      if (r[3] > 0.02 || Math.hypot(jx - sg.ax, jz - sg.az) > 3) out.push(bearingOf(-tx, -tz)); if (r[3] < 0.98 || Math.hypot(jx - sg.bx, jz - sg.bz) > 3) out.push(bearingOf(tx, tz)); });
    return out;
  }
  function carriageAt(x, z, rad) { let hit = null; ST.carrGrid.near(x, z, rad + 14, (sg) => { const r = segDist(x, z, sg.ax, sg.az, sg.bx, sg.bz); const need = sg.hw + rad + 0.3; if (r[0] < need && (!hit || need - r[0] > hit.pen)) hit = { pen: need - r[0], px: r[1], pz: r[2], d: r[0], sg }; }); return hit; }
  function blockedAt(x, z, rad, self) {
    if (carriageAt(x, z, rad)) return "road";
    if (ST.bldGrid.near(x, z, rad + 1, (b) => { if (x < b.bb[0] - rad - 0.5 || x > b.bb[1] + rad + 0.5 || z < b.bb[2] - rad - 0.5 || z > b.bb[3] + rad + 0.5) return; if (inPoly(b.poly, x, z) || polyEdgeDist(b.poly, x, z) < rad + 0.35) return true; })) return "building";
    if (ST.ptGrid.near(x, z, rad + 2, (c) => { if (c.self === self) return; if (Math.hypot(c.x - x, c.z - z) < c.r + rad + 0.12) return true; })) return "object";
    return null;
  }
  function footBlocked(x, z, th, foot, self) { const c = Math.cos(th), s = Math.sin(th); for (const [lx, lz, r] of foot) { const b = blockedAt(x + lx * c + lz * s, z - lx * s + lz * c, r, self); if (b) return b; } return null; }
  function resolveSpot(rec) {
    const foot = rec.foot; let x = rec.x, z = rec.z; const th = rec.th || 0;
    // push out of carriageways first (perpendicular to the ribbon), a few rounds for crossings
    for (let it = 0; it < 8; it++) { const c = Math.cos(th), s = Math.sin(th); let moved = false;
      for (const [lx, lz, r] of foot) { const fx = x + lx * c + lz * s, fz = z - lx * s + lz * c; const h = carriageAt(fx, fz, r); if (!h) continue; let nx = fx - h.px, nz = fz - h.pz; let L = Math.hypot(nx, nz); if (L < 1e-3) { nx = -(h.sg.bz - h.sg.az); nz = h.sg.bx - h.sg.ax; L = Math.hypot(nx, nz) || 1; } x += nx / L * (h.pen + 0.05); z += nz / L * (h.pen + 0.05); moved = true; break; }
      if (!moved) break; }
    let why = footBlocked(x, z, th, foot, rec);
    if (!why) return [x, z, Math.hypot(x - rec.x, z - rec.z)];
    const x0 = x, z0 = z; const a0 = hashStr(rec.id) * 6.283;
    for (const r of [0.4, 0.7, 1.0, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0]) for (let k = 0; k < 16; k++) { const a = a0 + k / 16 * 6.283; const cx = x0 + Math.cos(a) * r, cz = z0 + Math.sin(a) * r; if (!footBlocked(cx, cz, th, foot, rec)) return [cx, cz, Math.hypot(cx - rec.x, cz - rec.z)]; }
    ST.unresolved.push({ id: rec.id, fam: rec.fam, why, x: rec.x, z: rec.z });
    return [x0, z0, Math.hypot(x0 - rec.x, z0 - rec.z)];
  }
  function reservePoint(rec, x, z, r) { const it = { x, z, r, self: rec }; ST.ptGrid.addBox(x - r, z - r, x + r, z + r, it); }

  function nearestDistrict(x, z) { let best = null, bd = 1e9; for (const d of window.PLAN.districts || []) { if (!d.poly) continue; const dd = planInPoly(d.poly, x, z) ? 0 : polyEdgeDist(d.poly, x, z); if (dd < bd) { bd = dd; best = d; } } return best; }
  function stageFromText(t) { const m = /Stage (One|Two|Three)\b/i.exec(t || ""); return m ? { one: "S1", two: "S2", three: "S3" }[m[1].toLowerCase()] : null; }
  function classify(s) {
    const d = (typeof planDistrictAt === "function" ? planDistrictAt(s.x, s.z) : null) || nearestDistrict(s.x, s.z);
    let stage = d ? planStageOf(d) : null; let gp = s.park === "genesis_park" || /^gp_/.test(s.id) || stage === "GP"; if (gp) stage = "GP"; if (!stage) stage = s.city_item ? "AIRPORT" : "S1";
    const all = (s.faces || []).join(" | ");
    if (s.type === "gateway" || s.type === "totem") { if (/^(SOLPORT|SUNFIELD|DOUGLAS MUNICIPAL)/i.test(all)) { stage = "AIRPORT"; gp = false; } else if (/^GENESIS PARK/i.test(all)) { stage = "GP"; gp = true; } else { const st = stageFromText(all); if (st) { stage = st; gp = false; } } }
    const rec = { id: s.id, s, type: s.type, x: s.x, z: s.z, x0: s.x, z0: s.z, stage, gp, district: d ? d.name : null, theme: d ? (d.theme || "") : "", th: 0 };
    if (s.type === "gateway") { const sc = String(s.scale || ""); rec.fam = /monument/.test(sc) ? "mo" : "dm"; rec.coBrand = /co-branded/.test(sc) || (gp && /monument/.test(sc)); rec.ped = /pedestrian/.test(sc); }
    else rec.fam = { fingerpost: "fp", blade: "bl", kiosk: "ki", trailblazer: "tb", totem: "tm", runway: "rw" }[s.type] || null;
    return rec;
  }

  function placeSigns() {
    const P = window.PLAN; if (!P || !Array.isArray(P.signs)) return;
    const skip = window.PLAN_SKIP;
    ST.lines = gatherLines(P); ST.lineGrid = new Grid(40);
    for (const L of ST.lines) { if (!ST.byName.has(L.name)) ST.byName.set(L.name, []); ST.byName.get(L.name).push(L); const p = L.pts; for (let i = 0; i < p.length - 1; i++) { const sg = { ax: p[i][0], az: p[i][1], bx: p[i + 1][0], bz: p[i + 1][1], L }; ST.lineGrid.addBox(Math.min(sg.ax, sg.bx), Math.min(sg.az, sg.bz), Math.max(sg.ax, sg.bx), Math.max(sg.az, sg.bz), sg); } }
    // carriageways as drawn (ROADS): plan vehicle roads, the Main Street carriageway, and non-plan pavement (City taxiways, aprons, runway)
    ST.carrGrid = new Grid(30); const roadCls = new Map(); for (const L of ST.lines) if (!L.prom) roadCls.set(L.id, L.veh);
    ST.carrN = 0; for (const r of ROADS) { if (!r || !r.pts || r.pts.length < 2 || !(r.w > 0)) continue; let veh; if (r.plan) { if (roadCls.has(r.plan)) veh = roadCls.get(r.plan); else if (r.plan === "hl3_main_street") veh = r.w >= 15; else veh = false; } else veh = true; if (!veh) continue; ST.carrN++;
      const p = r.pts, hw = r.w / 2; for (let i = 0; i < p.length - 1; i++) { const sg = { ax: p[i][0], az: p[i][1], bx: p[i + 1][0], bz: p[i + 1][1], hw, id: r.plan || "site" }; ST.carrGrid.addBox(Math.min(sg.ax, sg.bx) - hw, Math.min(sg.az, sg.bz) - hw, Math.max(sg.ax, sg.bx) + hw, Math.max(sg.az, sg.bz) + hw, sg); } }
    // building footprints (jets excluded: the airfield signs stand by their stands on purpose)
    ST.bldGrid = new Grid(40); for (const b of P.buildings || []) { if (!b.poly || b.poly.length < 3 || b.kind === "jet") continue; const bb = planBB(b.poly); ST.bldGrid.addBox(bb[0], bb[2], bb[1], bb[3], { poly: b.poly, bb }); }
    // small things already standing: lamps, allee trees, solar bollards, fountains
    ST.ptGrid = new Grid(20); for (const c of COLLIDERS) if (c[2] < 1.8) ST.ptGrid.addBox(c[0] - c[2], c[1] - c[2], c[0] + c[2], c[1] + c[2], { x: c[0], z: c[1], r: c[2] });
    try { for (const p of SOLAR.pts) ST.ptGrid.addBox(p[0] - 0.2, p[1] - 0.2, p[0] + 0.2, p[1] + 0.2, { x: p[0], z: p[1], r: 0.2 }); } catch (e) {}
    try { for (const k of ["lamp", "fanpalm", "paloverde", "ironwood", "desertwillow", "mesquite", "saguaro"]) for (const e of (PLACE[k] || [])) ST.ptGrid.addBox(e[0] - 0.5, e[2] - 0.5, e[0] + 0.5, e[2] + 0.5, { x: e[0], z: e[2], r: k === "lamp" ? 0.35 : 0.55 }); } catch (e) {}
    for (const f of P.fountains || []) { const R = { grand: 7, major: 4.6, minor: 2.8 }[f.scale] || 3; ST.ptGrid.addBox(f.x - R, f.z - R, f.x + R, f.z + R, { x: f.x, z: f.z, r: R }); }
    // big families first so the small ones step round them
    const order = { mo: 0, tm: 1, ki: 2, rw: 3, dm: 4, fp: 5, bl: 6, tb: 7 };
    const recs = [];
    for (const s of P.signs) { if (skip && typeof skip.has === "function" && skip.has(s.id)) continue; if (s.in_tunnel) { ST.tunnel.push(s); continue; } const r = classify(s); if (r.fam) recs.push(r); }
    recs.sort((a, b) => order[a.fam] - order[b.fam]);
    for (const rec of recs) {
      try { orient(rec); } catch (e) { rec.th = 0; }
      const [x, z, moved] = resolveSpot(rec); rec.x = x; rec.z = z; if (moved > 0.05) ST.nudged.push({ id: rec.id, fam: rec.fam, m: +moved.toFixed(2) });
      if (moved > 0.05 && rec.fam === "bl") { try { orient(rec); } catch (e) {} }
      reserve(rec);
    }
    ST.recs = recs; ST.placed = true;
  }

  // orientation per family (world yaw th = three.js rotation.y of the sign's local frame)
  function faceYaw(fx, fz) { return Math.atan2(fx, fz); }          // local +z along (fx, fz)
  function alongYaw(tx, tz) { return Math.atan2(-tz, tx); }        // local +x along (tx, tz)
  function orient(rec) {
    const s = rec.s, x = rec.x, z = rec.z;
    if (rec.fam === "fp") {
      rec.rows = s.faces.map(parseFace); const jx = s.junction ? s.junction[0] : x, jz = s.junction ? s.junction[1] : z; const dirs = junctionDirs(jx, jz);
      for (const r of rec.rows) if (r.kind === "dir") { let best = r.bearing, bd = 31; for (const b of dirs) { const d = angDiff(b, r.bearing); if (d < bd) { bd = d; best = b; } } r.aim = best; }
      const nl = nearestLine(x, z, null, 60); let f = nl ? [nl.px - x, nl.pz - z] : [jx - x, jz - z]; if (Math.hypot(f[0], f[1]) < 0.5 && nl) f = [-nl.tz, nl.tx]; rec.th = faceYaw(f[0], f[1]);
      rec.foot = [[0, 0, 0.32]];
    } else if (rec.fam === "bl") {
      const jx = s.junction ? s.junction[0] : x, jz = s.junction ? s.junction[1] : z; rec.blades = s.faces.map((nm, i) => { const name = clean(nm); let best = null; for (const L of ST.byName.get(name) || []) { const p = L.pts; for (let k = 0; k < p.length - 1; k++) { const r = segDist(jx, jz, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]); if (!best || r[0] < best.d) { const len = Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]) || 1; best = { d: r[0], tx: (p[k + 1][0] - p[k][0]) / len, tz: (p[k + 1][1] - p[k][1]) / len }; } } }
        let t = best && best.d < 60 ? [best.tx, best.tz] : dirOf(i * 90); if (t[0] < -0.2 || (Math.abs(t[0]) <= 0.2 && t[1] > 0)) t = [-t[0], -t[1]]; return { name, t }; });
      rec.th = 0; rec.foot = [[0, 0, 0.26]];
    } else if (rec.fam === "ki") {
      let best = null; for (const pz of window.PLAN.plazas || []) { const d = Math.hypot(pz.x - x, pz.z - z); if (d < pz.r + 25 && (!best || d - pz.r < best.d)) best = { d: d - pz.r, pz }; }
      let f; if (best && Math.hypot(best.pz.x - x, best.pz.z - z) > 1) f = [best.pz.x - x, best.pz.z - z]; else { const nl = nearestLine(x, z, null, 60); f = nl ? [nl.px - x, nl.pz - z] : [0, -1]; if (nl && Math.hypot(f[0], f[1]) < 0.6) f = [-nl.tz, nl.tx]; }
      rec.th = faceYaw(f[0], f[1]); rec.foot = [[-0.45, 0, 0.42], [0.45, 0, 0.42]];
    } else if (rec.fam === "mo") {
      // a section-road monument faces the section road it stands behind (read by traffic on the road and at the gate); otherwise the road it names
      const per = nearestLine(x, z, (L) => L.cls === "perimeter", 34); const nl = per || nearestLine(x, z, (L) => !L.prom, 70) || nearestLine(x, z, null, 90); if (nl) rec.th = alongYaw(nl.tx, nl.tz);
      rec.foot = rec.coBrand ? [[-2.4, 0, 0.55], [-0.8, 0, 0.55], [0.8, 0, 0.55], [2.4, 0, 0.55]] : [[-2.5, 0, 0.62], [-0.85, 0, 0.62], [0.85, 0, 0.62], [2.5, 0, 0.62]];
    } else if (rec.fam === "dm") {
      // a pair of markers, one at each kerb of the entrance road: each slab faces along that road (the one its face names)
      const m = /entrance from (.+)$/i.exec(clean((s.faces || [])[2] || "")); const nm = m ? m[1].trim() : null;
      const nl = (nm && nearestLine(x, z, (L) => L.name === nm, 60)) || nearestLine(x, z, null, 60); if (nl) rec.th = faceYaw(nl.tx, nl.tz); rec.foot = [[0, 0, 0.42]];
    } else if (rec.fam === "tb") {
      const nl = nearestLine(x, z, (L) => L.prom, 30) || nearestLine(x, z, null, 40); let t = nl ? [nl.tx, nl.tz] : [0, -1];
      const nb = trailNeighbour(rec); if (nb) { const dx = nb[0] - x, dz = nb[1] - z; if (dx * t[0] + dz * t[1] < 0) t = [-t[0], -t[1]]; }
      rec.dir = t; rec.th = faceYaw(t[0], t[1]); rec.foot = [[0, 0, 0.2]];
    } else if (rec.fam === "tm") {
      const nl = nearestLine(x, z, null, 80); let f = nl ? [nl.px - x, nl.pz - z] : [0, -1]; if (Math.hypot(f[0], f[1]) < 0.5 && nl) f = [-nl.tz, nl.tx]; rec.th = faceYaw(f[0], f[1]); rec.foot = [[0, 0, 0.95]];
    } else if (rec.fam === "rw") {
      let f; if (s.junction) f = [s.junction[0] - x, s.junction[1] - z]; else { const nl = nearestLine(x, z, null, 80); f = nl ? [nl.px - x, nl.pz - z] : [0, 1]; }
      if (/portal/i.test(s.name)) { const tun = (window.PLAN.roads || []).filter((r) => r.class === "tunnel"); let best = null; for (const r of tun) for (const e of [[r.pts[0], r.pts[1]], [r.pts[r.pts.length - 1], r.pts[r.pts.length - 2]]]) { const d = Math.hypot(e[0][0] - x, e[0][1] - z); if (!best || d < best.d) best = { d, e }; } if (best && best.d < 60) f = [best.e[0][0] - best.e[1][0], best.e[0][1] - best.e[1][1]]; }
      rec.th = faceYaw(f[0], f[1]); rec.rwW = rwWidth(s.faces); const hw = rec.rwW / 2; rec.foot = [[-hw * 0.7, 0, 0.45], [0, 0, 0.45], [hw * 0.7, 0, 0.45]];
    }
  }
  function trailNeighbour(rec) {
    const s = rec.s; const all = window.PLAN.signs; let key = null, fwd = 0;
    if (typeof s.hl_remaining_m === "number") { key = "hl_remaining_m"; fwd = -1; } else if (typeof s.loop_m === "number") { key = "loop_m"; fwd = 1; } else if (typeof s.spring_m === "number") { key = "spring_m"; fwd = -1; } else return null;
    let best = null; for (const o of all) { if (o === s || typeof o[key] !== "number" || o.in_tunnel || o.name !== s.name && key !== "hl_remaining_m") continue; const dv = (o[key] - s[key]) * fwd; if (dv <= 0) continue; const d = Math.hypot(o.x - s.x, o.z - s.z); if (d > 160) continue; if (!best || dv < best.dv) best = { dv, p: [o.x, o.z] }; }
    if (best) return best.p;
    for (const o of all) { if (o === s || typeof o[key] !== "number" || o.in_tunnel) continue; const dv = (s[key] - o[key]) * fwd; if (dv <= 0 || dv > 150) continue; const d = Math.hypot(o.x - s.x, o.z - s.z); if (d > 160) continue; return [2 * s.x - o.x, 2 * s.z - o.z]; }
    return null;
  }
  function reserve(rec) {
    const c = Math.cos(rec.th), s = Math.sin(rec.th);
    for (const [lx, lz, r] of rec.foot) { const x = rec.x + lx * c + lz * s, z = rec.z - lx * s + lz * c; reservePoint(rec, x, z, r + (rec.fam === "fp" ? 0.6 : 0.1)); COLLIDERS.push([x, z, Math.min(r, 0.9)]); }
    if (rec.fam === "mo" || rec.fam === "tm" || rec.fam === "ki" || rec.fam === "rw") KEEPOUT.push([rec.x, rec.z, rec.fam === "mo" ? 4.2 : rec.fam === "rw" ? rec.rwW / 2 + 1 : 1.8]);
  }

  // ------------------------- materials and textures -------------------------
  const MAT = {};
  function canvasTex(w, h, draw, rep) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t; }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  function paintRust(x, w, h, base, seed) { const r = rng(seed); x.fillStyle = base; x.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const px = r() * w, py = r() * h, rr = 1 + r() * 7; const k = r(); x.fillStyle = k < 0.45 ? "rgba(70,30,12,0.22)" : k < 0.8 ? "rgba(160,82,38,0.20)" : "rgba(40,22,14,0.25)"; x.beginPath(); x.arc(px, py, rr, 0, 6.283); x.fill(); } for (let i = 0; i < 40; i++) { const px = r() * w; x.fillStyle = "rgba(60,26,10,0.10)"; x.fillRect(px, 0, 1 + r() * 3, h); } }
  function makeMats() {
    const S = (o) => new THREE.MeshStandardMaterial(o);
    const cortenTex = canvasTex(256, 256, (x, w, h) => paintRust(x, w, h, "#7a3c1c", 7), true);
    const greyTex = canvasTex(256, 256, (x, w, h) => { paintRust(x, w, h, "#9a9a9a", 11); const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const g = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11); d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.min(255, g * 1.35); } x.putImageData(d, 0, 0); }, true);
    const earthTex = canvasTex(512, 256, (x, w, h) => { const r = rng(5); let y = 0; const cols = ["#b98a5c", "#a8784c", "#c49766", "#9d6e46", "#b28356", "#c9a273"]; while (y < h) { const bh = 10 + r() * 26; x.fillStyle = cols[Math.floor(r() * cols.length)]; x.fillRect(0, y, w, bh); x.fillStyle = "rgba(60,36,20,0.18)"; x.fillRect(0, y + bh - 1.5, w, 1.5); y += bh; } for (let i = 0; i < 2600; i++) { x.fillStyle = r() < 0.5 ? "rgba(70,45,25,0.25)" : "rgba(235,210,170,0.18)"; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }, true);
    const woodTex = (typeof TEX !== "undefined" && TEX.wood) ? TEX.wood : null;
    MAT.corten = S({ map: cortenTex, roughness: 0.86, metalness: 0.2 });
    MAT.tint = S({ map: greyTex, roughness: 0.7, metalness: 0.35 });             // weathered metal, tinted per instance (corten, copper, bronze)
    MAT.weather = S({ map: cortenTex, color: 0x6a5a50, roughness: 0.78, metalness: 0.35 });
    MAT.earth = S({ map: earthTex, roughness: 1, metalness: 0 });
    MAT.concrete = S({ color: 0xb8b0a2, roughness: 0.95 });
    MAT.alu = S({ color: 0xc6cbd0, roughness: 0.34, metalness: 0.85 });
    MAT.darkSteel = S({ color: 0x2a2d2e, roughness: 0.5, metalness: 0.7 });
    MAT.wood = S({ map: woodTex, color: woodTex ? 0x9a7656 : 0x6b4a30, roughness: 0.88 });
    MAT.paint = S({ color: 0xffffff, roughness: 0.5, metalness: 0.05 });         // instance colours: cream blades, stage tips, bands
    MAT.glass = S({ color: 0x0d1a1e, roughness: 0.1, metalness: 0.65 });
    MAT.black = S({ color: 0x151515, roughness: 0.55, metalness: 0.2 });
    MAT.bronze = S({ color: 0x8c6a3c, roughness: 0.35, metalness: 0.9 });
    MAT.copper = S({ color: 0xb8703e, roughness: 0.4, metalness: 0.85 });
    MAT.stone = S({ color: 0x9c8f80, roughness: 0.95 });
    MAT.white = S({ color: 0xece8de, roughness: 0.6 });
    MAT.solar = S({ color: 0x14224a, roughness: 0.2, metalness: 0.6 });
    MAT.rubber = S({ color: 0x1b1b1b, roughness: 0.9 });
    MAT.fabric = S({ color: 0xf1ece0, roughness: 0.8, side: THREE.DoubleSide });
    MAT.brass = S({ color: 0xc9a152, roughness: 0.3, metalness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    MAT.glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });   // instance-coloured light strips; brightened at night
    ST.glowMats = [MAT.glow];
    // merge groups for the procedural totems: flat-coloured parts share one vertex-coloured material per finish
    MAT.vcMetal = S({ vertexColors: true, roughness: 0.4, metalness: 0.82 }); MAT.vcMatte = S({ vertexColors: true, roughness: 0.78, metalness: 0.08 }); MAT.vcDouble = S({ vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    MAT.vcGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); ST.glowMats.push(MAT.vcGlow);
    for (const k of ["bronze", "copper", "alu", "darkSteel"]) MAT[k].userData.vc = "metal"; for (const k of ["stone", "white", "black", "rubber", "solar", "concrete"]) MAT[k].userData.vc = "matte"; MAT.fabric.userData.vc = "double";
    const checker = canvasTex(64, 64, (x, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? "#111" : "#f2f2f2"; x.fillRect(i * 8, j * 8, 8, 8); } });
    MAT.checker = S({ map: checker, roughness: 0.8, side: THREE.DoubleSide });
    const clock = canvasTex(256, 128, (x, w, h) => { x.fillStyle = "#050505"; x.fillRect(0, 0, w, h); x.font = `700 84px ${FM}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#ff8a3a"; x.shadowColor = "#ff6a00"; x.shadowBlur = 14; x.fillText("T-10", w / 2, h / 2 + 4); });
    MAT.clock = new THREE.MeshBasicMaterial({ map: clock, toneMapped: false }); ST.glowMats.push(MAT.clock);
    const door = canvasTex(128, 256, (x, w, h) => { x.fillStyle = "#6f7a80"; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 8) { x.fillStyle = "rgba(0,0,0,0.18)"; x.fillRect(i, 0, 2, h); } x.fillStyle = "#4DDE6F"; x.fillRect(0, h * 0.08, w, h * 0.05); x.font = `400 96px ${FD}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#f5f1e6"; x.fillText("01", w / 2, h * 0.45); });
    MAT.door = S({ map: door, roughness: 0.6, metalness: 0.4 });
  }
  const ACC = {}; function accMat(hex) { if (!ACC[hex]) { ACC[hex] = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.5, metalness: 0.1 }); ACC[hex].userData.vc = "matte"; } return ACC[hex]; }
  const VC1 = {}; function vcOnce(hex, grp) { const k = grp + hex; if (!VC1[k]) { VC1[k] = { color: new THREE.Color(hex), userData: { vc: grp } }; } return VC1[k]; }
  const GLOWC = {}; function glowMat(hex) { if (!GLOWC[hex]) { GLOWC[hex] = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), toneMapped: false }); GLOWC[hex].userData.vc = "glow"; } return GLOWC[hex]; }

  // ------------------------- instanced structure -------------------------
  const GEO = {};
  function unitGeo(k) { if (GEO[k]) return GEO[k]; let g;
    if (k === "box") g = new THREE.BoxGeometry(1, 1, 1);
    else if (k === "cyl8") g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    else if (k === "cyl16") g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    else if (k === "pyr") { g = new THREE.ConeGeometry(0.5, 1, 4); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); }
    else if (k === "prism") { g = new THREE.BufferGeometry(); const v = [0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, -0.5, 1, 0, -0.5, 0, -0.5, -0.5]; const P = (i) => v.slice(i * 3, i * 3 + 3); const tri = [[0, 1, 2], [3, 4, 5], [0, 2, 4], [0, 4, 3], [1, 5, 4], [1, 4, 2], [0, 3, 5], [0, 5, 1]]; const pos = [], uv = []; for (const t of tri) for (const i of t) { pos.push(...P(i)); uv.push(0, 0); } g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); }
    return GEO[k] = g; }
  const BUCKETS = new Map();
  const _o = new THREE.Object3D();
  function inst(geoK, mat, x, y, z, ry, sx, sy, sz, color, rx, rz) { const key = geoK + "|" + mat.uuid; let b = BUCKETS.get(key); if (!b) BUCKETS.set(key, b = { geo: unitGeo(geoK), mat, m: [], c: [], anyC: false, shadow: false }); _o.position.set(x, y, z); _o.rotation.set(rx || 0, ry || 0, rz || 0, "YXZ"); _o.scale.set(sx, sy, sz); _o.updateMatrix(); b.m.push(_o.matrix.clone()); b.c.push(color || null); if (color) b.anyC = true; return b; }
  function flushInstances(root) { const col = new THREE.Color(); let n = 0;
    for (const b of BUCKETS.values()) { if (!b.m.length) continue; const im = new THREE.InstancedMesh(b.geo, b.mat, b.m.length); for (let i = 0; i < b.m.length; i++) { im.setMatrixAt(i, b.m[i]); if (b.anyC) im.setColorAt(i, col.set(b.c[i] || "#ffffff")); } im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.castShadow = b.shadow; im.receiveShadow = true; im.userData.planSigns = true; root.add(im); n++; }
    BUCKETS.clear(); return n; }
  // local frame helpers: a sign's local (lx, ly, lz) -> world, local direction -> world
  function F(rec) { const c = Math.cos(rec.th), s = Math.sin(rec.th); return { x: rec.x, y: rec.y, z: rec.z, c, s, th: rec.th, p: (lx, ly, lz) => [rec.x + lx * c + lz * s, rec.y + ly, rec.z - lx * s + lz * c], v: (vx, vy, vz) => [vx * c + vz * s, vy, -vx * s + vz * c] }; }
  function part(f, geoK, mat, lx, ly, lz, sx, sy, sz, color, lyaw, shadow) { const p = f.p(lx, ly, lz); const b = inst(geoK, mat, p[0], p[1], p[2], f.th + (lyaw || 0), sx, sy, sz, color); if (shadow) b.shadow = true; return b; }
  // a text quad: centre c, right r (unit), up u (unit), size, canvas rect
  function quad(rec, c, r, u, w, h, rect) { (rec.quads || (rec.quads = [])).push({ c, r, u, w, h, rect }); }
  function faceQuads(rec, f, lx, ly, lz, w, h, rect, twoSided) { // a panel whose front faces local +z at depth lz
    const n = f.v(0, 0, 1), r = f.v(1, 0, 0); quad(rec, f.p(lx, ly, lz), r, [0, 1, 0], w, h, rect);
    if (twoSided !== false) quad(rec, f.p(lx, ly, -lz), [-r[0], 0, -r[2]], [0, 1, 0], w, h, rect); return n; }

  // ------------------------- builders per family -------------------------
  function timberPaint(rec) { return rec.stage === "S3" ? "#6d2b1f" : rec.stage === "S2" ? "#2f4b3b" : "#5a3a24"; }
  function bladeStyle(rec) { const m = String(rec.s.material || "").toLowerCase(); if (/genesis park|copper band/.test(m) || rec.gp) return "gp"; if (/aluminium/.test(m)) return "air"; if (/glass/.test(m)) return "glass"; if (/timber/.test(m)) return "timber"; if (/corten/.test(m)) return "corten"; return rec.stage === "S1" || rec.stage === "AIRPORT" ? "air" : "corten"; }
  function bladeBg(style, rec) { return style === "air" ? "#141414" : style === "glass" ? "#0c1b20" : style === "gp" ? "#5b4130" : style === "timber" ? timberPaint(rec) : "#7a3c1c"; }

  function buildFingerpost(rec) {
    const f = F(rec); const gp = rec.gp; rec.y = baseY(rec.x, rec.z, 0, [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]);
    f.y = rec.y; const fr = F(rec); const top = 3.72;
    part(fr, "cyl8", MAT.concrete, 0, -0.14, 0, 0.44, 0.34, 0.44);
    part(fr, "box", gp ? MAT.wood : MAT.weather, 0, top / 2, 0, gp ? 0.15 : 0.11, top, gp ? 0.15 : 0.11, null, 0, true);
    part(fr, "box", MAT.darkSteel, 0, top + 0.03, 0, 0.17, 0.06, 0.17);
    part(fr, "pyr", MAT.paint, 0, top + 0.06, 0, 0.13, 0.22, 0.13, HEX[rec.stage] || HEX.S1);
    const K = KIND.fp, RH = K.h / 7; let row = 0, cur = 3.62; rec.regions = [];
    const front = [Math.sin(rec.th), Math.cos(rec.th)];
    for (const d of rec.rows) {
      if (d.kind === "info") { if (row + 2 > 7) continue; const h = 0.6, cy = cur - h / 2; cur -= h + 0.07; const rect = [0, row * RH, K.w, RH * 2]; row += 2; rec.regions.push({ rect, paint: "info", d });
        const fx = front[0], fz = front[1]; const cx = rec.x + fx * 0.085, cz = rec.z + fz * 0.085; inst("box", MAT.paint, cx, rec.y + cy, cz, faceYaw(fx, fz), 1.5, h, 0.04, "#1f2420");
        inst("box", MAT.paint, cx, rec.y + cy - h / 2 - 0.012, cz, faceYaw(fx, fz), 1.5, 0.024, 0.045, d.colour);
        const r = [fz, 0, -fx]; quad(rec, [cx + fx * 0.024, rec.y + cy, cz + fz * 0.024], r, [0, 1, 0], 1.47, h - 0.03, rect); quad(rec, [cx - fx * 0.024, rec.y + cy, cz - fz * 0.024], [-r[0], 0, -r[2]], [0, 1, 0], 1.47, h - 0.03, rect); continue; }
      if (row + 1 > 7) continue; const L = 1.45, h = 0.3, cy = cur - h / 2; cur -= 0.38; const rect = [0, row * RH, K.w, RH]; row++; rec.regions.push({ rect, paint: "arm", d });
      const dd = dirOf(d.aim !== undefined ? d.aim : d.bearing); const yaw = alongYaw(dd[0], dd[1]); const n = [-dd[1], 0, dd[0]];
      const ax = rec.x + dd[0] * (0.07 + L / 2), az = rec.z + dd[1] * (0.07 + L / 2), ay = rec.y + cy;
      inst("box", MAT.paint, ax, ay, az, yaw, L, h, 0.036, gp ? "#e7dcc2" : "#ece4d1");
      inst("prism", MAT.paint, rec.x + dd[0] * (0.07 + L), ay, rec.z + dd[1] * (0.07 + L), yaw, 0.24, h, 0.036, d.colour);
      inst("box", MAT.darkSteel, rec.x + dd[0] * 0.075, ay, rec.z + dd[1] * 0.075, yaw, 0.05, h + 0.04, 0.05);
      quad(rec, [ax + n[0] * 0.022, ay, az + n[2] * 0.022], [dd[0], 0, dd[1]], [0, 1, 0], L - 0.04, h - 0.02, rect);
      quad(rec, [ax - n[0] * 0.022, ay, az - n[2] * 0.022], [-dd[0], 0, -dd[1]], [0, 1, 0], L - 0.04, h - 0.02, rect);
    }
    addSolid(rec.x, rec.z, 0, 0.22, 0.22, rec.y, rec.y + top, "world");
  }

  function buildBladeSet(rec) {
    rec.y = baseY(rec.x, rec.z, 0, [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]]); const f = F(rec);
    const style = bladeStyle(rec); rec.style = style; const n = rec.blades.length; const top = 2.62 + (n - 1) * 0.27 + 0.22;
    part(f, "cyl8", MAT.concrete, 0, -0.14, 0, 0.36, 0.32, 0.36);
    if (style === "air" || style === "glass") part(f, "cyl8", style === "glass" ? MAT.darkSteel : MAT.alu, 0, top / 2, 0, 0.09, top, 0.09, null, 0, true);
    else part(f, "box", style === "corten" ? MAT.corten : MAT.wood, 0, top / 2, 0, style === "corten" ? 0.1 : 0.13, top, style === "corten" ? 0.1 : 0.13, null, 0, true);
    part(f, "box", style === "air" ? MAT.alu : MAT.darkSteel, 0, top + 0.02, 0, 0.14, 0.04, 0.14);
    const K = KIND.bl, RH = K.h / 4; rec.regions = []; const bg = bladeBg(style, rec);
    rec.blades.forEach((b, i) => { if (i > 3) return; const hy = rec.y + 2.62 + i * 0.27; const yaw = alongYaw(b.t[0], b.t[1]); const nn = [-b.t[1], 0, b.t[0]]; const rect = [0, i * RH, K.w, RH]; rec.regions.push({ rect, paint: "street", d: { name: b.name, style } });
      inst("box", style === "corten" ? MAT.corten : MAT.paint, rec.x, hy, rec.z, yaw, 1.15, 0.24, 0.03, style === "corten" ? null : bg);
      if (style === "glass") for (const e of [-1, 1]) inst("box", MAT.glow, rec.x, hy + e * 0.126, rec.z, yaw, 1.15, 0.012, 0.034, "#6fd6e8");
      if (style === "air") for (const e of [-1, 1]) inst("box", MAT.alu, rec.x, hy + e * 0.126, rec.z, yaw, 1.16, 0.014, 0.034);
      quad(rec, [rec.x + nn[0] * 0.019, hy, rec.z + nn[2] * 0.019], [b.t[0], 0, b.t[1]], [0, 1, 0], 1.12, 0.22, rect);
      quad(rec, [rec.x - nn[0] * 0.019, hy, rec.z - nn[2] * 0.019], [-b.t[0], 0, -b.t[1]], [0, 1, 0], 1.12, 0.22, rect); });
    addSolid(rec.x, rec.z, 0, 0.2, 0.2, rec.y, rec.y + top, "world");
  }

  function buildKiosk(rec) {
    rec.y = baseY(rec.x, rec.z, rec.th, [[0, 0], [0.7, 0.25], [-0.7, 0.25], [0.7, -0.25], [-0.7, -0.25]]); const f = F(rec); const gp = rec.gp;
    part(f, "box", MAT.concrete, 0, 0.01, 0, 1.52, 0.26, 0.64);
    for (const sd of [-1, 1]) part(f, "box", gp ? MAT.wood : MAT.darkSteel, sd * 0.67, 1.27, 0, gp ? 0.13 : 0.09, 2.44, 0.36, null, 0, true);
    part(f, "box", MAT.glass, 0, 1.27, 0, 1.25, 2.0, 0.1, null, 0, true);
    part(f, "box", gp ? MAT.tint : MAT.darkSteel, 0, 2.52, 0, 1.74, 0.08, 0.8, gp ? "#b8703e" : null, 0, true);
    for (const sd of [-1, 1]) part(f, "box", MAT.glow, 0, 2.465, sd * 0.3, 1.2, 0.02, 0.03, "#ffe2b0");
    part(f, "box", MAT.paint, 0, 0.3, 0, 1.25, 0.05, 0.106, HEX[rec.stage] || HEX.S1);
    const K = KIND.ki; const rect = [0, 0, K.w, K.h]; rec.regions = [{ rect, paint: "kiosk", d: kioskData(rec) }];
    rec.panel = { lz: 0.056, w: 1.18, h: 1.92, ly: 1.29 };
    faceQuads(rec, f, 0, 1.29, 0.056, 1.18, 1.92, rect);
    addSolid(rec.x, rec.z, rec.th, 1.5, 0.62, rec.y, rec.y + 2.56, "world");
  }
  function kioskData(rec) { const s = rec.s; const head = clean(s.faces[0] || "").replace(/^YOU ARE HERE:\s*/i, ""); const list = s.faces.slice(2).map(parseFace).filter((d) => d.kind === "dir"); return { head, list, park: rec.gp, x: rec.x0, z: rec.z0 }; }

  function buildMonument(rec) {
    const cb = rec.coBrand; const W = 6, D = cb ? 0.7 : 0.8, Hh = cb ? 1.7 : 2.8;
    rec.y = baseY(rec.x, rec.z, rec.th, [[0, 0], [-2.9, 0.35], [2.9, 0.35], [-2.9, -0.35], [2.9, -0.35], [-1.5, 0], [1.5, 0]]); const f = F(rec);
    part(f, "box", MAT.concrete, 0, 0.02, 0, W + 0.3, 0.3, D + 0.3);
    part(f, "box", MAT.earth, 0, (Hh - 0.35) / 2, 0, W, Hh + 0.35, D, null, 0, true);
    const band = rec.stage === "GP" ? HEX.AIRPORT : (HEX[rec.stage] || HEX.S1); part(f, "box", MAT.paint, 0, cb ? 0.3 : 0.42, 0, W + 0.02, 0.13, D + 0.02, band);
    const pw = cb ? 4.6 : 4.4, ph = cb ? 1.1 : 1.9, py = cb ? 1.0 : 1.56; const plateTint = rec.gp ? "#b8703e" : rec.stage === "AIRPORT" ? "#d9dcdf" : null;
    if (plateTint) part(f, "box", MAT.tint, 0, py, 0, pw, ph, D + 0.05, plateTint); else part(f, "box", MAT.corten, 0, py, 0, pw, ph, D + 0.05);
    for (const sd of [-1, 1]) part(f, "box", MAT.glow, 0, 0.19, sd * (D / 2 + 0.16), pw, 0.025, 0.05, "#ffd49a");
    const K = KIND.mo; const rect = cb ? [0, 0, K.w, Math.round(K.w * ph / pw)] : [0, 0, K.w, K.h]; rec.regions = [{ rect, paint: "monument", d: monumentData(rec) }];
    faceQuads(rec, f, 0, py, D / 2 + 0.025 + 0.004, pw - 0.04, ph - 0.04, rect);
    addSolid(rec.x, rec.z, rec.th, W, D, rec.y, rec.y + Hh, "world");
  }
  function monumentData(rec) { const p = clean(rec.s.faces[0] || "").split("|").map((q) => q.trim()).filter(Boolean); const d = { word: p[0] || "GENESIS", lines: p.slice(1), stage: rec.stage, gp: rec.gp, cb: rec.coBrand };
    const m = /^Stage (One|Two|Three)\s+(.*)$/i.exec(d.lines[0] || ""); if (m) { d.stageNo = NUMW[m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()]; d.stageName = m[2]; d.lines = d.lines.slice(1); } return d; }

  function buildMarker(rec) {
    rec.y = baseY(rec.x, rec.z, rec.th, [[0, 0], [0.32, 0], [-0.32, 0]]); const f = F(rec); const gp = rec.gp;
    part(f, "box", MAT.concrete, 0, 0.0, 0, 0.84, 0.2, 0.36);
    if (gp) part(f, "box", MAT.tint, 0, 0.85, 0, 0.62, 1.9, 0.14, "#b8703e", 0, true); else part(f, "box", MAT.corten, 0, 0.85, 0, 0.62, 1.9, 0.14, null, 0, true);
    part(f, "box", MAT.paint, 0.3275, 0.85, 0, 0.035, 1.9, 0.15, gp ? HEX.AIRPORT : (HEX[rec.stage] || HEX.S1));
    const K = KIND.dm; const rect = [0, 0, K.w, K.h]; rec.regions = [{ rect, paint: "marker", d: { lines: rec.s.faces.map(clean), stage: rec.stage, gp } }];
    faceQuads(rec, f, -0.015, 0.93, 0.074, 0.56, 1.7, rect);
    addSolid(rec.x, rec.z, rec.th, 0.66, 0.2, rec.y, rec.y + 1.8, "world");
  }

  function buildTrail(rec) {
    rec.y = baseY(rec.x, rec.z, 0, [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]); const f = F(rec); const cap = rec.gp ? "#b8703e" : "#8c6a3c";
    part(f, "cyl16", MAT.concrete, 0, 0.31, 0, 0.26, 0.78, 0.26, null, 0, true);
    part(f, "cyl16", MAT.glow, 0, 0.665, 0, 0.272, 0.03, 0.272, "#ffe6bf");
    part(f, "cyl16", MAT.tint, 0, 0.735, 0, 0.32, 0.07, 0.32, cap);
    for (const sd of [-1, 1]) part(f, "box", MAT.tint, 0, 0.42, sd * 0.135, 0.19, 0.25, 0.02, cap);
    const K = KIND.tb; const top = [0, 0, K.w, K.w], side = [0, K.w, K.w, K.h - K.w]; rec.regions = [{ rect: top, paint: "trailTop", d: trailData(rec) }, { rect: side, paint: "trailSide", d: trailData(rec) }];
    const d = rec.dir; quad(rec, [rec.x, rec.y + 0.7715, rec.z], [-d[1], 0, d[0]], [d[0], 0, d[1]], 0.27, 0.27, top);
    faceQuads(rec, f, 0, 0.42, 0.1455, 0.17, 0.225, side);
    addSolid(rec.x, rec.z, 0, 0.3, 0.3, rec.y, rec.y + 0.76, "world");
  }
  function trailData(rec) { const s = rec.s; const fc = s.faces.map(clean); const d = { title: fc[0] || "", gp: rec.gp, lines: fc.slice(1) };
    const num = (t) => { const m = /(\d{2,5})\s*m/.exec(t || ""); return m ? m[1] : null; };
    if (typeof s.hl_remaining_m === "number") { d.num = String(Math.floor(s.hl_remaining_m / 10) * 10); d.unit = "m to the Ring"; d.glyph = "ring"; }
    else if (typeof s.loop_m === "number") { d.num = String(s.loop_m); d.unit = "m from the Overlook Gate"; d.glyph = "leaf"; d.sub = fc[2] || ""; }
    else if (typeof s.spring_m === "number") { d.num = num(fc[1]) || String(Math.floor(s.spring_m / 10) * 10); d.unit = "m to Genesis Spring"; d.glyph = "leaf"; }
    else { d.num = num(fc[1]) || ""; d.unit = "m to the Ring"; d.glyph = "ring"; d.sub = fc[2] || ""; }
    return d; }

  function buildTotem(rec) {
    rec.y = baseY(rec.x, rec.z, rec.th, [[0, 0], [0.65, 0.4], [-0.65, 0.4], [0.65, -0.4], [-0.65, -0.4]]); const f = F(rec);
    const plinth = rec.gp ? MAT.stone : rec.stage === "S3" ? MAT.earth : rec.stage === "S2" ? MAT.darkSteel : MAT.concrete;
    part(f, "box", plinth, 0, 0.3, 0, 1.4, 1.2, 0.9, null, 0, true);
    for (const sd of [-1, 1]) part(f, "box", MAT.darkSteel, 0, 0.45, sd * 0.455, 1.24, 0.34, 0.02);
    part(f, "box", MAT.paint, 0, 0.86, 0, 1.42, 0.05, 0.92, HEX[rec.stage] || HEX.S1);
    const K = KIND.tm; const rect = [0, 0, K.w, K.h]; rec.regions = [{ rect, paint: "totem", d: { name: clean(rec.s.faces[0]), stage: clean(rec.s.faces[1] || ""), st: rec.stage } }];
    faceQuads(rec, f, 0, 0.45, 0.4695, 1.2, 0.3, rect);
    const motif = clean(rec.s.faces[2] || "").replace(/^motif:\s*/i, ""); rec.motif = motif;
    try { buildMotif(rec, motif); } catch (e) { console.warn("plan_signs: totem motif failed", rec.id, e); }
    addSolid(rec.x, rec.z, rec.th, 1.4, 0.9, rec.y, rec.y + 4.5, "world");
  }

  function rwWidth(faces) { const c = document.createElement("canvas").getContext("2d"); let w = 0; const fc = faces.map(clean);
    const segs = airSegs((fc[0] || "").toUpperCase()); c.font = `700 100px ${FB}`; let a = 0; for (const s of segs) a += c.measureText(s.t).width + 70; w = Math.max(w, a);
    c.font = `700 64px ${FB}`; if (fc[1]) w = Math.max(w, c.measureText(fc[1].replace("->", "\u2192").replace("<-", "\u2190").toUpperCase()).width + 80);
    if (fc[2]) { c.font = `600 34px ${FB}`; w = Math.max(w, c.measureText(fc[2]).width + 60); }
    const px = Math.min(KIND.rw.w, Math.max(560, w)); return Math.max(1.8, Math.min(5.9, px / 320 * 1.2 + 0.08)); }
  function airSegs(t) { const out = []; const re = /\[([^\]]+)\]|([^\[\]]+)/g; let m; while ((m = re.exec(t))) { if (m[1]) out.push({ t: m[1].trim(), loc: true }); else { const s = m[2].replace(/^\s*\/\s*|\s*\/\s*$/g, "").trim(); if (s) out.push({ t: s, loc: false }); } } return out; }
  function buildRunway(rec) {
    const W = rec.rwW; rec.y = baseY(rec.x, rec.z, rec.th, [[0, 0], [-W / 2, 0.15], [W / 2, 0.15], [-W / 2, -0.15], [W / 2, -0.15]]); const f = F(rec);
    part(f, "box", MAT.concrete, 0, -0.02, 0, W + 0.4, 0.24, 0.7);
    for (const sd of [-1, 1]) { part(f, "box", MAT.darkSteel, sd * (W / 2 - 0.35), 0.3, 0, 0.09, 0.56, 0.09); part(f, "cyl8", MAT.darkSteel, sd * (W / 2 - 0.35), 0.54, 0, 0.13, 0.05, 0.13); }
    part(f, "box", MAT.black, 0, 1.18, 0, W, 1.28, 0.3, null, 0, true);
    part(f, "box", MAT.paint, 0, 1.18, 0, W - 0.08, 1.2, 0.304, "#f2c200");
    const K = KIND.rw; const pxw = Math.round(Math.min(K.w, (W - 0.1) / 1.2 * K.h)); const rect = [0, 0, pxw, K.h]; rec.regions = [{ rect, paint: "airfield", d: { faces: rec.s.faces.map(clean) } }];
    faceQuads(rec, f, 0, 1.18, 0.156, W - 0.1, 1.2, rect);
    addSolid(rec.x, rec.z, rec.th, W, 0.3, rec.y, rec.y + 1.82, "world");
  }

  // ------------------------- totem motifs (procedural, merged per material) -------------------------
  const MERGE = new Map();
  function Parts() { const list = []; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const add = (mat, g, x, y, z, rx, ry, rz, sx, sy, sz) => { e.set(rx || 0, ry || 0, rz || 0, "XYZ"); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, sc.set(sx || 1, sy || 1, sz || 1)); const gg = g.index ? g.toNonIndexed() : g.clone(); gg.applyMatrix4(m4); list.push([mat, gg]); };
    const P = { list,
      box: (mat, w, h, d, x, y, z, rx, ry, rz) => add(mat, unitGeo("box"), x, y, z, rx, ry, rz, w, h, d),
      cyl: (mat, r, h, x, y, z, rx, ry, rz, seg, rTop) => add(mat, new THREE.CylinderGeometry(rTop === undefined ? r : rTop, r, h, seg || 10), x, y, z, rx, ry, rz),
      sph: (mat, r, x, y, z, sx, sy, sz, rx, ry, rz) => add(mat, new THREE.SphereGeometry(1, 12, 8), x, y, z, rx, ry, rz, r * (sx || 1), r * (sy || 1), r * (sz || 1)),
      tor: (mat, R, t, x, y, z, arc, rx, ry, rz, seg) => add(mat, new THREE.TorusGeometry(R, t, 6, seg || 28, arc || 6.2832), x, y, z, rx, ry, rz),
      cone: (mat, r, h, x, y, z, rx, ry, rz, seg) => add(mat, new THREE.ConeGeometry(r, h, seg || 10), x, y, z, rx, ry, rz),
      geo: (mat, g, x, y, z, rx, ry, rz) => add(mat, g, x, y, z, rx, ry, rz),
      rod: (mat, r, a, b, seg) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const L = Math.hypot(dx, dy, dz) || 1e-3; const g = new THREE.CylinderGeometry(r, r, L, seg || 6); const qq = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(dx / L, dy / L, dz / L)); m4.compose(v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), qq, sc.set(1, 1, 1)); const gg = g.toNonIndexed(); gg.applyMatrix4(m4); list.push([mat, gg]); } };
    return P; }
  function shapeGeo(pts, depth) { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2); return g; }
  function starGeo(R, r, n) { const pts = []; for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * 6.2832 - Math.PI / 2; const rr = i % 2 ? r : R; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); } return pts; }
  function windmill(P, y0, withTrough) { const H = 3.3, top = y0 + H; const legs = [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]];
    for (const [lx, lz] of legs) P.rod(MAT.weather, 0.035, [lx, y0, lz], [lx * 0.3, top, lz * 0.3]);
    for (let k = 1; k <= 3; k++) { const t = k / 4, yy = y0 + H * t, s = 1 - 0.7 * t; for (let i = 0; i < 4; i++) { const a = legs[i], b = legs[(i + 1) % 4]; P.rod(MAT.weather, 0.018, [a[0] * s, yy, a[1] * s], [b[0] * s, yy, b[1] * s]); } }
    P.box(MAT.darkSteel, 0.3, 0.3, 0.3, 0, top + 0.1, 0); const hz = 0.35, hy = top + 0.3; P.cyl(MAT.darkSteel, 0.1, 0.25, 0, hy, hz, Math.PI / 2);
    P.tor(MAT.weather, 0.95, 0.025, 0, hy, hz + 0.05); P.tor(MAT.weather, 0.5, 0.02, 0, hy, hz + 0.05);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832; P.box(MAT.alu, 0.14, 0.62, 0.012, Math.cos(a) * 0.72, hy + Math.sin(a) * 0.72, hz + 0.05, 0.35, 0, a - Math.PI / 2); }
    P.rod(MAT.weather, 0.03, [0, hy, 0], [0, hy, -1.3]); P.box(MAT.alu, 0.02, 0.55, 1.0, 0, hy + 0.05, -1.55);
    if (withTrough) { P.box(MAT.weather, 1.7, 0.5, 0.6, 1.55, -0.55, 0.2); P.box(MAT.glass, 1.6, 0.02, 0.5, 1.55, -0.32, 0.2); } }
  function heron(P, y0, mat) { P.rod(MAT.weather, 0.05, [0, y0, 0], [0, y0 + 0.6, 0]); P.rod(mat, 0.035, [-0.08, y0 + 0.5, 0], [-0.04, y0 + 1.7, 0]); P.rod(mat, 0.035, [0.1, y0 + 0.5, 0.05], [0.05, y0 + 1.7, 0]);
    P.sph(mat, 0.42, 0, y0 + 2.05, 0, 1.5, 0.72, 0.7, 0, 0, -0.35); P.cone(mat, 0.2, 0.7, -0.75, y0 + 1.8, 0, 0, 0, 1.9);
    P.rod(mat, 0.07, [0.45, y0 + 2.2, 0], [0.6, y0 + 2.7, 0]); P.rod(mat, 0.06, [0.6, y0 + 2.7, 0], [0.42, y0 + 3.15, 0]); P.rod(mat, 0.055, [0.42, y0 + 3.15, 0], [0.55, y0 + 3.55, 0]);
    P.sph(mat, 0.11, 0.6, y0 + 3.62, 0, 1.3, 1, 1); P.cone(MAT.bronze, 0.04, 0.5, 0.95, y0 + 3.58, 0, 0, 0, -Math.PI / 2 - 0.12); }
  function cairn(P, y0, n, mat, flat) { let y = y0; for (let i = 0; i < n; i++) { const r = 0.62 - i * (0.42 / n); const h = r * (flat || 0.55); P.sph(mat, r, (hashStr("c" + i) - 0.5) * 0.12, y + h, (hashStr("d" + i) - 0.5) * 0.12, 1, flat || 0.55, 1, 0, i * 0.7, 0); y += h * 1.8; } return y; }
  function lanternAt(P, x, y, z) { P.box(glowMat("#ffcf7a"), 0.22, 0.32, 0.22, x, y, z); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.box(MAT.darkSteel, 0.03, 0.36, 0.03, x + a * 0.12, y, z + b * 0.12); P.cone(MAT.darkSteel, 0.2, 0.16, x, y + 0.24, z, 0, Math.PI / 4, 0, 4); }
  function buildMotif(rec, motif) {
    const P = Parts(); const y0 = 0.88; const m = motif.toLowerCase(); const acc = accMat(HEX[rec.stage] || HEX.S1);
    if (/heron/.test(m)) heron(P, y0, MAT.wood);
    else if (/propeller and beacon/.test(m)) { P.cyl(MAT.weather, 0.09, 3.4, 0, y0 + 1.7, 0); P.cyl(MAT.darkSteel, 0.16, 0.25, 0, y0 + 2.7, 0.14, Math.PI / 2); for (const sd of [-1, 1]) P.box(MAT.alu, 0.24, 1.5, 0.05, 0, y0 + 2.7 + sd * 0.78, 0.2, 0, sd * 0.25, 0); P.sph(glowMat("#4DDE6F"), 0.17, 0, y0 + 3.55, 0); P.cone(MAT.darkSteel, 0.2, 0.16, 0, y0 + 3.76, 0); }
    else if (/windsock/.test(m)) { P.cyl(MAT.weather, 0.07, 3.8, 0, y0 + 1.9, 0); P.tor(MAT.darkSteel, 0.28, 0.025, 0.02, y0 + 3.55, 0, 0, 0, Math.PI / 2, 0); for (let i = 0; i < 5; i++) { const r0 = 0.28 - i * 0.035; P.cyl(i % 2 ? MAT.white : acc, r0 - 0.035, 0.3, 0.17 + i * 0.3, y0 + 3.55 - i * 0.03, 0, 0, 0, Math.PI / 2 + 0.06, 12, r0); } }
    else if (/hangar door/.test(m)) { for (const sd of [-1, 1]) P.box(MAT.corten, 0.22, 3.6, 0.24, sd * 0.95, y0 + 1.8, 0); P.box(MAT.corten, 2.14, 0.26, 0.26, 0, y0 + 3.7, 0); P.box(MAT.door, 1.66, 3.3, 0.06, 0, y0 + 1.72, 0); }
    else if (/lantern tree/.test(m)) { P.cyl(MAT.weather, 0.11, 3.2, 0, y0 + 1.6, 0, 0, 0, 0, 8, 0.07); for (let i = 0; i < 5; i++) { const a = i / 5 * 6.2832; const ex = Math.cos(a) * 0.95, ez = Math.sin(a) * 0.95, ey = y0 + 2.6 + (i % 2) * 0.5; P.rod(MAT.weather, 0.035, [0, y0 + 2.2 + i * 0.1, 0], [ex, ey + 0.2, ez]); lanternAt(P, ex, ey - 0.05, ez); } }
    else if (/lantern/.test(m)) { P.box(MAT.wood, 0.2, 3.9, 0.2, 0, y0 + 1.95, 0); P.box(MAT.darkSteel, 0.8, 0.07, 0.07, 0.38, y0 + 3.7, 0); lanternAt(P, 0.68, y0 + 3.36, 0); P.box(MAT.darkSteel, 0.3, 0.05, 0.3, 0, y0 + 3.92, 0); }
    else if (/tensile sail/.test(m)) { P.rod(MAT.alu, 0.07, [-0.3, y0, 0], [0.1, y0 + 4.0, 0]); const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([0.08, y0 + 3.9, 0, 1.6, y0 + 1.2, 0.35, -0.9, y0 + 1.5, -0.2], 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 0, 0, 0], 2)); g.computeVertexNormals(); P.geo(MAT.fabric, g, 0, 0, 0); P.rod(MAT.darkSteel, 0.01, [1.6, y0 + 1.2, 0.35], [1.6, y0 - 0.1, 0.6]); P.rod(MAT.darkSteel, 0.01, [-0.9, y0 + 1.5, -0.2], [-1.2, y0 - 0.1, -0.4]); }
    else if (/club crest/.test(m)) { cairn(P, y0, 6, MAT.stone); P.cyl(MAT.bronze, 0.42, 0.06, 0, y0 + 1.6, 0.58, Math.PI / 2); P.tor(MAT.bronze, 0.3, 0.03, 0, y0 + 1.6, 0.62); }
    else if (/neon hangar/.test(m)) { for (const sd of [-1, 1]) P.box(MAT.darkSteel, 0.12, 2.2, 0.12, sd * 1.0, y0 + 1.1, 0); P.tor(MAT.darkSteel, 1.0, 0.06, 0, y0 + 2.2, 0, Math.PI); P.tor(glowMat("#ff5fa2"), 0.86, 0.025, 0, y0 + 2.2, 0.08, Math.PI); P.tor(glowMat("#6fd6e8"), 0.7, 0.025, 0, y0 + 2.2, 0.08, Math.PI); P.box(glowMat("#f4cd5a"), 1.5, 0.05, 0.05, 0, y0 + 2.05, 0.08); }
    else if (/propeller/.test(m)) { P.cyl(MAT.weather, 0.1, 2.9, 0, y0 + 1.45, 0); P.cyl(MAT.darkSteel, 0.2, 0.3, 0, y0 + 3.0, 0.16, Math.PI / 2); P.cone(MAT.alu, 0.2, 0.35, 0, y0 + 3.0, 0.45, Math.PI / 2); for (let i = 0; i < 3; i++) { const a = i / 3 * 6.2832 + 0.3; P.box(MAT.alu, 0.26, 1.35, 0.05, Math.cos(a) * 0.72, y0 + 3.0 + Math.sin(a) * 0.72, 0.2, 0, 0.3, a - Math.PI / 2); } }
    else if (/chequered flag/.test(m)) { P.cyl(MAT.alu, 0.05, 3.5, 0, y0 + 1.75, 0); P.box(MAT.checker, 1.3, 0.85, 0.01, 0.68, y0 + 3.05, 0, 0, 0, -0.05); P.sph(MAT.alu, 0.07, 0, y0 + 3.53, 0); }
    else if (/mesquite branch/.test(m)) { P.rod(MAT.bronze, 0.13, [0, y0, 0], [0.1, y0 + 1.6, 0]); const br = [[0.1, 1.6, -0.9, 3.0, 0.3], [0.1, 1.6, 0.9, 3.3, -0.2], [0.1, 1.6, 0.2, 3.9, 0.1], [-0.5, 2.4, -1.2, 3.4, 0.6], [0.6, 2.6, 1.3, 3.0, 0.5]]; for (const [ax, ay, bx, by, bz] of br) { P.rod(MAT.bronze, 0.05, [ax, y0 + ay, 0], [bx, y0 + by, bz]); for (let k = 0; k < 3; k++) P.sph(MAT.bronze, 0.22, bx + (k - 1) * 0.18, y0 + by + 0.05 * k, bz + (k - 1) * 0.1, 1.4, 0.35, 0.8, 0, k, 0); } }
    else if (/windmill/.test(m)) windmill(P, y0, /trough/.test(m));
    else if (/stone spiral/.test(m)) { P.cyl(MAT.stone, 0.18, 3.4, 0, y0 + 1.7, 0); for (let i = 0; i < 20; i++) { const a = i * 0.62, r = 0.5; P.sph(MAT.stone, 0.2, Math.cos(a) * r, y0 + 0.2 + i * 0.17, Math.sin(a) * r, 1.3, 0.7, 1, 0, a, 0); } }
    else if (/antenna/.test(m)) { const legs = [[0, 0.4], [0.35, -0.2], [-0.35, -0.2]]; for (const [lx, lz] of legs) P.rod(MAT.alu, 0.03, [lx, y0, lz], [lx * 0.2, y0 + 3.8, lz * 0.2]); for (let k = 1; k < 7; k++) { const t = k / 7, s = 1 - 0.8 * t; for (let i = 0; i < 3; i++) { const a = legs[i], b = legs[(i + 1) % 3]; P.rod(MAT.alu, 0.012, [a[0] * s, y0 + 3.8 * t, a[1] * s], [b[0] * s, y0 + 3.8 * t + 0.25, b[1] * s]); } } const dish = new THREE.SphereGeometry(0.7, 16, 6, 0, 6.2832, 0, 0.9); P.geo(MAT.white, dish, 0, y0 + 2.9, 0.4, -1.05, 0, 0); P.cyl(MAT.alu, 0.04, 4.2, 0, y0 + 2.4, 0, 0, 0, 0, 6); P.sph(glowMat("#ff3b30"), 0.07, 0, y0 + 4.55, 0); }
    else if (/solar wing/.test(m)) { P.cyl(MAT.alu, 0.09, 3.0, 0, y0 + 1.5, 0); P.box(MAT.solar, 2.6, 0.05, 1.3, 0, y0 + 3.2, 0, -0.55, 0, 0.08); P.box(MAT.alu, 2.66, 0.07, 0.05, 0, y0 + 3.2 + Math.sin(0.55) * 0.66, -Math.cos(0.55) * 0.66, -0.55, 0, 0.08); for (const sd of [-1, 1]) P.rod(MAT.alu, 0.03, [0, y0 + 2.6, 0], [sd * 1.1, y0 + 3.2, 0]); }
    else if (/countdown/.test(m)) { P.box(MAT.black, 1.2, 3.0, 0.34, 0, y0 + 1.5, 0); for (const sd of [-1, 1]) P.box(MAT.clock, 1.0, 0.5, 0.01, 0, y0 + 2.4, sd * 0.176, 0, sd < 0 ? Math.PI : 0, 0); P.box(glowMat("#ff8a3a"), 1.22, 0.04, 0.36, 0, y0 + 3.0, 0); }
    else if (/rover wheel/.test(m)) { const cy = y0 + 1.25; P.tor(MAT.rubber, 1.0, 0.17, 0, cy, 0, 6.2832, 0, 0, 0, 32); P.cyl(MAT.alu, 0.22, 0.4, 0, cy, 0, Math.PI / 2); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; P.box(MAT.alu, 0.06, 0.86, 0.06, Math.cos(a) * 0.45, cy + Math.sin(a) * 0.45, 0, 0, 0, a - Math.PI / 2); } for (let i = 0; i < 24; i++) { const a = i / 24 * 6.2832; P.box(MAT.rubber, 0.2, 0.1, 0.42, Math.cos(a) * 1.15, cy + Math.sin(a) * 1.15, 0, 0, 0, a); } for (const sd of [-1, 1]) P.box(MAT.weather, 0.12, 0.5, 0.12, sd * 0.55, y0 + 0.2, 0); }
    else if (/horseshoe arch/.test(m)) { P.tor(MAT.weather, 1.2, 0.14, 0, y0 + 2.3, 0, 4.4, 0, 0, -0.64, 36); for (let i = 0; i < 7; i++) { const a = -0.64 + (i + 0.5) / 7 * 4.4; P.cyl(MAT.darkSteel, 0.05, 0.3, Math.cos(a) * 1.2, y0 + 2.3 + Math.sin(a) * 1.2, 0, Math.PI / 2); } }
    else if (/horseshoe and spurs/.test(m)) { P.box(MAT.weather, 0.16, 3.4, 0.16, 0, y0 + 1.7, 0); P.tor(MAT.copper, 0.55, 0.1, 0, y0 + 3.3, 0.1, 4.4, 0, 0, -0.64, 30); const rowel = shapeGeo(starGeo(0.42, 0.14, 8), 0.05); P.geo(MAT.copper, rowel, 0, y0 + 2.2, 0.12); P.cyl(MAT.copper, 0.05, 0.6, 0.45, y0 + 2.2, 0.12, 0, 0, Math.PI / 2); }
    else if (/gantry/.test(m)) { const C = [[-0.8, -0.55], [0.8, -0.55], [0.8, 0.55], [-0.8, 0.55]]; for (const [cx, cz] of C) P.box(acc, 0.14, 3.8, 0.14, cx, y0 + 1.9, cz); for (const zz of [-0.55, 0.55]) { P.box(acc, 1.74, 0.16, 0.14, 0, y0 + 3.8, zz); P.rod(MAT.darkSteel, 0.03, [-0.8, y0 + 0.3, zz], [0.8, y0 + 3.6, zz]); } for (const xx of [-0.8, 0.8]) P.box(acc, 0.14, 0.16, 1.24, xx, y0 + 3.8, 0); P.rod(MAT.darkSteel, 0.012, [0, y0 + 3.7, 0], [0, y0 + 2.6, 0]); P.tor(MAT.darkSteel, 0.1, 0.025, 0, y0 + 2.5, 0, 4.5); }
    else if (/flagstick/.test(m)) { P.cyl(MAT.white, 0.03, 3.6, 0, y0 + 1.8, 0, 0, 0, 0, 8); const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([0.03, y0 + 3.55, 0, 1.0, y0 + 3.28, 0, 0.03, y0 + 3.0, 0], 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)); g.computeVertexNormals(); P.geo(vcOnce(HEX[rec.stage] || HEX.S3, "double"), g, 0, 0, 0); P.tor(MAT.white, 0.2, 0.02, 0, y0 + 0.02, 0, 6.2832, Math.PI / 2, 0, 0); }
    else if (/ridge line/.test(m)) { const pts = [[-1.4, 0], [1.4, 0], [1.4, 2.2], [0.9, 3.0], [0.55, 2.5], [0.1, 3.9], [-0.35, 3.1], [-0.8, 3.4], [-1.4, 2.4]]; P.geo(MAT.corten, shapeGeo(pts, 0.1), 0, y0, 0); }
    else if (/obelisk/.test(m)) { P.cyl(MAT.stone, 0.36, 3.2, 0, y0 + 1.6, 0, 0, Math.PI / 4, 0, 4, 0.19); P.cone(MAT.bronze, 0.19 * 1.414 / 1.414, 0.38, 0, y0 + 3.39, 0, 0, Math.PI / 4, 0, 4); }
    else if (/corten figure/.test(m)) { for (const sd of [-1, 1]) P.box(MAT.corten, 0.26, 1.6, 0.3, sd * 0.2, y0 + 0.8, 0, 0, 0, sd * 0.04); P.box(MAT.corten, 0.7, 1.3, 0.34, 0, y0 + 2.2, 0); for (const sd of [-1, 1]) P.box(MAT.corten, 0.2, 1.2, 0.24, sd * 0.47, y0 + 2.1, 0, 0, 0, sd * 0.12); P.box(MAT.corten, 0.3, 0.36, 0.3, 0, y0 + 3.08, 0); }
    else if (/stacked stone/.test(m)) { let y = y0; for (let i = 0; i < 8; i++) { const w = 1.25 - i * 0.07, h = 0.3 + hashStr("s" + i) * 0.22; P.box(MAT.stone, w, h, w * 0.75, (hashStr("x" + i) - 0.5) * 0.1, y + h / 2, 0, 0, i * 0.4, 0); y += h; } }
    else if (/sun disc/.test(m)) { for (const sd of [-1, 1]) P.box(MAT.weather, 0.14, 2.4, 0.14, sd * 0.5, y0 + 1.2, 0); P.cyl(MAT.corten, 1.25, 0.09, 0, y0 + 2.75, 0, Math.PI / 2, 0, 0, 32); P.tor(MAT.bronze, 1.3, 0.035, 0, y0 + 2.75, 0.05); }
    else if (/branding iron/.test(m)) { for (const sd of [-1, 1]) P.box(MAT.wood, 0.22, 3.8, 0.22, sd * 1.1, y0 + 1.9, 0); P.box(MAT.wood, 2.7, 0.22, 0.24, 0, y0 + 3.75, 0); for (const sd of [-1, 1]) P.rod(MAT.darkSteel, 0.012, [sd * 0.3, y0 + 3.64, 0], [sd * 0.3, y0 + 3.1, 0]); P.tor(MAT.darkSteel, 0.38, 0.045, 0, y0 + 2.7, 0); P.box(MAT.darkSteel, 0.76, 0.08, 0.08, 0, y0 + 2.7, 0); P.box(MAT.darkSteel, 0.9, 0.06, 0.06, 0, y0 + 3.1, 0); }
    else if (/crossed bats/.test(m)) { for (const sd of [-1, 1]) P.cyl(MAT.weather, 0.075, 3.2, sd * 0.12, y0 + 1.75, 0, 0, 0, sd * 0.42, 10, 0.035); P.sph(MAT.white, 0.24, 0, y0 + 3.5, 0.1); }
    else if (/bandshell arch/.test(m)) { const sh = new THREE.SphereGeometry(1.35, 20, 10, -Math.PI / 2, Math.PI, 0, Math.PI / 2); sh.scale(1, 1.5, 0.8); P.geo(vcOnce("#b8703e", "double"), sh, 0, y0, 0); for (let i = 0; i < 5; i++) P.tor(MAT.darkSteel, 1.36 - i * 0.02, 0.025, 0, y0, 0, Math.PI, 0, (i - 2) * 0.35, 0); }
    else if (/biplane weathervane/.test(m)) { P.cyl(MAT.darkSteel, 0.05, 3.5, 0, y0 + 1.75, 0); P.box(MAT.darkSteel, 1.2, 0.04, 0.04, 0, y0 + 3.0, 0); P.box(MAT.darkSteel, 0.04, 0.04, 1.2, 0, y0 + 3.0, 0); const yb = y0 + 3.75; P.cyl(MAT.copper, 0.09, 0.95, 0, yb, 0, 0, 0, Math.PI / 2); for (const dy of [-0.12, 0.12]) P.box(MAT.copper, 0.24, 0.02, 1.1, 0.1, yb + dy, 0); P.box(MAT.copper, 0.2, 0.22, 0.02, -0.45, yb + 0.1, 0); P.box(MAT.copper, 0.16, 0.02, 0.36, -0.45, yb, 0); P.box(MAT.darkSteel, 0.02, 0.36, 0.05, 0.5, yb, 0); }
    else if (/rooster/.test(m)) { const cy = y0 + 1.2; P.tor(MAT.weather, 0.75, 0.05, 0, cy, 0); for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832; P.box(MAT.weather, 0.03, 0.72, 0.03, Math.cos(a) * 0.37, cy + Math.sin(a) * 0.37, 0, 0, 0, a - Math.PI / 2); } P.cyl(MAT.darkSteel, 0.05, 3.3, 0, y0 + 1.65, -0.1); const yr = y0 + 3.55; P.sph(MAT.copper, 0.28, 0, yr, -0.1, 1.2, 0.8, 0.35); P.sph(MAT.copper, 0.13, 0.28, yr + 0.26, -0.1, 1, 1, 0.5); P.cone(MAT.copper, 0.25, 0.5, -0.38, yr + 0.18, -0.1, 0, 0, 0.9); P.box(MAT.copper, 0.1, 0.1, 0.03, 0.3, yr + 0.42, -0.1); P.box(MAT.darkSteel, 1.1, 0.03, 0.03, 0, yr - 0.4, -0.1); }
    else if (/river stones/.test(m) || /cottonwood leaf/.test(m)) { const top = cairn(P, y0, 8, MAT.stone, 0.5); P.sph(MAT.copper, 0.55, 0, top + 0.35, 0, 0.7, 0.06, 1.0, 0.5, 0.3, 0.4); P.rod(MAT.copper, 0.02, [0, top, 0], [0.05, top + 0.3, 0.2]); }
    else if (/jet silhouette/.test(m)) { P.cyl(MAT.weather, 0.09, 4.3, 0, y0 + 2.15, 0); const yj = y0 + 4.45; P.cyl(MAT.copper, 0.16, 2.0, 0, yj, 0, 0, 0, Math.PI / 2 + 0.2, 12, 0.12); P.cone(MAT.copper, 0.12, 0.4, 1.17, yj + 0.24, 0, 0, 0, -Math.PI / 2 + 0.2); P.box(MAT.copper, 0.5, 0.03, 2.1, 0.05, yj, 0, 0, 0.35, 0.2); P.box(MAT.copper, 0.35, 0.5, 0.03, -0.9, yj + 0.1, 0, 0, 0, 0.5); P.box(MAT.copper, 0.28, 0.03, 0.8, -0.92, yj - 0.12, 0, 0, 0.3, 0.2); }
    else { cairn(P, y0, 5, MAT.stone); P.sph(acc, 0.2, 0, y0 + 2.4, 0); }
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(rec.x, rec.y, rec.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rec.th, 0)), new THREE.Vector3(1, 1, 1));
    for (const [mat, g] of P.list) { g.applyMatrix4(m4); if (!MERGE.has(mat)) MERGE.set(mat, []); MERGE.get(mat).push(g); }
  }
  function mergeInto(root) { let n = 0; const groups = new Map();
    for (const [mat, list] of MERGE) { const vc = mat.userData && mat.userData.vc; const target = vc ? MAT["vc" + vc[0].toUpperCase() + vc.slice(1)] : mat; if (!groups.has(target)) groups.set(target, []); for (const g of list) groups.get(target).push([g, vc ? mat.color : null]); }
    for (const [mat, list] of groups) { let cnt = 0; for (const [g] of list) cnt += g.attributes.position.count; const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2); const col = mat.vertexColors ? new Float32Array(cnt * 3) : null; let o = 0;
      for (const [g, c] of list) { const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv; pos.set(p.array.subarray(0, p.count * 3), o * 3); if (nn) nor.set(nn.array.subarray(0, p.count * 3), o * 3); if (u) uv.set(u.array.subarray(0, p.count * 2), o * 2); if (col) for (let i = 0; i < p.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; } o += p.count; g.dispose(); }
      const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); bg.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); if (col) bg.setAttribute("color", new THREE.BufferAttribute(col, 3)); bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, mat); mesh.castShadow = !(mat instanceof THREE.MeshBasicMaterial); mesh.receiveShadow = true; mesh.userData.planSigns = true; root.add(mesh); n++; }
    MERGE.clear(); return n; }

  // ------------------------- the brass line (Horizon Line) -------------------------
  function offsetLine(pts, off) { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const L = Math.hypot(nx, nz) || 1; out.push([pts[i][0] + nx / L * off, pts[i][1] + nz / L * off]); } return out; }
  function resample(pts, step) { const out = [pts[0]]; let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue; let t = step - acc; while (t < L) { out.push([ax + (bx - ax) * t / L, az + (bz - az) * t / L]); t += step; } acc = L - (t - step); } out.push(pts[pts.length - 1]); return out; }
  function buildBrass(root) {
    const P = window.PLAN; const pos = [], nor = [], uv = [], idx = []; let vi = 0; let starN = 0, studN = 0; const stars = [], studs = [];
    for (const id of HL_WALKS) { const pr = (P.promenades || []).find((q) => q.id === id); if (!pr || (typeof planSkip === "function" && planSkip(id))) continue; const w = pr.width || 10;
      if (id === "hl3_main_street") { const line = resample(offsetLine(pr.pts, 8.35), 1.25); for (const q of line) studs.push(q); continue; }
      const line = resample(offsetLine(pr.pts, w / 2 - 1.9), 1.5); let run = 0;
      for (let i = 0; i < line.length; i++) { const p = line[i], a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L; const nx = -tz * 0.05, nz = tx * 0.05;
        const y1 = surf(p[0] + nx, p[1] + nz) + 0.012, y2 = surf(p[0] - nx, p[1] - nz) + 0.012; pos.push(p[0] + nx, y1, p[1] + nz, p[0] - nx, y2, p[1] - nz); nor.push(0, 1, 0, 0, 1, 0); uv.push(0, 0, 1, 0);
        if (i < line.length - 1) idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3); vi += 2; if (i) run += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]); if (run >= 25) { run -= 25; stars.push([p[0] - tz * 0.6, p[1] + tx * 0.6, Math.atan2(tx, tz)]); } } vi = pos.length / 3; }
    let n = 0;
    if (idx.length) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere(); const m = new THREE.Mesh(g, MAT.brass); m.receiveShadow = true; m.userData.planSigns = true; root.add(m); n++; }
    if (stars.length) { const sg = new THREE.ShapeGeometry(new THREE.Shape(starGeo(0.3, 0.13, 5).map((q) => new THREE.Vector2(q[0], q[1])))); sg.rotateX(-Math.PI / 2); const im = new THREE.InstancedMesh(sg, MAT.brass, stars.length); stars.forEach((s, i) => { _o.position.set(s[0], surf(s[0], s[1]) + 0.014, s[1]); _o.rotation.set(0, s[2], 0); _o.scale.set(1, 1, 1); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); }); im.computeBoundingSphere(); im.receiveShadow = true; root.add(im); n++; starN = stars.length; }
    if (studs.length) { const cg = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 10); const im = new THREE.InstancedMesh(cg, MAT.brass, studs.length); studs.forEach((s, i) => { _o.position.set(s[0], surf(s[0], s[1]) + 0.006, s[1]); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1, 1); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); }); im.computeBoundingSphere(); im.receiveShadow = true; root.add(im); n++; studN = studs.length; }
    API.brassLine = { stars: starN, studs: studN }; return n;
  }

  // ------------------------- the plan maps for the kiosks -------------------------
  const MAPS = {};
  const SITE_BB = [-500, 1140, -640, 1000];            // x0, x1, z0, z1 (square, the section plus the park)
  const PARK_BB = [-515, 75, -650, -60];
  function drawMap(bb, size, park) {
    const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); const P = window.PLAN;
    const sx = size / (bb[1] - bb[0]), sz = size / (bb[3] - bb[2]); const X = (v) => (v - bb[0]) * sx, Z = (v) => (v - bb[2]) * sz; const S = Math.min(sx, sz);
    x.fillStyle = "#101712"; x.fillRect(0, 0, size, size);
    const poly = (pts, fill, stroke, lw) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p[0]), Z(p[1])) : x.moveTo(X(p[0]), Z(p[1]))); x.closePath(); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 1; x.stroke(); } };
    const line = (pts, col, lw, dash) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p[0]), Z(p[1])) : x.moveTo(X(p[0]), Z(p[1]))); x.strokeStyle = col; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round"; x.setLineDash(dash || []); x.stroke(); x.setLineDash([]); };
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
    const pc = P.parcels || {}; const stageOfParcel = { "parcel_F": "S1", "parcel_H": "S2", "parcel_G": "S3", "parcel_E": "AIRPORT" };
    for (const k in pc) { const st = stageOfParcel[k]; if (!pc[k].ring) continue; poly(pc[k].ring, st === "AIRPORT" ? "rgba(245,241,230,0.04)" : rgba(HEX[st] || HEX.S1, 0.08), st === "AIRPORT" ? "rgba(245,241,230,0.18)" : rgba(HEX[st] || HEX.S1, 0.55), Math.max(1, S * 3)); }
    for (const d of P.districts || []) { const st = planStageOf(d); poly(d.poly, rgba(HEX[st] || HEX.S1, park ? 0.16 : 0.12), rgba(HEX[st] || HEX.S1, 0.28), 1); }
    const gp = P.genesis_park || {};
    if (park) for (const l of gp.landscape || []) if (l.poly) poly(l.poly, /field|lawn|meadow|green/i.test(l.type + l.name) ? "rgba(120,170,90,0.35)" : "rgba(200,180,140,0.14)", "rgba(200,180,140,0.25)", 1);
    const rw = P.runway; if (rw && rw.ne) line([rw.ne, rw.sw], "#4a4f52", Math.max(3, 30 * S));
    for (const r of P.roads || []) { if (r.class === "tunnel") { line(r.pts, "rgba(245,241,230,0.55)", Math.max(1.2, r.width * S), [3, 3]); continue; } line(r.pts, r.class === "taxilane" ? "#565b5e" : "#b89b72", Math.max(park ? 1.4 : 0.9, r.width * S * (park ? 1 : 0.9))); }
    for (const r of P.promenades || []) line(r.pts, "#e7dcc3", Math.max(park ? 1.6 : 1.1, r.width * S * 0.8));
    for (const w of gp.water || []) if (w.pts && /creek|rill/i.test(w.kind || "")) line(w.pts, "#5fb3e6", Math.max(2, (park ? 5 : 3) * S * 1.4));
    const loop = (P.promenades || []).find((q) => q.id === "gp_p_loop"); if (loop) line(loop.pts, "#d0864f", Math.max(park ? 3 : 1.5, 5 * S));
    // the Horizon Line in white with the brass line beside it
    const hl = ["sun_gate_walk", "hl1_club_walk", "the_crossing", "hl3_main_street", "hl4_sculpture_ave", "hl5_launch_walk"].map((id) => (P.promenades || []).find((q) => q.id === id) || (P.roads || []).find((q) => q.id === id)).filter(Boolean);
    for (const h of hl) line(h.pts, "#ffffff", Math.max(park ? 3 : 2.2, 6 * S), h.class === "tunnel" ? [4, 3] : null);
    for (const h of hl) if (h.class !== "tunnel") line(offsetLine(h.pts, 9), "#c9a152", Math.max(1, 2 * S), [1.5, 2.5]);
    const ring = (P.places || []).find((q) => /genesis_ring|^ring$/.test(q.id)) || (P.places || []).find((q) => /Genesis Ring/.test(q.name)); if (ring) { x.beginPath(); x.arc(X(ring.x), Z(ring.z), Math.max(3, 12 * S), 0, 6.283); x.strokeStyle = "#6fd6e8"; x.lineWidth = 2; x.stroke(); }
    if (!park) { x.font = `600 ${Math.round(size * 0.026)}px ${FB}`; x.textAlign = "center"; x.fillStyle = "rgba(245,241,230,0.8)";
      const lab = [["STAGE 01 THE LANDING", 420, -560, HEX.S1], ["STAGE 02 THE FLIGHT LINE", -250, 470, HEX.S2], ["STAGE 03 THE EXPANSE", 800, 420, HEX.S3], ["GENESIS PARK", -250, -600, HEX.GP]]; for (const [t, lx, lz, col] of lab) { x.fillStyle = col; x.fillText(t, X(lx), Z(lz)); } }
    else { const fs = Math.round(size * 0.021); x.font = `600 ${fs}px ${FB}`; x.textAlign = "center"; const boxes = [];
      for (const d of gp.destinations || []) { if (typeof d.x !== "number" || d.x > 60) continue; const px = X(d.x), py = Z(d.z); x.fillStyle = "#d0864f"; x.beginPath(); x.arc(px, py, 2.5, 0, 6.283); x.fill();
        let t = planShortName(d.label).replace(/^Genesis Park\s*/, "").replace(/\s+and the .*$/, "") || d.label; const tw = x.measureText(t).width; let bx = [Math.max(2, Math.min(size - tw - 6, px - tw / 2 - 2)), py - 6 - fs, tw + 4, fs + 3]; if (boxes.some((b) => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1])) { bx = [bx[0], py + 5, bx[2], bx[3]]; if (boxes.some((b) => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1])) continue; }
        boxes.push(bx); x.fillStyle = "rgba(16,23,18,0.65)"; x.fillRect(bx[0], bx[1], bx[2], bx[3]); x.fillStyle = "rgba(245,241,230,0.92)"; x.fillText(t, bx[0] + bx[2] / 2, bx[1] + bx[3] / 2 + 1); } }
    // north arrow
    x.fillStyle = "rgba(245,241,230,0.9)"; x.beginPath(); const nx = size - 22, ny = 26; x.moveTo(nx, ny - 14); x.lineTo(nx + 7, ny + 6); x.lineTo(nx, ny + 2); x.lineTo(nx - 7, ny + 6); x.closePath(); x.fill(); x.font = `700 12px ${FB}`; x.textAlign = "center"; x.fillText("N", nx, ny + 20);
    return c;
  }
  function mapsReady() { if (MAPS.site) return; const tier = texScale(); MAPS.site = drawMap(SITE_BB, Math.round(480 * tier), false); MAPS.park = drawMap(PARK_BB, Math.round(480 * tier), true); MAPS.inset = drawMap(SITE_BB, Math.round(150 * tier), false); }

  // ------------------------- canvas painters -------------------------
  function fit(c, text, weight, fam, size, maxW, min) { let s = size; c.font = `${weight} ${s}px ${fam}`; const w = c.measureText(text).width; if (w > maxW) { s = Math.max(min || 6, Math.floor(s * maxW / w)); c.font = `${weight} ${s}px ${fam}`; } return s; }
  function wrap(c, text, maxW) { const words = String(text).split(/\s+/); const out = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
  const PAT = {};
  function pattern(c, key) { if (PAT[key]) return c.createPattern(PAT[key], "repeat"); const cv = document.createElement("canvas"); cv.width = cv.height = 128; const x = cv.getContext("2d");
    if (key === "corten") paintRust(x, 128, 128, "#7a3c1c", 3); else if (key === "copper") { const g = x.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, "#c27a48"); g.addColorStop(0.5, "#a95f33"); g.addColorStop(1, "#b86e3f"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const r = rng(4); for (let i = 0; i < 70; i++) { x.fillStyle = "rgba(255,210,170,0.10)"; x.fillRect(0, r() * 128, 128, 1); } for (let i = 0; i < 90; i++) { x.fillStyle = i % 3 ? "rgba(120,60,28,0.18)" : "rgba(96,168,146,0.22)"; x.beginPath(); x.arc(r() * 128, r() * 128, 1 + r() * 4, 0, 6.283); x.fill(); } }
    else if (key === "wood") { x.fillStyle = "#5b4130"; x.fillRect(0, 0, 128, 128); const r = rng(8); for (let i = 0; i < 60; i++) { x.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,230,190,0.06)"; x.fillRect(0, r() * 128, 128, 1 + r() * 2); } }
    else if (key === "alu") { x.fillStyle = "#d4d8dc"; x.fillRect(0, 0, 128, 128); const r = rng(2); for (let i = 0; i < 90; i++) { x.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.3)"; x.fillRect(0, r() * 128, 128, 1); } }
    PAT[key] = cv; return c.createPattern(cv, "repeat"); }
  function grain(c, x, y, w, h, col, seed) { const r = rng(seed || 3); c.fillStyle = col; for (let i = 0; i < 24; i++) c.fillRect(x, y + r() * h, w, 0.8 + r() * 1.4); }
  function glyphRing(c, cx, cy, R, col) { c.strokeStyle = col; c.lineWidth = R * 0.22; c.beginPath(); c.arc(cx, cy, R, 0, 6.283); c.stroke(); c.lineWidth = R * 0.08; c.beginPath(); c.arc(cx, cy, R * 0.55, 0, 6.283); c.stroke(); }
  function glyphLeaf(c, cx, cy, R, col) { c.strokeStyle = col; c.lineWidth = R * 0.14; c.beginPath(); c.arc(cx, cy, R, 0, 6.283); c.stroke(); c.fillStyle = col; c.beginPath(); c.moveTo(cx, cy - R * 0.62); c.quadraticCurveTo(cx + R * 0.55, cy, cx, cy + R * 0.62); c.quadraticCurveTo(cx - R * 0.55, cy, cx, cy - R * 0.62); c.fill(); }
  const PAINT = {
    arm(c, x, y, w, h, d, rec) { const tim = rec.gp; c.fillStyle = tim ? "#e7dcc2" : "#ece4d1"; c.fillRect(x, y, w, h); if (tim) grain(c, x, y, w, h * 0.86, "rgba(110,80,40,0.08)", 5);
      c.fillStyle = "rgba(0,0,0,0.12)"; c.fillRect(x, y, w, 2); c.fillStyle = d.colour; c.fillRect(x, y + h * 0.87, w, h * 0.13);
      c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#1c1e1b"; fit(c, d.name, 700, FB, Math.round(h * 0.34), w * 0.92, 10); c.fillText(d.name, x + w / 2, y + h * 0.3);
      let info = `${d.dir}  \u00b7  ${d.dist}  \u00b7  ${d.mins}`; if (d.vias.length) info += "  \u00b7  " + d.vias.join(", "); c.fillStyle = "#3f3d37"; fit(c, info, 500, FB, Math.round(h * 0.22), w * 0.92, 8); c.fillText(info, x + w / 2, y + h * 0.66); },
    info(c, x, y, w, h, d) { c.fillStyle = "#1f2420"; c.fillRect(x, y, w, h); c.strokeStyle = d.colour; c.lineWidth = 3; c.strokeRect(x + 5, y + 5, w - 10, h - 10); c.textAlign = "center"; c.textBaseline = "middle";
      let L = d.lines; if (L.length === 1 && /:\s/.test(L[0])) { const i = L[0].indexOf(":"); L = [L[0].slice(0, i), L[0].slice(i + 1).trim()]; L[1] = L[1].charAt(0).toUpperCase() + L[1].slice(1); } c.fillStyle = "#f5f1e6"; fit(c, (L[0] || "").toUpperCase(), 400, FD, Math.round(h * 0.2), w * 0.9, 10); c.fillText((L[0] || "").toUpperCase(), x + w / 2, y + h * 0.2);
      c.font = `500 ${Math.round(h * 0.105)}px ${FB}`; let lines = []; for (const t of L.slice(1)) lines = lines.concat(wrap(c, t, w * 0.9)); lines = lines.slice(0, 5); const lh = h * 0.12; const y0 = y + h * 0.42 + (5 - lines.length) * lh * 0.35; c.fillStyle = "#d8d2c2"; lines.forEach((t, i) => c.fillText(t, x + w / 2, y0 + i * lh)); },
    street(c, x, y, w, h, d, rec) { const st = d.style; c.textAlign = "center"; c.textBaseline = "middle";
      let name = d.name, tag = null; const hl = /^Horizon Line \d+:\s*(.+)$/i.exec(name); if (hl) { name = hl[1]; tag = "Horizon Line"; } const pr = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name); if (pr && pr[1]) { name = pr[1]; tag = (tag ? tag + "  \u00b7  " : "") + pr[2]; }
      const bandH = st === "gp" ? h * 0.18 : 0; let ink = "#f1e4cc", fam = FB, wt = 700;
      if (st === "air") { c.fillStyle = "#141414"; c.fillRect(x, y, w, h); c.strokeStyle = "#b9bec3"; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, w - 4, h - 4); for (const [rx, ry] of [[0.035, 0.22], [0.035, 0.78], [0.965, 0.22], [0.965, 0.78]]) { c.fillStyle = "#c9ced3"; c.beginPath(); c.arc(x + w * rx, y + h * ry, h * 0.055, 0, 6.283); c.fill(); c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.arc(x + w * rx + 1, y + h * ry + 1, h * 0.03, 0, 6.283); c.fill(); } ink = "#f7c600"; }
      else if (st === "timber" || st === "gp") { c.fillStyle = st === "gp" ? pattern(c, "wood") : bladeBg("timber", rec); c.fillRect(x, y, w, h); grain(c, x, y, w, h, "rgba(0,0,0,0.12)", 9); c.strokeStyle = "rgba(240,228,204,0.8)"; c.lineWidth = 2; c.strokeRect(x + 6, y + 6, w - 12, h - 12 - bandH); if (st === "gp") { c.fillStyle = pattern(c, "copper"); c.fillRect(x, y + h - bandH, w, bandH); } ink = "#f0e4cc"; fam = FS; }
      else if (st === "glass") { const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, "#10252c"); g.addColorStop(1, "#08151a"); c.fillStyle = g; c.fillRect(x, y, w, h); c.fillStyle = "#6fd6e8"; c.fillRect(x, y, w, 3); c.fillRect(x, y + h - 3, w, 3); ink = "#f2fbff"; wt = 600; }
      else { c.fillStyle = pattern(c, "corten"); c.fillRect(x, y, w, h); wt = 600; }
      const hh = h - bandH; const ny = y + hh * (tag ? 0.42 : 0.53); const up = name.toUpperCase(); fit(c, up, wt, fam, Math.round(hh * (tag ? 0.38 : 0.44)), w * 0.86, 9);
      if (st === "corten") { c.fillStyle = "rgba(20,10,4,0.55)"; c.fillText(up, x + w / 2 + 2, ny + 2); } if (st === "glass") { c.shadowColor = "#6fd6e8"; c.shadowBlur = 10; }
      c.fillStyle = ink; c.fillText(up, x + w / 2, ny); c.shadowBlur = 0;
      if (tag) { fit(c, tag.toUpperCase(), 600, FB, Math.round(hh * 0.15), w * 0.8, 7); c.globalAlpha = 0.85; c.fillText(tag.toUpperCase(), x + w / 2, y + hh * 0.8); c.globalAlpha = 1; } },
    kiosk(c, x, y, w, h, d, rec) { mapsReady(); c.fillStyle = "#0e1411"; c.fillRect(x, y, w, h); const pad = Math.round(w * 0.05); c.textBaseline = "middle";
      c.fillStyle = "#ff3b30"; c.beginPath(); c.arc(x + pad + 7, y + h * 0.035, 7, 0, 6.283); c.fill(); c.textAlign = "left"; c.fillStyle = "#e9e2d2"; c.font = `700 ${Math.round(h * 0.019)}px ${FM}`; c.fillText("YOU ARE HERE", x + pad + 20, y + h * 0.036);
      c.fillStyle = "#f5f1e6"; fit(c, d.head.toUpperCase(), 400, FD, Math.round(h * 0.046), w - pad * 2, 12); c.fillText(d.head.toUpperCase(), x + pad, y + h * 0.078);
      const ms = w - pad * 2, my = y + Math.round(h * 0.11); const map = d.park ? MAPS.park : MAPS.site; c.drawImage(map, x + pad, my, ms, ms); c.strokeStyle = "rgba(245,241,230,0.35)"; c.lineWidth = 1.5; c.strokeRect(x + pad, my, ms, ms);
      if (d.park) { const s2 = Math.round(ms * 0.24); c.drawImage(MAPS.inset, x + pad + 5, my + ms - s2 - 5, s2, s2); c.strokeStyle = "rgba(245,241,230,0.6)"; c.lineWidth = 1.5; c.strokeRect(x + pad + 5, my + ms - s2 - 5, s2, s2); }
      const bb = d.park ? PARK_BB : SITE_BB; const px = x + pad + (d.x - bb[0]) / (bb[1] - bb[0]) * ms, py = my + (d.z - bb[2]) / (bb[3] - bb[2]) * ms; c.strokeStyle = "#ff3b30"; c.lineWidth = 3; c.beginPath(); c.arc(px, py, 11, 0, 6.283); c.stroke();
      rec.mapRect = [x + pad, my, ms, ms]; rec.mapBB = bb;
      let ly = my + ms + Math.round(h * 0.022); c.font = `600 ${Math.round(h * 0.0145)}px ${FB}`; c.textAlign = "left"; const leg = d.park ? [["the Loop", "#d0864f"], ["Genesis Creek", "#5fb3e6"], ["Genesis", "#4DDE6F"]] : [["Horizon Line", "#ffffff"], ["brass line", "#c9a152"], ["S1", HEX.S1], ["S2", HEX.S2], ["S3", HEX.S3], ["Park", HEX.GP]]; let lx = x + pad;
      for (const [t, col] of leg) { c.fillStyle = col; c.fillRect(lx, ly - 4, 14, 8); c.fillStyle = "#cfc8b8"; c.fillText(t, lx + 18, ly); lx += 26 + c.measureText(t).width; }
      ly += Math.round(h * 0.03); const rows = d.list.slice(0, 8); const rh = Math.min(Math.round(h * 0.04), Math.floor((y + h * 0.955 - ly) / Math.max(1, rows.length)));
      for (const r of rows) { c.fillStyle = r.colour; c.fillRect(x + pad, ly + 3, 6, rh - 8); c.textAlign = "left"; c.fillStyle = "#f5f1e6"; const nm = r.name + (r.vias.length ? "  (" + r.vias.join(", ") + ")" : ""); fit(c, nm, 600, FB, Math.round(rh * 0.46), w * 0.6, 8); c.fillText(nm, x + pad + 14, ly + rh * 0.45);
        c.textAlign = "right"; c.fillStyle = "#bfb8a8"; const inf = `${r.dir}  ${r.dist}  ${r.mins.replace(" walk", "")}`; fit(c, inf, 500, FM, Math.round(rh * 0.38), w * 0.3, 8); c.fillText(inf, x + w - pad, ly + rh * 0.45); ly += rh; }
      c.textAlign = "center"; c.fillStyle = "#9d978a"; c.font = `500 ${Math.round(h * 0.0135)}px ${FB}`; const foot = d.park ? "Genesis Park · open to everyone, sunrise to sunset" : "Grand Loop shuttle every 15 min  \u00b7  Crossing Shuttle every 3 min"; fit(c, foot, 500, FB, Math.round(h * 0.0135), w - pad * 2, 7); c.fillText(foot, x + w / 2, y + h * 0.975); },
    monument(c, x, y, w, h, d, rec) { const gp = d.gp, air = d.stage === "AIRPORT"; c.fillStyle = gp ? pattern(c, "copper") : air ? pattern(c, "alu") : pattern(c, "corten"); c.fillRect(x, y, w, h);
      const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, "rgba(255,255,255,0.06)"); g.addColorStop(1, "rgba(0,0,0,0.22)"); c.fillStyle = g; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 4; c.strokeRect(x + 3, y + 3, w - 6, h - 6);
      const ink = air ? "#1d2226" : "#f3ead8", shade = air ? "rgba(255,255,255,0.5)" : "rgba(15,6,2,0.6)"; const col = HEX[d.stage] || HEX.S1; c.textAlign = "center"; c.textBaseline = "middle";
      const word = d.word.toUpperCase(); const big = d.cb ? h * 0.3 : h * 0.3; try { c.letterSpacing = Math.round(big * 0.06) + "px"; } catch (e) {}
      let wx = x + w / 2; if (gp) { glyphLeaf(c, x + w * 0.12, y + h * (d.cb ? 0.3 : 0.28), big * 0.42, "#f3ead8"); wx = x + w * 0.56; }
      fit(c, word, 400, FD, Math.round(big), gp ? w * 0.72 : w * 0.88, 20); c.fillStyle = shade; c.fillText(word, wx + 3, y + h * 0.28 + 3); c.fillStyle = ink; c.fillText(word, wx, y + h * 0.28); try { c.letterSpacing = "0px"; } catch (e) {}
      let yy = y + h * 0.55;
      if (d.stageNo) { const t = `STAGE ${d.stageNo}  \u00b7  ${d.stageName.toUpperCase()}`; fit(c, t, 700, FB, Math.round(h * 0.11), w * 0.86, 12); c.fillStyle = shade; c.fillText(t, x + w / 2 + 2, yy + 2); c.fillStyle = col; c.fillText(t, x + w / 2, yy); yy += h * 0.15; }
      const rest = d.lines.slice(); c.fillStyle = ink; for (let i = 0; i < rest.length && yy < y + h * 0.95; i++) { const sz = i === 0 && !d.stageNo ? h * 0.1 : h * 0.07; c.font = `${i === 0 && !d.stageNo ? 700 : 500} ${Math.round(sz)}px ${FB}`; const ln = wrap(c, rest[i], w * 0.86).slice(0, 2); for (const t of ln) { c.fillText(t, x + w / 2, yy); yy += sz * 1.25; } }
      if (gp && yy < y + h * 0.97) { c.font = `500 ${Math.round(h * 0.05)}px ${FB}`; c.fillStyle = "rgba(243,234,216,0.85)"; c.fillText("Open to everyone, sunrise to sunset", x + w / 2, Math.min(y + h * 0.92, yy + h * 0.02)); } },
    marker(c, x, y, w, h, d) { c.fillStyle = d.gp ? pattern(c, "copper") : pattern(c, "corten"); c.fillRect(x, y, w, h); c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(x, y + h - 6, w, 6); c.textAlign = "center"; c.textBaseline = "middle";
      const L = d.lines; let head = L[0] || "", stage = L[1] || "", sub = L[2] || ""; if (/\|/.test(head)) { const p = head.split("|").map((q) => q.trim()); head = p[0]; stage = p[1] || ""; sub = p.slice(2).join(", "); }
      c.font = `400 ${Math.round(w * 0.2)}px ${FD}`; let lines = wrap(c, head.toUpperCase(), w * 0.84); let sz = Math.round(w * 0.2); while (lines.length > 5 && sz > 16) { sz -= 2; c.font = `400 ${sz}px ${FD}`; lines = wrap(c, head.toUpperCase(), w * 0.84); }
      let widest = 0; for (const t of lines) widest = Math.max(widest, c.measureText(t).width); if (widest > w * 0.86) { sz = Math.floor(sz * w * 0.86 / widest); c.font = `400 ${sz}px ${FD}`; }
      let yy = y + h * 0.1; for (const t of lines) { c.fillStyle = "rgba(15,6,2,0.55)"; c.fillText(t, x + w / 2 + 2, yy + 2); c.fillStyle = "#f3ead8"; c.fillText(t, x + w / 2, yy); yy += sz * 1.12; }
      const col = d.gp ? HEX.AIRPORT : (HEX[d.stage] || HEX.S1); c.fillStyle = col; c.fillRect(x + w * 0.3, yy + 4, w * 0.4, 4); yy += 22;
      const m = /^Stage (One|Two|Three)\s+(.*)$/i.exec(stage); c.fillStyle = col; if (m) { c.font = `700 ${Math.round(w * 0.1)}px ${FB}`; c.fillText("STAGE " + NUMW[m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()], x + w / 2, yy); yy += w * 0.13; c.font = `600 ${Math.round(w * 0.085)}px ${FB}`; for (const t of wrap(c, m[2].toUpperCase(), w * 0.86)) { c.fillText(t, x + w / 2, yy); yy += w * 0.11; } }
      else if (stage) { c.font = `600 ${Math.round(w * 0.075)}px ${FB}`; for (const t of wrap(c, stage, w * 0.86).slice(0, 4)) { c.fillText(t, x + w / 2, yy); yy += w * 0.1; } }
      c.font = `500 ${Math.round(w * 0.066)}px ${FB}`; const ln = sub ? wrap(c, sub, w * 0.84).slice(0, 5) : []; const subTop = y + h * 0.95 - ln.length * w * 0.085;
      { const gr = Math.min(w * 0.2, (subTop - yy) * 0.32); if (gr > w * 0.08) { const gy = (yy + subTop) / 2 - w * 0.03; c.globalAlpha = 0.55; if (d.gp) glyphLeaf(c, x + w / 2, gy, gr, "rgba(20,8,2,0.75)"); else glyphRing(c, x + w / 2, gy, gr, "rgba(20,8,2,0.75)"); c.globalAlpha = 0.85; c.fillStyle = col; c.beginPath(); c.arc(x + w / 2, gy, gr * 0.16, 0, 6.283); c.fill(); c.globalAlpha = 1; } }
      if (ln.length) { c.fillStyle = "rgba(243,234,216,0.85)"; let y2 = Math.max(yy + 10, subTop); for (const t of ln) { c.fillText(t, x + w / 2, y2); y2 += w * 0.085; } } },
    trailTop(c, x, y, w, h, d) { const cx = x + w / 2, cy = y + h / 2, R = w * 0.49; const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R); g.addColorStop(0, d.gp ? "#d99a66" : "#c9a15e"); g.addColorStop(1, d.gp ? "#8a4f28" : "#6f5128"); c.fillStyle = "#3a2a16"; c.fillRect(x, y, w, h); c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, 6.283); c.fill();
      const ink = "rgba(40,24,10,0.9)"; if (d.glyph === "ring") glyphRing(c, cx, cy - h * 0.25, w * 0.075, ink); else glyphLeaf(c, cx, cy - h * 0.25, w * 0.08, ink);
      c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = ink; fit(c, d.num, 400, FD, Math.round(h * 0.3), w * 0.7, 12); c.fillText(d.num, cx, cy + h * 0.02); c.font = `700 ${Math.round(h * 0.065)}px ${FB}`; const u = d.unit.toUpperCase(); fit(c, u, 700, FB, Math.round(h * 0.065), w * 0.74, 6); c.fillText(u, cx, cy + h * 0.24); },
    trailSide(c, x, y, w, h, d) { c.fillStyle = d.gp ? "#8f5630" : "#7a5a2e"; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(255,230,180,0.35)"; c.lineWidth = 2; c.strokeRect(x + 4, y + 4, w - 8, h - 8); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#f6e7c8";
      fit(c, d.title.toUpperCase(), 700, FB, Math.round(h * 0.13), w * 0.84, 6); c.fillText(d.title.toUpperCase(), x + w / 2, y + h * 0.18); fit(c, d.num + " m", 400, FD, Math.round(h * 0.34), w * 0.84, 10); c.fillText(d.num + " m", x + w / 2, y + h * 0.5);
      c.font = `600 ${Math.round(h * 0.085)}px ${FB}`; const t = (d.sub || d.unit.replace(/^m\s*/, "")); const ln = wrap(c, t, w * 0.86).slice(0, 2); ln.forEach((q, i) => c.fillText(q, x + w / 2, y + h * (0.76 + i * 0.12))); },
    totem(c, x, y, w, h, d) { c.fillStyle = "#1c1f1e"; c.fillRect(x, y, w, h); c.fillStyle = HEX[d.st] || HEX.S1; c.fillRect(x, y + h - 8, w, 8); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#f5f1e6"; fit(c, d.name, 400, FD, Math.round(h * 0.42), w * 0.92, 12); c.fillText(d.name, x + w / 2, y + h * 0.36);
      c.fillStyle = HEX[d.st] || HEX.S1; const st = d.stage.replace(/^Stage (One|Two|Three)\s*/i, (q, n) => "STAGE " + NUMW[n[0].toUpperCase() + n.slice(1).toLowerCase()] + "  \u00b7  ").toUpperCase(); fit(c, st, 600, FB, Math.round(h * 0.17), w * 0.92, 8); c.fillText(st, x + w / 2, y + h * 0.74); },
    airfield(c, x, y, w, h, d) { c.fillStyle = "#101010"; c.fillRect(x, y, w, h); const f = d.faces; const rows = [f[0], f[1], f[2]].filter(Boolean); const hh = rows.length === 1 ? [h] : rows.length === 2 ? [h * 0.58, h * 0.42] : [h * 0.48, h * 0.32, h * 0.2]; let yy = y; c.textBaseline = "middle";
      rows.forEach((t, i) => { const rh = hh[i];
        if (i === 0) { const segs = airSegs(t.toUpperCase()); const gap = 6, avail = w - 12 - gap * (segs.length - 1); let fs = Math.round(rh * 0.6); c.font = `700 ${fs}px ${FB}`; const nat = segs.map((s) => c.measureText(s.t).width + rh * 0.5); let tw = nat.reduce((a, b) => a + b, 0);
          if (tw > avail) { const k = avail / tw; fs = Math.floor(fs * k); c.font = `700 ${fs}px ${FB}`; for (let j = 0; j < nat.length; j++) nat[j] *= k; tw = avail; } const extra = (avail - tw) / segs.length; let xx = x + 6;
          segs.forEach((s, j) => { const sw = nat[j] + extra; if (s.loc) { c.fillStyle = "#111"; c.fillRect(xx, yy + 4, sw, rh - 8); c.strokeStyle = "#f2c200"; c.lineWidth = 4; c.strokeRect(xx + 5, yy + 9, sw - 10, rh - 18); c.fillStyle = "#f2c200"; } else { c.fillStyle = "#f2c200"; c.fillRect(xx, yy + 4, sw, rh - 8); c.fillStyle = "#111"; } c.textAlign = "center"; c.fillText(s.t, xx + sw / 2, yy + rh / 2 + 2); xx += sw + gap; }); }
        else if (i === 1) { c.fillStyle = "#f2c200"; c.fillRect(x + 6, yy, w - 12, rh - 6); c.fillStyle = "#111"; c.textAlign = "center"; const tt = t.replace("->", "\u2192").replace("<-", "\u2190").toUpperCase(); fit(c, tt, 700, FB, Math.round(rh * 0.56), w - 40, 8); c.fillText(tt, x + w / 2, yy + rh / 2 - 2); }
        else { c.fillStyle = "#f5f1e6"; c.textAlign = "center"; fit(c, t, 600, FB, Math.round(rh * 0.52), w - 40, 8); c.fillText(t, x + w / 2, yy + rh / 2); } yy += rh; }); },
  };

  // ------------------------- text pools -------------------------
  function texScale() { try { return ASSET && ASSET.tier === "m" ? 0.75 : 1; } catch (e) { return 1; } }
  function newSlot(kind) { const K = KIND[kind]; const sc = texScale(); const cv = document.createElement("canvas"); cv.width = Math.round(K.w * sc); cv.height = Math.round(K.h * sc); const ctx = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.userData.text = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.62, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.visible = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noInst = true; mesh.userData.planSigns = true; mesh.renderOrder = 1; ST.root.add(mesh);
    const slot = { kind, cv, ctx, tex, mat, mesh, rec: null, sc, dots: null }; return slot; }
  function paintSlot(slot, rec) { const c = slot.ctx, sc = slot.sc; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, slot.cv.width, slot.cv.height); c.setTransform(sc, 0, 0, sc, 0, 0);
    for (const rg of rec.regions || []) { const [x, y, w, h] = rg.rect; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); try { PAINT[rg.paint](c, x, y, w, h, rg.d, rec); } catch (e) { if (!ST.paintErr) { ST.paintErr = true; console.warn("plan_signs: paint failed", rec.id, e); } } c.restore(); }
    c.setTransform(1, 0, 0, 1, 0, 0); slot.tex.needsUpdate = true; }
  function quadsGeo(rec, slot) { const K = KIND[slot.kind]; const qs = rec.quads || []; const pos = new Float32Array(qs.length * 12), nor = new Float32Array(qs.length * 12), uv = new Float32Array(qs.length * 8), idx = []; let o = 0;
    qs.forEach((q, i) => { const [cx, cy, cz] = q.c, r = q.r, u = q.u; const hw = q.w / 2, hh = q.h / 2; const n = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
      const P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]; const [px, py, pw, ph] = q.rect; const u0 = px / K.w, u1 = (px + pw) / K.w, v1 = 1 - py / K.h, v0 = 1 - (py + ph) / K.h; const UV = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      for (let k = 0; k < 4; k++) { const [a, b] = P[k]; pos[o * 3] = cx + r[0] * a + u[0] * b; pos[o * 3 + 1] = cy + r[1] * a + u[1] * b; pos[o * 3 + 2] = cz + r[2] * a + u[2] * b; nor[o * 3] = n[0]; nor[o * 3 + 1] = n[1]; nor[o * 3 + 2] = n[2]; uv[o * 2] = UV[k][0]; uv[o * 2 + 1] = UV[k][1]; o++; }
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere(); return g; }
  function assign(slot, rec) { if (slot.rec) slot.rec.slot = null; slot.rec = rec; rec.slot = slot; paintSlot(slot, rec); const old = slot.mesh.geometry; slot.mesh.geometry = quadsGeo(rec, slot); if (old) old.dispose(); slot.mesh.visible = true; slot.mat.emissiveIntensity = glowFor(rec, ST.glow < 0 ? 0 : ST.glow);
    if (slot.kind === "ki") kioskDots(slot, rec); ST.assigns = (ST.assigns || 0) + 1; }
  function release(slot) { if (slot.rec) slot.rec.slot = null; slot.rec = null; slot.mesh.visible = false; if (slot.dots) for (const d of slot.dots) d.visible = false; }
  function glowFor(rec, g) { const f = rec.fam; if (f === "ki") return 0.18 + 0.8 * g; if (f === "rw") return 0.05 + 1.05 * g; if (f === "bl" && rec.style === "glass") return 0.1 + 0.8 * g; if (f === "tb") return 0.05 * g; return 0.14 * g; }
  // live kiosk map: the red you-are-here dot (pulsing) and the viewer's own position (moving)
  function kioskDots(slot, rec) { if (!slot.dots) { slot.dots = []; const g = new THREE.CircleGeometry(1, 20); const red = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }); const me = new THREE.MeshBasicMaterial({ color: 0x4DDE6F, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(g, i < 2 ? red : me); m.visible = false; m.userData.noInst = true; ST.root.add(m); slot.dots.push(m); } }
    for (const d of slot.dots) d.visible = true; kioskDotUpdate(slot, 0); }
  function mapToWorld(rec, face, px, py) { const K = KIND.ki; const qd = rec.quads[face]; const lx = (px / K.w - 0.5) * qd.w, ly = (0.5 - py / K.h) * qd.h; const n = [qd.r[1] * qd.u[2] - qd.r[2] * qd.u[1], qd.r[2] * qd.u[0] - qd.r[0] * qd.u[2], qd.r[0] * qd.u[1] - qd.r[1] * qd.u[0]];
    return [qd.c[0] + qd.r[0] * lx + qd.u[0] * ly + n[0] * 0.004, qd.c[1] + qd.r[1] * lx + qd.u[1] * ly + n[1] * 0.004, qd.c[2] + qd.r[2] * lx + qd.u[2] * ly + n[2] * 0.004, n]; }
  function kioskDotUpdate(slot, now) { const rec = slot.rec; if (!rec || !rec.mapRect || !slot.dots) return; const [mx, my, ms] = rec.mapRect, bb = rec.mapBB; const K = KIND.ki;
    const toPx = (wx, wz) => [mx + (wx - bb[0]) / (bb[1] - bb[0]) * ms, my + (wz - bb[2]) / (bb[3] - bb[2]) * ms];
    const here = toPx(rec.x0, rec.z0); const pl = (typeof player !== "undefined" && player) ? player.position : camera.position; const me = toPx(pl.x, pl.z); const inMap = me[0] > mx && me[0] < mx + ms && me[1] > my && me[1] < my + ms;
    const pulse = 1 + 0.35 * Math.sin(now * 0.006); const pxm = rec.quads[0].w / K.w;
    for (let f = 0; f < 2; f++) { const a = mapToWorld(rec, f, here[0], here[1]); const d = slot.dots[f]; d.position.set(a[0], a[1], a[2]); d.lookAt(a[0] + a[3][0], a[1] + a[3][1], a[2] + a[3][2]); d.scale.setScalar(6 * pxm * pulse);
      const b = mapToWorld(rec, f, me[0], me[1]); const e = slot.dots[2 + f]; e.visible = inMap && Math.hypot(me[0] - here[0], me[1] - here[1]) > 3; e.position.set(b[0], b[1], b[2]); e.lookAt(b[0] + b[3][0], b[1] + b[3][1], b[2] + b[3][2]); e.scale.setScalar(4 * pxm); } }

  function textRange() { let k = 1; try { if (QUAL && QUAL.q && QUAL.q.range) k = Math.max(0.7, Math.min(1.2, QUAL.q.range)); } catch (e) {} return k; }
  function updatePools(force) {
    const cam = camera.position; const k = textRange(); const want = {}; for (const kd in KIND) want[kd] = [];
    ST.cellGrid.near(cam.x, cam.z, 100, (rec) => { const R = KIND[rec.fam].R * k; const d = Math.hypot(rec.x - cam.x, rec.y + 1.5 - cam.y, rec.z - cam.z); if (d < (rec.slot ? R * 1.12 : R)) want[rec.fam].push([d, rec]); });
    let budget = force ? 1e9 : 2;
    for (const kd in KIND) { const pool = ST.pools[kd] || (ST.pools[kd] = []); const list = want[kd].sort((a, b) => a[0] - b[0]); const keep = new Set(list.slice(0, KIND[kd].max).map((q) => q[1]));
      for (const sl of pool) if (sl.rec && !keep.has(sl.rec)) release(sl);
      for (const [d, rec] of list) { if (!keep.has(rec) || rec.slot) continue; if (budget <= 0) { ST.pending = true; break; } let sl = pool.find((q) => !q.rec); if (!sl && pool.length < KIND[kd].max) { sl = newSlot(kd); pool.push(sl); } if (!sl) break; assign(sl, rec); budget--; } }
  }
  function updateGlow() { let g = 0; try { g = Math.max(0, Math.min(1, M.lampGlow.emissiveIntensity / 2.5)); } catch (e) {} if (Math.abs(g - ST.glow) < 0.02) return; ST.glow = g;
    for (const kd in ST.pools) for (const sl of ST.pools[kd]) if (sl.rec) sl.mat.emissiveIntensity = glowFor(sl.rec, g);
    const b = 0.55 + 0.9 * g; for (const m of ST.glowMats) { if (m.userData.base) m.color.copy(m.userData.base).multiplyScalar(b); else if (m.map) m.color.setScalar(0.6 + 0.6 * g); else m.color.setScalar(b); } }

  // ------------------------- defer hook: build -------------------------
  function buildSigns() {
    if (!ST.placed || ST.built) return; const t0 = performance.now();
    const root = new THREE.Group(); root.name = "planSigns"; root.userData.noCull = true; root.userData.noInst = true; scene.add(root); ST.root = root;
    makeMats(); let fails = 0;
    for (const rec of ST.recs) { try { ({ fp: buildFingerpost, bl: buildBladeSet, ki: buildKiosk, mo: buildMonument, dm: buildMarker, tb: buildTrail, tm: buildTotem, rw: buildRunway })[rec.fam](rec); rec.ok = true; } catch (e) { fails++; if (fails <= 3) console.warn("plan_signs: build failed", rec.id, e); } }
    let n = flushInstances(root); n += mergeInto(root);
    // the brass line: plan_outpost.js (B4) lays the full line (studs, strips, stars and the medallion); this is only the fallback when that module is absent
    if (window.PLAN_OUTPOST && typeof window.PLAN_OUTPOST === "object") API.brassLine = { owner: "plan_outpost.js" }; else { try { n += buildBrass(root); } catch (e) { console.warn("plan_signs: brass line failed", e); } }
    ST.cellGrid = new Grid(50); for (const rec of ST.recs) if (rec.ok && rec.quads && rec.quads.length) ST.cellGrid.addBox(rec.x, rec.z, rec.x, rec.z, rec);
    ST.meshes = n; ST.built = true; ST.buildMs = Math.round(performance.now() - t0);
    try { if (document.fonts && document.fonts.load) Promise.all([document.fonts.load(`40px ${FD}`), document.fonts.load(`600 20px ${FB}`), document.fonts.load(`600 20px ${FM}`)]).then(() => { ST.fontsOk = true; ST.repaint = true; }).catch(() => {}); } catch (e) {}
    console.log(`plan signs: ${ST.recs.length} signs built (${ST.tunnel.length} tunnel markers left to the tunnel module), ${n} meshes, ${ST.nudged.length} nudged, ${ST.unresolved.length} unresolved, ${ST.buildMs} ms`);
  }

  // ------------------------- frame hook -------------------------
  function frameSigns(dt, now) {
    if (!ST.built) return; ST.frame++;
    if (ST.repaint) { ST.repaint = false; for (const kd in ST.pools) for (const sl of ST.pools[kd]) if (sl.rec) paintSlot(sl, sl.rec); }
    const cam = camera.position; const moved = !ST.lastCam || Math.abs(cam.x - ST.lastCam[0]) + Math.abs(cam.z - ST.lastCam[1]) > 2.5;
    if (API.forceNext) { API.forceNext = false; updatePools(true); ST.lastCam = [cam.x, cam.z]; }
    else if (moved || ST.frame % 20 === 0 || (ST.pending && ST.frame % 3 === 0)) { ST.pending = false; updatePools(false); if (moved) ST.lastCam = [cam.x, cam.z]; }
    if (ST.frame % 30 === 1) updateGlow();
    const ki = ST.pools.ki; if (ki && ST.frame % 2 === 0) for (const sl of ki) if (sl.rec) kioskDotUpdate(sl, now || performance.now());
  }
  // debug camera for screenshots (only while API.cam is set)
  function interiorSigns() { const c = API.cam; if (!c) return false; camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); return true; }

  // ------------------------- debug / test API -------------------------
  API.find = (id) => ST.recs.find((r) => r.id === id) || null;
  API.force = () => { API.forceNext = true; };
  API.stats = () => { const fam = {}; for (const r of ST.recs) fam[r.fam] = (fam[r.fam] || 0) + 1; const pools = {}; for (const kd in ST.pools) pools[kd] = ST.pools[kd].filter((s) => s.rec).length + "/" + ST.pools[kd].length; return { signs: ST.recs.length, built: ST.recs.filter((r) => r.ok).length, fam, tunnel: ST.tunnel.length, meshes: ST.meshes, nudged: ST.nudged.length, unresolved: ST.unresolved, pools, assigns: ST.assigns || 0, buildMs: ST.buildMs, carriageRibbons: ST.carrN, brass: API.brassLine }; };
  // look at sign `id` from `dist` m in front of its face (or along `bearing`), camera at eye height
  API.view = (id, dist, side, up) => { const r = API.find(id); if (!r) return null; const f = [Math.sin(r.th), Math.cos(r.th)]; const s = side || 0; const d = dist || 6; let fx = f[0], fz = f[1]; if (r.fam === "mo" || r.fam === "fp" || r.fam === "bl" || r.fam === "tb") { fx = f[0]; fz = f[1]; }
    const cx = r.x + fx * d + (-fz) * s, cz = r.z + fz * d + fx * s; const ty = r.y + ({ fp: 2.4, bl: 2.6, ki: 1.3, mo: 1.4, dm: 1.0, tb: 0.5, tm: 2.2, rw: 1.1 })[r.fam]; API.cam = [cx, surf(cx, cz) + (up || 1.7), cz, r.x, ty, r.z]; try { player.position.set(cx, surf(cx, cz), cz); } catch (e) {} API.forceNext = true; return { x: +cx.toFixed(1), z: +cz.toFixed(1), th: +r.th.toFixed(2), y: +r.y.toFixed(2) }; };
  API.free = () => { API.cam = null; };
  // pick a clear viewpoint: dist m from the sign, the smallest angle off its face (either face) whose sight line crosses no building footprint
  API.shot = (id, dist, up, lookUp) => { const r = API.find(id); if (!r) return null; const d = dist || 6; const polys = (window.PLAN.buildings || []).filter((b) => b.poly && Math.hypot(b.x - r.x, b.z - r.z) < d + 60);
    const segHits = (ax, az, bx, bz, poly) => { for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [x1, z1] = poly[j], [x2, z2] = poly[i]; const den = (bx - ax) * (z2 - z1) - (bz - az) * (x2 - x1); if (Math.abs(den) < 1e-9) continue; const t = ((x1 - ax) * (z2 - z1) - (z1 - az) * (x2 - x1)) / den, u = ((x1 - ax) * (bz - az) - (z1 - az) * (bx - ax)) / den; if (t > 0 && t < 1 && u > 0 && u < 1) return true; } return false; };
    const ok = (cx, cz) => { for (const b of polys) { if (planInPoly(b.poly, cx, cz) || polyEdgeDist(b.poly, cx, cz) < 1.5 || segHits(cx, cz, r.x, r.z, b.poly)) return false; } return true; };
    const faces = r.fam === "fp" || r.fam === "bl" || r.fam === "tb" ? [0, 90, 180, 270] : [0, 180];
    for (const off of [0, 15, -15, 30, -30, 45, -45, 60, -60]) for (const f0 of faces) { const a = r.th + (f0 + off) * Math.PI / 180; const cx = r.x + Math.sin(a) * d, cz = r.z + Math.cos(a) * d; if (!ok(cx, cz)) continue;
      const ty = r.y + (lookUp !== undefined ? lookUp : ({ fp: 2.4, bl: 2.7, ki: 1.3, mo: 1.3, dm: 0.95, tb: 0.5, tm: 2.0, rw: 1.1 })[r.fam]); API.cam = [cx, surf(cx, cz) + (up || 1.7), cz, r.x, ty, r.z]; try { player.position.set(cx, surf(cx, cz), cz); } catch (e) {} API.forceNext = true; return { id, a: f0 + off, x: +cx.toFixed(1), z: +cz.toFixed(1) }; }
    return API.view(id, d, 0, up); };
  // the painted text canvas of one sign as a PNG data URL (design review without the renderer)
  API.canvas = (id, scale) => { const r = API.find(id); if (!r || !r.regions) return null; const K = KIND[r.fam]; const sc = scale || 1; const cv = document.createElement("canvas"); cv.width = Math.round(K.w * sc); cv.height = Math.round(K.h * sc); paintSlot({ ctx: cv.getContext("2d"), cv, sc, tex: {} }, r); return cv.toDataURL("image/png"); };

  HOOKS.world.push({ name: "signs:place", fn: placeSigns });
  HOOKS.defer.push({ name: "signs:build", fn: buildSigns });
  HOOKS.frame.push({ name: "signs:frame", fn: frameSigns });
  HOOKS.interior.push({ name: "signs:debugcam", fn: interiorSigns });
})();
