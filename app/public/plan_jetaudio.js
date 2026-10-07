// plan_jetaudio.js · R20 FY (7 Oct 2026): jet sound for every jet in the game, procedural WebAudio (no files, no GPU work).
//
// Replaces the propeller drone (audio/plane.mp3, used as the AI traffic and the fly-in exterior loop) and the old cabin loop
// (audio/jet_cabin.mp3) and plan_flight's sawtooth engine:
//   - the CABIN: broadband air and engine rumble centred low (about 60 to 250 Hz), a soft air rush, a faint fan whine aft, a
//     sub-bass pressure hum, slow random variation, the engines spooling (idle on descent, the reverser surge), gear-down
//     thunks and gear rumble, the flap motor whir, the touchdown thump through the floor, braking rumble and the spool-down;
//   - OUTSIDE (R20b, after the user's review): a soft, distant broadband jet rumble centred low (steep low-pass, nothing tonal,
//     no whine), louder aft, gentle Doppler, distance attenuation, gentle wind for a camera moving with the jet, a soft
//     touchdown chirp and thump, reverse thrust and taxi idle as more or less rumble;
//   - CHIMES: the two-tone PA ding-dong, the seatbelt sign bong, the single call ding.
// At most one cabin voice and three positional jet voices exist (the loudest three jets), all built from three shared noise
// buffers, a few oscillators and biquads. Everything stops when nothing is audible. Respects soundOn, VOL.master, VOL.amb
// (engines and mechanisms) and VOL.sfx (chimes are part of the PA: master only). Client globals are read by bare name at call
// time. PLAN mode hooks only (the legacy world keeps its sounds). ?jetaudio=0 turns it off (the R19 sounds come back).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_JETAUDIO = window.PLAN_JETAUDIO || {};
(function () {
  "use strict";
  const JA = window.PLAN_JETAUDIO;
  JA.v = "r20-1"; JA.errs = JA.errs || []; JA.n = { voices: 0, builds: 0, oneShots: 0 }; JA.on = !/[?&]jetaudio=0\b/.test(location.search);
  JA.K = Object.assign({ cabin: 1.0, ext: 0.6, fx: 1.0, chime: 0.55 }, JA.K && JA.K.v === 2 ? JA.K : {}); JA.K.v = 2;
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  function log(tag, e) { try { if (JA.errs.length < 30) JA.errs.push(tag + ": " + (e && e.message ? e.message : String(e))); } catch (x) {} }
  const audible = () => { try { return JA.on && typeof soundOn !== "undefined" && soundOn && typeof audioReady !== "undefined" && audioReady; } catch (e) { return false; } };
  const vol = (k) => { try { return (VOL.master == null ? 1 : VOL.master) * (k == null ? 1 : (VOL[k] == null ? 1 : VOL[k])); } catch (e) { return 1; } };

  // ───────────────────────────── context, buses, noise ─────────────────────────────
  let C = null; const B = {}; const NB = {};
  function ctx() {
    if (C) return C; if (typeof actx !== "function") return null; try { C = actx(); } catch (e) { log("ctx", e); return null; }
    B.comp = C.createDynamicsCompressor(); B.comp.threshold.value = -12; B.comp.knee.value = 10; B.comp.ratio.value = 3.5; B.comp.attack.value = 0.012; B.comp.release.value = 0.3; B.comp.connect(C.destination);
    B.eng = C.createGain(); B.eng.gain.value = 0; B.eng.connect(B.comp); B.fx = C.createGain(); B.fx.gain.value = 0; B.fx.connect(B.comp);
    B.pa = C.createGain(); B.pa.gain.value = 0; B.pa.connect(C.destination);
    const sr = C.sampleRate; const mk = (sec, fn) => { const b = C.createBuffer(1, Math.floor(sr * sec), sr), d = b.getChannelData(0); fn(d); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); for (let i = 0; i < d.length; i++) d[i] /= pk || 1; return b; };
    NB.white = mk(4.1, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    NB.pink = mk(5.3, (d) => { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; } });
    NB.brown = mk(6.1, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l; } });
    // loop seams: fade the last 40 ms into the first so no click repeats
    for (const k in NB) { const d = NB[k].getChannelData(0), n = Math.floor(sr * 0.04); for (let i = 0; i < n; i++) { const a = i / n; d[d.length - n + i] = d[d.length - n + i] * (1 - a) + d[i] * a; } }
    return C;
  }
  JA.ctx = ctx;
  const T = () => C.currentTime;
  function set(p, v, tc) { if (!p) return; if (p._last !== undefined && Math.abs(p._last - v) < Math.max(1e-5, Math.abs(v) * 0.004)) return; p._last = v; try { p.setTargetAtTime(v, T(), tc || 0.08); } catch (e) {} }
  function noiseSrc(buf, rate) { const s = C.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1; s.start(T(), Math.random() * buf.duration * 0.9); return s; }
  function bq(type, f, q, g) { const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (g != null) b.gain.value = g; return b; }
  function gn(v) { const g = C.createGain(); g.gain.value = v || 0; return g; }
  function osc(type, f) { const o = C.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }
  function chain() { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function stopAll(list) { for (const n of list) { try { if (n.stop) n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} } }

  // ───────────────────────────── the cabin voice ─────────────────────────────
  let CAB = null;
  function mkCabin() {
    const o = { nodes: [], out: gn(0) }; o.out.connect(B.eng); const N = (x) => { o.nodes.push(x); return x; };
    // engine and airframe rumble: brown noise shaped round 60 to 250 Hz, a resonance near 95 Hz (the floor and the sidewalls)
    o.r = N(noiseSrc(NB.brown, 1)); o.rLP = N(bq("lowpass", 230, 0.6)); o.rPk = N(bq("peaking", 95, 1.1, 5)); o.rHP = N(bq("highpass", 38, 0.7)); o.rG = N(gn(0)); chain(o.r, o.rHP, o.rLP, o.rPk, o.rG, o.out);
    // air rush over the skin: pink noise, 280 Hz to 1.8 kHz, soft
    o.a = N(noiseSrc(NB.pink, 1)); o.aHP = N(bq("highpass", 280, 0.5)); o.aLP = N(bq("lowpass", 1700, 0.5)); o.aG = N(gn(0)); chain(o.a, o.aHP, o.aLP, o.aG, o.out);
    // the pressure feel: a sub hum
    o.s = N(osc("sine", 41)); o.sG = N(gn(0)); chain(o.s, o.sG, o.out);
    // the fan, far back: two close sines (a slow beat) and a narrow noise band, low passed
    o.w1 = N(osc("sine", 2300)); o.w2 = N(osc("sine", 2306)); o.wN = N(noiseSrc(NB.white, 1)); o.wBP = N(bq("bandpass", 3100, 8)); o.wLP = N(bq("lowpass", 4200, 0.6)); o.wG = N(gn(0)); o.w1.connect(o.wLP); o.w2.connect(o.wLP); chain(o.wN, o.wBP, o.wLP); chain(o.wLP, o.wG, o.out);
    // the N1 drone through the structure
    o.d = N(osc("sine", 110)); o.d2 = N(osc("sine", 165)); o.dLP = N(bq("lowpass", 300, 0.7)); o.dG = N(gn(0)); o.d.connect(o.dLP); o.d2.connect(o.dLP); chain(o.dLP, o.dG, o.out);
    // the wheels: rolling and braking rumble, and the gear in the airflow
    o.w = N(noiseSrc(NB.brown, 1.4)); o.wlLP = N(bq("lowpass", 150, 0.8)); o.wlPk = N(bq("peaking", 48, 1.4, 6)); o.wlG = N(gn(0)); chain(o.w, o.wlLP, o.wlPk, o.wlG, o.out);
    o.g = N(noiseSrc(NB.pink, 0.8)); o.gBP = N(bq("bandpass", 260, 0.7)); o.gG = N(gn(0)); chain(o.g, o.gBP, o.gG, o.out);
    o.ou = 0; o.sp = 0.5; JA.n.builds++; return o;
  }
  // p: { k (0..1 audible), n1 (0..1, spooled), air (m/s), roll (ground speed m/s, 0 in the air), rev (0..1), gear (0..1 down in the airflow), aft (0..1) }
  function cabinFrame(p, dt) {
    if (!CAB) { if (!(p.k > 0.001)) return; CAB = mkCabin(); }
    const o = CAB; const n1 = cl(p.n1, 0, 1), air = cl(p.air || 0, 0, 260), rev = cl(p.rev || 0, 0, 1), aft = cl(p.aft || 0, 0, 1);
    o.ou += (Math.random() * 2 - 1) * dt * 0.9 - o.ou * dt * 0.35; const wob = cl(o.ou, -1, 1);
    const ak = Math.pow(air / 120, 1.15);
    set(o.rG.gain, (0.2 + 0.36 * n1 + 0.32 * rev + 0.08 * ak) * (1 + 0.07 * wob) * (0.85 + 0.3 * aft), 0.25); set(o.rLP.frequency, 170 + 110 * n1 + 90 * rev, 0.4);
    set(o.aG.gain, 0.085 * ak * (1 + 0.05 * wob), 0.3); set(o.aLP.frequency, 1150 + 800 * Math.min(1.4, ak) + 90 * wob, 0.5);
    set(o.sG.gain, 0.05 + 0.05 * n1 + 0.06 * rev, 0.4);
    set(o.w1.frequency, 1750 + 1100 * n1, 1.2); set(o.w2.frequency, 1756 + 1104 * n1, 1.2); set(o.wBP.frequency, 2500 + 1300 * n1, 1.2); set(o.wG.gain, p.cockpit ? 0 : (0.0035 + 0.011 * n1 + 0.006 * rev) * (0.5 + 1.1 * aft), 0.6);
    set(o.d.frequency, 78 + 72 * n1, 1.2); set(o.d2.frequency, 117 + 108 * n1, 1.2); set(o.dG.gain, 0.008 + 0.022 * n1 + 0.02 * rev, 0.5);
    const roll = cl((p.roll || 0) / 45, 0, 1); set(o.wlG.gain, roll > 0 ? (0.08 + 0.42 * roll) * (1 + 0.25 * Math.random()) : 0, 0.12); set(o.w.playbackRate, 0.8 + 0.9 * roll, 0.3);
    set(o.gG.gain, 0.14 * cl(p.gear || 0, 0, 1) * Math.min(1, ak * 1.3), 0.6);
    set(o.out.gain, cl(p.k, 0, 1) * JA.K.cabin, 0.35);
    o.idle = p.k > 0.001 ? 0 : (o.idle || 0) + dt;
  }

  // ───────────────────────────── positional jet voices ─────────────────────────────
  const POOL = []; const MAXV = 3;
  // R20b: outside, every jet is a soft, distant broadband rumble centred low (no fan whine, no buzz-saw, no inlet hiss): two
  // noise layers through steep low-pass filters (24 dB per octave, never above about 1 kHz), so it sits under the music
  function mkExt() {
    const o = { nodes: [], key: null, k: 0 }; const N = (x) => { o.nodes.push(x); return x; };
    o.out = N(gn(0)); o.lp = N(bq("lowpass", 900, 0.5)); o.lp2 = N(bq("lowpass", 900, 0.5)); o.pan = N(C.createStereoPanner ? C.createStereoPanner() : gn(1)); chain(o.out, o.lp, o.lp2, o.pan, B.eng);
    o.r = N(noiseSrc(NB.pink, 1)); o.rLP = N(bq("lowpass", 420, 0.55)); o.rLP2 = N(bq("lowpass", 420, 0.55)); o.rHP = N(bq("highpass", 45, 0.6)); o.rG = N(gn(0)); chain(o.r, o.rHP, o.rLP, o.rLP2, o.rG, o.out);   // the roar, low
    o.b = N(noiseSrc(NB.brown, 1)); o.bLP = N(bq("lowpass", 170, 0.7)); o.bG = N(gn(0)); chain(o.b, o.bLP, o.bG, o.out);                                                                     // the deep rumble
    JA.n.voices++; return o;
  }
  const _d = { x: 0, y: 0, z: 0 };
  // S: { key, p: Vector3, v: Vector3, fwd: Vector3, n1, rev, own }, L: listener { p, v, right }
  function extFrame(o, S, L, k) {
    const dx = S.p.x - L.p.x, dy = S.p.y - L.p.y, dz = S.p.z - L.p.z; const d = Math.max(1, Math.hypot(dx, dy, dz)); _d.x = dx / d; _d.y = dy / d; _d.z = dz / d;
    const vr = cl(-((S.v.x - L.v.x) * _d.x + (S.v.y - L.v.y) * _d.y + (S.v.z - L.v.z) * _d.z), -160, 160); const dop = cl(343 / (343 - vr), 0.8, 1.25);
    const front = -(S.fwd.x * _d.x + S.fwd.y * _d.y + S.fwd.z * _d.z); const bk = Math.max(0, -front);
    const n1 = cl(S.n1, 0, 1), rev = cl(S.rev || 0, 0, 1); const att = (150 / (150 + d)) * 0.75; const ch = S.own ? 1.3 : 1;   // your own jet keeps a little more body
    set(o.lp.frequency, cl(1000 * ch / (1 + d / 400), 260, 1000 * ch), 0.3); set(o.lp2.frequency, cl(1000 * ch / (1 + d / 400), 260, 1000 * ch), 0.3);
    const fc = (300 + 300 * n1 + 150 * rev) * ch; set(o.rLP.frequency, fc, 0.4); set(o.rLP2.frequency, fc, 0.4);
    set(o.rG.gain, (0.12 + 0.5 * n1 * n1 + 0.4 * rev) * (0.75 + 0.35 * bk), 0.4);
    set(o.bG.gain, (0.1 + 0.45 * n1 * n1 + 0.4 * rev) * (0.7 + 0.4 * bk), 0.4);
    set(o.r.playbackRate, dop, 0.3); set(o.b.playbackRate, dop, 0.3);
    try { if (o.pan.pan) set(o.pan.pan, cl((_d.x * L.right.x + _d.y * L.right.y + _d.z * L.right.z) * 0.6, -0.7, 0.7), 0.2); } catch (e) {}
    set(o.out.gain, att * k * JA.K.ext, 0.35);
    return att * (0.2 + n1);
  }
  // gentle wind on a camera that moves with a jet (chase shots, the chase view): low and soft
  let WIND = null;
  function windFrame(speed, k) {
    const want = k * cl((speed - 25) / 120, 0, 1); if (!WIND) { if (want < 0.005) return; WIND = { nodes: [] }; const o = WIND; o.s = noiseSrc(NB.pink, 0.9); o.hp = bq("highpass", 110, 0.5); o.lp = bq("lowpass", 520, 0.5); o.lp2 = bq("lowpass", 700, 0.5); o.g = gn(0); chain(o.s, o.hp, o.lp, o.lp2, o.g, B.eng); o.nodes.push(o.s, o.hp, o.lp, o.lp2, o.g); }
    set(WIND.g.gain, 0.1 * want, 0.8); set(WIND.lp.frequency, 360 + 260 * cl(speed / 140, 0, 1), 1.0); WIND.idle = want < 0.005 ? (WIND.idle || 0) + 1 : 0;
  }

  // ───────────────────────────── one-shots ─────────────────────────────
  function burst(dest, buf, at, dur, fType, f0, f1, q, peak, attack, rate) {
    const s = C.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate || 1; const f = bq(fType, f0, q); const g = gn(0); chain(s, f, g, dest);
    const t = T() + (at || 0); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t, Math.random() * (buf.duration - dur - 0.1)); s.stop(t + dur + 0.05); s.onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) {} }; JA.n.oneShots++;
  }
  function thud(dest, at, f, dur, peak, f1) { const o = C.createOscillator(); o.type = "sine"; const g = gn(0); chain(o, g, dest); const t = T() + (at || 0); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f1 || f * 0.6, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05); o.onended = () => { try { g.disconnect(); } catch (e) {} }; }
  function whir(dest, at, dur, f0, f1, peak) { const o = C.createOscillator(); o.type = "sawtooth"; const bp = bq("bandpass", f0 * 3, 3); const g = gn(0); chain(o, bp, g, dest); const t = T() + (at || 0); o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur * 0.3); o.frequency.linearRampToValueAtTime(f1 * 0.97, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.35); g.gain.setValueAtTime(peak, t + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05); o.onended = () => { try { g.disconnect(); bp.disconnect(); } catch (e) {} }; }
  // a positional one-shot: gain and pan from the listener
  function placed(p) { const L = LS; if (!L.ok || !p) return { g: 0.6, pan: 0 }; const dx = p.x - L.p.x, dy = p.y - L.p.y, dz = p.z - L.p.z, d = Math.max(1, Math.hypot(dx, dy, dz)); return { g: Math.pow(60 / (60 + d), 1.05) * 1.1, pan: cl((dx * L.right.x + dy * L.right.y + dz * L.right.z) / d * 0.6, -0.7, 0.7), lp: cl(1800 / (1 + d / 300), 400, 1800) }; }
  function spot(p) { const q = placed(p); const g = gn(q.g); const lp = bq("lowpass", q.lp || 17000, 0.5); let pn = null; try { pn = C.createStereoPanner(); pn.pan.value = q.pan; chain(g, lp, pn, B.fx); } catch (e) { chain(g, lp, B.fx); } setTimeout(() => { try { g.disconnect(); lp.disconnect(); if (pn) pn.disconnect(); } catch (e) {} }, 4000); return g; }
  const FX = JA.fx = {
    // cabin: the main gear going down (the doors, the uplock, the thump into the locks; the rumble comes from the cabin voice)
    gearDown(inside) { if (!audible() || !ctx()) return; const d = B.fx; thud(d, 0, 95, 0.32, 0.34); burst(d, NB.brown, 0, 0.45, "lowpass", 700, 200, 0.7, 0.42); burst(d, NB.white, 0.05, 0.25, "bandpass", 1800, 900, 2, 0.05);
      whir(d, 0.25, 4.6, 340, 520, 0.022); thud(d, 5.2, 70, 0.4, 0.4); burst(d, NB.brown, 5.2, 0.5, "lowpass", 500, 160, 0.8, 0.5); thud(d, 5.55, 62, 0.35, 0.3); },
    gearUp(inside) { if (!audible() || !ctx()) return; const d = B.fx; whir(d, 0, 5, 320, 500, 0.02); thud(d, 5.0, 80, 0.3, 0.32); burst(d, NB.brown, 5.0, 0.4, "lowpass", 600, 180, 0.8, 0.35); },
    flaps(dur) { if (!audible() || !ctx()) return; whir(B.fx, 0, dur || 3.6, 160, 230, 0.03); burst(B.fx, NB.pink, 0, (dur || 3.6) * 0.9, "bandpass", 700, 760, 4, 0.012, 0.6); },
    // cabin: the mains, then the nose gear, through the floor
    touchdown(k) { if (!audible() || !ctx()) return; k = k == null ? 1 : k; const d = B.fx; thud(d, 0, 58, 0.55, 0.75 * k, 34); thud(d, 0, 31, 0.7, 0.5 * k, 24); burst(d, NB.brown, 0, 0.5, "lowpass", 420, 120, 0.9, 0.7 * k); burst(d, NB.white, 0.01, 0.18, "bandpass", 1500, 900, 1.5, 0.05 * k);
      thud(d, 1.5, 64, 0.4, 0.42 * k, 40); burst(d, NB.brown, 1.5, 0.35, "lowpass", 360, 120, 0.9, 0.35 * k); },
    // outside: the tyre chirp on both main bogies and the thump, at p
    chirp(p, k) { if (!audible() || !ctx()) return; k = (k == null ? 1 : k) * 0.4; const d = spot(p); burst(d, NB.white, 0, 0.14, "bandpass", 1350, 950, 4, 0.3 * k, 0.006); burst(d, NB.white, 0.055, 0.18, "bandpass", 1250, 900, 4, 0.26 * k, 0.006); burst(d, NB.pink, 0.02, 0.9, "lowpass", 600, 300, 0.7, 0.18 * k, 0.01); thud(d, 0, 60, 0.4, 0.6 * k, 38); }
  };
  // chimes: a bell made of a few inharmonic partials; "pa" = the two-tone ding-dong, "belt" = the seatbelt sign bong, "call" = one ding
  function bell(at, f, peak, len) { const t = T() + at; const out = gn(0); const lp = bq("lowpass", 5200, 0.5); chain(out, lp, B.pa); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(peak, t + 0.006); out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const [m, a, dk] of [[1, 1, 1], [2.0, 0.22, 0.55], [2.76, 0.1, 0.4], [4.07, 0.05, 0.25]]) { const o = C.createOscillator(); o.type = "sine"; o.frequency.value = f * m; const g = gn(a); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len * dk); chain(o, g, out); o.start(t); o.stop(t + len + 0.05); }
    setTimeout(() => { try { out.disconnect(); lp.disconnect(); } catch (e) {} }, (at + len + 0.3) * 1000); }
  JA.chime = function (kind) { if (!audible() || !ctx()) return false; const k = JA.K.chime; if (kind === "belt") bell(0, 659.3, 0.42 * k, 2.2); else if (kind === "call") bell(0, 1174.7, 0.36 * k, 1.6); else { bell(0, 987.8, 0.4 * k, 1.9); bell(0.62, 784.0, 0.4 * k, 2.4); } return true; };

  // ───────────────────────────── sources: which jets are sounding ─────────────────────────────
  const LS = { ok: false, p: new THREE.Vector3(), v: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), last: new THREE.Vector3(), has: false };
  function listener(dt) {
    if (typeof camera === "undefined") return; camera.updateMatrixWorld(); const p = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (LS.has && dt > 0) { const jump = p.distanceTo(LS.last); if (jump > 60 * Math.max(dt, 0.016) * 3 || jump > 25) LS.v.set(0, 0, 0); else { const vx = (p.x - LS.last.x) / dt, vy = (p.y - LS.last.y) / dt, vz = (p.z - LS.last.z) / dt; const a = Math.min(1, dt * 6); LS.v.x += (vx - LS.v.x) * a; LS.v.y += (vy - LS.v.y) * a; LS.v.z += (vz - LS.v.z) * a; } }
    LS.last.copy(p); LS.has = true; LS.p.copy(p); LS.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); LS.ok = true;
  }
  const TRK = new Map();   // per source key: last position, velocity, spool, phase
  function track(key, pos, dt, fwdQ, rotY) {
    let t = TRK.get(key); if (!t) { t = { p: pos.clone(), v: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), n1: 0, seen: 0 }; TRK.set(key, t); }
    if (dt > 0) { const vx = (pos.x - t.p.x) / dt, vy = (pos.y - t.p.y) / dt, vz = (pos.z - t.p.z) / dt; if (Math.hypot(vx, vy, vz) < 400) { const a = Math.min(1, dt * 5); t.v.x += (vx - t.v.x) * a; t.v.y += (vy - t.v.y) * a; t.v.z += (vz - t.v.z) * a; } else t.v.set(0, 0, 0); }
    t.p.copy(pos); if (fwdQ) t.fwd.set(0, 0, 1).applyQuaternion(fwdQ); else if (rotY !== undefined) t.fwd.set(Math.sin(rotY), 0, Math.cos(rotY)); t.seen = performance.now(); return t;
  }
  // spool: engines follow the commanded N1 with a lag (faster up than down, like a turbofan)
  function spool(t, want, dt) { const rate = want > t.n1 ? 0.55 : 0.32; t.n1 += (want - t.n1) * Math.min(1, dt * rate * 2.2); return t.n1; }
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
  function trafficN1(j, dt, t) {
    const ph = j.phase; if (t.ph !== ph) { if (t.ph === "approach" && ph === "rollout") { t.tdAt = performance.now(); try { JA.fx.chirp(j.g.position, 0.9); } catch (e) {} } t.ph = ph; t.phAt = performance.now(); }
    const since = (performance.now() - (t.phAt || 0)) / 1000; let want = 0.24, rev = 0;
    if (ph === "approach") want = 0.42; else if (ph === "takeoff") want = j.speed > 3 ? 0.97 : 0.5; else if (ph === "rollout") { if (since < 7 && j.speed > 25) { want = 0.72; rev = cl(1 - since / 7, 0, 1) * cl((since - 0.8) / 0.6, 0, 1); } else want = 0.22; }
    else if (ph === "gate") { want = since < 12 ? 0.22 : (j.timer !== undefined && j.timer < 14 ? 0.22 : 0); }
    t.rev = rev; return spool(t, want, dt);
  }
  function sources(dt) {
    const out = [];
    try { if (typeof TRAFFIC !== "undefined" && TRAFFIC.jets) for (const j of TRAFFIC.jets) { if (!j.g) continue; const key = "ai:" + (j.id || j.g.id); const t = track(key, j.g.position, dt, null, j.g.rotation.y); const n1 = trafficN1(j, dt, t); if (n1 < 0.02) continue; out.push({ key, p: t.p, v: t.v, fwd: t.fwd, n1, rev: t.rev || 0 }); } } catch (e) { log("traffic", e); }
    try { if (typeof view !== "undefined" && view && view.vehicles && typeof VEH !== "undefined") for (const [id, v] of Object.entries(view.vehicles)) { const V = VEH[id]; if (!V || V.kind !== "jet" || !V.g) continue; if (JA.pilot && JA.pilot.id === id && JA.pilot.view === 1) continue;
        const key = "veh:" + id; V.g.getWorldPosition(_p); V.g.getWorldQuaternion(_q); const t = track(key, _p, dt, _q); const sp = t.v.length(); let want;
        if (JA.pilot && JA.pilot.id === id) { want = JA.pilot.n1; t.rev = JA.pilot.rev || 0; t.own = true; } else { const driven = !!v.driver; const air = (v.y || 0) > 2; want = air ? 0.5 + cl(t.v.y / 20, -0.15, 0.4) : sp > 1.5 ? 0.24 + cl(sp / 70, 0, 0.6) : driven ? 0.2 : 0; t.rev = 0; }
        const n1 = spool(t, want, dt); if (n1 < 0.02) continue; out.push({ key, p: t.p, v: t.v, fwd: t.fwd, n1, rev: t.rev || 0, own: !!t.own }); } } catch (e) { log("vehicles", e); }
    try { const F = window.FLYIN; if (F && F.active && F.eng && F.eng.ext && typeof FLY !== "undefined" && FLY.jet) { FLY.jet.getWorldPosition(_p); const t = track("hero", _p, dt, F.jetQ || FLY.jet.quaternion); out.push({ key: "hero", p: t.p, v: t.v, fwd: t.fwd, n1: F.eng.n1, rev: F.eng.rev || 0, k: F.eng.extK == null ? 1 : F.eng.extK }); } } catch (e) { log("hero", e); }
    const now = performance.now(); for (const [k, t] of TRK) if (now - t.seen > 5000) TRK.delete(k);
    return out;
  }

  // ───────────────────────────── per frame ─────────────────────────────
  let idle = 0; JA.state = { cabin: 0, ext: 0 };
  function frame(dt) {
    if (!JA.on) return; dt = Math.min(0.1, Math.max(0, dt || 0.016));
    const aud = audible(); stubClient();
    if (!aud) { if (C) { set(B.eng.gain, 0, 0.05); set(B.fx.gain, 0, 0.05); set(B.pa.gain, 0, 0.05); } idle += dt; if (idle > 2) shutdown(); return; }
    if (!ctx()) return; set(B.eng.gain, vol("amb"), 0.2); set(B.fx.gain, vol("amb"), 0.2); set(B.pa.gain, vol(null), 0.2);
    listener(dt);
    // the cabin voice: the fly-in aboard, a passenger or pilot in the cockpit view of a flying jet
    let cab = null; const F = window.FLYIN;
    if (F && F.active && F.eng && F.eng.cab) cab = F.eng.cab;
    else if (JA.pilot && JA.pilot.view === 1 && JA.pilot.live) cab = { k: 1, n1: JA.pilot.n1, air: JA.pilot.V, roll: JA.pilot.ground ? JA.pilot.V : 0, rev: JA.pilot.rev || 0, gear: JA.pilot.gear || 0, aft: 0, cockpit: true };
    else { try { if (typeof riding !== "undefined" && riding && riding.kind === "jet" && !(JA.pilot && JA.pilot.live)) { const sp = Math.abs(typeof vSpeed !== "undefined" ? vSpeed : 0); cab = { k: 0.9, n1: 0.25 + cl(sp / 90, 0, 0.6), air: sp, roll: 0, aft: 0.3 }; } } catch (e) {} }
    cabinFrame(cab || { k: 0 }, dt); JA.state.cabin = cab ? cab.k : 0;
    // positional voices: the loudest jets
    const L = LS; const src = sources(dt); for (const s of src) { const d = Math.max(1, Math.hypot(s.p.x - L.p.x, s.p.y - L.p.y, s.p.z - L.p.z)); s.score = Math.pow(120 / (120 + d), 1.0) * (0.25 + s.n1 + s.rev) * (s.k == null ? 1 : s.k); if (POOL.some((o) => o.key === s.key)) s.score *= 1.25; }
    src.sort((a, b) => b.score - a.score); const pick = src.filter((s) => s.score > 0.0015).slice(0, MAXV);
    for (const o of POOL) if (!pick.some((s) => s.key === o.key)) { o.key = null; set(o.out.gain, 0, 0.25); o.free = (o.free || 0) + dt; }
    for (const s of pick) { let o = POOL.find((q) => q.key === s.key); if (!o) { o = POOL.find((q) => !q.key && (q.free || 0) > 0.35); if (!o && POOL.length < MAXV) { o = mkExt(); POOL.push(o); } if (!o) continue; o.key = s.key; o.free = 0; }
      extFrame(o, s, L, (s.k == null ? 1 : s.k) * (cab && cab.cockpit ? 0.35 : 1)); }
    for (let i = POOL.length - 1; i >= 0; i--) if (!POOL[i].key && POOL[i].free > 3) { stopAll(POOL[i].nodes); POOL.splice(i, 1); }
    // wind for a camera riding with a jet
    let windK = 0; if (F && F.active && F.eng && F.eng.ext) windK = F.eng.windK == null ? 1 : F.eng.windK; else if (JA.pilot && JA.pilot.live && JA.pilot.view === 0) windK = 0.7;
    windFrame(L.v.length(), windK); if (WIND && WIND.idle > 200) { stopAll(WIND.nodes); WIND = null; }
    if (CAB && CAB.idle > 3) { stopAll(CAB.nodes); CAB = null; }
    JA.state.ext = pick.length; idle = cab || pick.length ? 0 : idle + dt; if (JA.pilot && performance.now() - (JA.pilot.at || 0) > 600) JA.pilot.live = false;
  }
  function shutdown() { if (CAB) { stopAll(CAB.nodes); CAB = null; } while (POOL.length) stopAll(POOL.pop().nodes); if (WIND) { stopAll(WIND.nodes); WIND = null; } }
  JA.shutdown = shutdown; JA.frame = frame;

  // ───────────────────────────── the flown jet (plan_flight.js calls this from its engine sound) ─────────────────────────────
  JA.flight = function (s, viewMode) {
    try { if (!s) { if (JA.pilot) JA.pilot.live = false; return true; } const id = typeof riding !== "undefined" && riding ? riding.id : null; const P = JA.pilot || (JA.pilot = {});
      const gear = s.gearPos == null ? 1 : s.gearPos; if (P.id === id && P.live) { if (!P.ground && s.onGround && s.V > 20) { FX.touchdown(viewMode === 1 ? 1 : 0.5); if (viewMode !== 1) { try { FX.chirp(s.P, 1); } catch (e) {} } }
        if (P.gearT !== undefined && s.gear !== P.gearT) { if (viewMode === 1) { if (s.gear) FX.gearDown(true); else FX.gearUp(true); } } if (P.flapT !== undefined && s.flaps !== P.flapT && viewMode === 1) FX.flaps(3.2); }
      Object.assign(P, { id, live: true, at: performance.now(), n1: cl(s.N == null ? 0.3 : s.N, 0, 1), V: s.V || 0, ground: !!s.onGround, gear: s.onGround ? 0 : gear, gearT: s.gear, flapT: s.flaps, view: viewMode === 1 ? 1 : 0, rev: 0 }); return true; } catch (e) { log("flight", e); return false; }
  };

  // ───────────────────────────── the client's old loops: silent stand-ins ─────────────────────────────
  // AUD.traffic (plane.mp3, a propeller) carried the AI jets and the fly-in exterior; AUD.jetCabin the cabin. Both become silent
  // objects with the HTMLAudioElement surface the client touches (volume, paused, play, pause, playbackRate, dataset), so no
  // propeller sound is left on any jet. AUD.plane is preloaded but never played; it is stubbed too.
  function stub(vol) { return { volume: 0, paused: true, playbackRate: 1, loop: true, currentTime: 0, dataset: { vol: vol }, play() { return Promise.resolve(); }, pause() {}, cloneNode() { return stub(vol); }, fyStub: true }; }
  function stubClient() { if (JA.stubbed) return; try { if (typeof AUD === "undefined") return; for (const k of ["traffic", "jetCabin", "plane"]) { const a = AUD[k]; if (a && !a.fyStub) { try { a.pause(); a.src = ""; } catch (e) {} AUD[k] = stub(a.dataset ? a.dataset.vol : 0.5); } } JA.stubbed = true; } catch (e) { log("stub", e); } }
  JA.stubClient = stubClient;

  // ───────────────────────────── capture (tests and the handoff video): the whole mix to a MediaStream ─────────────────────────────
  // JA.tapStart() routes the engines, the one-shots, the chimes and (from then on) the PA voice and the cabin music through a
  // MediaStreamDestination as well as the speakers; JA.tapStream() is that stream. Not used in play.
  let TAP = null; JA.tapStart = function () { if (!ctx()) return null; if (TAP) return TAP; const d = C.createMediaStreamDestination(); B.comp.connect(d); B.pa.connect(d); TAP = JA.recTap = d;
    JA.tapEl = function (el) { try { if (!el || el.__fyTap) return; const src = C.createMediaElementSource(el); src.connect(C.destination); src.connect(d); el.__fyTap = src; } catch (e) { log("tap", e); } };
    try { if (typeof AUD !== "undefined" && AUD.cabinMusic && !AUD.cabinMusic.fyStub) JA.tapEl(AUD.cabinMusic); } catch (e) {} try { if (typeof RADIO !== "undefined" && RADIO.a) JA.tapEl(RADIO.a); } catch (e) {} return d; };
  JA.tapJet = function () { if (!ctx()) return null; const d = C.createMediaStreamDestination(); B.comp.connect(d); return d; };   // the jet bus alone (engines, one-shots), for analysis
  JA.tapStream = function () { return TAP ? TAP.stream : null; };

  if (!JA.hooked && JA.on) { JA.hooked = true; window.PLAN_HOOKS.frame.push({ name: "jetAudio", fn: function (dt) { try { JA.frame(dt); } catch (e) { log("frame", e); } } }); }
})();
