// plan_flight.js (round 3, flight): fly your own jet at Solport. PLAN mode only (the legacy world never runs these hooks and keeps
// client.js driveVehicle, which is also correct now that the vehicle group composes heading, pitch and roll in that order).
//  1. The flight model for the shared jets (Giveback One): throttle with engine spool, a takeoff roll with nose-wheel steering and
//     brakes, rotation from about 100 KT, lift from the angle of attack and the flap setting, a fly-by-wire pitch law (the stick
//     asks for a change of flight path, neutral holds it, a turn needs no back pressure), banked coordinated turns that follow
//     the bank, stall protection (an angle-of-attack limit, a climb limit that follows the speed and alpha-floor thrust, so the
//     jet sinks gently instead of stalling), gear, flaps UP/15/35 with load relief, speed brakes, ground spoilers and autobrake.
//  2. The attitude is written as heading (rotation.y), pitch (rotation.x, negative = nose up) and roll (rotation.z, positive =
//     right wing down) on a group whose Euler order is YXZ (client.js ensureVehicle) and whose model nose is local +Z, so the
//     nose points where the jet goes at every heading. Remote jets get the same order and the roll we send.
//  3. A chase camera (smoothed in angle, no lag at speed) and a cockpit view with a head-up display; keyboard and mouse,
//     gamepad (standard mapping) and touch (the joystick plus a flight button panel).
//  4. A soft airspace: the Genesis One section line (plan_bounds.js) plus a margin, and the Runway 03/21 approach corridor.
//     Past it the jet is banked back toward the site; never below the terrain; a ceiling of 1,000 m above the ground.
//  5. The Solport Scenic Flight: tow or taxi to Runway 03, take off, fly nine gates over Solport and the Stellar FBO, Main
//     Street, Compass Plaza, The Outpost, Desert Golf and Genesis Park, join right base for Runway 21 and land. Score (10,000):
//     gates, touchdown rate, centreline, touchdown zone, smoothness and time. Personal best in localStorage; the shared board
//     "flight" in the server boards (like Dance Battle, v = 100000 - points; a device board until the server knows the game);
//     PLAN_PROGRESS.award("flight", { score, landed: true }) when a flight lands and stops on the runway (score on the 0..100
//     scale plan_progress.js reads, the points as `points`).
// Client globals are reached by bare name at call time. Every override dispatches through PLAN_FLIGHT.impl (hot reload in tests).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  const FL = (window.PLAN_FLIGHT = window.PLAN_FLIGHT || {});
  FL.errs = FL.errs || [];
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, KT = 1.943844, FTM = 3.28084, FPM = 196.8504, G0 = 9.81, MAGVAR = 10;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const sk = (dt, r) => 1 - Math.exp(-dt * r);
  function log(where, e) { const m = where + ": " + ((e && e.message) || e); if (FL.errs.length < 40) FL.errs.push(m); if (FL.errs.length <= 5) console.error("plan_flight " + m, (e && e.stack) || ""); }

  // ───────────────────────────── tuning ─────────────────────────────
  // accelerations in m/s2; lift and drag as cL * V^2 * coefficient. Stall (at the protection angle): about 95 KT clean,
  // 89 KT flaps 15, 85 KT flaps 35; rotate 100 KT; approach 110 to 120 KT (nose a little up); about 140 KT for the loop; VMO 250 KT.
  // kTurn scales the turn rate of a coordinated turn (a real jet at 35 degrees of bank would need a kilometre to turn round;
  // 430 acres needs about 300 m), so the bank you see still sets the turn.
  const C = FL.cfg = Object.assign({
    tmax: 3.6, lapse: 0.25, idle: 0.05,
    cL: 3.076e-3, cla: 5.2, cl0: [0.2, 0.38, 0.52], flapDeg: [0, 15, 35], flapMaxKt: [999, 200, 165],
    cd0: 0.028, cdGear: 0.022, cdFlap: [0, 0.012, 0.04], cdSB: 0.06, cdGS: 0.1, K: 0.05,
    alProt: 12.5 * D2R, alMin: -6 * D2R, alRate: 10 * D2R,
    bankMax: 35 * D2R, rollRate: 32 * D2R, kTurn: 2.5, dnUp: 0.7, dnDn: 0.6, gamMin: -16 * D2R,
    vmo: 250 / KT, mu: 0.018, muRough: 0.07, brake: 3.2, autobrake: 1.9,
    rotMax: 10 * D2R, rotUp: 3.2 * D2R, rotDn: 2.4 * D2R, gearT: 6, flapT: 2.5, ceiling: 1000,
    edgeSoft: 150, edgeSpan: 350, corrC: 800, corrA: 1750,
  }, FL.cfgOverride || {});
  const GATE_R = 26, PAR = 165, MAX_RUN = 600;

  // ───────────────────────────── runway frame (plan.json) ─────────────────────────────
  const RW = FL.rw = { ok: false };
  function ground(x, z) { try { const h = planGroundAt(x, z); if (Number.isFinite(h)) return h; } catch (e) {} try { return getH(x, z); } catch (e) { return 0; } }
  function setupRunway() {
    const P = window.PLAN; const ne = P && P.runway ? P.runway.ne : [738, -445.4], sw = P && P.runway ? P.runway.sw : [-411.2, 884.4];
    const dx = ne[0] - sw[0], dz = ne[1] - sw[1], L = Math.hypot(dx, dz);
    RW.u = [dx / L, dz / L]; RW.p = [-RW.u[1], RW.u[0]]; RW.mid = [(ne[0] + sw[0]) / 2, (ne[1] + sw[1]) / 2]; RW.half = L / 2; RW.len = L; RW.w = 30;
    RW.psi03 = Math.atan2(RW.u[0], RW.u[1]); RW.psi21 = wrap(RW.psi03 + Math.PI); RW.gs = 4 * D2R; RW.aimPast = 300;
    RW.elev = ground(RW.mid[0], RW.mid[1]); RW.ok = true;
  }
  const toRW = (x, z) => { const dx = x - RW.mid[0], dz = z - RW.mid[1]; return [dx * RW.u[0] + dz * RW.u[1], dx * RW.p[0] + dz * RW.p[1]]; };
  const fromRW = (a, c) => [RW.mid[0] + RW.u[0] * a + RW.p[0] * c, RW.mid[1] + RW.u[1] * a + RW.p[1] * c];
  FL.toRW = toRW; FL.fromRW = fromRW;
  // the landing runway from a heading: 21 (toward the south-west, threshold at the north-east end) or 03
  function rwyFor(psi) { const d21 = Math.abs(wrap(psi - RW.psi21)), d03 = Math.abs(wrap(psi - RW.psi03)); if (d21 < 50 * D2R) return 21; if (d03 < 50 * D2R) return 3; return 0; }
  function pastThreshold(a, rwy) { return rwy === 21 ? RW.half - a : a + RW.half; }
  function aimAlong(rwy) { return rwy === 21 ? RW.half - RW.aimPast : -RW.half + RW.aimPast; }
  const hdgOf = (psi) => { let b = (180 - psi * R2D - MAGVAR) % 360; if (b < 0) b += 360; return b; };

  // ───────────────────────────── the jet: measurements and state ─────────────────────────────
  function measure(V) {
    const g = V.g; const key = g.children.map((c) => (c.isMesh && c.geometry ? c.geometry.uuid : "")).join(",");
    if (V._flM && V._flM.key === key) return V._flM;
    const bb = new THREE.Box3(), tmp = new THREE.Box3(); let any = false;
    for (const c of g.children) { if (!c.isMesh || !c.geometry || c.isSprite) continue; if (!c.geometry.boundingBox) c.geometry.computeBoundingBox(); c.updateMatrix(); tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrix); bb.union(tmp); any = true; }
    if (!any || !Number.isFinite(bb.min.x)) bb.set(new THREE.Vector3(-10, 0, -11), new THREE.Vector3(10, 6, 11));
    const len = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y, cz = (bb.max.z + bb.min.z) / 2;
    const M = { key, bb, len, h, span: bb.max.x - bb.min.x, minY: bb.min.y, mgZ: cz - len * 0.07, wheelbase: len * 0.38, eye: new THREE.Vector3(0, bb.min.y + h * 0.34, bb.max.z - len * 0.085) };
    V._flM = M; return M;
  }
  let S = null; FL.S = null;
  function newState(id, V) {
    const M = measure(V), g = V.g, psi = g.rotation.y;
    const s = { id, M, P: new THREE.Vector3(), V: 0, gam: 0, psi, th: 0, ph: 0, al: 0, onGround: true, thr: 0, N: C.idle, gear: 1, gearPos: 1, flaps: 1, flapPos: 1, sbPos: 0, gsPos: 0, n: 1, prot: false, protT: 0, floor: false,
      t: 0, gPitch: 0, steer: 0, kp: 0, kr: 0, air: 0, autobrake: false, sendAt: 0, crashed: null, slope: 0, lastTD: null, callT: 0, agl: 0, trend: 0, vPrev: 0, liftAt: -1 };
    s.P.set(g.position.x + Math.sin(psi) * M.mgZ, 0, g.position.z + Math.cos(psi) * M.mgZ);
    const h = ground(s.P.x, s.P.z); const up = g.position.y - h;
    if (up > 6) { s.onGround = false; s.P.y = g.position.y; s.V = 70; s.gear = 0; s.gearPos = 0; s.flaps = 0; s.flapPos = 0; s.thr = 0.35; s.N = 0.35; s.air = 1; trim(s); } else s.P.y = h;
    return s;
  }
  // the angle of attack for level flight at the current speed and flaps (a jet put in the air starts trimmed, not sinking)
  function trim(s) { const cl0 = flapCoef(s)[0]; s.al = clamp((G0 / (C.cL * Math.max(20, s.V) ** 2) - cl0) / C.cla, C.alMin, C.alProt); s.th = s.gam + s.al; s.n = 1; }
  // write the state on the vehicle group: heading, then pitch, then roll (YXZ); origin = main-gear contact point minus R * contact offset
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  function apply(s, g) {
    const th = s.th + (s.onGround ? s.gPitch : 0);
    if (g.rotation.order !== "YXZ") g.rotation.order = "YXZ";
    g.rotation.set(-th, s.psi, s.ph);
    _v.set(0, s.M.minY, s.M.mgZ).applyEuler(g.rotation);
    g.position.set(s.P.x - _v.x, s.P.y - _v.y, s.P.z - _v.z);
  }
  // origin <-> main gear, at the current attitude (for ground collision, which works on the origin like the original)
  function originOf(s, x, z) { const c = Math.cos(s.th), m = s.M.mgZ; return [x - Math.sin(s.psi) * c * m, z - Math.cos(s.psi) * c * m]; }
  function gearOf(s, x, z) { const c = Math.cos(s.th), m = s.M.mgZ; return [x + Math.sin(s.psi) * c * m, z + Math.cos(s.psi) * c * m]; }

  // ───────────────────────────── inputs ─────────────────────────────
  const IN = FL.inp = FL.inp || { mRoll: 0, gpPrev: [], thrTouch: 0, brakeKey: false, look: 0, lookP: 0 };
  FL.invert = localStorage.getItem("g1:flyinv") === "1";
  function pad() {
    let list = null; try { list = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) {} if (!list) return null;
    let gp = null; for (const q of list) if (q && q.connected && q.axes && q.axes.length >= 2) { gp = q; break; } if (!gp) return null;
    const dz = (v) => (Math.abs(v || 0) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const bv = (i) => { const b = gp.buttons[i]; return !b ? 0 : typeof b === "object" ? (b.value || (b.pressed ? 1 : 0)) : +b; };
    const pr = gp.buttons.map((b, i) => bv(i) > 0.5); const prev = IN.gpPrev; IN.gpPrev = pr;
    return { roll: dz(gp.axes[0]), pitch: dz(gp.axes[1]), lookX: dz(gp.axes[2]), lookY: dz(gp.axes[3]), thr: bv(7) - bv(6), brake: bv(1) > 0.5, edge: (i) => pr[i] && !prev[i] };
  }
  function readInputs(s, dt) {
    const k = (typeof chatOpen !== "undefined" && chatOpen) ? {} : keys; const inj = FL.inject;
    let thr = 0, roll = 0, pit = 0;
    if (k.KeyW || k.ArrowUp) thr += 1; if (k.KeyS || k.ArrowDown) thr -= 1;
    if (k.KeyA || k.ArrowLeft) roll -= 1; if (k.KeyD || k.ArrowRight) roll += 1;
    if (k.Space) pit += 1; if (k.KeyQ || k.ShiftLeft || k.ShiftRight) pit -= 1;
    s.kp += clamp(pit - s.kp, -dt * 3, dt * 3); s.kr += clamp(roll - s.kr, -dt * 4, dt * 4);   // keys ramp in, so a tap is a small input
    let P = s.kp, R = s.kr, T = thr, St = roll;
    const mp = typeof pitchInput === "number" ? -pitchInput : 0; P += FL.invert ? -mp : mp;         // mouse: up = nose up (Y inverts)
    IN.mRoll *= Math.exp(-dt * 0.8); R += IN.mRoll; St += IN.mRoll;
    if (typeof joy !== "undefined" && joy.active) { R += joy.dx; St += joy.dx; P += -joy.dy; if (s.onGround) T += -joy.dy; }
    T += IN.thrTouch;
    let brake = (k.KeyS || k.ArrowDown) && s.thr <= 0.001 ? 1 : 0; if (IN.brakeKey) brake = 1;
    const gp = pad();
    if (gp) { R += gp.roll; St += gp.roll; P += gp.pitch; T += gp.thr; if (gp.brake) brake = 1; IN.look = gp.lookX * 2.6; IN.lookP = -gp.lookY * 0.9;
      if (gp.edge(0)) toggleGear(); if (gp.edge(5)) setFlaps(s.flaps + 1); if (gp.edge(4)) setFlaps(s.flaps - 1); if (gp.edge(3)) cycleView(); if (gp.edge(9)) scenicKey(); }
    let out = { thr: clamp(T, -1, 1), roll: clamp(R, -1, 1), pitch: clamp(P, -1, 1), steer: clamp(St, -1, 1), brake, sb: !s.onGround && brake > 0 };
    if (inj) out = Object.assign(out, inj);   // scripted inputs (tests): same channel as a player
    return out;
  }

  // ───────────────────────────── the flight model ─────────────────────────────
  function flapCoef(s) { const fi = clamp(s.flapPos, 0, 2), f0 = Math.floor(fi), f1 = Math.min(2, f0 + 1), fk = fi - f0; return [lerp(C.cl0[f0], C.cl0[f1], fk), lerp(C.cdFlap[f0], C.cdFlap[f1], fk)]; }
  function stallSpeed(s) { const cl0 = flapCoef(s)[0]; return Math.sqrt(G0 / (C.cL * (cl0 + C.cla * C.alProt))); }
  FL.stallKt = (fl) => { const cl = C.cl0[fl] + C.cla * C.alProt; return Math.sqrt(G0 / (C.cL * cl)) * KT; };
  function step(s, dt, inp) {
    s.t += dt;
    s.thr = clamp(s.thr + inp.thr * dt * 0.55, 0, 1);
    const Vs = stallSpeed(s);
    if (!s.onGround) { if (s.prot && s.V < Vs * 1.13) s.floor = true; else if (s.floor && s.V > Vs * 1.28 && !s.prot) s.floor = false; } else s.floor = false;
    const lever = s.floor ? 1 : s.thr, tgt = C.idle + (1 - C.idle) * lever;
    s.N += (tgt - s.N) * Math.min(1, dt * (tgt > s.N ? 0.8 : 1.2));
    s.gearPos += clamp(s.gear - s.gearPos, -dt / C.gearT, dt / C.gearT);
    if (!s.onGround && s.flaps > 0 && s.V * KT > C.flapMaxKt[s.flaps] + 5) { s.flaps--; s.relief = s.t; }   // flap load relief
    s.flapPos += clamp(s.flaps - s.flapPos, -dt / C.flapT, dt / C.flapT);
    s.sbPos += clamp((inp.sb ? 1 : 0) - s.sbPos, -dt * 1.5, dt * 1.5);
    s.gsPos += clamp((s.onGround && s.air > 0 && s.V > 16 && s.thr < 0.15 ? 1 : 0) - s.gsPos, -dt * 2, dt * 3);
    const [cl0, cdF] = flapCoef(s); const V = s.V, q = C.cL * V * V;
    const thrust = C.tmax * s.N * (1 - C.lapse * V / 100) * (V > C.vmo ? clamp(1 - (V - C.vmo) / 12, 0, 1) : 1);
    const cd0 = C.cd0 + C.cdGear * s.gearPos + cdF + C.cdSB * s.sbPos + C.cdGS * s.gsPos + (V > C.vmo ? (V - C.vmo) * 0.004 : 0);
    if (s.onGround) groundStep(s, dt, inp, q, cl0, cd0, thrust); else airStep(s, dt, inp, q, cl0, cd0, thrust);
  }
  function groundStep(s, dt, inp, q, cl0, cd0, thrust) {
    const V = s.V, auth = clamp((V - 44) / 8, 0, 1);            // the elevator bites from about 85 KT, fully at 100 KT
    const want = inp.pitch > 0.05 ? inp.pitch * C.rotMax * auth : 0;
    if (want > s.th) s.th = Math.min(want, s.th + C.rotUp * dt * Math.max(0.3, auth)); else s.th = Math.max(want, s.th - C.rotDn * dt);
    s.th = Math.max(0, s.th); s.al = s.th;
    const CL = cl0 + C.cla * s.al, Lm = q * CL * (1 - 0.85 * s.gsPos), Nw = Math.max(0, G0 - Lm);
    const [ra, rc] = toRW(s.P.x, s.P.z); let lift = 0; try { lift = roadLiftAt(s.P.x, s.P.z); } catch (e) {}
    const paved = (Math.abs(rc) < RW.w / 2 + 3 && Math.abs(ra) < RW.half + 40) || lift > 0.05;
    let brake = inp.brake; if (s.autobrake && s.thr < 0.1 && V > 2) brake = Math.max(brake, C.autobrake / C.brake); if (s.thr > 0.3) s.autobrake = false;
    if (s.thr < 0.03 && V < 2 && inp.thr <= 0) brake = 1;   // stopped at idle: the brakes hold (a jet at idle would otherwise creep)
    const D = q * (cd0 + C.K * CL * CL);
    const a = thrust - D - (V > 0.05 ? (paved ? C.mu : C.muRough) * Nw + brake * C.brake * Nw / G0 : 0) - G0 * s.slope;
    s.V = Math.max(0, V + a * dt);
    s.steer += clamp(inp.steer - s.steer, -dt * 2.5, dt * 2.5);
    const nw = Math.min(0.5, V / 20) * clamp(1 - (V - 10) / 30, 0.1, 1), rud = 0.05 * clamp(V / 40, 0, 1);
    s.psi = wrap(s.psi - s.steer * (nw + rud) * dt);
    s.ph += (0 - s.ph) * Math.min(1, dt * 5); s.gam = 0;
    // move the main gear, collide on the origin like the original jet code (plan_bounds' soft stop reads collide(x, z, 4))
    let nx = s.P.x + Math.sin(s.psi) * s.V * dt, nz = s.P.z + Math.cos(s.psi) * s.V * dt;
    try {
      let [ox, oz] = originOf(s, nx, nz); vSpeed = s.V; [ox, oz] = collide(ox, oz, 4);
      const ho = collideOthers(ox, oz, 6, riding.id); if (ho[2]) { s.V *= 0.5; if (s.V > 6) sfx("bump"); } ox = ho[0]; oz = ho[1];
      if (Number.isFinite(vSpeed) && vSpeed < s.V) s.V = Math.max(0, vSpeed);
      [nx, nz] = gearOf(s, ox, oz);
    } catch (e) { log("collide", e); }
    s.P.x = nx; s.P.z = nz; const h = ground(nx, nz); s.P.y = h;
    // the jet sits on its gear: pitch from the ground under the nose wheel, the runway slope for the roll
    const wb = s.M.wheelbase, hn = ground(nx + Math.sin(s.psi) * wb, nz + Math.cos(s.psi) * wb); s.gPitch = clamp(Math.atan2(hn - h, wb), -0.12, 0.12); s.slope = Math.sin(s.gPitch);
    if (Lm > G0 * 1.02 && V > 40) { s.onGround = false; s.air++; s.gam = Math.max(0.004, s.slope + 0.004); s.liftAt = s.t; s.th = s.th + s.gPitch; s.al = s.th - s.gam; s.gPitch = 0; runEvent("liftoff"); }
  }
  function airStep(s, dt, inp, q, cl0, cd0, thrust) {
    const V = Math.max(s.V, 15), agl = s.P.y - ground(s.P.x, s.P.z);
    const as = airspace(s);
    let phT = inp.roll * C.bankMax; if (as.k > 0) phT = lerp(phT, as.turn * C.bankMax, Math.min(1, as.k * 1.4));
    s.ph += clamp((phT - s.ph) * 2.6, -C.rollRate, C.rollRate) * dt;
    // pitch law: the stick asks for extra load factor (a change of flight path); neutral holds the path, the bank is compensated
    let dn = inp.pitch >= 0 ? inp.pitch * C.dnUp : inp.pitch * C.dnDn;
    const Vs = stallSpeed(s), gMax = (3 + 20 * clamp((V - Vs * 1.2) / (Vs * 0.5), 0, 1)) * D2R;   // the climb the speed allows
    if (s.gam > gMax && dn > -0.25) dn = Math.min(dn, -(s.gam - gMax) * 3);
    else if (dn > 0 && s.gam > gMax - 3 * D2R) dn *= clamp((gMax - s.gam) / (3 * D2R), 0, 1);
    if (dn < 0 && s.gam < C.gamMin + 4 * D2R) dn *= clamp((s.gam - C.gamMin) / (4 * D2R), 0, 1);
    if (agl > C.ceiling) dn = Math.min(dn, -0.25 * clamp((agl - C.ceiling) / 80, 0, 1) - Math.max(0, s.gam) * 2);
    const cg = Math.cos(s.gam), cph = Math.cos(s.ph);
    const nReq = cg / Math.max(0.3, cph) + dn, CLreq = nReq * G0 / Math.max(1, q);
    let alT = (CLreq - cl0) / C.cla; const over = alT > C.alProt; alT = clamp(alT, C.alMin, C.alProt);
    s.al += clamp(alT - s.al, -C.alRate * dt, C.alRate * dt);
    s.prot = over && s.al > C.alProt - 0.6 * D2R; s.protT = s.prot ? s.protT + dt : 0;
    const CL = cl0 + C.cla * s.al, Lm = q * CL; s.n = Lm / G0;
    const Dm = q * (cd0 + C.K * CL * CL);
    s.V = Math.max(12, s.V + (thrust - Dm - G0 * Math.sin(s.gam)) * dt);
    s.gam = clamp(s.gam + ((Lm * cph - G0 * cg) / V) * dt, -0.7, 0.7);
    s.psi = wrap(s.psi - C.kTurn * (Lm * Math.sin(s.ph)) / (V * Math.max(0.35, cg)) * dt);   // right bank (ph > 0) turns right (heading angle falls)
    s.th = s.gam + s.al;
    const cgp = Math.cos(s.gam);
    s.P.x += Math.sin(s.psi) * cgp * s.V * dt; s.P.z += Math.cos(s.psi) * cgp * s.V * dt; s.P.y += Math.sin(s.gam) * s.V * dt;
    if (as.o > C.edgeSpan) { const k = as.o - C.edgeSpan; s.P.x += as.ix * k; s.P.z += as.iz * k; }   // the hard edge: never further out
    const h = ground(s.P.x, s.P.z);
    if (s.P.y <= h) { if (s.t - s.liftAt < 2 && s.gam > -0.03) { s.P.y = h + 0.01; s.gam = Math.max(s.gam, 0.004); } else touchdown(s, h); }   // just airborne over a rising runway: still flying
  }
  // the airspace: inside the section line plus a margin, or inside the approach corridor of the runway. o = metres past the soft line
  function airspace(s) {
    const x = s.P.x, z = s.P.z; let o1, ix, iz;
    const B = window.PLAN_BOUNDS;
    if (B && typeof B.sdist === "function" && B.ring) { const d = B.sdist(x, z); o1 = -d.d - C.edgeSoft; ix = -d.nx; iz = -d.nz; }
    else { const bx = [-487, 1127], bz = [-628, 995]; const ox = Math.max(bx[0] - x, x - bx[1], 0), oz = Math.max(bz[0] - z, z - bz[1], 0); o1 = Math.hypot(ox, oz) - C.edgeSoft; const cx = 320 - x, cz = 180 - z, L = Math.hypot(cx, cz) || 1; ix = cx / L; iz = cz / L; }
    const [a, c] = toRW(x, z); const oc = Math.max(Math.abs(c) - C.corrC, Math.abs(a) - (RW.half + C.corrA));
    const o = Math.min(o1, oc);
    if (o <= 0) return { o, k: 0, turn: 0, ix: 0, iz: 0 };
    if (oc < o1) { const L = Math.hypot(RW.mid[0] - x, RW.mid[1] - z) || 1; ix = (RW.mid[0] - x) / L; iz = (RW.mid[1] - z) / L; }
    const want = Math.atan2(ix, iz), err = wrap(want - s.psi);          // heading angle falls in a right turn
    const turn = Math.abs(err) < 0.35 ? clamp(-err / 0.35, -1, 1) * 0.6 : (err < 0 ? 1 : -1);
    return { o, k: clamp(o / C.edgeSpan, 0, 1), turn, ix, iz };
  }
  function touchdown(s, h) {
    const vs = s.V * Math.sin(s.gam), fpm = Math.max(0, -vs * FPM); const [a, c] = toRW(s.P.x, s.P.z);
    const onRwy = Math.abs(c) <= RW.w / 2 + 2 && Math.abs(a) <= RW.half + 10; const rwy = rwyFor(s.psi);
    const td = { fpm, a, c, onRwy, rwy, bank: s.ph, pitch: s.th, kt: s.V * KT, flaps: s.flaps, t: s.t, past: rwy ? pastThreshold(a, rwy) : 0 };
    s.P.y = h;
    if (s.gearPos < 0.98) return crash(s, "gear", td);
    if (fpm > 1200 || Math.abs(s.ph) > 12 * D2R || s.th < -4 * D2R) return crash(s, "hard", td);
    s.onGround = true; s.V *= Math.max(0.5, Math.cos(s.gam)); s.gam = 0; s.al = s.th; s.lastTD = td; s.autobrake = true; s.tdShake = clamp(fpm / 600, 0.25, 1.2);
    try { sfx(fpm > 500 ? "bump" : "land"); if (typeof noise === "function") noise(0.35, 0.05 + Math.min(0.08, fpm / 12000), 2200); } catch (e) {}
    runEvent("touchdown", td);
  }
  function crash(s, why, td) {
    s.onGround = true; s.V = 0; s.gam = 0; s.ph = 0; s.th = 0; s.al = 0; s.thr = 0; s.N = C.idle; s.crashed = { why, td, t: s.t }; s.tdShake = 1.6;
    s.P.y = ground(s.P.x, s.P.z);
    try { sfx("bump"); if (typeof emitDust === "function") emitDust(s.P.x, s.P.y, s.P.z, 30, 7, 2.2); } catch (e) {}
    runEvent("crash", { why, td });
  }

  // ───────────────────────────── drive (replaces driveVehicle for a jet you pilot) ─────────────────────────────
  FL.timeScale = FL.timeScale || 1;
  function drive(dtc, forced) {
    const V = VEH[riding.id]; if (!V) return; const g = V.g;
    if (!S || S.id !== riding.id) { S = FL.S = newState(riding.id, V); FL.lastT = 0; CAMS.init = false; runBoard(); }
    const s = S; const M = measure(V); if (M !== s.M) s.M = M;
    const now = performance.now(); let dt = FL.lastT ? (now - FL.lastT) / 1000 : dtc; FL.lastT = now; dt = clamp(dt, 0, 0.12) * FL.timeScale;
    if (forced) dt = forced;   // tests: fixed steps (PLAN_FLIGHT.debug.ff)
    if (FL.tow) towStep(s, dt);
    else {
      const inp = readInputs(s, Math.min(dt, 0.05)); FL.lastInp = inp;
      const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n;
      for (let i = 0; i < n; i++) { const p0x = s.P.x, p0y = s.P.y, p0z = s.P.z; step(s, h, inp); runStep(s, h, p0x, p0y, p0z); }
    }
    apply(s, g);
    vSpeed = s.V; vVertical = s.onGround ? 0 : s.V * Math.sin(s.gam); bank = s.ph;
    player.position.copy(g.position); yaw = g.rotation.y;
    if (now - s.sendAt > 100) { s.sendAt = now; const gy = getH(g.position.x, g.position.z);
      act({ t: "drive", x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), y: +clamp(g.position.y - gy, 0, 2400).toFixed(2), ry: +g.rotation.y.toFixed(3), pitch: +g.rotation.x.toFixed(3), roll: +g.rotation.z.toFixed(3) }); }
  }
  // the tow to the Runway 03 line-up: the screen fades, the jet moves in steps the server accepts (each update well under 900 m)
  function lineupSpot() { const [x, z] = fromRW(-RW.half + 45, 0); return { x, z, psi: RW.psi03 }; }
  function towTo(spot) {
    const s = S; if (!s) return; const d = Math.hypot(spot.x - s.P.x, spot.z - s.P.z);
    FL.tow = { from: [s.P.x, s.P.z], to: [spot.x, spot.z], psi: spot.psi, t: 0, dur: Math.max(1.6, d / 5500), fadeIn: false, at: performance.now() };
    const f = document.getElementById("fade"); if (f) { f.style.transition = "opacity .45s"; f.style.opacity = 1; }
    runSet("tow");
  }
  function towStep(s, dt) {
    const T = FL.tow; T.t += dt / Math.max(1e-6, FL.timeScale); let k = clamp((T.t - 0.45) / T.dur, 0, 1);
    // never more than 600 m ahead of the position the server has confirmed: a slow frame or a dropped message must not leave the
    // shared jet behind (leaving the jet puts you beside the server's copy). After 25 s it finishes regardless (offline play).
    const D = Math.hypot(T.to[0] - T.from[0], T.to[1] - T.from[1]) || 1, v = view && view.vehicles && view.vehicles[riding.id], wait = !!v && T.t < 25;
    if (wait) { const o = originOf(s, T.from[0], T.from[1]); T.conf = clamp(((v.x - o[0]) * (T.to[0] - T.from[0]) + (v.z - o[1]) * (T.to[1] - T.from[1])) / D, 0, D); k = Math.min(k, (T.conf + 600) / D); }
    s.P.x = lerp(T.from[0], T.to[0], k); s.P.z = lerp(T.from[1], T.to[1], k); s.P.y = ground(s.P.x, s.P.z);
    s.V = 0; s.gam = 0; s.th = 0; s.al = 0; s.ph = 0; s.thr = 0; s.N = C.idle; s.onGround = true; s.crashed = null; s.gear = 1; s.gearPos = 1; s.flaps = 1; s.flapPos = 1; s.sbPos = 0; s.gsPos = 0; s.autobrake = false; s.lastTD = null; s.air = 0; s.gPitch = 0;
    if (k < 1) return;
    s.psi = T.psi; const o = originOf(s, s.P.x, s.P.z); if (wait && Math.hypot(v.x - o[0], v.z - o[1]) > 150) return;   // the last step not confirmed yet
    if (!T.fadeIn) { T.fadeIn = true; T.end = T.t; const f = document.getElementById("fade"); if (f) f.style.opacity = 0; }
    if (T.t - T.end > 0.5) { FL.tow = null; const f = document.getElementById("fade"); if (f) f.style.transition = ""; runArm(); }
  }

  // ───────────────────────────── controls (keys the jet owns while you fly it) ─────────────────────────────
  function piloting() { return !!(typeof riding !== "undefined" && riding && riding.kind === "jet" && riding.driver && typeof VEH !== "undefined" && VEH[riding.id]); }
  FL.piloting = piloting;
  function toggleGear() { const s = S; if (!s) return; if (s.onGround && s.gear) { callout("Gear stays down on the ground"); return; } if (!s.gear && s.V * KT > 220) { callout("Too fast for the gear: below 220 KT"); return; } s.gear = s.gear ? 0 : 1; callout(s.gear ? "Gear down" : "Gear up"); try { if (typeof noise === "function") noise(1.1, 0.03, 180); } catch (e) {} }
  function setFlaps(n) { const s = S; if (!s) return; n = clamp(n, 0, 2); if (n > s.flaps && s.V * KT > C.flapMaxKt[n]) { callout(`Flaps ${C.flapDeg[n]} below ${C.flapMaxKt[n]} KT`); return; } s.flaps = n; callout(n ? `Flaps ${C.flapDeg[n]}` : "Flaps up"); try { if (typeof tone === "function") tone(330, 0.12, "triangle", 0.03); } catch (e) {} }
  FL.view = +(localStorage.getItem("g1:flyview") || 0) === 1 ? 1 : 0;
  function cycleView() { FL.view = FL.view ? 0 : 1; localStorage.setItem("g1:flyview", String(FL.view)); CAMS.init = false; callout(FL.view ? "Cockpit view" : "Chase view"); }
  function onKey(e) {
    if (!piloting() || (e.target && e.target.tagName === "INPUT") || (typeof chatOpen !== "undefined" && chatOpen)) return;
    const c = e.code; let own = true;
    if (c === "KeyG") { if (!e.repeat) toggleGear(); }
    else if (c === "Digit1" || c === "Digit2" || c === "Digit3") { if (!e.repeat) setFlaps(+c.slice(5) - 1); }
    else if (c === "KeyC" || c === "KeyO") { if (!e.repeat) cycleView(); }
    else if (c === "KeyT") { if (!e.repeat) scenicKey(); }
    else if (c === "KeyB") IN.brakeKey = true;
    else if (c === "KeyY") { if (!e.repeat) { FL.invert = !FL.invert; localStorage.setItem("g1:flyinv", FL.invert ? "1" : "0"); callout(FL.invert ? "Mouse pitch inverted" : "Mouse pitch normal"); } }
    else if (c === "KeyF" && S && !S.onGround && !e.repeat && !(FL.bailAt && performance.now() - FL.bailAt < 3000)) { FL.bailAt = performance.now(); callout("Press F again to leave the jet in the air (it returns to its stand)", 3000); }
    else if (c === "Escape" && FL.resOpen) { closeResult(); own = false; }
    else own = false;
    if (own) { e.stopImmediatePropagation(); e.preventDefault(); }
  }
  function onKeyUp(e) { if (e.code === "KeyB") IN.brakeKey = false; }
  function onMouse(e) { if (!piloting() || typeof locked === "undefined" || !locked) return; IN.mRoll = clamp(IN.mRoll + e.movementX * 0.0035, -1, 1); }
  function scenicKey() {
    const s = S; if (!s) return;
    if (FL.resOpen) closeResult();
    if (FL.tow) return;
    if (!s.onGround && active()) { if (FL.cancelAt && performance.now() - FL.cancelAt < 3000) { FL.cancelAt = 0; runSet("off"); showGates(false); callout("Scenic flight ended · free flight", 2500); } else { FL.cancelAt = performance.now(); callout("Press T again to end the scenic flight and fly free", 3000); } return; }
    if (!s.onGround) { callout("The scenic flight starts on the ground: land, stop, then press T", 3500); return; }
    if (s.V > 3) { callout("Stop the jet first (S to brake), then press T", 3000); return; }
    towTo(lineupSpot());
  }

  // ───────────────────────────── the Solport Scenic Flight ─────────────────────────────
  const RUN = FL.run = { state: "off", gates: [], gi: 0 };
  function P_(id) { const P = window.PLAN; const p = P && P.places && P.places.find((q) => q.id === id); return p ? [p.x, p.z] : null; }
  function routeDefs() {
    const mid = (a, b, k) => [lerp(a[0], b[0], k === undefined ? 0.5 : k), lerp(a[1], b[1], k === undefined ? 0.5 : k)];
    const main = P_("main_street") || [744, 311], fc = P_("four_corners") || [668, 153], comp = P_("compass_plaza") || [822, 473];
    const lp = P_("launch_plaza") || [932, 702], ring = P_("genesis_ring") || [995, 833], golf = P_("golf") || [-55, 877];
    const barn = P_("gp_barn") || [-205, -522];
    const sd = [comp[0] - fc[0], comp[1] - fc[1]], sl = Math.hypot(sd[0], sd[1]) || 1, streetDir = [sd[0] / sl, sd[1] / sl];
    return [
      // a low pass over Runway 03 abeam the Stellar FBO, then one sweeping right turn (about 240 m radius, 35 degrees of bank at
      // 125 KT) that arrives at Four Corners lined up with Main Street; Compass Plaza and The Outpost are straight on down the street
      { name: "Solport · Stellar FBO", at: fromRW(150, 0), agl: 40, n: [RW.u[0], RW.u[1]] },
      { name: "Main Street", at: fc, agl: 110, n: streetDir },
      { name: "Compass Plaza", at: comp, agl: 115 },
      { name: "The Outpost", at: mid(lp, ring), agl: 120 },
      { name: "Desert Golf", at: golf, agl: 105 },
      { name: "Genesis Park", at: barn, agl: 120 },
      // a right-hand circuit for Runway 21: downwind along the north-west side (past Genesis Spring and the farm), then a right
      // turn of 325 m radius onto final; the base gate sits on that arc, facing along it
      { name: "Downwind · Runway 21", at: fromRW(1300, -660), agl: 125, n: [RW.u[0], RW.u[1]] },
      { name: "Right base · Runway 21", at: fromRW(RW.half + 1446, -325), agl: 125, base: true, n: [RW.p[0], RW.p[1]] },
      { name: "Final · Runway 21", at: fromRW(RW.half + 970, 0), final: true, n: [-RW.u[0], -RW.u[1]] },
    ];
  }
  function buildRoute() {
    if (RUN.route) return RUN.route; const defs = routeDefs(); const aimA = aimAlong(21), aimXZ = fromRW(aimA, 0), aimY = ground(aimXZ[0], aimXZ[1]);
    const R = defs.map((d, i) => { const gy = ground(d.at[0], d.at[1]); let y = gy + (d.agl || 100); if (d.base) y = Math.max(gy + 90, RW.elev + 125); if (d.final) { const [a] = toRW(d.at[0], d.at[1]); y = aimY + 3 + (a - aimA) * Math.tan(RW.gs); } return { i, name: d.name, x: d.at[0], y, z: d.at[1], final: !!d.final, base: !!d.base, n0: d.n }; });
    // each ring faces the way you arrive, leaning toward the next leg (a third; a sixth at a sharp corner, which you fly into and then turn)
    for (let i = 0; i < R.length; i++) {
      const p = R[i - 1], n = R[i + 1]; const din = p ? [R[i].x - p.x, R[i].z - p.z] : [RW.u[0], RW.u[1]], dout = n ? [n.x - R[i].x, n.z - R[i].z] : [-RW.u[0], -RW.u[1]];
      const li = Math.hypot(din[0], din[1]) || 1, lo = Math.hypot(dout[0], dout[1]) || 1; const turn = Math.acos(clamp((din[0] * dout[0] + din[1] * dout[1]) / (li * lo), -1, 1)); const w = turn > 50 * D2R ? 0.2 : 0.5;
      let nx = din[0] / li + w * dout[0] / lo, nz = din[1] / li + w * dout[1] / lo;
      if (R[i].n0) { nx = R[i].n0[0]; nz = R[i].n0[1]; } const L = Math.hypot(nx, nz) || 1; R[i].nx = nx / L; R[i].nz = nz / L;
    }
    RUN.route = R; RUN.aim = { x: aimXZ[0], y: aimY, z: aimXZ[1] }; return R;
  }
  function runSet(st) { RUN.state = st; RUN.stAt = performance.now(); }
  function runArm() {
    buildRoute(); buildGates(); runSet("armed"); RUN.gi = 0; RUN.hits = []; RUN.t = 0; RUN.rough = 0; RUN.prot = 0; RUN.over = 0; RUN.tds = []; RUN.fail = null; RUN.res = null; RUN.started = false;
    callout("Lined up Runway 03 · full power (W) to start", 4000); try { if (typeof tone === "function") { tone(660, 0.12, "sine", 0.05); setTimeout(() => tone(880, 0.18, "sine", 0.05), 130); } } catch (e) {}
  }
  function runBoard() { if (RUN.state !== "off" && RUN.state !== "done" && RUN.state !== "failed") { runSet("off"); } }
  function lined(s) { const [a, c] = toRW(s.P.x, s.P.z); return s.onGround && a < -RW.half + 320 && a > -RW.half - 10 && Math.abs(c) < 10 && Math.abs(wrap(s.psi - RW.psi03)) < 12 * D2R; }
  function active() { return RUN.state === "roll" || RUN.state === "gates" || RUN.state === "final" || RUN.state === "landed"; }
  FL.active = active;
  function runFail(why, detail) { if (!active() && RUN.state !== "armed") return; RUN.fail = { why, detail }; runSet("failed"); showGates(false); showResult(); }
  function runEvent(ev, d) {
    if (ev === "liftoff") { if (RUN.state === "roll") runSet("gates"); if (RUN.state === "landed") { runSet(RUN.gi >= (RUN.route || []).length ? "final" : "gates"); } FL.airAt = performance.now(); }
    else if (ev === "touchdown") {
      if (!active()) return; RUN.tds.push(d);
      if (!d.onRwy) return runFail("offrwy", d);
      if (!d.rwy) return runFail("across", d);
      for (let i = RUN.gi; i < RUN.route.length; i++) RUN.hits[i] = RUN.hits[i] || { ok: false, off: 999 };
      RUN.gi = RUN.route.length; runSet("landed");
    } else if (ev === "crash") { if (active()) runFail(d.why, d.td); else callout(d.why === "gear" ? "Gear-up landing: the belly is scraped, nobody is hurt" : "That was a hard landing", 3500); }
  }
  // per physics step: timer, gates, smoothness, the finish
  function runStep(s, dt, px, py, pz) {
    if ((RUN.state === "off" || RUN.state === "done" || RUN.state === "failed") && !FL.resOpen && s.onGround && s.V < 3 && lined(s)) runArm();
    if (RUN.state === "armed") {
      const [a, c] = toRW(s.P.x, s.P.z); const near = s.onGround && a < -RW.half + 450 && a > -RW.half - 20 && Math.abs(c) < 16 && Math.abs(wrap(s.psi - RW.psi03)) < 25 * D2R;
      if (!near) runSet("off"); else if (s.V > 1.5) { runSet("roll"); RUN.t = 0; RUN.started = true; }
    }
    if (!active()) return;
    RUN.t += dt; if (RUN.t > MAX_RUN) return runFail("time");
    if (RUN.state === "roll") { const [a, c] = toRW(s.P.x, s.P.z); if (Math.abs(c) > RW.w / 2 + 8 || a > RW.half) return runFail("rwyexit"); if (s.V < 0.5 && RUN.t > 8) return runFail("abort"); }
    if (!s.onGround) { RUN.rough += Math.max(0, s.n - 1.55, 0.5 - s.n) * dt; if (s.prot) RUN.prot += dt; if (s.V > C.vmo) RUN.over += dt; }
    if ((RUN.state === "gates" || RUN.state === "final") && RUN.gi < RUN.route.length) gateCheck(s, px, py, pz);
    if (RUN.state === "gates" && RUN.gi >= RUN.route.length) runSet("final");
    if (RUN.state === "landed" && s.onGround && s.V < 2.5) finish(s);
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function gateCheck(s, px, py, pz) {
    const hc = s.M.h * 0.3; _a.set(px, py + hc, pz); _b.set(s.P.x, s.P.y + hc, s.P.z);
    for (let j = RUN.gi; j < Math.min(RUN.route.length, RUN.gi + 2); j++) {
      const G = RUN.route[j]; const s0 = (_a.x - G.x) * G.nx + (_a.z - G.z) * G.nz, s1 = (_b.x - G.x) * G.nx + (_b.z - G.z) * G.nz;
      if (!(s0 < 0 && s1 >= 0)) continue; const k = -s0 / (s1 - s0); const X = _a.x + (_b.x - _a.x) * k, Y = _a.y + (_b.y - _a.y) * k, Z = _a.z + (_b.z - _a.z) * k;
      const off = Math.hypot(X - G.x, Y - G.y, Z - G.z); if (off > (j === RUN.gi ? 900 : 320)) continue;   // a crossing far off (the plane's other end) is not this gate
      const ok = off <= GATE_R * 1.15;
      if (j === RUN.gi) { RUN.hits[j] = { ok, off }; RUN.gi = j + 1; gateFx(G, ok, off); return; }   // through it, or past it to one side (a miss)
      if (ok) { RUN.hits[RUN.gi] = { ok: false, off: 999 }; RUN.hits[j] = { ok: true, off }; RUN.gi = j + 1; gateFx(G, true, off); callout("Gate missed", 1500); return; }
    }
  }
  function gateFx(G, ok, off) {
    try { if (ok) { sfx("coin"); callout(off < GATE_R * 0.35 ? `${G.name} · dead centre` : `${G.name}`, 1800); } else { if (typeof tone === "function") tone(196, 0.35, "sawtooth", 0.03); callout(`Missed ${G.name}`, 2200); } } catch (e) {}
    const m = FL.gates && FL.gates.list[G.i]; if (m) { m.flash = ok ? 1 : -1; }
  }
  function scoreOf(R, td, T) {
    const gates = Math.round(R.route.reduce((a, G, i) => { const h = R.hits[i]; return a + (h && h.ok ? 250 + 100 * clamp(1 - h.off / GATE_R, 0, 1) : 0); }, 0));
    const f = td.fpm; const vs = Math.round(f <= 150 ? 2000 : f <= 600 ? 2000 - (f - 150) / 450 * 1100 : f <= 1000 ? 900 - (f - 600) / 400 * 900 : 0);
    const ac = Math.abs(td.c); const cl = Math.round(ac <= 1.5 ? 1500 : Math.max(0, 1500 * (1 - (ac - 1.5) / 10.5)));
    const dz = Math.abs(td.past - RW.aimPast); const zone = Math.round(td.past < 0 ? 0 : dz <= 60 ? 1500 : Math.max(0, 1500 * (1 - (dz - 60) / 340)));
    const bounces = Math.max(0, R.tds.length - 1);
    const pen = { comfort: Math.round(R.rough * 500), prot: Math.round(R.prot * 120), over: Math.round(R.over * 120), bounce: bounces * 150, nose: td.pitch < 0.5 * D2R ? 250 : 0, bank: Math.round(Math.max(0, Math.abs(td.bank) * R2D - 2) * 40) };
    const sm = Math.round(clamp(1050 - pen.comfort - pen.prot - pen.over - pen.bounce - pen.nose - pen.bank, 0, 1050));
    const time = Math.round(T <= PAR ? 800 : Math.max(0, 800 * (1 - (T - PAR) / PAR)));
    const nOk = R.route.filter((G, i) => R.hits[i] && R.hits[i].ok).length;
    return { gates, vs, cl, zone, sm, time, pen, nOk, total: gates + vs + cl + zone + sm + time };
  }
  FL.scoreOf = scoreOf;
  function finish(s) {
    const td = RUN.tds[RUN.tds.length - 1]; const sc = scoreOf(RUN, td, RUN.t); RUN.res = sc; runSet("done"); showGates(false);
    let best = null; try { best = JSON.parse(localStorage.getItem("g1:flightbest") || "null"); } catch (e) {}
    RUN.pb = !best || sc.total > best.score; RUN.prevBest = best;
    if (RUN.pb) localStorage.setItem("g1:flightbest", JSON.stringify({ score: sc.total, t: Math.round(RUN.t), at: Date.now() }));
    try { const lg = JSON.parse(localStorage.getItem("g1:flightlog") || "[]"); lg.push({ by: (player && player.userData && player.userData.name) || localStorage.getItem("g1:name") || "You", score: sc.total, at: Date.now() }); lg.sort((a, b) => b.score - a.score); localStorage.setItem("g1:flightlog", JSON.stringify(lg.slice(0, 10))); } catch (e) {}
    if (sc.total > 0) { FL.scoreAt = performance.now(); act({ t: "score", game: "flight", v: Math.max(1, 100000 - sc.total) }); }
    try { if (window.PLAN_PROGRESS && typeof window.PLAN_PROGRESS.award === "function") window.PLAN_PROGRESS.award("flight", { score: Math.round(sc.total / 100), landed: true, points: sc.total }); } catch (e) { log("progress", e); }   // plan_progress reads score on a 0..100 scale
    try { if (typeof logLine === "function") logLine("Scenic Flight", `${(player && player.userData && player.userData.name) || "A pilot"} landed Giveback One with ${sc.total.toLocaleString("en-US")} points`); } catch (e) {}
    try { if (typeof sfx === "function") sfx("rank"); } catch (e) {}
    showResult();
  }

  // ───────────────────────────── 3D: gates, route line, runway aids ─────────────────────────────
  function textSprite(txt, color, w, h) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 160; const x = c.getContext("2d");
    x.font = "700 78px 'Space Grotesk', system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.lineJoin = "round";
    x.lineWidth = 14; x.strokeStyle = "rgba(6,14,10,.85)"; x.strokeText(txt, 512, 82); x.fillStyle = color || "#f5f1e6"; x.fillText(txt, 512, 82);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m); sp.scale.set(w || 96, h || 15, 1); sp.renderOrder = 10; return sp;
  }
  function buildGates() {
    if (FL.gates) return FL.gates; const R = buildRoute(); const root = new THREE.Group(); root.name = "flight_gates"; root.userData.noCull = true;
    const geo = new THREE.TorusGeometry(GATE_R, 1.3, 12, 80);
    const mNext = new THREE.MeshStandardMaterial({ color: 0xf4cd5a, emissive: 0xf4cd5a, emissiveIntensity: 1.5, roughness: 0.35, metalness: 0.3 });
    const mSoon = new THREE.MeshStandardMaterial({ color: 0x4dde6f, emissive: 0x2fae57, emissiveIntensity: 0.9, roughness: 0.5, transparent: true, opacity: 0.75 });
    const mBeam = new THREE.MeshBasicMaterial({ color: 0xf4cd5a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beamGeo = new THREE.CylinderGeometry(0.9, 0.9, 1, 8, 1, true); beamGeo.translate(0, 0.5, 0);
    const list = R.map((G, i) => { const m = new THREE.Mesh(geo, mSoon); m.position.set(G.x, G.y, G.z); m.rotation.y = Math.atan2(G.nx, G.nz); m.castShadow = false; m.visible = false; root.add(m);
      const lb = textSprite(`${i + 1} · ${G.name.toUpperCase()}`, "#f5f1e6"); lb.position.set(G.x, G.y + GATE_R + 12, G.z); lb.visible = false; root.add(lb);
      const gy = ground(G.x, G.z); const beam = new THREE.Mesh(beamGeo, mBeam); beam.position.set(G.x, gy, G.z); beam.scale.set(1, Math.max(1, G.y - GATE_R - gy), 1); beam.visible = false; root.add(beam);
      return { G, m, lb, beam, flash: 0 }; });
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 16), 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf4cd5a, transparent: true, opacity: 0.55, depthWrite: false, fog: false })); line.frustumCulled = false; line.visible = false; root.add(line);
    scene.add(root); FL.gates = { root, list, mNext, mSoon, line }; return FL.gates;
  }
  function showGates(on) { const G = FL.gates; if (!G) return; if (!on) { for (const q of G.list) { q.m.visible = false; q.lb.visible = false; q.beam.visible = false; } G.line.visible = false; } }
  function updateGates(now) {
    const G = FL.gates; if (!G) return; const on = active() || RUN.state === "armed";
    if (!on) { showGates(false); return; }
    for (const q of G.list) { const i = q.G.i; const next = i === RUN.gi, soon = i === RUN.gi + 1 || (RUN.state === "armed" && i === 1);
      q.m.visible = next || soon || q.flash !== 0; q.m.material = next ? G.mNext : G.mSoon; q.lb.visible = next || soon; q.beam.visible = next && RUN.state !== "armed" ? true : RUN.state === "armed" && i === 0;
      if (next) { const p = 1 + 0.06 * Math.sin(now * 0.006); q.m.scale.setScalar(p); } else q.m.scale.setScalar(1);
      if (q.flash) { q.flash += q.flash > 0 ? -0.03 : 0.03; if (Math.abs(q.flash) < 0.04) q.flash = 0; else { q.m.material = G.mNext; q.m.scale.setScalar(1 + (1 - Math.abs(q.flash)) * 0.9); } }
      q.lb.material.opacity = next ? 1 : 0.7; }
    // the route ahead as a thin line through the remaining gates and down to the runway aim point
    const pos = G.line.geometry.attributes.position.array; let n = 0; for (let i = RUN.gi; i < G.list.length && n < 15; i++) { const g0 = G.list[i].G; pos[n * 3] = g0.x; pos[n * 3 + 1] = g0.y; pos[n * 3 + 2] = g0.z; n++; }
    if (RUN.aim && n < 16) { pos[n * 3] = RUN.aim.x; pos[n * 3 + 1] = RUN.aim.y + 2; pos[n * 3 + 2] = RUN.aim.z; n++; }
    G.line.geometry.setDrawRange(0, n); G.line.geometry.attributes.position.needsUpdate = true; G.line.visible = n > 1 && RUN.state !== "landed";
  }
  // runway aids: PAPI for both runways (four units left of the runway at the aim point, 4 degree path), the Runway 21 touchdown
  // zone and the Runway 03 line-up mark. Shown only to the pilot, only while flying.
  function groundStrip(a0, a1, c0, c1, lift, mat, stepA) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (stepA || 15))); const P = [], UV = [], I = [];
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); for (const [j, c] of [[0, c0], [1, c1]]) { const [x, z] = fromRW(a, c); P.push(x, ground(x, z) + lift, z); UV.push(j, i / n); } if (i < n) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.renderOrder = 4; m.frustumCulled = false; return m;
  }
  function buildAids() {
    if (FL.aids) return FL.aids; const root = new THREE.Group(); root.name = "flight_aids"; root.userData.noCull = true; root.visible = false;
    const papis = [];
    for (const rwy of [21, 3]) { const a = aimAlong(rwy), side = rwy === 21 ? 1 : -1; const face = rwy === 21 ? RW.psi03 : RW.psi21;
      for (let k = 0; k < 4; k++) { const c = side * (RW.w / 2 + 7 + k * 9); const [x, z] = fromRW(a, c); const y = ground(x, z) + 0.9;
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }); const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.0), mat); box.position.set(x, y, z); box.rotation.y = face; root.add(box);
        const gm = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); const gl = new THREE.Sprite(gm); gl.scale.set(9, 9, 1); gl.position.set(x, y + 0.4, z); root.add(gl);
        papis.push({ rwy, k, x, y, z, mat, gm, thr: [4.5, 4.17, 3.83, 3.5][k] * D2R }); } }
    const tdz = new THREE.Group(); const zm = new THREE.MeshBasicMaterial({ color: 0x4dde6f, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false });
    const am = new THREE.MeshBasicMaterial({ color: 0xf4cd5a, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, fog: false });
    const a21 = aimAlong(21); tdz.add(groundStrip(RW.half - 150, RW.half - 600, -RW.w / 2 + 1, RW.w / 2 - 1, 0.45, zm)); tdz.add(groundStrip(a21 + 4, a21 - 4, -RW.w / 2 + 1, RW.w / 2 - 1, 0.5, am, 8)); tdz.visible = false; root.add(tdz);
    const lc = document.createElement("canvas"); lc.width = 256; lc.height = 512; const x = lc.getContext("2d"); x.fillStyle = "rgba(77,222,111,.85)";
    for (let i = 0; i < 3; i++) { const y0 = 420 - i * 150; x.beginPath(); x.moveTo(28, y0); x.lineTo(128, y0 - 90); x.lineTo(228, y0); x.lineTo(228, y0 + 40); x.lineTo(128, y0 - 50); x.lineTo(28, y0 + 40); x.closePath(); x.fill(); }
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; const lm = new THREE.MeshBasicMaterial({ map: lt, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, fog: false });
    const lu = groundStrip(-RW.half + 22, -RW.half + 82, -9, 9, 0.5, lm, 10); lu.visible = false; root.add(lu);
    scene.add(root); FL.aids = { root, papis, tdz, lu }; return FL.aids;
  }
  function updateAids(s, now) {
    const A = buildAids(); A.root.visible = true; const e = camera.position;
    for (const p of A.papis) { const [a] = toRW(e.x, e.z); const front = p.rwy === 21 ? a > aimAlong(21) : a < aimAlong(3); const d = Math.hypot(e.x - p.x, e.z - p.z); const ang = Math.atan2(e.y - p.y, Math.max(1, d));
      const white = ang > p.thr; const col = !front ? 0x3a2a20 : white ? 0xfff6e8 : 0xff2a1a; p.mat.color.setHex(col); p.gm.color.setHex(col); p.gm.opacity = front ? 0.95 : 0; }
    A.tdz.visible = RUN.state === "final" || (RUN.state === "gates" && RUN.gi >= 7); A.lu.visible = s.onGround && (RUN.state === "off" || RUN.state === "armed" || RUN.state === "done" || RUN.state === "failed");
  }

  // ───────────────────────────── cameras ─────────────────────────────
  function selfHide(V, on) { if (on) { for (const c of V.g.children) if (c.isMesh && c.visible) { c.visible = false; V._flHidden = true; } } else if (V && V._flHidden) { for (const c of V.g.children) if (c.isMesh) c.visible = true; V._flHidden = false; } }
  function unhideAll() { try { for (const V of Object.values(VEH)) if (V._flHidden) selfHide(V, false); } catch (e) {} }
  const CAMS = FL.cams = { init: false, yaw: 0, pit: -0.15, roll: 0, shake: 0 };
  const _eye = new THREE.Vector3(), _tg = new THREE.Vector3(), _up = new THREE.Vector3(), _dir = new THREE.Vector3(), _rt = new THREE.Vector3();
  function camera_(dt) {
    if (window.__cam || (typeof towerView !== "undefined" && towerView) || !(typeof riding !== "undefined" && riding && riding.kind === "jet")) { if (CAMS.active) { CAMS.active = false; CAMS.init = false; unhideAll(); try { CAM.init = false; } catch (e) {} } return false; }
    const V = VEH[riding.id]; if (!V) return false; const g = V.g, M = measure(V); CAMS.active = true;
    selfHide(V, FL.view === 1);   // in the cockpit your own jet's shell would fill the view (its materials are two-sided)
    const s = riding.driver ? S : null; const sh = s && s.tdShake ? s.tdShake : 0; if (s && s.tdShake) s.tdShake = Math.max(0, s.tdShake - dt * 2.2);
    if (FL.view === 1) {
      g.updateMatrixWorld(true); _eye.copy(M.eye).applyMatrix4(g.matrixWorld); camera.position.copy(_eye);
      _q.copy(g.quaternion).multiply(Q_FLIP); if (IN.look || IN.lookP) { const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(IN.lookP * 0.6, IN.look * 0.5, 0, "YXZ")); _q.multiply(lq); } camera.quaternion.copy(_q);
      if (sh) camera.position.y += (Math.random() - 0.5) * sh * 0.12;
      return true;
    }
    const psi = g.rotation.y, th = -g.rotation.x, ph = g.rotation.z;
    if (!CAMS.init) { CAMS.yaw = psi; CAMS.pit = -0.15 + th * 0.55; CAMS.roll = 0; CAMS.init = true; }
    CAMS.yaw += wrap(psi + IN.look - CAMS.yaw) * sk(dt, 3.4); CAMS.pit += ((-0.15 + th * 0.55 + IN.lookP * 0.5) - CAMS.pit) * sk(dt, 2.8); CAMS.roll += (ph * 0.3 - CAMS.roll) * sk(dt, 2.4);
    const spd = s ? s.V : 0; const dist = M.len * 1.3 + 10 + clamp(spd - 50, 0, 80) * 0.07;
    _tg.set(g.position.x, g.position.y + M.minY + M.h * 0.42, g.position.z);
    const cp = Math.cos(CAMS.pit); _dir.set(Math.sin(CAMS.yaw) * cp, Math.sin(CAMS.pit), Math.cos(CAMS.yaw) * cp);
    _eye.copy(_tg).addScaledVector(_dir, -dist); _eye.y += M.h * 0.18; const gy = ground(_eye.x, _eye.z) + 2.5; if (_eye.y < gy) _eye.y = gy;
    if (sh) { _eye.x += (Math.random() - 0.5) * sh * 0.5; _eye.y += (Math.random() - 0.5) * sh * 0.5; }
    camera.position.copy(_eye); _tg.addScaledVector(_dir, M.len * 0.7);
    _rt.crossVectors(_dir, _up.set(0, 1, 0)).normalize(); _up.multiplyScalar(Math.cos(CAMS.roll)).addScaledVector(_rt, Math.sin(CAMS.roll));
    _m.lookAt(camera.position, _tg, _up); camera.quaternion.setFromRotationMatrix(_m);
    return true;
  }

  // ───────────────────────────── HUD ─────────────────────────────
  const CSS = `
body.fl-on #veh{display:none!important}
body.fl-run #game,body.fl-run #zone{display:none!important}
body.fl-air #prompt{display:none!important}
body.fl-on #prompt{bottom:168px}
#fl-hud{left:50%;bottom:16px;transform:translateX(-50%);display:none;z-index:6;font-family:"JetBrains Mono",ui-monospace,monospace;color:var(--cream,#f5f1e6)}
#fl-hud.on{display:block}
#fl-hud .strip{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--glass2,rgba(7,17,12,.8));border:1px solid var(--line,rgba(77,222,111,.3));border-radius:16px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 12px 34px rgba(0,0,0,.35)}
#fl-hud .box{width:84px;text-align:center;padding:4px 0;border-radius:10px;background:rgba(0,0,0,.28);border:1px solid rgba(245,241,230,.12)}
#fl-hud .v{font:700 25px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.02em;line-height:1.1}
#fl-hud .u{font:600 9px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.18em;color:var(--green,#4DDE6F)}
#fl-hud .sub{font:600 11px "JetBrains Mono",ui-monospace,monospace;color:var(--dim,rgba(245,241,230,.62));margin-top:2px;min-height:14px}
#fl-hud canvas{display:block;width:104px;height:104px}
#fl-hud .col{display:flex;flex-direction:column;gap:6px;width:196px}
#fl-hud .row1{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
#fl-hud .hdg{font:700 18px "JetBrains Mono",ui-monospace,monospace}
#fl-hud .thr{display:flex;align-items:center;gap:7px}
#fl-hud .thr i{position:relative;display:block;flex:1;height:10px;border-radius:6px;background:rgba(245,241,230,.1);border:1px solid rgba(245,241,230,.18);overflow:hidden}
#fl-hud .thr i em{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2fae57,#4DDE6F)}
#fl-hud .thr i s{position:absolute;top:-2px;bottom:-2px;width:2px;left:0;background:#f4cd5a;box-shadow:0 0 6px #f4cd5a}
#fl-hud .ann{display:flex;gap:5px;flex-wrap:wrap}
#fl-hud .ann span{min-width:56px;text-align:center;font:700 9.5px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.1em;padding:3px 6px;border-radius:5px;border:1px solid rgba(245,241,230,.2);color:var(--dim,rgba(245,241,230,.62))}
#fl-hud .ann span.g{color:#4DDE6F;border-color:rgba(77,222,111,.55);background:rgba(77,222,111,.1)}
#fl-hud .ann span.a{color:#f4cd5a;border-color:rgba(244,205,90,.6);background:rgba(244,205,90,.1)}
#fl-hud .ann span.r{color:#ff9180;border-color:rgba(255,145,128,.6);background:rgba(255,145,128,.12)}
#fl-warn{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);white-space:nowrap;font:700 13px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;padding:5px 12px;border-radius:8px;display:none}
#fl-warn.a{display:block;color:#0a1610;background:#f4cd5a}
#fl-warn.r{display:block;color:#fff;background:#d8412f;animation:flblink .6s steps(2) infinite}
@keyframes flblink{50%{opacity:.45}}
#fl-call{position:fixed;left:50%;top:30%;transform:translateX(-50%);font:600 15px "Space Grotesk",system-ui,sans-serif;color:var(--cream,#f5f1e6);text-shadow:0 2px 10px rgba(0,0,0,.75);opacity:0;transition:opacity .35s;white-space:nowrap;z-index:6;pointer-events:none}
#fl-call.on{opacity:1}
#fl-run{left:50%;top:78px;transform:translateX(-50%);display:none;text-align:center;padding:9px 18px 10px;background:var(--glass,rgba(7,17,12,.62));border:1px solid var(--line,rgba(77,222,111,.3));border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);min-width:260px;max-width:min(560px,92vw);z-index:5}
#fl-run.on{display:block}
#fl-run .k{font:700 10px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.2em;color:var(--green,#4DDE6F)}
#fl-run .h{font-family:"Anton",Impact,sans-serif;font-size:24px;letter-spacing:.04em;margin-top:2px;color:var(--cream,#f5f1e6)}
#fl-run .s{font:500 12.5px "Space Grotesk",system-ui,sans-serif;color:var(--dim,rgba(245,241,230,.62));margin-top:3px}
#fl-run .dots{margin-top:6px;display:flex;gap:4px;justify-content:center}
#fl-run .dots i{width:9px;height:9px;border-radius:50%;border:1px solid rgba(245,241,230,.35)}
#fl-run .dots i.ok{background:#4DDE6F;border-color:#4DDE6F}#fl-run .dots i.no{background:#ff9180;border-color:#ff9180}#fl-run .dots i.nx{border-color:#f4cd5a;box-shadow:0 0 6px #f4cd5a}
#fl-run .dev{display:flex;gap:14px;justify-content:center;margin-top:6px;font:600 10px "JetBrains Mono",ui-monospace,monospace;color:var(--dim,rgba(245,241,230,.62));letter-spacing:.1em}
#fl-run .dev b{display:inline-block;position:relative;width:70px;height:8px;margin-left:6px;vertical-align:middle;border-bottom:1px solid rgba(245,241,230,.3)}
#fl-run .dev b i{position:absolute;top:0;width:8px;height:8px;margin-left:-4px;transform:rotate(45deg);background:#f4cd5a}
#fl-keys{left:50%;bottom:146px;transform:translateX(-50%);display:none;color:var(--dim,rgba(245,241,230,.62));text-align:center;line-height:1.9;padding:5px 14px;background:var(--glass,rgba(7,17,12,.62));border:1px solid var(--line2,rgba(245,241,230,.14));border-radius:14px;font:600 9.5px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.06em;width:max-content;max-width:min(700px,calc(100vw - 600px));z-index:5}
@media (max-width:1100px){#fl-keys{max-width:92vw}}
#fl-keys.on{display:block}
#fl-keys kbd{display:inline-block;padding:1px 5px;border:1px solid rgba(77,222,111,.4);background:rgba(77,222,111,.1);color:var(--green,#4DDE6F);border-radius:4px;font:600 9.5px "JetBrains Mono",ui-monospace,monospace;margin:0 2px}
#fl-mk{left:0;top:0;display:none;z-index:5;transform:translate(-50%,-50%)}
#fl-mk.on{display:block}
#fl-mk i{display:block;width:16px;height:16px;margin:0 auto;border:2px solid #f4cd5a;transform:rotate(45deg);box-shadow:0 0 10px rgba(244,205,90,.7)}
#fl-mk b{display:block;margin-top:5px;text-align:center;font:700 10.5px "JetBrains Mono",ui-monospace,monospace;color:#f4cd5a;text-shadow:0 1px 4px rgba(0,0,0,.8);white-space:nowrap}
#fl-mk.edge i{border-radius:2px;border-width:0 3px 3px 0;box-shadow:none}
#fl-hudc{left:0;top:0;width:100vw;height:100vh;display:none}
#fl-hudc.on{display:block}
#fl-touch{right:18px;bottom:22px;display:none;grid-template-columns:repeat(3,60px);gap:6px;pointer-events:auto;z-index:6}
body.touch #fl-touch.on{display:grid}
#fl-touch button{height:44px;border-radius:10px;border:1px solid rgba(245,241,230,.35);background:rgba(10,22,16,.66);color:var(--cream,#f5f1e6);font:700 10.5px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.06em;touch-action:none}
#fl-touch button.hot{border-color:#4DDE6F;color:#4DDE6F}
#fl-res{left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,92vw);display:none;padding:20px 22px;background:rgba(7,17,12,.92);border:1px solid var(--line,rgba(77,222,111,.3));border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);pointer-events:auto;z-index:21;color:var(--cream,#f5f1e6);font-family:"Space Grotesk",system-ui,sans-serif}
#fl-res.on{display:block}
#fl-res .k{font:700 10px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.2em;color:var(--green,#4DDE6F)}
#fl-res .big{font-family:"Anton",Impact,sans-serif;font-size:46px;letter-spacing:.03em;line-height:1.05;margin-top:4px}
#fl-res .rate{font:600 13px "Space Grotesk",system-ui,sans-serif;color:#f4cd5a;margin-bottom:10px}
#fl-res table{width:100%;border-collapse:collapse;font-size:13px}
#fl-res td{padding:5px 0;border-bottom:1px solid rgba(245,241,230,.08)}
#fl-res td.n{text-align:right;font:700 13px "JetBrains Mono",ui-monospace,monospace}
#fl-res td small{color:var(--dim,rgba(245,241,230,.62));font-size:11.5px;margin-left:6px}
#fl-res .pb{margin-top:10px;font-size:12.5px;color:var(--dim,rgba(245,241,230,.62))}
#fl-res .pb b{color:#4DDE6F}
#fl-res .bd{margin-top:10px;font-size:12px}
#fl-res .bd div{display:flex;justify-content:space-between;padding:2px 0;color:var(--dim,rgba(245,241,230,.62))}
#fl-res .bd div.me{color:var(--cream,#f5f1e6)}
#fl-res .btns{display:flex;gap:8px;margin-top:14px}
#fl-res button{flex:1;padding:9px 10px;border-radius:10px;border:1px solid var(--green,#4DDE6F);background:rgba(77,222,111,.14);color:var(--cream,#f5f1e6);font:700 11px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;cursor:pointer}
#fl-res button.ghost{border-color:rgba(245,241,230,.25);background:transparent}
body.touch #fl-hud{bottom:auto;top:64px;transform:translateX(-50%) scale(.82);transform-origin:top center}
body.touch #fl-run{top:208px}
body.touch #fl-touch{right:auto;left:50%;transform:translateX(-50%);bottom:18px}
body.touch #fl-keys{display:none!important}
@media (max-width:760px){#fl-hud{transform:translateX(-50%) scale(.78);transform-origin:bottom center}body.touch #fl-hud{transform:translateX(-50%) scale(.7)}#fl-run .h{font-size:19px}#fl-call{font-size:13px}}
`;
  const E = {};
  function injectDOM() {
    for (const id of ["fl-css", "fl-hud", "fl-run", "fl-mk", "fl-hudc", "fl-touch", "fl-res", "fl-keys", "fl-call"]) { const o = document.getElementById(id); if (o) o.remove(); }
    const st = document.createElement("style"); st.id = "fl-css"; st.textContent = CSS; document.head.appendChild(st);
    const mk = (tag, id, cls, html) => { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
    E.hud = mk("div", "fl-hud", "hud", `<div id="fl-warn"></div><div class="strip"><div class="box"><div class="v" id="fl-spd">0</div><div class="u">KT</div><div class="sub" id="fl-spd2"></div></div><canvas id="fl-att" width="208" height="208"></canvas><div class="box"><div class="v" id="fl-alt">0</div><div class="u">FT</div><div class="sub" id="fl-vs"></div></div><div class="col"><div class="row1"><span class="u">HDG</span><span class="hdg" id="fl-hdg">000</span><span class="u" id="fl-ra"></span></div><div class="thr"><span class="u">THR</span><i><em id="fl-thrb"></em><s id="fl-n1"></s></i></div><div class="ann"><span id="fl-gear">GEAR DN</span><span id="fl-flap">FLAPS 15</span><span id="fl-brk">BRK</span></div></div></div>`);
    E.call = mk("div", "fl-call", "");
    E.run = mk("div", "fl-run", "hud", `<div class="k" id="fl-run-k"></div><div class="h" id="fl-run-h"></div><div class="s" id="fl-run-s"></div><div class="dots" id="fl-dots"></div><div class="dev" id="fl-dev" style="display:none"><span>GS<b><i id="fl-gs"></i></b></span><span>LOC<b><i id="fl-loc"></i></b></span></div>`);
    E.keys = mk("div", "fl-keys", "hud", `<kbd>W</kbd><kbd>S</kbd> thrust / brake · <kbd>A</kbd><kbd>D</kbd> steer, bank · <kbd>space</kbd><kbd>shift</kbd> nose up / down · mouse flies · <kbd>G</kbd> gear · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> flaps · <kbd>B</kbd> brakes · <kbd>C</kbd> view · <kbd>T</kbd> scenic flight · <kbd>F</kbd> leave`);
    E.mk = mk("div", "fl-mk", "hud", `<i></i><b id="fl-mk-d"></b>`);
    E.hudc = mk("canvas", "fl-hudc", "hud"); try { const gl = document.getElementById("gl"); if (gl) gl.after(E.hudc); } catch (e) {}   // under the game's HUD, over the 3D view
    E.touch = mk("div", "fl-touch", "hud", `<button data-f="thr+">THR +</button><button data-f="gear">GEAR</button><button data-f="flap+">FLAPS +</button><button data-f="thr-">THR −</button><button data-f="view">VIEW</button><button data-f="flap-">FLAPS −</button><button data-f="brk">BRAKE</button><button data-f="tour" class="hot">TOUR</button><button data-f="leave">LEAVE</button>`);
    E.res = mk("div", "fl-res", "hud", "");
    for (const b of E.touch.querySelectorAll("button")) {
      const f = b.dataset.f; const down = (e) => { e.preventDefault(); e.stopPropagation(); if (f === "thr+") IN.thrTouch = 1; else if (f === "thr-") IN.thrTouch = -1; else if (f === "brk") IN.brakeKey = true; else if (f === "gear") toggleGear(); else if (f === "flap+") setFlaps((S ? S.flaps : 1) + 1); else if (f === "flap-") setFlaps((S ? S.flaps : 1) - 1); else if (f === "view") cycleView(); else if (f === "tour") scenicKey(); else if (f === "leave") { try { toggleRide(); } catch (x) {} } };
      const up = (e) => { if (f === "thr+" || f === "thr-") IN.thrTouch = 0; if (f === "brk") IN.brakeKey = false; };
      b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
    }
    for (const k of ["spd", "spd2", "alt", "vs", "hdg", "ra", "thrb", "n1", "gear", "flap", "brk", "warn", "att", "run-k", "run-h", "run-s", "dots", "dev", "gs", "loc", "mk-d"]) E[k] = document.getElementById("fl-" + k);
    E.txt = {};
  }
  const setT = (el, key, v) => { if (E.txt[key] !== v) { E.txt[key] = v; el.textContent = v; } };
  const setH = (el, key, v) => { if (E.txt[key] !== v) { E.txt[key] = v; el.innerHTML = v; } };
  const setC = (el, key, v) => { if (E.txt["c" + key] !== v) { E.txt["c" + key] = v; el.className = v; } };
  let callT = 0;
  function callout(t, ms) { if (!E.call) return; E.call.textContent = t; E.call.classList.add("on"); callT = performance.now() + (ms || 2200); }
  FL.callout = callout;
  const fmtT = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };
  const fmtD = (d) => (d >= 1000 ? (d / 1000).toFixed(1) + " KM" : Math.round(d / 10) * 10 + " M");
  const num = (v) => Math.round(v).toLocaleString("en-US");
  function drawAtt(cv, th, ph, gam) {
    const x = cv.getContext("2d"), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 3, k = H / (46 * D2R);
    x.clearRect(0, 0, W, H); x.save(); x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip();
    x.translate(cx, cy); x.rotate(-ph); x.translate(0, th * k);
    let gr = x.createLinearGradient(0, -H, 0, 0); gr.addColorStop(0, "#1f4f86"); gr.addColorStop(1, "#6fa8dc"); x.fillStyle = gr; x.fillRect(-W * 2, -H * 3, W * 4, H * 3);
    gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#8a6440"); gr.addColorStop(1, "#4a3420"); x.fillStyle = gr; x.fillRect(-W * 2, 0, W * 4, H * 3);
    x.strokeStyle = "#fff"; x.lineWidth = 3; x.beginPath(); x.moveTo(-W * 2, 0); x.lineTo(W * 2, 0); x.stroke();
    x.lineWidth = 2; x.fillStyle = "#fff"; x.font = "600 15px 'JetBrains Mono', monospace"; x.textAlign = "left"; x.textBaseline = "middle";
    for (const d of [-20, -15, -10, -5, 5, 10, 15, 20]) { const y = -d * D2R * k, w = d % 10 === 0 ? 34 : 16; x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke(); if (d % 10 === 0) x.fillText(String(Math.abs(d)), w + 6, y); }
    x.restore();
    x.save(); x.translate(cx, cy); x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 2; for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = (b - 90) * D2R, r0 = R - (b % 30 === 0 ? 14 : 9); x.beginPath(); x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); x.lineTo(Math.cos(a) * R, Math.sin(a) * R); x.stroke(); }
    x.rotate(-ph); x.fillStyle = "#f4cd5a"; x.beginPath(); x.moveTo(0, -R + 15); x.lineTo(-8, -R + 29); x.lineTo(8, -R + 29); x.closePath(); x.fill(); x.restore();
    x.save(); x.translate(cx, cy); x.strokeStyle = "#0a1610"; x.fillStyle = "#f4cd5a"; x.lineWidth = 2;
    const wing = (sx) => { x.beginPath(); x.moveTo(sx * 18, 0); x.lineTo(sx * 58, 0); x.lineTo(sx * 58, 7); x.lineTo(sx * 26, 7); x.lineTo(sx * 18, 16); x.closePath(); x.fill(); x.stroke(); }; wing(1); wing(-1); x.fillRect(-4, -4, 8, 8); x.strokeRect(-4, -4, 8, 8);
    if (gam !== undefined) { const fy = (th - gam) * k; x.strokeStyle = "#4DDE6F"; x.lineWidth = 2.5; x.beginPath(); x.arc(0, fy, 7, 0, 7); x.moveTo(-18, fy); x.lineTo(-7, fy); x.moveTo(7, fy); x.lineTo(18, fy); x.moveTo(0, fy - 7); x.lineTo(0, fy - 14); x.stroke(); }
    x.restore(); x.strokeStyle = "rgba(245,241,230,.35)"; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
  }
  function drawHUDc(s) {
    const cv = E.hudc, dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext("2d"); x.clearRect(0, 0, W, H); const k = (H / 2) / Math.tan(camera.fov * D2R / 2), cx = W / 2, cy = H / 2;
    // the flight deck: window posts, the header and the glare shield (the jet's own shell is hidden in this view)
    x.save(); x.fillStyle = "rgba(11,15,13,.96)";
    x.beginPath(); x.moveTo(0, 0); x.lineTo(W * 0.055, 0); x.lineTo(W * 0.115, H * 0.8); x.lineTo(0, H * 0.87); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(W, 0); x.lineTo(W * 0.945, 0); x.lineTo(W * 0.885, H * 0.8); x.lineTo(W, H * 0.87); x.closePath(); x.fill();
    x.fillRect(0, 0, W, H * 0.035);
    x.beginPath(); x.moveTo(0, H * 0.86); x.quadraticCurveTo(W / 2, H * 0.76, W, H * 0.86); x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
    x.strokeStyle = "rgba(245,241,230,.08)"; x.lineWidth = 2 * dpr; x.beginPath(); x.moveTo(0, H * 0.86); x.quadraticCurveTo(W / 2, H * 0.76, W, H * 0.86); x.stroke(); x.restore();
    x.save(); x.strokeStyle = "rgba(77,222,111,.9)"; x.fillStyle = "rgba(77,222,111,.95)"; x.lineWidth = 2 * dpr; x.font = `600 ${13 * dpr}px 'JetBrains Mono', monospace`; x.textBaseline = "middle";
    x.translate(cx, cy); x.rotate(-s.ph); x.translate(0, s.th * k);
    x.beginPath(); x.moveTo(-W, 0); x.lineTo(-60 * dpr, 0); x.moveTo(60 * dpr, 0); x.lineTo(W, 0); x.stroke();
    for (let d = -30; d <= 30; d += 5) { if (!d) continue; const y = -d * D2R * k, w = 70 * dpr, gap = 26 * dpr; x.setLineDash(d < 0 ? [8 * dpr, 6 * dpr] : []); x.beginPath(); x.moveTo(-w, y); x.lineTo(-gap, y); x.moveTo(gap, y); x.lineTo(w, y); x.stroke(); x.setLineDash([]); x.textAlign = "left"; x.fillText(String(d), w + 6 * dpr, y); x.textAlign = "right"; x.fillText(String(d), -w - 6 * dpr, y); }
    x.restore();
    x.save(); x.translate(cx, cy); x.strokeStyle = "rgba(77,222,111,.95)"; x.lineWidth = 2 * dpr;
    x.beginPath(); x.moveTo(-26 * dpr, 0); x.lineTo(-10 * dpr, 0); x.lineTo(-5 * dpr, 7 * dpr); x.lineTo(0, 0); x.lineTo(5 * dpr, 7 * dpr); x.lineTo(10 * dpr, 0); x.lineTo(26 * dpr, 0); x.stroke();
    const fy = (s.th - s.gam) * k; x.beginPath(); x.arc(0, fy, 8 * dpr, 0, 7); x.moveTo(-24 * dpr, fy); x.lineTo(-8 * dpr, fy); x.moveTo(8 * dpr, fy); x.lineTo(24 * dpr, fy); x.moveTo(0, fy - 8 * dpr); x.lineTo(0, fy - 16 * dpr); x.stroke();
    const R = 170 * dpr; x.beginPath(); x.arc(0, 0, R, (-90 - 45) * D2R, (-90 + 45) * D2R); x.stroke(); for (const b of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) { const a = (b - 90) * D2R; x.beginPath(); x.moveTo(Math.cos(a) * R, Math.sin(a) * R); x.lineTo(Math.cos(a) * (R + (b % 30 === 0 ? 12 : 7) * dpr), Math.sin(a) * (R + (b % 30 === 0 ? 12 : 7) * dpr)); x.stroke(); }
    x.rotate(-s.ph); x.beginPath(); x.moveTo(0, -R + 2 * dpr); x.lineTo(-7 * dpr, -R + 14 * dpr); x.lineTo(7 * dpr, -R + 14 * dpr); x.closePath(); x.stroke(); x.restore();
  }
  function warnOf(s, agl) {
    if (s.crashed) return null; const kt = s.V * KT, vsf = s.V * Math.sin(s.gam) * FPM;
    if (!s.onGround) {
      if (agl < 90 && s.gear === 0 && (vsf < -150 || s.thr < 0.35)) return ["r", "LANDING GEAR"];
      if (agl < 350 && vsf < -1600 && agl / Math.max(1, -s.V * Math.sin(s.gam)) < 12) return ["r", "PULL UP"];
      if (agl < 300 && vsf < -1500) return ["a", "SINK RATE"];
      if (s.floor) return ["a", "ALPHA FLOOR · THRUST"];
      if (s.prot) return ["a", "STALL PROTECTION"];
      if (kt > 250) return ["a", "OVERSPEED"];
      if (s.relief && s.t - s.relief < 3) return ["a", "FLAP LOAD RELIEF"];
      if (FL.edgeK > 0.05) return ["a", "AIRSPACE EDGE · TURNING BACK"];
      if (agl > C.ceiling - 20) return ["a", "SCENIC CEILING"];
    }
    return null;
  }
  const _pv = new THREE.Vector3();
  function marker(target, label) {
    if (!target) { if (E.mk.classList.contains("on")) E.mk.classList.remove("on"); return; }
    camera.updateMatrixWorld(); _pv.set(target.x, target.y, target.z).applyMatrix4(camera.matrixWorldInverse); const behind = _pv.z > 0;
    const W = innerWidth, H = innerHeight; let sx, sy, edge = false;
    if (!behind) { _pv.applyMatrix4(camera.projectionMatrix); sx = (_pv.x + 1) / 2 * W; sy = (1 - _pv.y) / 2 * H; }
    const m = 46; if (behind || sx < m || sx > W - m || sy < m || sy > H - m) { edge = true; let dx, dy; if (behind) { _pv.set(target.x, target.y, target.z).applyMatrix4(camera.matrixWorldInverse); dx = _pv.x; dy = -_pv.y; if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1; } else { dx = sx - W / 2; dy = sy - H / 2; }
      const sc = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (H / 2 - m) / Math.max(1e-3, Math.abs(dy))); sx = W / 2 + dx * sc; sy = H / 2 + dy * sc; E.mk.querySelector("i").style.transform = `rotate(${Math.atan2(dy, dx) * R2D - 45}deg)`; }
    else E.mk.querySelector("i").style.transform = "rotate(45deg)";
    E.mk.classList.add("on"); E.mk.classList.toggle("edge", edge); E.mk.style.left = sx.toFixed(1) + "px"; E.mk.style.top = sy.toFixed(1) + "px"; setT(E["mk-d"], "mk", label);
  }
  function hud(s, now) {
    const g = VEH[riding.id].g; const agl = s.P.y - ground(s.P.x, s.P.z); s.agl = agl;
    const kt = s.V * KT; s.trend += ((s.V - s.vPrev) / Math.max(1e-3, FL.hudDt || 0.016) - s.trend) * 0.1; s.vPrev = s.V;
    setT(E.spd, "spd", String(Math.round(kt))); setT(E.spd2, "spd2", s.onGround ? (kt > 5 ? "GROUND" : "") : (s.trend > 0.4 ? "▲" : s.trend < -0.4 ? "▼" : "") + " M " + (s.V / 340).toFixed(2));
    setT(E.alt, "alt", num(Math.round(Math.max(0, (s.P.y - RW.elev) * FTM) / 10) * 10));   // feet above the field (the runway's middle)
    const vsf = s.onGround ? 0 : s.V * Math.sin(s.gam) * FPM; setT(E.vs, "vs", (vsf > 25 ? "▲ " : vsf < -25 ? "▼ " : "") + num(Math.abs(Math.round(vsf / 50) * 50)) + " FPM");
    setT(E.hdg, "hdg", String(Math.round(hdgOf(s.psi)) % 360).padStart(3, "0")); setT(E.ra, "ra", !s.onGround && agl < 760 ? `RA ${num(Math.round(agl * FTM / 10) * 10)}` : "");
    const tp = Math.round(s.thr * 100) / 100 + "", np = Math.round(clamp((s.N - C.idle) / (1 - C.idle), 0, 1) * 100) / 100 + "";
    if (E.txt.thr !== tp) { E.txt.thr = tp; E.n1.style.left = `calc(${(+tp * 100).toFixed(0)}% - 1px)`; } if (E.txt.n1 !== np) { E.txt.n1 = np; E.thrb.style.width = (+np * 100).toFixed(0) + "%"; }
    const gt = s.gearPos > 0.99 ? "GEAR DN" : s.gearPos < 0.01 ? "GEAR UP" : "GEAR ···"; setT(E.gear, "gear", gt); setC(E.gear, "gear", s.gearPos > 0.99 ? "g" : s.gearPos < 0.01 ? "" : "a");
    const ft = s.flaps ? `FLAPS ${C.flapDeg[s.flaps]}` : "FLAPS UP"; setT(E.flap, "flap", Math.abs(s.flapPos - s.flaps) > 0.02 ? ft + " ···" : ft); setC(E.flap, "flap", Math.abs(s.flapPos - s.flaps) > 0.02 ? "a" : s.flaps ? "g" : "");
    const bt = s.onGround ? (s.autobrake && s.thr < 0.1 && s.V > 2 ? "AUTOBRAKE" : (FL.lastInp && FL.lastInp.brake) ? "BRAKES" : s.V < 0.5 && s.thr < 0.02 ? "PARKED" : "BRK") : (s.sbPos > 0.05 ? "SPD BRK" : "SPD BRK"); setT(E.brk, "brk", bt); setC(E.brk, "brk", (s.onGround && bt !== "BRK") || s.sbPos > 0.05 ? "g" : "");
    const w = warnOf(s, agl); if (w) { setT(E.warn, "warn", w[1]); setC(E.warn, "warn", w[0]); } else setC(E.warn, "warn", "");
    drawAtt(E.att, s.th + (s.onGround ? s.gPitch : 0), s.ph, s.onGround ? undefined : s.gam);
    if (FL.view === 1) { if (!E.hudc.classList.contains("on")) E.hudc.classList.add("on"); drawHUDc(s); } else if (E.hudc.classList.contains("on")) E.hudc.classList.remove("on");
    if (E.call.classList.contains("on") && now > callT) E.call.classList.remove("on");
    // audio warnings: the gear horn and a soft stall chime
    try { if (typeof tone === "function" && now - (FL.hornAt || 0) > 900) { if (w && (w[1] === "LANDING GEAR" || w[1] === "PULL UP")) { FL.hornAt = now; tone(440, 0.35, "square", 0.025); } else if (w && w[1] === "STALL PROTECTION") { FL.hornAt = now; tone(880, 0.12, "sine", 0.03); } } } catch (e) {}
    // callouts on the takeoff roll and on short final (radio altitude, feet)
    if (s.onGround && !s.air && s.V * KT > 100 && !FL.vrCalled) { FL.vrCalled = true; callout("ROTATE · hold Space", 2500); }
    if (!s.onGround && FL.airAt && now - FL.airAt < 7000 && s.gear && agl > 20 && s.V * Math.sin(s.gam) > 1 && !FL.posCalled) { FL.posCalled = true; callout("Positive rate · gear up (G)", 3000); }
    if (s.onGround && s.V < 5) { FL.vrCalled = false; FL.posCalled = false; }
    if (!s.onGround && s.gear && vsf < -100) { const ft = agl * FTM; for (const c of [100, 50, 30, 20, 10]) { if (ft < c && (FL.raLast || 1e9) >= c) { callout(String(c), 700); try { if (typeof tone === "function") tone(1200, 0.05, "sine", 0.02); } catch (e) {} } } FL.raLast = ft; } else FL.raLast = 1e9;
  }
  function runHUD(s, now) {
    const st = RUN.state; let k = "", h = "", sub = "", show = true, target = null, tlabel = "";
    const [a, c] = toRW(s.P.x, s.P.z);
    if (FL.tow || st === "tow") { k = "SOLPORT SCENIC FLIGHT"; h = "Towing to Runway 03"; sub = "The tug is lining you up"; }
    else if (st === "armed") { k = "READY · RUNWAY 03 · 9 GATES"; h = "Full power: hold W"; sub = "Rotate at 100 KT (hold Space) · then G for gear up"; const G = RUN.route[0]; target = { x: G.x, y: G.y, z: G.z }; tlabel = "GATE 1"; }
    else if (st === "roll") { k = "TAKEOFF ROLL · " + fmtT(RUN.t); h = `${Math.round(s.V * KT)} KT`; sub = s.V * KT < 90 ? "Stay on the centreline (A, D) · rotate at 100 KT" : "Rotate: hold Space"; }
    else if (st === "gates" || st === "final") {
      const G = RUN.route[RUN.gi];
      if (G && st === "gates") { k = `GATE ${RUN.gi + 1} OF ${RUN.route.length} · ${fmtT(RUN.t)}`; h = G.name.toUpperCase(); const d = Math.hypot(G.x - s.P.x, G.y - s.P.y, G.z - s.P.z); const nx = RUN.route[RUN.gi + 1]; sub = `${fmtD(d)}` + (G.base ? " · turn right onto final after the gate" : G.final ? " · gear down, flaps 35, about 115 KT" : nx ? ` · then ${nx.name}` : ""); target = G; tlabel = `${RUN.gi + 1} · ${fmtD(d)}`; }
      else { k = `RUNWAY 21 · ${fmtT(RUN.t)}`; h = "LAND IN THE GREEN ZONE"; sub = s.gear ? "Flaps 35 (3) · about 110 KT · PAPI two red, two white" : "Gear down (G) · flaps 35 (3) · about 110 KT"; target = RUN.aim; tlabel = `TOUCHDOWN · ${fmtD(Math.hypot(RUN.aim.x - s.P.x, RUN.aim.z - s.P.z))}`; }
    }
    else if (st === "landed") { const td = RUN.tds[RUN.tds.length - 1]; k = `TOUCHDOWN · ${num(Math.round(td.fpm / 10) * 10)} FPM · ${fmtT(RUN.t)}`; h = "BRAKE TO A STOP"; sub = "Throttle idle (S) · autobrake is on"; }
    else if (st === "off" || st === "done" || st === "failed") { if (s.onGround && !FL.resOpen) { const L = lineupSpot(); const d = Math.hypot(L.x - s.P.x, L.z - s.P.z); k = "SOLPORT SCENIC FLIGHT"; h = "PRESS T TO LINE UP"; sub = d > 60 ? `or taxi to the Runway 03 threshold, ${fmtD(d).toLowerCase()} · add power when lined up` : "Line up on the centreline, then add power"; target = { x: L.x, y: ground(L.x, L.z) + 4, z: L.z }; tlabel = `RWY 03 · ${fmtD(d)}`; if (lined(s)) { h = "LINED UP"; sub = "Hold still a moment"; } } else show = false; }
    else show = false;
    if (FL.resOpen) show = false;
    E.run.classList.toggle("on", show); document.body.classList.toggle("fl-run", show);
    if (show) { setT(E["run-k"], "rk", k); setT(E["run-h"], "rh", h); setT(E["run-s"], "rs", sub);
      const dots = (active() || st === "armed") && RUN.route ? RUN.route.map((G, i) => `<i class="${RUN.hits[i] ? (RUN.hits[i].ok ? "ok" : "no") : i === RUN.gi && st !== "armed" ? "nx" : ""}"></i>`).join("") : ""; setH(E.dots, "dots", dots);
      const app = st === "final" || (st === "gates" && RUN.gi >= 8); E.dev.style.display = app ? "" : "none";
      if (app) { const aimA = aimAlong(21), dist = Math.max(1, a - aimA); const ang = Math.atan2(s.P.y - RUN.aim.y, dist); const gsd = clamp((ang - RW.gs) / (1 * D2R), -1, 1), lcd = clamp(Math.atan2(c, dist) / (2.5 * D2R), -1, 1); E.gs.style.left = (50 - gsd * 50).toFixed(0) + "%"; E.loc.style.left = (50 - lcd * 50).toFixed(0) + "%"; } }
    marker(show || active() ? target : null, tlabel);
    E.keys.classList.toggle("on", !FL.resOpen && (s.onGround || (FL.airAt && now - FL.airAt < 12000)));
  }
  // ───────────────────────────── result card and the board ─────────────────────────────
  const REASON = { gear: "Gear-up landing: the belly is scraped, nobody is hurt.", hard: "Hard landing. Keep the sink rate under 600 FPM and the wings level.", offrwy: "You touched down in the desert. The score counts on Runway 21 (or 03).", across: "You touched down across the runway.", time: "Time is up for this flight.", rwyexit: "Takeoff abandoned: stay on the runway until you rotate.", abort: "Takeoff abandoned.", left: "You left the jet." };
  function rating(t) { return t >= 9000 ? "Greaser. The cabin never noticed." : t >= 7500 ? "Smooth. Passengers are clapping." : t >= 5500 ? "Solid flying." : t >= 3000 ? "Safely down. Room to improve." : "Down in one piece."; }
  function boardRows() {
    const out = []; const B = view && view.boards && Array.isArray(view.boards.flight) ? view.boards.flight : null;
    if (B && B.length) { for (const e of B) out.push({ by: e.by, score: 100000 - e.v }); return { rows: out, shared: true }; }
    try { for (const e of JSON.parse(localStorage.getItem("g1:flightlog") || "[]")) out.push({ by: e.by, score: e.score }); } catch (e) {} return { rows: out, shared: false };
  }
  function showResult() {
    const R = RUN, sc = R.res; let html;
    if (!sc) { const n = (R.hits || []).filter((h) => h && h.ok).length; html = `<div class="k">SOLPORT SCENIC FLIGHT</div><div class="big">NO SCORE</div><div class="rate">${REASON[R.fail && R.fail.why] || "The flight ended."}</div><table><tr><td>Gates flown</td><td class="n">${n} of ${(R.route || []).length}</td></tr><tr><td>Time</td><td class="n">${fmtT(R.t || 0)}</td></tr></table><div class="btns"><button id="fl-again">FLY AGAIN (T)</button><button class="ghost" id="fl-close">CLOSE (ESC)</button></div>`; }
    else { const td = R.tds[R.tds.length - 1]; const side = td.c > 0.3 ? (td.rwy === 21 ? "left" : "right") : td.c < -0.3 ? (td.rwy === 21 ? "right" : "left") : ""; const zd = td.past - RW.aimPast;
      const bd = boardRows(); const rows = bd.rows.slice(0, 5).map((e, i) => `<div class="${e.score === sc.total ? "me" : ""}"><span>${i + 1}. ${String(e.by).replace(/[<>&]/g, "")}</span><span>${num(e.score)}</span></div>`).join("");
      const best = R.pb ? `<b>New personal best.</b>` : `Personal best ${num(R.prevBest.score)}`;
      html = `<div class="k">SOLPORT SCENIC FLIGHT · RUNWAY ${td.rwy === 3 ? "03" : "21"}</div><div class="big">${num(sc.total)}</div><div class="rate">${rating(sc.total)}</div><table>
<tr><td>Gates<small>${sc.nOk} of ${R.route.length}</small></td><td class="n">${num(sc.gates)}</td></tr>
<tr><td>Touchdown<small>${num(Math.round(td.fpm / 10) * 10)} FPM</small></td><td class="n">${num(sc.vs)}</td></tr>
<tr><td>Centreline<small>${Math.abs(td.c).toFixed(1)} m${side ? " " + side : ""}</small></td><td class="n">${num(sc.cl)}</td></tr>
<tr><td>Touchdown zone<small>${td.past < 0 ? "short of the runway" : Math.abs(zd) < 1 ? "on the aim point" : Math.round(Math.abs(zd)) + " m " + (zd < 0 ? "short of" : "past") + " the aim point"}</small></td><td class="n">${num(sc.zone)}</td></tr>
<tr><td>Smoothness<small>${sc.pen.bounce ? "bounced · " : ""}${sc.pen.nose ? "nose first · " : ""}${sc.pen.bank ? "wing low · " : ""}${(() => { const r = sc.pen.comfort + sc.pen.prot + sc.pen.over; return r > 150 ? "rough air work" : r > 40 ? "a few firm moments" : "gentle"; })()}</small></td><td class="n">${num(sc.sm)}</td></tr>
<tr><td>Time<small>${fmtT(R.t)} (par ${fmtT(PAR)})</small></td><td class="n">${num(sc.time)}</td></tr></table>
<div class="pb">${best}</div><div class="bd"><div style="color:#4DDE6F;font:700 10px 'JetBrains Mono',monospace;letter-spacing:.18em">${bd.shared ? "SITE BOARD" : "THIS DEVICE"}</div>${rows}</div><div class="btns"><button id="fl-again">FLY AGAIN (T)</button><button class="ghost" id="fl-close">CLOSE (ESC)</button></div>`; }
    E.res.innerHTML = html; E.res.classList.add("on"); FL.resOpen = true;
    const a = document.getElementById("fl-again"), c = document.getElementById("fl-close"); if (a) a.onclick = () => { closeResult(); scenicKey(); }; if (c) c.onclick = () => closeResult();
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  }
  function closeResult() { FL.resOpen = false; if (E.res) E.res.classList.remove("on"); }
  function injectBoard() {
    const b = document.getElementById("board"); if (!b || document.getElementById("b-flight")) return; const row = b.querySelector(".row");
    const cols = document.createElement("div"); cols.className = "cols"; cols.style.cssText = "grid-template-columns:1fr;margin-top:10px"; cols.innerHTML = `<div><h3>Solport Scenic Flight</h3><div class="blist" id="b-flight"></div></div>`; if (row) b.insertBefore(cols, row); else b.appendChild(cols);
  }
  function fillBoard() {
    const el = document.getElementById("b-flight"); if (!el) return; const bd = boardRows(); el.innerHTML = "";
    if (!bd.rows.length) { const d = document.createElement("div"); d.textContent = "No flights yet. Board Giveback One and press T."; el.append(d); return; }
    bd.rows.slice(0, 10).forEach((e, i) => { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${i + 1}. ${e.by}`; const sp = document.createElement("span"); sp.textContent = num(e.score) + " pts" + (bd.shared ? "" : " · this device"); d.append(b, sp); el.append(d); });
  }

  // ───────────────────────────── engine sound ─────────────────────────────
  function engineAudio(s) {
    try {
      const on = s && typeof soundOn !== "undefined" && soundOn && typeof actx === "function" && (typeof audioReady === "undefined" || audioReady);
      if (!on) { if (FL.au) { FL.au.g.gain.value = 0; FL.au.ng.gain.value = 0; } return; }
      if (!FL.au) { const c = actx(); const g = c.createGain(); g.gain.value = 0; g.connect(c.destination); const o = c.createOscillator(); o.type = "sawtooth"; const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; o.connect(f); f.connect(g); o.start();
        const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const n = c.createBufferSource(); n.buffer = b; n.loop = true; const nf = c.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 1200; nf.Q.value = 0.8; const ng = c.createGain(); ng.gain.value = 0; n.connect(nf); nf.connect(ng); ng.connect(c.destination); n.start();
        FL.au = { c, o, f, g, n, nf, ng }; }
      const A = FL.au, vol = (VOL.sfx || 1) * (VOL.master || 1), N = s.N;
      A.o.frequency.value = 60 + 240 * N; A.f.frequency.value = 500 + 900 * N; A.g.gain.value = (0.004 + 0.014 * N) * vol; A.nf.frequency.value = 600 + 2400 * N; A.ng.gain.value = (0.003 + 0.018 * N + 0.00009 * s.V) * vol;
    } catch (e) { log("audio", e); }
  }

  // ───────────────────────────── per frame (after the camera, before the render) ─────────────────────────────
  function frame(dt, now) {
    const pil = piloting(); FL.hudDt = dt;
    document.body.classList.toggle("fl-on", pil); document.body.classList.toggle("fl-air", !!(pil && S && !S.onGround));
    if (!pil) {
      if (!(typeof riding !== "undefined" && riding && riding.kind === "jet" && FL.view === 1)) unhideAll(); if (S) { if (active() || RUN.state === "armed") { if (active()) { RUN.fail = { why: "left" }; runSet("failed"); } else runSet("off"); } S = FL.S = null; FL.tow = null; showGates(false); const f = document.getElementById("fade"); if (f && f.style.opacity === "1" && !(typeof FLY !== "undefined" && FLY.on)) f.style.opacity = 0; }
      document.body.classList.remove("fl-run"); if (E.hud) { E.hud.classList.remove("on"); E.run.classList.remove("on"); E.mk.classList.remove("on"); E.hudc.classList.remove("on"); E.touch.classList.remove("on"); E.keys.classList.remove("on"); }
      if (FL.aids) FL.aids.root.visible = false; engineAudio(null);
    } else if (S) {
      const s = S, V = VEH[riding.id]; E.hud.classList.add("on"); E.touch.classList.add("on");
      if (V.label) V.label.visible = false;   // no floating name over your own jet
      FL.edgeK = s.onGround ? 0 : airspace(s).k;
      hud(s, now); runHUD(s, now); updateGates(now); updateAids(s, now); engineAudio(s);
      // hold new AI arrivals and keep departing AI jets short of the runway while you fly
      try { if (TRAFFIC && (!s.onGround || active())) TRAFFIC.next = Math.max(TRAFFIC.next, now + 20000); } catch (e) {}
    }
    // everyone else's jets: the roll they send (YXZ like ours)
    try { if (view && view.vehicles) for (const [id, v] of Object.entries(view.vehicles)) { const V = VEH[id]; if (!V || V.kind !== "jet" || (pil && riding.id === id)) continue; if (V.g.rotation.order !== "YXZ") V.g.rotation.order = "YXZ"; const r = typeof v.roll === "number" && (v.y || 0) > 0.3 ? v.roll : 0; V.g.rotation.z += (r - V.g.rotation.z) * Math.min(1, dt * 6); } } catch (e) {}
  }

  // ───────────────────────────── install (world hook) ─────────────────────────────
  function install() {
    if (FL.installed) return; FL.installed = true;
    try { setupRunway(); } catch (e) { log("runway", e); }
    try { injectDOM(); injectBoard(); } catch (e) { log("dom", e); }
    const I = () => FL.impl; const orig = FL.orig = { driveVehicle, setStatus, updateMinigames, renderBoard, planRunwayBusy, planApproachWant };
    driveVehicle = function (dt) { if (riding && riding.kind === "jet" && riding.driver && FL.enabled !== false) { try { return I().drive(dt); } catch (e) { log("drive", e); } } return orig.driveVehicle.apply(this, arguments); };
    // the server knows the "flight" board once logic.js is deployed; until then the score is kept on this device and the error is quiet
    setStatus = function (t, err) { if (err && typeof t === "string") { if (/unknown game/.test(t) && performance.now() - (FL.scoreAt || -1e9) < 15000) { FL.noServerBoard = true; return; } if (/moved too far|outside the site/.test(t) && FL.tow) return; } return orig.setStatus.apply(this, arguments); };
    // Sky Rings sleep while a scenic flight runs (two ring courses at once would confuse)
    const DUMMY = Array.from({ length: 10 }, () => ({ x: 1e7, y: 1e7, z: 1e7, m: new THREE.Object3D() }));
    updateMinigames = function () { if (!(FL.active && FL.active()) || typeof RINGS === "undefined") return orig.updateMinigames.apply(this, arguments); const keep = RINGS.list; RINGS.list = DUMMY; RINGS.next = -1; try { return orig.updateMinigames.apply(this, arguments); } finally { RINGS.list = keep; for (const r of keep) if (r.m) r.m.visible = false; } };
    renderBoard = function () { const r = orig.renderBoard.apply(this, arguments); try { injectBoard(); fillBoard(); } catch (e) { log("board", e); } return r; };
    // AI jets hold short while you are on the runway or on approach; the approach lights come on for you
    const onRwyOrFinal = () => { const s = S; if (!s || !piloting()) return false; const [a, c] = toRW(s.P.x, s.P.z); return (s.onGround && Math.abs(c) < 45 && Math.abs(a) < RW.half + 60) || (!s.onGround && Math.abs(c) < 400 && Math.abs(a) < RW.half + 2600 && s.P.y - RW.elev < 250); };
    planRunwayBusy = function () { return onRwyOrFinal() || orig.planRunwayBusy.apply(this, arguments); };
    planApproachWant = function () { return orig.planApproachWant.apply(this, arguments) || (onRwyOrFinal() && !(S && S.onGround) ? 1 : 0); };
    addEventListener("keydown", (e) => { try { I().onKey(e); } catch (x) { log("key", x); } }, true);
    addEventListener("keyup", (e) => { try { I().onKeyUp(e); } catch (x) {} }, true);
    addEventListener("mousemove", (e) => { try { I().onMouse(e); } catch (x) {} });
    try { const R = buildRoute(); void R; hotspots.push({ x: -40, z: 70, r: 34, t: "Solport Scenic Flight", k: "Minigame · fly Giveback One", p: "Board Giveback One (F beside it), press T to line up on Runway 03 and fly nine gates over Solport and the Stellar FBO, Main Street, Compass Plaza, The Outpost, Desert Golf and Genesis Park, then land on Runway 21. W and S thrust, A and D bank, Space and Shift nose up and down (or the mouse), G gear, 1 2 3 flaps, C cockpit view. Scored on gates, touchdown, centreline, touchdown zone, smoothness and time; the best flights go on the board (L)." }); } catch (e) { log("hotspot", e); }
    FL.ready = true;
  }

  // ───────────────────────────── debug and test helpers ─────────────────────────────
  // R9p (HANDOFF_R9_HITCHES.md): the gates and the runway aids built once at load (hidden, as they wait between flights anyway) so
  // their shader programs are compiled and first drawn behind the loading screen, not at the first take-off (0.2 to 0.5 s stalls)
  FL.r9prep = function () { try { if (RW.ok) { buildGates(); buildAids(); } } catch (e) { return []; } return [FL.gates && FL.gates.root, FL.aids && FL.aids.root].filter(Boolean); };
  FL.debug = {
    state: () => { const s = S; if (!s) return null; const [a, c] = toRW(s.P.x, s.P.z); const g = VEH[riding.id] && VEH[riding.id].g; let nose = null, wing = null; if (g) { g.updateMatrixWorld(true); const q = g.getWorldQuaternion(new THREE.Quaternion()); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q), w = new THREE.Vector3(-1, 0, 0).applyQuaternion(q); nose = [+n.x.toFixed(3), +n.y.toFixed(3), +n.z.toFixed(3)]; wing = [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)]; }
      return { kt: +(s.V * KT).toFixed(1), agl: +(s.P.y - ground(s.P.x, s.P.z)).toFixed(1), vsFpm: Math.round(s.onGround ? 0 : s.V * Math.sin(s.gam) * FPM), hdg: +hdgOf(s.psi).toFixed(1), pitchDeg: +(s.th * R2D).toFixed(2), gamDeg: +(s.gam * R2D).toFixed(2), bankDeg: +(s.ph * R2D).toFixed(2), aoaDeg: +(s.al * R2D).toFixed(2), n: +s.n.toFixed(2), thr: +s.thr.toFixed(2), N1: +s.N.toFixed(2), gear: s.gear, flaps: s.flaps, onGround: s.onGround, prot: s.prot, floor: s.floor, a: +a.toFixed(1), c: +c.toFixed(1), x: +s.P.x.toFixed(1), z: +s.P.z.toFixed(1), noseDir: nose, rightWing: wing, rotOrder: g && g.rotation.order, run: RUN.state, gi: RUN.gi, t: +(RUN.t || 0).toFixed(1) }; },
    // put the jet somewhere: along/cross on the runway frame, height above ground, heading (deg, magnetic), speed (KT), in the air or not
    place(a, c, agl, hdg, kt, air) { const s = S; if (!s) return "no jet"; const [x, z] = fromRW(a, c); s.P.set(x, ground(x, z) + (agl || 0), z); s.psi = wrap(Math.PI - ((hdg || 0) + MAGVAR) * D2R); s.V = (kt || 0) / KT; s.gam = 0; s.th = 0; s.al = 0; s.ph = 0; s.onGround = !air; if (air) { s.gear = 0; s.gearPos = 0; s.flaps = 0; s.flapPos = 0; s.thr = 0.35; s.N = 0.35; s.air = Math.max(1, s.air); trim(s); } s.crashed = null; apply(s, VEH[riding.id].g); return this.state(); },
    // fast-forward: the same drive() path in fixed steps (no rendering in between); bot(s, t) may set PLAN_FLIGHT.inject each step
    ff(sec, bot, h) { h = h || 1 / 30; let t = 0; const n = Math.round(sec / h); for (let i = 0; i < n; i++) { if (!piloting()) return "not piloting"; if (bot && bot(S, t) === false) break; drive(h, h); t += h; } return t; },
    lineup() { const s = S; if (!s) return "no jet"; const L = lineupSpot(); s.P.set(L.x, ground(L.x, L.z), L.z); s.psi = L.psi; s.V = 0; s.onGround = true; s.th = 0; s.gam = 0; s.ph = 0; s.thr = 0; s.N = C.idle; s.gear = 1; s.gearPos = 1; s.flaps = 1; s.flapPos = 1; s.air = 0; s.crashed = null; runArm(); apply(s, VEH[riding.id].g); return this.state(); },
    run: () => ({ state: RUN.state, gi: RUN.gi, t: RUN.t, hits: RUN.hits, tds: RUN.tds, res: RUN.res, fail: RUN.fail, route: (RUN.route || []).map((G) => ({ name: G.name, x: Math.round(G.x), y: Math.round(G.y), z: Math.round(G.z), nx: +G.nx.toFixed(3), nz: +G.nz.toFixed(3) })) }),
    route: () => buildRoute(), rw: () => RW, aim: () => RUN.aim, gear: () => toggleGear(), flaps: (n) => setFlaps(n), view: (v) => { FL.view = v ? 1 : 0; CAMS.init = false; return FL.view; }, tow: () => scenicKey(), close: () => closeResult(),
  };

  FL.impl = { install, drive, frame, camera: camera_, onKey, onKeyUp, onMouse };
  if (FL.installed) { try { setupRunway(); injectDOM(); injectBoard(); } catch (e) { log("reload", e); } }   // a new copy evaluated in a running page (tests)
  if (!FL.hooked) {
    FL.hooked = true; const H = window.PLAN_HOOKS;
    H.world.push({ name: "plan_flight", fn: () => FL.impl.install() });
    H.frame.push({ name: "plan_flight", fn: (dt, now) => FL.impl.frame(dt, now) });
    H.interior.push({ name: "plan_flight_cam", fn: (dt, now) => FL.impl.camera(dt, now) });
  }
})();
