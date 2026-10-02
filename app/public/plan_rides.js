// plan_rides.js: the Outpost Rovers and the Stagecoach (master plan round 2, builder R).
// Loaded before client.js. Classic script: nothing is declared at top level; everything runs from PLAN_HOOKS in PLAN mode and
// reaches the client's globals by bare name at call time.
//   world  (runs first): the two routes are built from the plan's roads and walks; wherever a route leaves the drawn walks and
//          roads it gets its own lane ribbon (red gravel for the rovers, packed dirt for the coach), so the modules that place
//          things after it keep off the lanes and nothing ever drives over bare kerbs
//   defer  the vehicles (rover, stagecoach and its four-horse team), the drivers, the harness, the stop posts and boards
//   frame  the timetable (a pure function of the clock, so every visitor sees the same rover in the same place), the poses on
//          the drawn surface, wheels, horses, lamps, boards and the E prompt
//   interior  the rider's seat (placed just before the camera, every frame)
// State for testing: window.PLAN_RIDES (lines, vehicles, stops, the ride, conflicts, errors, debug helpers).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var NEEDS = window.PLAN_MODEL_NEEDS = window.PLAN_MODEL_NEEDS || [];
  ["rover", "stagecoach"].forEach(function (k) { if (NEEDS.indexOf(k) < 0) NEEDS.push(k); });
  var PR = window.PLAN_RIDES = { lines: [], err: [], n: {}, ride: null, built: false, conflicts: [], ribbons: [], debug: {} };
  function note(where, e) { var m = where + ": " + ((e && e.message) || e); if (PR.err.length < 40) PR.err.push(m); if (PR.err.length < 10) console.warn("plan_rides " + m, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""); }
  function safe(name, fn) { try { fn(); } catch (e) { note(name, e); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function unit(a, b) { var dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9; return [dx / L, dz / L, L]; }
  function wrapA(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function rad(d) { return d * Math.PI / 180; }
  function nowS() { return Date.now() / 1000; }
  function el(id) { return document.getElementById(id); }

  // ─────────────────────────────── model facts (measured from the installed meshes, metres at scale 1, front +Z) ───────────────────────────────
  var ROVER = { kind: "rover", hw: 1.28, len: 5.0, h: 2.45, axF: 1.74, axR: -2.0, track: 2.2,
    wheels: [[-1.998, 0.515, 0.515, 0.9, 1.32, 0], [-0.197, 0.515, 0.515, 0.9, 1.32, 0], [1.74, 0.52, 0.52, 0.9, 1.32, 0]],   // z, y, r, |x| from, |x| to, steers
    seat: { top: 1.36, back: -0.30, pilot: 0.27, rider: -0.27 }, rear: { top: 1.30, back: -1.80 },
    wheelRel: [-0.05, 0.40, 1.12], wheelR: 0.17, lamps: [[0.62, 1.35, 2.49], [0, 1.36, 2.51], [-0.62, 1.35, 2.49]] };
  var COACH = { kind: "stagecoach", hw: 1.2, len: 6.0, h: 3.25, axF: 0.393, axR: -1.912, trackF: 1.7, trackR: 1.9,
    wheels: [[-1.912, 0.826, 0.826, 0.86, 1.24, 0], [0.393, 0.585, 0.585, 0.74, 1.14, 1]],
    seat: { top: 2.55, back: 0.16, driver: 0.30, rider: -0.30 }, poleTip: [0, 0.93, 2.95],
    reinsRel: [0, 0.26, 0.55], reinsR: 0.13, lamps: [[1.02, 2.12, 0.62], [-1.02, 2.12, 0.62]], rockPivot: [1.3, -0.75] };
  var HORSE = { sc: 0.78, wheelers: 2.75, leaders: 5.55, lat: 0.45, fore: 0.36, hind: -1.25, collar: [0, 1.84, 0.52], hook: [0.31, 1.62, 0.64], bit: [0, 1.95, 1.6] };

  // ─────────────────────────────── route geometry ───────────────────────────────
  function planPts(id) { try { var r = PLAN_IDX.road.get(id) || PLAN_IDX.prom.get(id); return r && r.pts ? r.pts : null; } catch (e) { return null; } }
  // the part of a plan polyline between the points nearest a and b, in that order
  function segPiece(id, a, b) {
    var pts = planPts(id); if (!pts) throw new Error("no plan line " + id);
    var cum = [0]; for (var i = 0; i < pts.length - 1; i++) cum.push(cum[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    function proj(p) { var best = null; for (var i = 0; i < pts.length - 1; i++) { var ax = pts[i][0], az = pts[i][1], vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az, L = Math.hypot(vx, vz) || 1e-9; var t = clamp(((p[0] - ax) * vx + (p[1] - az) * vz) / L, 0, L); var d = Math.hypot(p[0] - ax - vx / L * t, p[1] - az - vz / L * t); if (!best || d < best[0]) best = [d, cum[i] + t]; } return best[1]; }
    function at(s) { for (var i = 0; i < pts.length - 1; i++) if (s <= cum[i + 1] || i === pts.length - 2) { var k = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1e-9); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; } }
    var s0 = proj(a), s1 = proj(b), out = [at(s0)];
    if (s1 >= s0) { for (var j = 1; j < pts.length - 1; j++) if (cum[j] > s0 && cum[j] < s1) out.push([pts[j][0], pts[j][1]]); }
    else { for (var k = pts.length - 2; k > 0; k--) if (cum[k] < s0 && cum[k] > s1) out.push([pts[k][0], pts[k][1]]); }
    out.push(at(s1)); return out;
  }
  // offset a polyline to the right of travel (right of heading (ux, uz) is (-uz, ux) in x-east / z-south)
  function offsetPL(pl, lat) {
    if (!lat) return pl.map(function (p) { return [p[0], p[1]]; }); var out = [];
    for (var i = 0; i < pl.length; i++) { var nx, nz;
      if (i === 0 || i === pl.length - 1) { var u = i === 0 ? unit(pl[0], pl[1]) : unit(pl[i - 1], pl[i]); nx = -u[1]; nz = u[0]; }
      else { var a = unit(pl[i - 1], pl[i]), b = unit(pl[i], pl[i + 1]); var mx = -a[1] - b[1], mz = a[0] + b[0], L = Math.hypot(mx, mz) || 1e-9; mx /= L; mz /= L; var c = Math.max(0.3, mx * -a[1] + mz * a[0]); nx = mx / c; nz = mz / c; }
      out.push([pl[i][0] + nx * lat, pl[i][1] + nz * lat]); }
    return out;
  }
  function lineX(p1, p2, q1, q2) { var d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], d2x = q2[0] - q1[0], d2z = q2[1] - q1[1], den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-6) return null; var t = ((q1[0] - p1[0]) * d2z - (q1[1] - p1[1]) * d2x) / den; return [p1[0] + d1x * t, p1[1] + d1z * t]; }
  // pieces: { pts, lat, R (fillet radius at its corners), join (false: explicit geometry, no lane-line intersection), v (speed) }
  function buildWaypoints(pieces) {
    var offs = pieces.map(function (pc) { return { p: offsetPL(pc.pts, pc.lat || 0), R: pc.R || 8, jx: pc.join !== false, v: pc.v || 3 }; });
    var W = [], n = offs.length;
    for (var k = 0; k < n; k++) { var o = offs[k], pts = o.p.map(function (p) { return [p[0], p[1]]; });
      var pv = offs[(k - 1 + n) % n], nx = offs[(k + 1) % n];
      if (o.jx && pv.jx) { var X = lineX(pv.p[pv.p.length - 2], pv.p[pv.p.length - 1], pts[0], pts[1]); if (X && Math.hypot(X[0] - pts[0][0], X[1] - pts[0][1]) < 40) pts[0] = X; }
      if (o.jx && nx.jx) { var Y = lineX(pts[pts.length - 2], pts[pts.length - 1], nx.p[0], nx.p[1]); if (Y && Math.hypot(Y[0] - pts[pts.length - 1][0], Y[1] - pts[pts.length - 1][1]) < 40) pts[pts.length - 1] = Y; }
      for (var i = 0; i < pts.length; i++) { var q = pts[i]; if (W.length && Math.hypot(W[W.length - 1][0] - q[0], W[W.length - 1][1] - q[1]) < 0.8) continue; W.push([q[0], q[1], o.R, o.v]); } }
    if (Math.hypot(W[0][0] - W[W.length - 1][0], W[0][1] - W[W.length - 1][1]) < 0.8) W.pop();
    return W;
  }
  // a closed loop through the waypoints with a circular fillet at every corner, sampled every `step` metres
  function filletLoop(W, step) {
    var n = W.length, corners = [];
    for (var i = 0; i < n; i++) { var p0 = W[(i - 1 + n) % n], p1 = W[i], p2 = W[(i + 1) % n]; var a = unit(p0, p1), b = unit(p1, p2);
      var cr = a[0] * b[1] - a[1] * b[0], dt = a[0] * b[0] + a[1] * b[1], ang = Math.atan2(cr, dt), R = p1[2];
      if (Math.abs(ang) < 1e-3) { corners.push(null); continue; }
      var t = R * Math.tan(Math.abs(ang) / 2), tmax = Math.min(a[2], b[2]) * 0.49; if (t > tmax) { t = tmax; R = t / Math.tan(Math.abs(ang) / 2); }
      var A = [p1[0] - a[0] * t, p1[1] - a[1] * t], B = [p1[0] + b[0] * t, p1[1] + b[1] * t], s = cr > 0 ? 1 : -1; var C = [A[0] - a[1] * s * R, A[1] + a[0] * s * R];
      corners.push({ A: A, B: B, C: C, R: R, ang: ang, v: Math.min(p1[3], p2[3]) }); }
    var X = [], Z = [], V = [];
    function line(a, b, v) { var u = unit(a, b), k = Math.max(1, Math.round(u[2] / step)); for (var j = 0; j < k; j++) { X.push(a[0] + u[0] * u[2] * j / k); Z.push(a[1] + u[1] * u[2] * j / k); V.push(v); } }
    function arc(c) { var a0 = Math.atan2(c.A[1] - c.C[1], c.A[0] - c.C[0]), L = Math.abs(c.ang) * c.R, k = Math.max(1, Math.round(L / step)); for (var j = 0; j < k; j++) { var th = a0 + c.ang * j / k; X.push(c.C[0] + Math.cos(th) * c.R); Z.push(c.C[1] + Math.sin(th) * c.R); V.push(c.v); } }
    for (var i2 = 0; i2 < n; i2++) { var j2 = (i2 + 1) % n; var st = corners[i2] ? corners[i2].B : [W[i2][0], W[i2][1]], en = corners[j2] ? corners[j2].A : [W[j2][0], W[j2][1]]; line(st, en, W[i2][3]); if (corners[j2]) arc(corners[j2]); }
    return { X: X, Z: Z, V: V };
  }
  function circ(c, r, a0, a1, n) { var out = []; for (var i = 0; i < n; i++) { var a = rad(a0 + (a1 - a0) * i / (n - 1)); out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return out; }

  // ─────────────────────────────── the two lines ───────────────────────────────
  // The Outpost Rovers: the Outpost Gate turning loop, down the Launch Walk (the Countdown) past Launch Plaza, once round the
  // Genesis Ring, the Ring Link south to the Rover Trail and the Stratos Field loop, back round the east side of the Ring and up
  // the Launch Walk. Beyond Ridge Road nothing drives but rovers.
  function roverLine() {
    var p = planPts("hl5_launch_walk") || [[886.2, 606.6], [932.2, 702.1], [995, 832.5]]; var a = p[0], b = p[p.length - 1];
    var U = unit(a, b), nR = [-U[1], U[0]]; function LW(d, lat) { return [a[0] + U[0] * d + nR[0] * lat, a[1] + U[1] * d + nR[1] * lat]; }
    var q = null; try { q = planPlace("genesis_ring"); } catch (e) {} var C = q ? [q.x, q.z] : b, RR = 34.5, phiNW = Math.atan2(-U[1], -U[0]) * 180 / Math.PI;
    var T = LW(13, 0), RT = 5.9, phiNE = Math.atan2(-nR[1], -nR[0]) * 180 / Math.PI;
    var tr = planPts("rover_tr"), S0 = [952, 976], RS = 7;
    var tz = function (x) { if (!tr) return 974; var A = tr[tr.length - 2], B = tr[tr.length - 1]; return A[1] + (B[1] - A[1]) * (x - A[0]) / (B[0] - A[0]); };
    var se = [[24, 3.4], [88, 3.4], [97, 5.6], [115, 5.6], [124, 3.4], [140, 3.4], [146, 2.0], [156, 2.0], [162, 3.4], [212, 3.4]].map(function (v) { return LW(v[0], v[1]); });
    var nw = [[212, -3.4], [162, -3.4], [156, -2.0], [146, -2.0], [140, -3.4], [124, -3.4], [115, -5.6], [97, -5.6], [88, -3.4], [24, -3.4]].map(function (v) { return LW(v[0], v[1]); });
    var yLink = C[1] + RR + 6, xL = C[0] - 1.5, xR = C[0] + 1.5;
    var pieces = [
      { pts: se, R: 8, join: false, v: 2.6 },
      { pts: circ(C, RR, phiNW - 20, -250, 12), R: 12, join: false, v: 2.4 },                      // the Ring, west half (the Ring on the left)
      { pts: [[xL, yLink], [xL, tz(xL) - 1.5]], R: 8, join: false, v: 4.0 },                         // the Ring Link south
      { pts: [[986, tz(986) - 1.5], [963, tz(963) - 1.5]], R: 7, join: false, v: 3.2 },              // the Stratos spur west (north lane)
      { pts: circ(S0, RS, -90, -275, 10), R: 6, join: false, v: 2.4 },                               // the Stratos Field loop
      { pts: [[963, tz(963) + 1.5], [986, tz(986) + 1.5]], R: 7, join: false, v: 3.2 },              // the Stratos spur east (south lane)
      { pts: [[xR, tz(xR) + 1.5], [xR, yLink]], R: 8, join: false, v: 4.0 },                         // the Ring Link north
      { pts: circ(C, RR, 70, phiNW + 20, 16), R: 12, join: false, v: 2.4 },                          // the Ring, east half
      { pts: nw, R: 8, join: false, v: 2.6 },
      { pts: circ(T, RT, phiNE, phiNE - 180, 8), R: 6, join: false, v: 1.8 }                          // the Outpost Gate turning loop
    ];
    var stops = [
      { id: "og", name: "Outpost Gate", at: LW(34, 3.4), post: LW(36, 6.3), side: 1 },
      { id: "lp1", name: "Launch Plaza", at: LW(86, 3.4), post: LW(87, 6.3), side: 1 },
      { id: "ring1", name: "The Genesis Ring", at: LW(204, 3.4), post: LW(205, 6.3), side: 1 },
      { id: "stratos", name: "Stratos Field", at: [S0[0] - RS, S0[1]], post: [S0[0] - RS - 2.9, S0[1] + 1], side: 1 },
      { id: "ring2", name: "The Genesis Ring", at: LW(204, -3.4), post: LW(203, -6.3), side: 1 },
      { id: "lp2", name: "Launch Plaza", at: LW(128, -3.4), post: LW(127, -6.3), side: 1 }
    ];
    // two-lane pieces laid as one wide surface first (the lane runs then see them as drawn)
    var surf = [{ id: "r2_ring_link", pts: [[C[0], C[1] + RR - 1], [C[0], tz(C[0]) + 0.5]], w: 7.2 }, { id: "r2_stratos_spur", pts: [[990, tz(990)], [958, tz(958)]], w: 7.6 }];
    return { id: "rover", name: "Outpost Rover", title: "OUTPOST ROVER", kind: "rover", M: ROVER, pieces: pieces, stops: stops, surf: surf, n: 2, dwell: 16, acc: 0.55, dec: 0.7, lat: 0.9, laneW: 4.4, laneMat: "redg",
      blurb: "Electric rovers loop The Outpost at walking pace: the Outpost Gate, down the Countdown to Launch Plaza, once round the Genesis Ring and out to Stratos Field. Beyond Ridge Road nothing drives but rovers." };
  }
  // The Stagecoach: Main Street from the Expanse Gate to Four Corners, Corral Road, the Stage Road north past the Stagecoach Stop,
  // Ranch Drive to the Frontier Ranch yard, back through the coach bay at the Stagecoach Stop and along the 1928 Strip to the Gate.
  function coachLine() {
    var ms = planPts("hl3_main_street") || [[613.5, 40.3], [821.8, 472.8]], a = ms[0], U = unit(ms[0], ms[ms.length - 1]), nR = [-U[1], U[0]];
    function MS(d, lat) { return [a[0] + U[0] * d + nR[0] * lat, a[1] + U[1] * d + nR[1] * lat]; }
    var fc = [667.7, 152.9]; try { var f = planPlace("four_corners"); if (f) fc = [f.x, f.z]; } catch (e) {}
    var rd = planPts("ranch_drive"), end = rd ? rd[rd.length - 1] : [965, -10], ud = rd ? unit(rd[rd.length - 2], end) : unit([930, 20], [965, -10]);
    var D0 = [end[0] - ud[0] * 12, end[1] - ud[1] * 12], Y = [end[0] + 14.5, end[1] + 14.5], RB = 9.5;
    var sr = planPts("stage_rd"), jn = sr ? sr[3] : [868, 40];   // the Stage Road / Ranch Drive junction
    var dFC = (fc[0] - a[0]) * U[0] + (fc[1] - a[1]) * U[1];
    var pieces = [
      { pts: [MS(30, 0), MS(dFC, 0)], lat: 0.8, R: 15, v: 2.2 },                                     // Main Street (near the crown, clear of the tree canopies), from the Gate turn
      { pts: segPiece("corral_rd", fc, [930, 205]), lat: 3.0, R: 12, v: 4.0 },                       // Corral Road east
      { pts: segPiece("stage_rd", [930, 205], jn), lat: 2.0, R: 11, v: 3.8 },                        // the Stage Road north
      { pts: segPiece("ranch_drive", jn, D0), lat: 1.8, R: 10, v: 3.2 },                             // Ranch Drive
      { pts: circ(Y, RB, 143, -74, 12), R: 9, join: false, v: 2.2 },                                 // round the ranch yard, the island on the left
      { pts: segPiece("ranch_drive", D0, jn), lat: 1.8, R: 9, v: 3.2 },                              // Ranch Drive back
      { pts: [[jn[0] + 8, jn[1] - 4.2], [jn[0] + 0.5, jn[1] + 4.2]], R: 6, join: false, v: 2.0 },    // the bend into the coach bay
      { pts: [[jn[0] - 6, jn[1] + 5], [jn[0] - 22, jn[1] + 5]], R: 10, join: false, v: 1.8 },        // through the Stagecoach Stop, north of the trough
      { pts: segPiece("heritage_strip_p", [840, 55], [613.5, 40.3]), lat: 3.0, R: 14, v: 2.4 }       // the 1928 Strip west
    ];
    var stops = [
      { id: "gate", name: "Expanse Gate", at: MS(40, 0.8), post: MS(37, 7.7), side: 1, pull: 1.4 },
      { id: "four", name: "Four Corners", at: MS(dFC - 35, 0.8), post: MS(dFC - 38, 7.7), side: 1, pull: 1.4 },
      { id: "ranch", name: "Frontier Ranch", at: [Y[0] - 1, Y[1] - RB - 0.2], post: [Y[0] - 3.5, Y[1] - RB - 3.1], side: 1 },
      { id: "stop", name: "Stagecoach Stop", at: [jn[0] - 13, jn[1] + 5], post: [jn[0] - 17, jn[1] + 2.3], side: 1 }
    ];
    return { id: "coach", name: "Stagecoach", title: "STAGECOACH", kind: "stagecoach", M: COACH, pieces: pieces, stops: stops, surf: [], n: 2, dwell: 18, acc: 0.45, dec: 0.6, lat: 0.6, laneW: 5.4, laneMat: "dirt", yard: { c: Y, r: RB },
      blurb: "A Concord coach and a four-horse team: down Main Street to Four Corners, out along Corral Road and the Stage Road to the Frontier Ranch, and home along the 1928 Strip to the Expanse Gate." };
  }

  // sample the loop: X, Z, S (cumulative), heading, curvature, speed caps
  function sampleLine(L) {
    var W = buildWaypoints(L.pieces), f = filletLoop(W, 0.5), N = f.X.length;
    var X = new Float64Array(N), Z = new Float64Array(N), S = new Float64Array(N + 1), Hd = new Float32Array(N), K = new Float32Array(N), V = new Float32Array(N);
    for (var i = 0; i < N; i++) { X[i] = f.X[i]; Z[i] = f.Z[i]; V[i] = f.V[i]; }
    for (var j = 0; j < N; j++) { var k = (j + 1) % N; S[j + 1] = S[j] + Math.hypot(X[k] - X[j], Z[k] - Z[j]); }
    for (var h = 0; h < N; h++) { var p = (h - 2 + N) % N, q = (h + 2) % N; Hd[h] = Math.atan2(X[q] - X[p], Z[q] - Z[p]); }
    for (var c = 0; c < N; c++) { var p2 = (c - 3 + N) % N, q2 = (c + 3) % N; var sA = S[p2] - (p2 > c ? S[N] : 0), sB = S[q2] + (q2 < c ? S[N] : 0); K[c] = wrapA(Hd[q2] - Hd[p2]) / Math.max(0.5, sB - sA); }
    L.P = { X: X, Z: Z, S: S, Hd: Hd, K: K, V: V, N: N, L: S[N], W: W, sh: new Float32Array(N) };
    // stops: the nearest sample to each stop point
    for (var s = 0; s < L.stops.length; s++) { var st = L.stops[s], bi = 0, bd = 1e9; for (var m = 0; m < N; m++) { var dd = (X[m] - st.at[0]) * (X[m] - st.at[0]) + (Z[m] - st.at[1]) * (Z[m] - st.at[1]); if (dd < bd) { bd = dd; bi = m; } } st.i = bi; st.s = S[bi]; st.off = Math.sqrt(bd); }
    L.stops.sort(function (a, b) { return a.s - b.s; });
    return L.P;
  }
  // position on the loop at arc length s (with the lateral shift profile): [x, z, heading]
  function pathAt(P, s) { var Lt = P.L; s = ((s % Lt) + Lt) % Lt; var lo = 0, hi = P.N; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P.S[mid] <= s) lo = mid; else hi = mid; }
    var i = lo, j = (i + 1) % P.N, k = (s - P.S[i]) / ((P.S[i + 1] - P.S[i]) || 1e-9); var h = P.Hd[i] + wrapA(P.Hd[j] - P.Hd[i]) * k; var sh = P.sh[i] + (P.sh[j] - P.sh[i]) * k;
    var x = P.X[i] + (P.X[j] - P.X[i]) * k, z = P.Z[i] + (P.Z[j] - P.Z[i]) * k; var c = Math.cos(h), sn = Math.sin(h); return [x - c * sh, z + sn * sh, h]; }
  // right-of-travel normal for heading h is (-cos h, sin h)

  // ─────────────────────────────── the drawn surface under the lanes ───────────────────────────────
  var RIDX = null;
  function ribbonIndex() { RIDX = new Map(); var C = 40; ROADS.forEach(function (r) { if (!r || !r.pts || !r.w) return; var p = r.pts; for (var i = 0; i < p.length - 1; i++) { var x0 = Math.min(p[i][0], p[i + 1][0]) - r.w, x1 = Math.max(p[i][0], p[i + 1][0]) + r.w, z0 = Math.min(p[i][1], p[i + 1][1]) - r.w, z1 = Math.max(p[i][1], p[i + 1][1]) + r.w; for (var cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) for (var cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) { var k = cx * 100003 + cz, a = RIDX.get(k); if (!a) RIDX.set(k, a = []); a.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], r.w / 2, r.lift || 0, i === 0, i === p.length - 2]); } } }); }
  // the lift of the ribbon under (x, z) (at least `inset` inside its edge), or null
  function ribbonAt(x, z, inset) { var a = RIDX.get(Math.floor(x / 40) * 100003 + Math.floor(z / 40)); if (!a) return null; var best = null;
    for (var i = 0; i < a.length; i++) { var q = a[i], vx = q[2] - q[0], vz = q[3] - q[1], L2 = vx * vx + vz * vz || 1e-9, t0 = ((x - q[0]) * vx + (z - q[1]) * vz) / L2;
      // ribbons are drawn with square ends: nothing past the first or last point counts
      var Lq = Math.sqrt(L2), eps = (inset || 0) / Lq; if ((q[6] && t0 < eps) || (q[7] && t0 > 1 - eps)) continue; var t = clamp(t0, 0, 1);
      var d = Math.hypot(x - q[0] - vx * t, z - q[1] - vz * t); if (d <= q[4] - (inset || 0) && (best === null || q[5] > best)) best = q[5]; } return best; }
  function laneSurfaces(L) {
    var P = L.P, mat = L.laneMat === "redg" ? planMats().redg : M.dirt; var hw = L.M.hw + 0.05; var step = 2, n = Math.floor(P.L / step), off = new Uint8Array(n), lifts = new Float32Array(n);
    for (var i = 0; i < n; i++) { var q = pathAt(P, i * step), c = Math.cos(q[2]), s = Math.sin(q[2]); var m = ribbonAt(q[0], q[1], 0.2), l = ribbonAt(q[0] - c * hw, q[1] + s * hw, 0.05), r = ribbonAt(q[0] + c * hw, q[1] - s * hw, 0.05); off[i] = m === null || l === null || r === null ? 1 : 0; lifts[i] = Math.min(m === null ? 9 : m, l === null ? 9 : l, r === null ? 9 : r); }
    var runs = [], i0 = -1; for (var k = 0; k <= n; k++) { var o = k < n && off[k]; if (o && i0 < 0) i0 = k; if (!o && i0 >= 0) { runs.push([i0, k - 1]); i0 = -1; } }
    if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) { var last = runs.pop(); runs[0] = [last[0] - n, runs[0][1]]; }
    // each run meets the drawn walks and roads at its two ends: its surface ramps from the one lift to the other in short
    // pieces (a centimetre under each neighbour), so no wheel or hoof ever meets a kerb where a lane joins a walk
    runs.forEach(function (rn, ri) { var a0 = rn[0] - 2, a1 = rn[1] + 2; var la = lifts[((a0 % n) + n) % n], lb = lifts[((a1 % n) + n) % n];
      if (la >= 9) la = lb < 9 ? lb : 0.23; if (lb >= 9) lb = la; la = Math.max(0.12, la - 0.012); lb = Math.max(0.12, lb - 0.012);
      var cnt = a1 - a0, pieces = Math.abs(la - lb) < 0.02 ? 1 : Math.max(2, Math.min(12, Math.round(Math.abs(la - lb) / 0.012)));
      for (var pc = 0; pc < pieces; pc++) { var k0 = a0 + Math.floor(cnt * pc / pieces), k1 = a0 + Math.ceil(cnt * (pc + 1) / pieces) + (pc < pieces - 1 ? 1 : 0); var lift = pieces === 1 ? Math.min(la, lb) : la + (lb - la) * (pc + 0.5) / pieces;
        var pts = []; for (var k2 = k0; k2 <= k1; k2++) { var q2 = pathAt(P, k2 * step); pts.push([q2[0], q2[1]]); }
        if (pts.length < 2) continue; var id = "r2_" + L.id + "_lane" + ri + (pieces > 1 ? "_" + pc : ""); planRibbon(pts, L.laneW, { mat: mat, lift: lift, tile: L.laneMat === "redg" ? 4 : 6 }, id); PR.ribbons.push({ id: id, n: pts.length, lift: +lift.toFixed(3), from: [+pts[0][0].toFixed(1), +pts[0][1].toFixed(1)] }); } });
  }

  // ─────────────────────────────── the timetable (a pure function of the clock) ───────────────────────────────
  function timetable(L) {
    var P = L.P, N = P.N, cap = new Float32Array(N), v = new Float32Array(N); var isStop = new Uint8Array(N); L.stops.forEach(function (st) { isStop[st.i] = 1; });
    for (var i = 0; i < N; i++) cap[i] = isStop[i] ? 0 : Math.max(0.6, Math.min(P.V[i], Math.sqrt(L.lat / Math.max(Math.abs(P.K[i]), 1e-4))));
    for (var j = 0; j < N; j++) v[j] = cap[j];
    for (var pass = 0; pass < 3; pass++) {
      for (var a = 1; a < 2 * N; a++) { var ii = a % N, pp = (a - 1) % N, ds = P.S[pp + 1] - P.S[pp]; v[ii] = Math.min(v[ii], Math.sqrt(v[pp] * v[pp] + 2 * L.acc * ds)); }
      for (var b = 2 * N - 2; b >= 0; b--) { var i2 = b % N, n2 = (b + 1) % N, ds2 = P.S[i2 + 1] - P.S[i2]; v[i2] = Math.min(v[i2], Math.sqrt(v[n2] * v[n2] + 2 * L.dec * ds2)); } }
    var T = new Float64Array(N + 1), dw = new Float32Array(N); L.stops.forEach(function (st) { dw[st.i] = L.dwell; });
    for (var k = 0; k < N; k++) { var kn = (k + 1) % N, dsk = P.S[k + 1] - P.S[k]; T[k + 1] = T[k] + dw[k] + 2 * dsk / Math.max(0.35, v[k] + v[kn]); }
    L.T = { T: T, v: v, dw: dw, P: T[N] };
  }
  // where a vehicle is at schedule time tau: { s, v, stop (index into L.stops or -1), left (dwell seconds left) }
  function scheduleAt(L, tau) { var T = L.T.T, N = L.P.N; tau = ((tau % L.T.P) + L.T.P) % L.T.P; var lo = 0, hi = N; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (T[mid] <= tau) lo = mid; else hi = mid; }
    var i = lo, dw = L.T.dw[i]; if (dw > 0 && tau < T[i] + dw) { var si = -1; for (var q = 0; q < L.stops.length; q++) if (L.stops[q].i === i) si = q; return { s: L.P.S[i], v: 0, stop: si, left: T[i] + dw - tau }; }
    var t0 = T[i] + dw, t1 = T[i + 1], k = (tau - t0) / Math.max(1e-6, t1 - t0), v0 = L.T.v[i], v1 = L.T.v[(i + 1) % N], ds = L.P.S[i + 1] - L.P.S[i];
    // constant acceleration inside the sample: s = v0 t + a t^2 / 2
    var dt = t1 - t0, acc = dt > 0 ? (v1 - v0) / dt : 0, tt = k * dt, sl = Math.min(ds, v0 * tt + 0.5 * acc * tt * tt);
    return { s: L.P.S[i] + Math.max(0, sl), v: v0 + acc * tt, stop: -1, left: 0 }; }
  // the next stop at or after arc length s
  function nextStop(L, s, after) { var best = null, bd = 1e9; for (var i = 0; i < L.stops.length; i++) { var d = L.stops[i].s - s; if (d < (after ? 0.5 : -0.5)) d += L.P.L; if (d < bd) { bd = d; best = L.stops[i]; } } return { st: best, d: bd }; }
  // seconds until a vehicle of the line is next dwelling at stop st
  function etaAt(L, st) { var best = 1e9; for (var k = 0; k < L.veh.length; k++) { var V = L.veh[k]; if (V.cur && V.cur.stop >= 0 && L.stops[V.cur.stop] === st) return 0; var tNow = ((V.tau % L.T.P) + L.T.P) % L.T.P; var tStop = L.T.T[st.i]; var d = tStop - tNow; if (d < 0) d += L.T.P; d += V.delay * 0.5; if (d < best) best = d; } return best; }

  // ─────────────────────────────── shaders: wheel spin, steering and the horse gait (static meshes, vertex shader) ───────────────────────────────
  var GLSL_ROT = "vec3 prX(vec3 p, vec2 c, float a) { float s = sin(a), co = cos(a); vec2 d = p.yz - c; return vec3(p.x, c.x + co * d.x - s * d.y, c.y + s * d.x + co * d.y); }\n" +
    "vec3 pvX(vec3 v, float a) { float s = sin(a), co = cos(a); return vec3(v.x, co * v.y - s * v.z, s * v.y + co * v.z); }\n" +
    "vec3 prY(vec3 p, float zc, float a) { float s = sin(a), co = cos(a); float dz = p.z - zc; return vec3(co * p.x + s * dz, p.y, zc - s * p.x + co * dz); }\n" +
    "vec3 pvY(vec3 v, float a) { float s = sin(a), co = cos(a); return vec3(co * v.x + s * v.z, v.y, -s * v.x + co * v.z); }\n" +
    "vec3 prZ(vec3 p, vec2 c, float a) { float s = sin(a), co = cos(a); vec2 d = p.xy - c; return vec3(c.x + co * d.x - s * d.y, c.y + s * d.x + co * d.y, p.z); }\n";
  function f3(v) { var s = (+v).toFixed(4); return s.indexOf(".") < 0 ? s + ".0" : s; }
  // wheels: uW.x spin angle per metre of radius 1 (distance), uW.y steer; each wheel spins about its own axle, the steering ones then turn about the axle's centre
  // (the coach body rocks on its thoroughbraces: the running gear is un-rocked here about the same pivot, uW.z, so it stays level)
  function wheelGLSL(M, pole) {
    var unrock = pole ? " p = prX(p, vec2(" + f3(M.rockPivot[0]) + ", " + f3(M.rockPivot[1]) + "), -uW.z); n = pvX(n, -uW.z);" : "";
    var code = "void vehDeform(inout vec3 p, inout vec3 n) { vec3 q = p; float ax = abs(q.x); float st = uW.y;\n";
    // each wheel also rides its own suspension travel (uSL / uSR: the left and right wheels, rear to front), so every tyre meets the surface
    M.wheels.forEach(function (w, wi) { var cmp = "xyz"[wi]; code += " if (ax > " + f3(w[3]) + " && ax < " + f3(w[4]) + ") { vec2 d = q.yz - vec2(" + f3(w[1]) + ", " + f3(w[0]) + "); if (dot(d, d) < " + f3((w[2] + 0.04) * (w[2] + 0.04)) + ") { float a = uW.x / " + f3(w[2]) + "; p = prX(p, vec2(" + f3(w[1]) + ", " + f3(w[0]) + "), a); n = pvX(n, a);" + (w[5] ? " p = prY(p, " + f3(w[0]) + ", st); n = pvY(n, st);" : "") + unrock + " p.y += q.x > 0.0 ? uSL." + cmp + " : uSR." + cmp + "; return; } }\n"; });
    if (pole) code += " if ((q.z > 1.02 && q.y < 1.32 && ax < 0.62) || (q.z > -0.15 && q.z < 0.95 && q.y < 0.9 && ax < 0.78)) { p = prY(p, " + f3(M.axF) + ", st); n = pvY(n, st);" + unrock + " return; }\n";
    if (pole) code += " if (q.y < 0.95 && ax < 0.9) {" + unrock + " }\n";   // the perch and the rear axle
    return code + "}\n";
  }
  function horseGLSL() {
    return "void vehDeform(inout vec3 p, inout vec3 n) { vec3 q = p; float ax = abs(q.x);\n" +
      " bool fr = q.z > 0.02 && q.z < 0.68 && q.y < 1.32 && ax > 0.03; bool hi = q.z > -1.47 && q.z < -0.78 && q.y < 1.44 && ax > 0.09;\n" +
      " if (fr || hi) { float lf = q.x > 0.0 ? 1.0 : 0.0; float oW = fr ? mix(0.75, 0.25, lf) : mix(0.5, 0.0, lf); float oT = fr ? mix(0.5, 0.0, lf) : mix(0.0, 0.5, lf);\n" +
      "  float ph = uG.x + 6.28318 * mix(oW, oT, uG.w); float up = uG.y * sin(ph); float sw = max(0.0, -cos(ph)); float lo = uG.z * sw * sw;\n" +
      "  vec2 hip = fr ? vec2(1.45, 0.33) : vec2(1.55, -1.18); vec2 kn = fr ? vec2(0.56, 0.31) : vec2(0.76, -1.37);\n" +
      "  float wU = fr ? smoothstep(1.30, 1.02, q.y) : smoothstep(1.42, 1.10, q.y); float wL = fr ? smoothstep(0.66, 0.46, q.y) : smoothstep(0.84, 0.62, q.y);\n" +
      "  vec3 p1 = mix(q, prX(q, kn, lo), wL); p = mix(p1, prX(p1, hip, up), wU); n = pvX(n, up * wU + lo * wL); }\n" +
      " if (q.z < -1.40 && ax < 0.18 && q.y < 2.16 && q.y > 0.1) { float w = smoothstep(2.12, 1.1, q.y); p = mix(p, prZ(p, vec2(0.0, 2.1), uH.y), w); }\n" +
      " if (q.z > 0.48 && q.y > 1.42) { float w = smoothstep(0.48, 1.0, q.z) * smoothstep(1.42, 1.85, q.y); p = mix(p, prX(p, vec2(1.8, 0.55), uH.x), w); n = pvX(n, uH.x * w); }\n" +
      "}\n";
  }
  // one hook source per kind (so every material of a kind shares one program); the uniforms are per material
  function deformHook(kind, U) {
    var body = kind === "horse" ? horseGLSL() : kind === "rover" ? wheelGLSL(ROVER, false) : wheelGLSL(COACH, true);
    var decl = kind === "horse" ? "uniform vec4 uG; uniform vec4 uH;\n" : "uniform vec4 uW; uniform vec3 uSL; uniform vec3 uSR;\n";
    var obc = function (sh) { if (kind === "horse") { sh.uniforms.uG = U.uG; sh.uniforms.uH = U.uH; } else { sh.uniforms.uW = U.uW; sh.uniforms.uSL = U.uSL; sh.uniforms.uSR = U.uSR; }
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + decl + GLSL_ROT + body);
      if (sh.vertexShader.indexOf("#include <beginnormal_vertex>") >= 0) sh.vertexShader = sh.vertexShader.replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n{ vec3 pD = position; vehDeform(pD, objectNormal); }\n#ifdef USE_TANGENT\n{ vec3 pT = position; vec3 tT = objectTangent; vehDeform(pT, tT); objectTangent = tT; }\n#endif");
      sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec3 nD = vec3(0.0, 1.0, 0.0); vehDeform(transformed, nD); }"); };
    obc.kindKey = "plan_rides_" + kind; return obc;
  }
  function deformMat(src, kind, U) { var m = src.clone(); m.onBeforeCompile = deformHook(kind, U); var ck = "plan_rides_" + kind + "_v1" + (m.defines && m.defines.USE_CSM ? "_csm" : ""); m.customProgramCacheKey = function () { return ck; }; m.needsUpdate = true; return m; }
  function deformDepth(kind, U) { var m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); m.onBeforeCompile = deformHook(kind, U); m.customProgramCacheKey = function () { return "plan_rides_depth_" + kind; }; return m; }

  // ─────────────────────────────── shared materials and textures ───────────────────────────────
  var MAT = {};
  function mats() { if (MAT.leather) return MAT;
    MAT.leather = new THREE.MeshStandardMaterial({ color: 0x160d07, roughness: 0.85, metalness: 0 });
    MAT.brass = new THREE.MeshStandardMaterial({ color: 0xb58a3a, roughness: 0.35, metalness: 0.85 });
    MAT.timber = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.82 });
    MAT.iron = new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.55, metalness: 0.6 });
    MAT.white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.38, metalness: 0.2 });
    MAT.dark = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.5, metalness: 0.4 });
    MAT.cyan = new THREE.MeshStandardMaterial({ color: 0x0d2a33, emissive: 0x7fe7ff, emissiveIntensity: 0.9, roughness: 0.4 });
    var c = document.createElement("canvas"); c.width = c.height = 64; var x = c.getContext("2d"); var g = x.createRadialGradient(32, 32, 1, 32, 32, 31); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    MAT.glowTex = new THREE.CanvasTexture(c); return MAT; }
  function contactBlob(w, d) { var tex = null; try { tex = blobTexture(); } catch (e) {} var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    if (tex) { m.material.color.set(0xffffff); } m.rotation.x = -Math.PI / 2; m.position.y = 0.04; m.renderOrder = 2; m.userData.noSolid = true; var shadows = false; try { shadows = !!(QUAL.q && QUAL.q.shadow); } catch (e) {} m.visible = !shadows; return m; }
  // concatenate non-indexed position / normal / uv (no dependency on BufferGeometryUtils)
  function mergeSimple(geos) { var P = [], N = [], U = []; geos.forEach(function (g0) { var g = g0.index ? g0.toNonIndexed() : g0; if (!g.attributes.normal) g.computeVertexNormals(); var p = g.attributes.position.array, nn = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null; for (var i = 0; i < p.length; i++) { P.push(p[i]); N.push(nn[i]); } var c = p.length / 3; for (var j = 0; j < c; j++) { U.push(uv ? uv[j * 2] : 0, uv ? uv[j * 2 + 1] : 0); } });
    var out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); out.computeBoundingSphere(); return out; }
  function glowSprite(col, size) { var m = new THREE.SpriteMaterial({ map: mats().glowTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); var s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.userData.noSolid = true; s.renderOrder = 3; return s; }

  // ─────────────────────────────── vehicles ───────────────────────────────
  function meshesOf(kind, U, deformKind, shadow) {
    var m = MODELS[kind]; if (!m) return null; var out = [];
    m.parts.forEach(function (part, i) { var mat = deformKind ? deformMat(part.material, deformKind, U) : part.material; var me = new THREE.Mesh(part.geometry, mat); me.castShadow = shadow !== false && !part.noShadow; me.receiveShadow = true; me.userData.noInst = true; me.userData.fullGeo = part.geometry; me.userData.lodGeo = m.lodGeos ? m.lodGeos[i] || m.lodGeos[m.lodGeos.length - 1] : null; if (deformKind === "horse") me.customDepthMaterial = deformDepth("horse", U); out.push(me); });
    return out;
  }
  function driverFor(L, k) {
    var id = "ride_" + L.id + "_" + k, look, hat, name;
    if (L.id === "coach") { look = { skin: ["c98f63", "e8c19a"][k % 2], shirt: "7a4a2a", pants: "2a2622", hair: (k + 1) % 4 }; hat = "hat_cowboy"; name = "Stagecoach driver"; }
    else { look = { skin: ["8d5a3b", "e8c19a", "a86f46"][k % 3], shirt: "e9ecef", pants: "4b535c", hair: k % 4 }; hat = "hat_cap"; name = "Rover pilot"; }
    var d = avatar(id, name, look, hat, null); d.userData.sit = true; d.userData.driveIK = true; if (d.userData.label) { d.userData.label.scale.multiplyScalar(0.8); d.userData.label.visible = false; }
    return d;
  }
  function seatLocal(g, x, top, back, out) { var f = sitFitOf(g); out = out || new THREE.Vector3(); return out.set(x - f.x, top - f.y + 0.005, back - f.back + 0.025); }
  function buildVehicle(L, k) {
    var M = L.M, V = { L: L, k: k, g: new THREE.Group(), U: { uW: { value: new THREE.Vector4() }, uSL: { value: new THREE.Vector3() }, uSR: { value: new THREE.Vector3() }, uG: null }, dist: 0, delay: 0, fac: 1, tau: 0, cur: null, pose: null, vis: true, near: false, horses: [], lod: false };
    V.g.name = "ride_" + L.id + "_" + k; V.g.userData.noCull = true; V.g.userData.noInst = true;
    V.body = new THREE.Group(); V.g.add(V.body);
    var ms = meshesOf(M.kind, V.U, L.id === "coach" ? "stagecoach" : "rover"); V.meshes = ms || [];
    if (ms) ms.forEach(function (m) { V.body.add(m); }); else { var bx = new THREE.Mesh(new THREE.BoxGeometry(M.hw * 2, M.h * 0.6, M.len), MAT.white); bx.position.y = M.h * 0.35; V.body.add(bx); V.meshes = [bx]; }
    // the driver
    V.drv = driverFor(L, k); V.body.add(V.drv); var dx = L.id === "coach" ? M.seat.driver : M.seat.pilot; seatLocal(V.drv, dx, M.seat.top, M.seat.back, V.drv.position);
    // lamps (night)
    V.glows = M.lamps.map(function (p) { var s = glowSprite(L.id === "coach" ? 0xffc27a : 0xeaf6ff, L.id === "coach" ? 0.42 : 0.3); s.position.set(p[0], p[1], p[2]); V.body.add(s); return s; });
    // a soft contact shadow for the tiers that run without shadow maps
    V.blob = contactBlob(M.hw * 2.4, M.len * 1.08); V.body.add(V.blob);
    if (L.id === "rover") { var pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.5), new THREE.MeshBasicMaterial({ map: mats().glowTex, color: 0x9fb8c4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.06, 5.2); pool.renderOrder = 2; pool.userData.noSolid = true; V.body.add(pool); V.pool = pool; }
    // the horses and the harness
    if (L.id === "coach") buildTeam(V);
    // a moving solid (off while the local visitor rides this vehicle)
    V.solid = addSolid(0, -99999, 0, M.hw * 2 - 0.1, M.len - 0.4, -1000, -999, "ride:" + L.id + k);
    if (L.id === "coach") { V.solidT = addSolid(0, -99999, 0, 1.7, 2.6, -1000, -999, "ride:" + L.id + k + "t"); V.solidL = addSolid(0, -99999, 0, 1.7, 2.6, -1000, -999, "ride:" + L.id + k + "l"); }
    scene.add(V.g); return V;
  }
  function buildTeam(V) {
    if (!MODELS.horse) return; var mm = mats();
    // collar with brass hames, a back pad and girth, a bridle band: one merged mesh per horse (horse model space)
    var U2 = THREE.BufferGeometryUtils, mg = U2 && (U2.mergeGeometries || U2.mergeBufferGeometries);
    function harnessGeo() { var parts = [], brass = [];
      // the collar hugs the base of the neck, resting on the shoulders (neck 0.52 m wide and 0.86 m deep there, inclined about 30 degrees)
      var col = new THREE.TorusGeometry(0.3, 0.085, 8, 26); col.scale(0.97, 1.45, 1); col.rotateX(-0.51); col.translate(HORSE.collar[0], HORSE.collar[1], HORSE.collar[2]); parts.push(col);
      var hm = new THREE.TorusGeometry(0.33, 0.022, 5, 22, Math.PI * 1.3); hm.rotateZ(-Math.PI * 0.15); hm.scale(0.97, 1.45, 1); hm.rotateX(-0.51); hm.translate(HORSE.collar[0], HORSE.collar[1] + 0.02, HORSE.collar[2] + 0.05); brass.push(hm);
      var girth = new THREE.TorusGeometry(1, 0.035, 5, 30); girth.scale(0.405, 0.5, 1.4); girth.translate(0, 1.66, -0.1); parts.push(girth);
      var pad = new THREE.BoxGeometry(0.34, 0.06, 0.3); pad.translate(0, 2.15, -0.1); parts.push(pad);
      var brow = new THREE.TorusGeometry(1, 0.014, 4, 20); brow.scale(0.15, 0.16, 1); brow.rotateX(-0.9); brow.translate(0, 2.36, 1.12); parts.push(brow);
      var nose = new THREE.TorusGeometry(1, 0.014, 4, 20); nose.scale(0.13, 0.15, 1); nose.rotateX(-1.1); nose.translate(0, 2.08, 1.46); parts.push(nose);
      return [mergeSimple(parts), mergeSimple(brass)]; }
    var hg = harnessGeo();
    for (var i = 0; i < 4; i++) { var U = { uG: { value: new THREE.Vector4(Math.random() * 6, 0, 0, 0) }, uH: { value: new THREE.Vector4() } };
      var hgrp = new THREE.Group(); hgrp.scale.setScalar(HORSE.sc); var ms = meshesOf("horse", U, "horse"); if (!ms) return; ms.forEach(function (m) { hgrp.add(m); });
      if (hg[0]) { var h1 = new THREE.Mesh(hg[0], mm.leather); h1.castShadow = true; hgrp.add(h1); } if (hg[1]) { var h2 = new THREE.Mesh(hg[1], mm.brass); hgrp.add(h2); }
      var inner = new THREE.Group(); inner.add(hgrp); var hb = contactBlob(0.95, 2.6); hb.position.z = -0.35; inner.add(hb); scene.add(inner);
      V.horses.push({ g: inner, s: hgrp, U: U, meshes: ms, lead: i >= 2, side: i % 2 ? -1 : 1, ph: Math.random() * 6.28, amp: 0, pose: null }); }
    // traces (collar to splinter bar or leader bar) and reins (driver's hands to each bit): one instanced strap box
    var strap = new THREE.BoxGeometry(1, 1, 1); V.straps = new THREE.InstancedMesh(strap, mm.leather, 12); V.straps.castShadow = true; V.straps.frustumCulled = false; V.straps.instanceMatrix.setUsage(THREE.DynamicDrawUsage); V.straps.userData.noSolid = true; scene.add(V.straps);
  }

  // ─────────────────────────────── stops: posts, live boards, hotspots ───────────────────────────────
  // a two-faced sign panel: front and back quads with their own uvs, so the words read the right way round from both sides
  function panel(w, h, cx, cy, t) { var hw = w / 2, hh = h / 2, z = t || 0.018; var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([cx - hw, cy - hh, z, cx + hw, cy - hh, z, cx + hw, cy + hh, z, cx - hw, cy + hh, z, cx + hw, cy - hh, -z, cx - hw, cy - hh, -z, cx - hw, cy + hh, -z, cx + hw, cy + hh, -z], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); return g; }
  function bx(w, h, d, x, y, z) { var g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
  function buildStop(L, st) {
    var x = st.post[0], z = st.post[1], y = planGroundAt(x, z), q = pathAt(L.P, st.s); var mm = mats();
    var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(q[0] - x, q[1] - z); g.userData.noInst = true;   // local +z faces the lane
    // coach: a timber post with a gallows arm, the boards hanging clear of the post; rover: two slim white legs framing the boards
    var coach = L.id === "coach", bx0 = coach ? 1.0 : 0, by = coach ? 2.28 : 2.35, ly = coach ? 1.8 : 1.84, S = {};
    function add(mat, geo) { (S[mat.uuid] = S[mat.uuid] || { m: mat, g: [] }).g.push(geo); }
    if (coach) { add(mm.timber, bx(0.16, 3.1, 0.16, 0, 1.55, 0)); add(mm.timber, bx(1.95, 0.12, 0.12, 0.9, 2.95, 0)); add(mm.iron, bx(0.05, 0.36, 0.05, 0.3 + 0.38, 2.74, 0)); add(mm.iron, bx(0.05, 0.36, 0.05, 1.72 - 0.38, 2.74, 0)); add(mm.timber, bx(1.58, 0.64, 0.03, bx0, by, 0)); add(mm.iron, bx(1.58, 0.45, 0.03, bx0, ly, 0)); add(mm.iron, bx(0.05, 0.09, 0.05, 0.3 + 0.38, 2.07, 0)); add(mm.iron, bx(0.05, 0.09, 0.05, 1.72 - 0.38, 2.07, 0)); }
    else { for (var lg = -1; lg <= 1; lg += 2) { add(mm.white, bx(0.09, 2.75, 0.09, lg * 0.84, 1.375, 0)); add(mm.cyan, bx(0.13, 0.05, 0.13, lg * 0.84, 2.77, 0)); add(mm.dark, bx(0.2, 0.06, 0.2, lg * 0.84, 0.03, 0)); } add(mm.dark, bx(1.58, 0.64, 0.03, bx0, by, 0)); add(mm.dark, bx(1.58, 0.45, 0.03, bx0, ly, 0)); add(mm.white, bx(1.77, 0.06, 0.1, 0, 2.7, 0)); }
    for (var k in S) { var me = new THREE.Mesh(mergeSimple(S[k].g), S[k].m); me.castShadow = true; me.receiveShadow = true; g.add(me); }
    var tx = coach ? textTexture([{ text: "STAGECOACH", size: 96, y: 0.3, shadow: true }, { text: st.name.toUpperCase(), size: 58, y: 0.6, color: "#f4cd5a" }, { text: "MAIN STREET · FRONTIER RANCH · E TO BOARD", size: 26, y: 0.85, color: "rgba(245,241,230,0.85)", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 1024, 384, { planks: true, border: "#f4cd5a" })
      : textTexture([{ text: "OUTPOST ROVER", size: 92, y: 0.3, shadow: true }, { text: st.name.toUpperCase(), size: 56, y: 0.6, color: "#7fe7ff", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }, { text: "THE RING · STRATOS FIELD · E TO BOARD", size: 28, y: 0.85, color: "rgba(245,241,230,0.8)", font: "'Space Grotesk', system-ui, sans-serif", weight: 600 }], 1024, 384, { planks: false, bg: "#0b1a22", border: "#7fe7ff" });
    g.add(new THREE.Mesh(panel(1.5, 0.56, bx0, by), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 })));
    var cv = document.createElement("canvas"); cv.width = 512; cv.height = 128; var ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
    g.add(new THREE.Mesh(panel(1.5, 0.37, bx0, ly), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.5, emissive: 0xffffff, emissiveMap: ct, emissiveIntensity: 0.35 })));
    scene.add(g); COLLIDERS.push([x, z, 0.25]);
    st.g = g; st.cv = cv; st.ct = ct; st.y = y; st.line = L; st.boardAt = 0;
    st.hs = { x: x, z: z, r: 5.5, t: L.name + " stop", k: st.name + " · " + (coach ? "the coach every few minutes" : "a rover every few minutes"), p: L.blurb + " Wait by the post and press E when it pulls in.", plan: "r2_rides" }; hotspots.push(st.hs);
    drawBoard(L, st, 1e9);
  }
  function fmtEta(s) { return s >= 90 ? Math.round(s / 60) + " MIN" : Math.max(1, Math.ceil(s)) + " S"; }
  function drawBoard(L, st, eta) { var x = st.cv.getContext("2d"), coach = L.id === "coach"; x.fillStyle = coach ? "#1c140d" : "#0a1418"; x.fillRect(0, 0, 512, 128); x.fillStyle = coach ? "#f4cd5a" : "#7fe7ff"; x.font = "700 30px system-ui, sans-serif"; x.textAlign = "left"; x.fillText(coach ? "NEXT COACH" : "NEXT ROVER", 22, 50);
    x.fillStyle = "#f5f1e6"; x.font = "700 44px system-ui, sans-serif"; x.textAlign = "right"; x.fillText(eta <= 0 ? "BOARDING" : eta > 3600 ? "--" : fmtEta(eta), 490, 90); x.fillStyle = "rgba(245,241,230,.6)"; x.font = "600 22px system-ui, sans-serif"; x.textAlign = "left"; x.fillText(st.name.toUpperCase(), 22, 92); st.ct.needsUpdate = true; }

  // ─────────────────────────────── poses on the drawn surface ───────────────────────────────
  var _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function gAt(x, z) { try { return planGroundAt(x, z); } catch (e) { return getH(x, z); } }
  // a rigid body from four contact points: axles at zf / zr, half tracks tf / tr (local x), heading h, centre (x, z)
  // a rigid body on its wheels: the least-squares plane through the surface under every contact point (lx, lz) gives height,
  // pitch and roll; what is left over per wheel (res) is its suspension travel
  function bodyFit(x, z, h, pts) { var c = Math.cos(h), s = Math.sin(h), n = pts.length, g = new Array(n);
    var Sx = 0, Sz = 0, Sxx = 0, Szz = 0, Sxz = 0, Sy = 0, Sxy = 0, Szy = 0;
    for (var i = 0; i < n; i++) { var lx = pts[i][0], lz = pts[i][1]; var y = gAt(x + lx * c + lz * s, z - lx * s + lz * c); g[i] = y; Sx += lx; Sz += lz; Sxx += lx * lx; Szz += lz * lz; Sxz += lx * lz; Sy += y; Sxy += lx * y; Szy += lz * y; }
    // solve [n Sx Sz; Sx Sxx Sxz; Sz Sxz Szz] [a b c] = [Sy Sxy Szy]
    var A = [[n, Sx, Sz], [Sx, Sxx, Sxz], [Sz, Sxz, Szz]], B = [Sy, Sxy, Szy];
    function det3(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }
    var D = det3(A), sol = [Sy / n, 0, 0]; if (Math.abs(D) > 1e-9) for (var k = 0; k < 3; k++) { var Mk = A.map(function (row, ri) { return row.map(function (v, ci) { return ci === k ? B[ri] : v; }); }); sol[k] = det3(Mk) / D; }
    var res = []; for (var j = 0; j < n; j++) res.push(g[j] - (sol[0] + sol[1] * pts[j][0] + sol[2] * pts[j][1]));
    return { x: x, y: sol[0], z: z, h: h, p: Math.atan(sol[2]), r: Math.atan(sol[1]), res: res }; }
  function bodyPose(x, z, h, zf, zr, tf, tr) { var c = Math.cos(h), s = Math.sin(h);
    function g(lx, lz) { return gAt(x + lx * c + lz * s, z - lx * s + lz * c); }
    var fl = g(tf, zf), fr = g(-tf, zf), rl = g(tr, zr), rr = g(-tr, zr); var yf = (fl + fr) / 2, yr = (rl + rr) / 2, wb = zf - zr;
    var pitch = Math.atan2(yf - yr, wb), yc = yr + (yf - yr) * (-zr / wb), roll = Math.atan2(((fl - fr) / (2 * tf) + (rl - rr) / (2 * tr)) / 2, 1);
    return { x: x, y: yc, z: z, h: h, p: pitch, r: roll }; }
  var ROVER_PTS = [[1.1, ROVER.wheels[0][0]], [1.1, ROVER.wheels[1][0]], [1.1, ROVER.wheels[2][0]], [-1.1, ROVER.wheels[0][0]], [-1.1, ROVER.wheels[1][0]], [-1.1, ROVER.wheels[2][0]]];
  var COACH_PTS = [[COACH.trackR / 2, COACH.axR], [COACH.trackF / 2, COACH.axF], [-COACH.trackR / 2, COACH.axR], [-COACH.trackF / 2, COACH.axF]];
  // the wheels' suspension travel: what the rigid body cannot reach, smoothed and limited to the travel
  function suspension(V, res, lim, dt, dCam) { var n = res.length / 2, L = V.U.uSL.value, R = V.U.uSR.value, k = Math.min(1, dt * 12); if (!V.sus) V.sus = new Float32Array(res.length);
    for (var i = 0; i < res.length; i++) { var t = dCam < 90 ? clamp(res[i], -lim, lim) : 0; V.sus[i] += (t - V.sus[i]) * k; }
    L.set(V.sus[0], V.sus[1], n > 2 ? V.sus[2] : 0); R.set(V.sus[n], V.sus[n + 1], n > 2 ? V.sus[n + 2] : 0); }
  function smoothPose(V, key, np, dt) { var o = V[key]; if (!o || Math.abs(o.x - np.x) + Math.abs(o.z - np.z) > 4) { V[key] = { x: np.x, y: np.y, z: np.z, h: np.h, p: np.p, r: np.r }; return V[key]; }
    var k = 1 - Math.exp(-dt * 10), kr = 1 - Math.exp(-dt * 6); o.x = np.x; o.z = np.z; o.h = np.h; o.y += (np.y - o.y) * k; o.p += (np.p - o.p) * kr; o.r += (np.r - o.r) * kr; return o; }
  function applyPose(obj, p) { obj.position.set(p.x, p.y, p.z); _e.set(-p.p, p.h, p.r, "YXZ"); obj.rotation.copy(_e); }

  // ─────────────────────────────── per frame ───────────────────────────────
  var LAST = 0, BOARD_AT = 0, CULL = { at: 0 };
  function darkSkyHour() { try { var t = dayT() * 24; return t >= 0 && t < 1; } catch (e) { return false; } }
  function pedestrians(V, P) { // anything in the lane ahead of the vehicle: the local visitor, other visitors, the walkers
    var M = V.L.M, h = P.h, c = Math.cos(h), s = Math.sin(h), fx = Math.sin(h), fz = Math.cos(h); var look = 3.2 + Math.max(0, V.cur ? V.cur.v : 0) * 1.6, front = V.L.id === "coach" ? 6.7 : 2.5, hw = M.hw + 0.55;
    function hit(px, pz) { var rx = px - P.x, rz = pz - P.z; var al = rx * fx + rz * fz - front, la = rx * -c + rz * s; return al > -0.4 && al < look && Math.abs(la) < hw; }
    if (player && (!PR.ride || PR.ride.V !== V) && !inside && hit(player.position.x, player.position.z)) return true;
    try { if (SITES.walkers) for (var i = 0; i < SITES.walkers.length; i++) { var w = SITES.walkers[i], g = w.g || w; if (g && g.position && g.visible !== false && Math.abs(g.position.x - P.x) < 14 && Math.abs(g.position.z - P.z) < 14 && hit(g.position.x, g.position.z)) return true; } } catch (e) {}
    try { if (typeof avatars !== "undefined") { var it = avatars.values(), r; while (!(r = it.next()).done) { var a = r.value.g; if (a && a.visible && Math.abs(a.position.x - P.x) < 14 && Math.abs(a.position.z - P.z) < 14 && hit(a.position.x, a.position.z)) return true; } } } catch (e) {}
    return false; }
  function stepLine(L, t, dt, cam) {
    var dark = L.id === "rover" && darkSkyHour();
    for (var k = 0; k < L.veh.length; k++) { var V = L.veh[k];
      V.tau = t - k * L.T.P / L.veh.length - V.delay; var cur = scheduleAt(L, V.tau);
      var pin = PR.pin && PR.pin[L.id] && PR.pin[L.id][k]; if (pin) cur = { s: pin.s, v: pin.v || 0, stop: pin.stop === undefined ? -1 : pin.stop, left: 9 };
      var P0 = pathAt(L.P, cur.s); var dCam = Math.hypot(P0[0] - cam.x, P0[1] - cam.z); V.near = dCam < 160;
      // yield to people in the lane, hold for the dark-sky hour, win back lost time at the stops
      var blocked = cur.stop < 0 && V.near && pedestrians(V, { x: P0[0], z: P0[1], h: P0[2] });
      if (PR.ride && PR.ride.V === V && PR.ride.hold && cur.stop >= 0) blocked = true;
      var want = blocked ? 0 : 1; V.fac += (want - V.fac) * Math.min(1, dt * (blocked ? 3.5 : 1.2)); V.delay += (1 - V.fac) * dt;
      if (cur.stop >= 0) { if (dark) V.delay += dt; else if (V.delay > 0 && !(PR.ride && PR.ride.V === V && PR.ride.hold)) V.delay = Math.max(0, V.delay - dt * 0.9); }
      if (V.delay > L.T.P) V.delay -= L.T.P;
      if (blocked && !V.honk) { V.honk = true; V.honkAt = performance.now(); } if (!blocked) V.honk = false;
      V.cur = cur; V.dark = dark;
      var vis = dCam < (L.id === "coach" ? 520 : 460) || !!(PR.ride && PR.ride.V === V); if (V.g.visible !== vis) { V.g.visible = vis; V.horses.forEach(function (hh) { hh.g.visible = vis; }); if (V.straps) V.straps.visible = vis; }
      if (!vis) { park(V); continue; }
      var dd = cur.s - (V.sPrev === undefined ? cur.s : V.sPrev); if (dd < -L.P.L / 2) dd += L.P.L; if (dd > L.P.L / 2) dd -= L.P.L; V.sPrev = cur.s; V.dist += Math.max(0, dd); V.spd = Math.max(0, cur.v) * V.fac;
      poseVehicle(V, cur.s, dt, dCam);
    }
  }
  function park(V) { if (V.solid) { V.solid.y0 = -1000; V.solid.y1 = -999; } if (V.solidT) { V.solidT.y0 = -1000; V.solidT.y1 = -999; } if (V.solidL) { V.solidL.y0 = -1000; V.solidL.y1 = -999; } }
  function setSolid(sd, x, z, h, y, top, riding) { if (!sd) return; sd.x = x; sd.z = z; sd.ry = h; sd.y0 = riding ? -1000 : y + 0.05; sd.y1 = riding ? -999 : y + top; }
  function poseVehicle(V, s, dt, dCam) {
    var L = V.L, M = L.M, P = L.P, riding = !!(PR.ride && PR.ride.V === V), q, pose;
    if (L.id === "rover") { q = pathAt(P, s); var fr = bodyFit(q[0], q[1], q[2], ROVER_PTS); pose = smoothPose(V, "pose", fr, dt); applyPose(V.g, pose); suspension(V, fr.res, 0.14, dt, dCam);
      V.U.uW.value.set(V.dist % 6283.185, 0, 0, 0); setSolid(V.solid, q[0], q[1], q[2], pose.y, 2.2, riding); }
    else { // the coach: rear axle and front axle on the path, the front axle and pole steer toward the wheelers
      var r = pathAt(P, s + M.axR), f = pathAt(P, s + M.axF); var hc = Math.atan2(f[0] - r[0], f[1] - r[1]); var cx = r[0] + Math.sin(hc) * -M.axR, cz = r[1] + Math.cos(hc) * -M.axR;
      var fc = bodyFit(cx, cz, hc, COACH_PTS); pose = smoothPose(V, "pose", fc, dt); suspension(V, fc.res, 0.07, dt, dCam);
      // the thoroughbraces: the body rocks gently fore and aft with the pace
      V.rockP = (V.rockP || 0) + dt * (1.6 + V.spd * 0.9); var rk = Math.min(1, V.spd / 2.5); V.rock = (V.rock || 0) + ((Math.sin(V.rockP) * 0.011 + Math.sin(V.rockP * 2.3 + 1) * 0.004) * rk - (V.rock || 0)) * Math.min(1, dt * 4);
      var py = COACH.rockPivot[0], pz = COACH.rockPivot[1], rc = Math.cos(V.rock), rs = Math.sin(V.rock); V.body.rotation.x = V.rock; V.body.position.set(0, py - (py * rc - pz * rs), pz - (py * rs + pz * rc));
      applyPose(V.g, pose); var wq = pathAt(P, s + HORSE.wheelers); var steer = clamp(wrapA(Math.atan2(wq[0] - f[0], wq[1] - f[1]) - hc), -0.7, 0.7); V.steer = steer;
      V.U.uW.value.set(V.dist % 6283.185, steer, V.rock, 0); setSolid(V.solid, cx, cz, hc, pose.y, 3.0, riding);
      poseTeam(V, s, dt, dCam, pose, riding); }
    // the lamps: warm coach lamps and soft rover lamps after dusk; the rovers run dark in the dark-sky hour
    var nt = 0; try { nt = typeof night === "number" ? night : 0; } catch (e) {} var lamp = clamp((nt - 0.25) / 0.5, 0, 1) * (V.dark ? 0.15 : 1);
    V.glows.forEach(function (g) { g.material.opacity = lamp * (L.id === "coach" ? 0.9 : 0.85); g.visible = lamp > 0.01; }); if (V.pool) { V.pool.material.opacity = lamp * 0.28; V.pool.visible = lamp > 0.01; }
    // level of detail: the decimated meshes beyond 55 m
    var far = dCam > 55; if (far !== V.lod) { V.lod = far; V.meshes.forEach(function (m) { if (m.userData.lodGeo) m.geometry = far ? m.userData.lodGeo : m.userData.fullGeo; }); V.horses.forEach(function (hh) { hh.meshes.forEach(function (m) { if (m.userData.lodGeo) m.geometry = far ? m.userData.lodGeo : m.userData.fullGeo; }); }); }
    // the driver: hands on the wheel (rover) or the reins (coach); the cart pose reads CARTG, so it is lent our geometry for the call
    driverPose(V, dt);
    var ov = PR.over && PR.over[L.id]; if (ov) { if (ov.w !== undefined) V.U.uW.value.x = ov.w; if (ov.st !== undefined) V.U.uW.value.y = ov.st; if (ov.g) V.horses.forEach(function (hh) { hh.U.uG.value.set(ov.g[0], ov.g[1], ov.g[2], ov.g[3]); }); }
  }
  var CG = null;
  function driverPose(V, dt) { var M = V.L.M, d = V.drv; if (!d) return; if (!CG) CG = { w: CARTG.wheel, r: CARTG.wheelR };
    var rel = V.L.id === "coach" ? M.reinsRel : M.wheelRel, rr = V.L.id === "coach" ? M.reinsR : M.wheelR;
    var w = [CARTG.seatX + rel[0], CARTG.seatTop + rel[1], CARTG.backZ + rel[2]]; var w0 = CARTG.wheel, r0 = CARTG.wheelR; CARTG.wheel = w; CARTG.wheelR = rr;
    try { animateWalk(d, 0, dt); } finally { CARTG.wheel = w0; CARTG.wheelR = r0; } }
  function poseTeam(V, s, dt, dCam, cp, riding) {
    var L = V.L, P = L.P, sp = V.spd || 0, trot = sstep(2.5, 3.3, sp), A = sp < 0.15 ? 0 : (0.3 + 0.12 * trot) * Math.min(1, sp / 0.8), B = (0.55 + 0.3 * trot) * Math.min(1, sp / 0.8);
    var near = dCam < 170, t = performance.now() / 1000;
    for (var i = 0; i < V.horses.length; i++) { var H = V.horses[i]; var q = pathAt(P, s + (H.lead ? HORSE.leaders : HORSE.wheelers)); var c = Math.cos(q[2]), sn = Math.sin(q[2]); var x = q[0] + c * HORSE.lat * H.side, z = q[1] - sn * HORSE.lat * H.side;   // local +x (the near side) is (cos h, -sin h)
      var np = bodyPose(x, z, q[2], HORSE.fore * HORSE.sc, HORSE.hind * HORSE.sc, 0.17, 0.2); np.r = 0; var p = smoothPose(H, "pose", np, dt);
      H.amp += (A - H.amp) * Math.min(1, dt * 2.5); var omega = sp > 0.05 ? sp / (1.13 * Math.max(0.2, 0.3 + 0.12 * trot)) : 0; H.ph = (H.ph + omega * dt) % (Math.PI * 200);
      var bob = H.amp > 0.01 ? (trot > 0.5 ? Math.abs(Math.cos(H.ph)) * 0.035 : Math.cos(H.ph * 2) * 0.012) * (H.amp / 0.42) : Math.sin(t * 1.9 + i) * 0.004;
      H.g.position.set(p.x, p.y + bob, p.z); _e.set(-p.p, p.h, 0, "YXZ"); H.g.rotation.copy(_e);
      if (near) { var nod = H.amp > 0.01 ? Math.sin(H.ph * 2 + 0.6) * (0.06 - 0.03 * trot) * (H.amp / 0.3) : (Math.sin(t * 0.37 + i * 1.7) > 0.93 ? -0.18 * (Math.sin(t * 0.37 + i * 1.7) - 0.93) / 0.07 : Math.sin(t * 0.8 + i) * 0.015);
        H.U.uG.value.set(H.ph % 6.28318, H.amp, B * Math.min(1, H.amp / 0.2), trot); H.U.uH.value.set(nod, Math.sin(t * (1.1 + i * 0.13) + i) * 0.1 + Math.sin(t * 2.9 + i) * 0.04, 0, 0); }
      else H.U.uG.value.set(H.ph % 6.28318, H.amp, B, trot); }
    // the team as two moving solids (wheelers + leaders)
    if (V.horses.length) { var wq = pathAt(P, s + HORSE.wheelers - 0.1), lq = pathAt(P, s + HORSE.leaders - 0.1); setSolid(V.solidT, wq[0], wq[1], wq[2], cp.y, 2.0, false); setSolid(V.solidL, lq[0], lq[1], lq[2], cp.y, 2.0, false); }
    if (V.straps) { var sv = dCam < 260; if (V.straps.visible !== sv) V.straps.visible = sv; if (sv) straps(V, cp); }
  }
  // the straps: a trace from each collar back to the splinter bar (wheelers) or the pole tip (leaders), a rein from the driver's hands to each bit
  var _a = new THREE.Vector3(), _b = new THREE.Vector3(), _hl = new THREE.Vector3(), _hr = new THREE.Vector3();
  function strap(im, i, a, b, w, t) { _v.subVectors(b, a); var L = _v.length() || 1e-3; _v2.addVectors(a, b).multiplyScalar(0.5); _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v.divideScalar(L)); _s.set(w, t, L); _m4.compose(_v2, _q, _s); im.setMatrixAt(i, _m4); }
  function straps(V, cp) { var M = V.L.M, im = V.straps, n = 0; V.g.updateMatrixWorld(true);
    var ct = Math.cos(V.steer || 0), st = Math.sin(V.steer || 0); function pole(lx, ly, lz) { var dz = lz - M.axF; _b.set(lx * ct + dz * st, ly, M.axF - lx * st + dz * ct); return V.body.localToWorld(_b); }
    var hands = null; try { var b = V.drv.userData.legBones; if (b && b.lh && b.rh) { b.lh.getWorldPosition(_hl); b.rh.getWorldPosition(_hr); hands = true; } } catch (e) {}
    if (!hands) { V.body.localToWorld(_hl.set(M.seat.driver + 0.12, M.seat.top + 0.3, M.seat.back + 0.6)); _hr.copy(_hl); }
    for (var i = 0; i < V.horses.length; i++) { var H = V.horses[i]; H.s.updateMatrixWorld(true);
      for (var sd = -1; sd <= 1; sd += 2) { H.s.localToWorld(_a.set(HORSE.hook[0] * sd, HORSE.hook[1], HORSE.hook[2])); var lx = HORSE.lat * H.side + 0.32 * sd; var e = H.lead ? pole(lx * 0.8, M.poleTip[1] + 0.05, M.poleTip[2]) : pole(lx, 0.98, 1.22); _b.copy(e); strap(im, n++, _a, _b, 0.055, 0.014); }
      H.s.localToWorld(_a.set(0, HORSE.bit[1], HORSE.bit[2])); strap(im, n++, i % 2 ? _hr : _hl, _a, 0.022, 0.008); }
    im.count = n; im.instanceMatrix.needsUpdate = true; }

  // ─────────────────────────────── riding ───────────────────────────────
  function busy() { try { return !player || FLY.on || riding || inside || (golf && golf.playing) || SITES.ride || SITES.park || SITES.bride || (RIDE && RIDE.on) || (RIDE_ON && RIDE_ON.id) || (ARC && ARC.on) || (DANCE && DANCE.on) || (window.PLAN_CROSSING && PLAN_CROSSING.ride); } catch (e) { return false; } }
  function fadeTo(on, ms) { var f = el("fade"); if (!f) return; f.style.transition = "opacity " + ((ms || 300) / 1000) + "s"; f.style.opacity = on ? "1" : "0"; }
  // the vehicle a visitor at (x, z) could board now: dwelling at a stop within reach of its side or the stop post
  function boardable(x, z) { var best = null, bd = 1e9;
    PR.lines.forEach(function (L) { L.veh.forEach(function (V) { if (!V.cur || V.cur.stop < 0 || !V.g.visible || V.dark) return; var st = L.stops[V.cur.stop]; var d = Math.min(Math.hypot(V.g.position.x - x, V.g.position.z - z), st.g ? Math.hypot(st.g.position.x - x, st.g.position.z - z) + 1.5 : 1e9); if (d < (L.id === "coach" ? 6.5 : 5.5) && d < bd) { bd = d; best = { V: V, L: L, st: st }; } }); }); return best; }
  function nearStop(x, z) { var best = null, bd = 1e9; PR.lines.forEach(function (L) { L.stops.forEach(function (st) { if (!st.g) return; var d = Math.hypot(st.g.position.x - x, st.g.position.z - z); if (d < 6 && d < bd) { bd = d; best = { L: L, st: st }; } }); }); return best; }
  function seatPoint(V, out) { var M = V.L.M; var x = V.L.id === "coach" ? M.seat.rider : M.seat.rider; return seatLocal(player, x, M.seat.top, M.seat.back, out); }
  function board(b) {
    if (!b || busy()) return false; try { if (cartMode) toggleCart(); } catch (e) {} var V = b.V, L = b.L;
    PR.ride = { V: V, L: L, from: b.st, at: performance.now(), req: false, hold: false, h: V.pose ? V.pose.h : 0, last: null, stood: 0 };
    fadeTo(true, 180); setTimeout(function () { fadeTo(false, 420); }, 200);
    SIT.on = true; player.userData.sit = true; try { mv.x = 0; mv.z = 0; airborne = false; vy = 0; } catch (e) {} if (player.userData.sitOff) { try { sitClear(player); } catch (e) {} }
    seatNow(0); yaw = PR.ride.h + Math.PI; pitch = Math.max(pitch, 0.1); try { CAM.init = false; } catch (e) {}
    var nx = nextStop(L, V.cur ? V.cur.s : 0, true); try { sfx("board"); } catch (e) {}
    setStatus((L.id === "coach" ? "Aboard the stagecoach, up on the box" : "Aboard the Outpost Rover") + " · next stop " + nx.st.name + " · E to get off at the next stop");
    return true; }
  function alight(msg) {
    var R = PR.ride; if (!R) return; PR.ride = null; var V = R.V, M = V.L.M;
    SIT.on = false; player.userData.sit = false; try { sitClear(player); } catch (e) {}
    var h = V.pose ? V.pose.h : 0, c = Math.cos(h), s = Math.sin(h), side = M.hw + 1.25; var x = V.g.position.x - c * side, z = V.g.position.z + s * side;
    if (V.L.id === "coach") { x -= Math.sin(h) * 0.5; z -= Math.cos(h) * 0.5; }
    try { var sp = planLandSpot(x, z); x = sp[0]; z = sp[1]; } catch (e) {}
    player.position.set(x, gAt(x, z), z); try { player.position.y = surfaceAt(x, z, gAt(x, z) + 0.05); } catch (e) {} player.rotation.y = h; yaw = h + Math.PI; try { airborne = false; vy = 0; CAM.init = false; } catch (e) {}
    fadeTo(true, 150); setTimeout(function () { fadeTo(false, 380); }, 170); hud(null); try { sfx("board"); } catch (e) {} if (msg) setStatus(msg); }
  function endRide() { var R = PR.ride; if (!R) return; PR.ride = null; if (SIT.on) { SIT.on = false; } try { player.userData.sit = false; sitClear(player); } catch (e) {} hud(null); }
  // the seat, placed every frame just before the camera
  var _sp = new THREE.Vector3();
  function seatNow(dt) { var R = PR.ride; if (!R || !player) return; var V = R.V; V.g.updateMatrixWorld(true); seatPoint(V, _sp); V.body.localToWorld(_sp);
    player.position.copy(_sp); var h = V.pose ? V.pose.h : R.h; player.rotation.y = h; SIT.y = _sp.y; if (dt) { yaw += wrapA(h - R.h); } R.h = h; R.last = [_sp.x, _sp.y, _sp.z]; player.userData.sit = true; player.userData.driveIK = false; }
  function interiorHook(dt, now) {
    var R = PR.ride; if (!R) return false;
    try {
      // someone moved us: a travel button, a warp, the fly-in, an interior
      if (!player || FLY.on || inside || (R.last && Math.hypot(player.position.x - R.last[0], player.position.z - R.last[2]) > 3.5)) { endRide(); return false; }
      if (!SIT.on) { // a move key, space or E made the engine stand us up
        var cur = R.V.cur; if (cur && cur.stop >= 0) { alight("Stepped off at " + R.V.L.stops[cur.stop].name); return false; }
        SIT.on = true; player.userData.sit = true; if (!R.req) { R.req = true; var nx = nextStop(R.L, cur ? cur.s : 0, true); setStatus("Stop requested · " + nx.st.name + " · hold on until it pulls in"); } }
      seatNow(dt); rideHud(R);
      var c2 = R.V.cur; if (c2 && c2.stop >= 0) { if (!R.atStop || R.atStop !== c2.stop) { R.atStop = c2.stop; R.stopAt = now; if (R.req) R.hold = true; }
        if (R.req && now - R.stopAt > 900) { alight("Stepped off at " + R.L.stops[c2.stop].name); return false; } }
      else { if (R.atStop !== undefined && R.atStop !== null) { R.atStop = null; R.hold = false; } }
    } catch (e) { note("seat", e); endRide(); }
    return false;
  }
  function hud(R) { if (!R) { try { var ids = ["game-big", "game-s", "game-n"]; ids.forEach(function (id) { var e = el(id); if (e) e.textContent = ""; }); } catch (e) {} return; } }
  function rideHud(R) { try { if (typeof gameHud === "function") gameHud("rides"); var n = el("game-n"), b = el("game-big"), s = el("game-s"); if (!n || !b || !s) return; var cur = R.V.cur, title = R.L.title;
      var big, small; if (cur && cur.stop >= 0) { var st = R.L.stops[cur.stop]; big = st.name; small = R.req ? "stepping off" : "E to get off here · " + (cur.left > 1 ? "leaving in " + Math.ceil(cur.left) + " s" : "leaving now"); if (R.V.dark) small = "The rovers rest for the dark-sky hour · E to get off"; }
      else { var nx = nextStop(R.L, cur ? cur.s : 0, true); big = (R.req ? "Stop requested: " : "Next: ") + nx.st.name + "  " + Math.max(10, Math.round(nx.d / 10) * 10) + " m"; small = R.req ? "you step off at " + nx.st.name : "E to get off at the next stop · look around with the mouse"; }
      if (n.textContent !== title) n.textContent = title; if (b.textContent !== big) b.textContent = big; if (s.textContent !== small) s.textContent = small; } catch (e) {} }
  // E and F: board, ask for the next stop, or step off (capture phase: before the engine's own E and F)
  function useKey() { if (!PR.built || !player) return false;
    var R = PR.ride; if (R) { var cur = R.V.cur; if (cur && cur.stop >= 0) { alight("Stepped off at " + R.L.stops[cur.stop].name); return true; } if (!R.req) { R.req = true; var nx = nextStop(R.L, cur ? cur.s : 0, true); setStatus("Stop requested · " + nx.st.name); } return true; }
    if (busy() || SIT.on) return false; var b = boardable(player.position.x, player.position.z); if (b) return board(b);
    var ns = nearStop(player.position.x, player.position.z); if (ns) { var eta = etaAt(ns.L, ns.st); setStatus(ns.L.id === "coach" ? "The next coach reaches " + ns.st.name + " in about " + fmtEta(eta).toLowerCase() : (darkSkyHour() ? "The rovers rest for the dark-sky hour, back at one o'clock" : "The next rover reaches " + ns.st.name + " in about " + fmtEta(eta).toLowerCase())); return false; }
    return false; }
  window.addEventListener("keydown", function (e) { if (e.repeat || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) return; if (e.code !== "KeyE" && e.code !== "KeyF") return; try { if (useKey()) { e.stopImmediatePropagation(); e.preventDefault(); } } catch (er) { note("key", er); } }, true);
  document.addEventListener("click", function (e) { var t = e.target; if (!t || !t.closest) return; var b = t.closest("#tbtns button"); if (b && (b.dataset.k === "KeyE" || b.dataset.k === "KeyF")) { try { if (useKey()) { e.stopImmediatePropagation(); e.preventDefault(); } } catch (er) { note("tap", er); } return; }
    if (PR.ride && t.closest("#warp, #mm, #places, #info-nav, #nav, #tour, #plist, #talk, #replayfly, .places, [data-w]")) endRide(); }, true);

  // the E prompt (runs after the engine wrote its own)
  function prompt() { var pe = el("prompt"), pt = el("prompt-t"); if (!pe || !pt || !player) return; var R = PR.ride, html = null;
    if (R) { var cur = R.V.cur; html = cur && cur.stop >= 0 ? "<b>E</b> &nbsp;get off at " + R.L.stops[cur.stop].name : R.req ? "stop requested" : "<b>E</b> &nbsp;get off at the next stop"; }
    else if (!busy() && !SIT.on) { var b = boardable(player.position.x, player.position.z); if (b) { var nx = nextStop(b.L, b.L.stops[b.V.cur.stop].s, true); html = "<b>E</b> &nbsp;board the " + (b.L.id === "coach" ? "stagecoach" : "Outpost Rover") + " · next stop " + nx.st.name; } }
    if (html) { pe.classList.add("on"); if (pt.innerHTML !== html) pt.innerHTML = html; } }
  function boards(now) { if (now - BOARD_AT < 1000) return; BOARD_AT = now; PR.lines.forEach(function (L) { L.stops.forEach(function (st) { if (!st.g) return; var d = player ? Math.hypot(player.position.x - st.g.position.x, player.position.z - st.g.position.z) : 1e9; var vis = d < 180; if (st.g.visible !== vis) st.g.visible = vis; if (d > 90) return; var eta = L.id === "rover" && darkSkyHour() ? 1e9 : etaAt(L, st); drawBoard(L, st, eta); }); }); }

  // ─────────────────────────────── the obstacle pass (after every module has placed its things) ───────────────────────────────
  function obstaclePass(L) {
    var P = L.P, N = P.N, M = L.M, hw = M.hw + 0.3, raw = new Float32Array(N), bad = [];
    var mine = new Set(); PR.lines.forEach(function (l2) { (l2.veh || []).forEach(function (V) { [V.solid, V.solidT, V.solidL].forEach(function (s) { if (s) mine.add(s); }); }); });
    // only what stands within 14 m of the route, bucketed on an 8 m grid
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (var r = 0; r < N; r++) { if (P.X[r] < x0) x0 = P.X[r]; if (P.X[r] > x1) x1 = P.X[r]; if (P.Z[r] < z0) z0 = P.Z[r]; if (P.Z[r] > z1) z1 = P.Z[r]; }
    var G = new Map(), CELL = 8; function key(x, z) { return Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); }
    function add(o, x, z, rad) { for (var gx = Math.floor((x - rad) / CELL); gx <= Math.floor((x + rad) / CELL); gx++) for (var gz = Math.floor((z - rad) / CELL); gz <= Math.floor((z + rad) / CELL); gz++) { var k = gx * 100003 + gz, a = G.get(k); if (!a) G.set(k, a = []); a.push(o); } }
    COLLIDERS.forEach(function (c) { if (c[2] < 0.12 || c[0] < x0 - 14 || c[0] > x1 + 14 || c[1] < z0 - 14 || c[1] > z1 + 14) return; add({ c: c }, c[0], c[1], c[2] + 6); });
    SOLIDS.forEach(function (s) { if (mine.has(s) || s.x < x0 - 20 || s.x > x1 + 20 || s.z < z0 - 20 || s.z > z1 + 20) return; add({ s: s }, s.x, s.z, s.hw + s.hd + 6); });
    function clear(x, z, y) { var best = 9, a = G.get(key(x, z)); if (!a) return best;
      for (var i = 0; i < a.length; i++) { var o = a[i];
        if (o.c) { var c = o.c, d = Math.hypot(c[0] - x, c[1] - z) - c[2]; if (d < best) best = d; continue; }
        var s = o.s; if (s.y1 < y + 0.2 || s.y0 > y + M.h) continue; var cs = Math.cos(s.ry), sn = Math.sin(s.ry), dx = x - s.x, dz = z - s.z, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; var ex = Math.max(0, Math.abs(lx) - s.hw), ez = Math.max(0, Math.abs(lz) - s.hd); var d2 = Math.hypot(ex, ez); if (d2 < best) best = d2; }
      return best; }
    var maxS = L.id === "coach" ? 1.4 : 1.6;
    for (var i = 0; i < N; i += 2) { var h = P.Hd[i], c = Math.cos(h), s = Math.sin(h), y = gAt(P.X[i], P.Z[i]); var shift = 0, ok = false;
      for (var k = 0; k <= Math.round(maxS / 0.2) && !ok; k++) { var cand = k === 0 ? [0] : [k * 0.2, -k * 0.2]; for (var ci = 0; ci < cand.length; ci++) { var sh = cand[ci], xs = P.X[i] - c * sh, zs = P.Z[i] + s * sh; var worst = Math.min(clear(xs, zs, y), clear(xs - c * hw, zs + s * hw, y), clear(xs + c * hw, zs - s * hw, y), clear(xs - c * hw * 0.5, zs + s * hw * 0.5, y), clear(xs + c * hw * 0.5, zs - s * hw * 0.5, y)); if (worst > 0.05) { shift = sh; ok = true; break; } } }
      raw[i] = shift; if (i + 1 < N) raw[i + 1] = shift; if (!ok) bad.push([+P.S[i].toFixed(0), +P.X[i].toFixed(1), +P.Z[i].toFixed(1)]); }
    // dilate then blur so the lane eases round anything in the way
    var dil = new Float32Array(N), win = 24; for (var a = 0; a < N; a++) { var m = 0; for (var b = -win; b <= win; b++) { var v = raw[(a + b + N) % N]; if (Math.abs(v) > Math.abs(m)) m = v; } dil[a] = m; }
    var out = new Float32Array(N), sg = 10; for (var a2 = 0; a2 < N; a2++) { var acc = 0, wt = 0; for (var b2 = -3 * sg; b2 <= 3 * sg; b2++) { var w = Math.exp(-b2 * b2 / (2 * sg * sg)); acc += dil[(a2 + b2 + N) % N] * w; wt += w; } out[a2] = acc / wt; }
    // the stops pull over toward the kerb
    L.stops.forEach(function (st) { if (!st.pull) return; for (var d = -40; d <= 40; d++) { var j = (st.i + d + N) % N; var ds = Math.abs(d) * 0.5; out[j] += st.pull * (1 - sstep(4, 14, ds)); } });
    P.sh = out; L.bad = bad; if (bad.length) PR.conflicts.push({ line: L.id, n: bad.length, first: bad.slice(0, 8) });
  }

  // ─────────────────────────────── the Frontier Ranch paddock ───────────────────────────────
  function buildPaddock() { var P = PR.paddock; if (!P || !MODELS.horse) return; var mm = mats(), c = P.c, geos = [], posts = [];
    var cs = [[-P.hw, -P.hd], [P.hw, -P.hd], [P.hw, P.hd], [-P.hw, P.hd]];
    for (var e = 0; e < 4; e++) { var a0 = cs[e], a1 = cs[(e + 1) % 4], len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), n = Math.round(len / 2.7);
      for (var i = 0; i < n; i++) { var t = i / n; posts.push([c[0] + a0[0] + (a1[0] - a0[0]) * t, c[1] + a0[1] + (a1[1] - a0[1]) * t]); }
      for (var j = 0; j < n; j++) { var t0 = j / n, t1 = (j + 1) / n, x0 = c[0] + a0[0] + (a1[0] - a0[0]) * t0, z0 = c[1] + a0[1] + (a1[1] - a0[1]) * t0, x1 = c[0] + a0[0] + (a1[0] - a0[0]) * t1, z1 = c[1] + a0[1] + (a1[1] - a0[1]) * t1, y0 = gAt(x0, z0), y1 = gAt(x1, z1), L2 = Math.hypot(x1 - x0, z1 - z0);
        if (e === 0 && j === Math.floor(n / 2)) continue;   // the gate gap, on the yard side
        for (var r = 0; r < 2; r++) { var gr = new THREE.BoxGeometry(0.1, 0.13, L2 + 0.1); gr.rotateX(-Math.atan2(y1 - y0, L2)); gr.rotateY(Math.atan2(x1 - x0, z1 - z0)); gr.translate((x0 + x1) / 2, (y0 + y1) / 2 + (r ? 1.15 : 0.62), (z0 + z1) / 2); geos.push(gr); } } }
    posts.forEach(function (p) { var gp = new THREE.BoxGeometry(0.16, 1.45, 0.16); gp.translate(p[0], gAt(p[0], p[1]) + 0.62, p[1]); geos.push(gp); COLLIDERS.push([p[0], p[1], 0.15]); });
    // the rails as solids so nobody walks through the fence (the gate gap stays open)
    for (var e2 = 0; e2 < 4; e2++) { var b0 = cs[e2], b1 = cs[(e2 + 1) % 4], ln = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]), ux = (b1[0] - b0[0]) / ln, uz = (b1[1] - b0[1]) / ln, ry = Math.atan2(ux, uz);
      var n2 = Math.round(ln / 2.7), gap = e2 === 0 ? Math.floor(n2 / 2) : -1, seg = ln / n2;
      for (var s2 = 0; s2 < n2; s2++) { if (s2 === gap) continue; var mx = c[0] + b0[0] + ux * seg * (s2 + 0.5), mz = c[1] + b0[1] + uz * seg * (s2 + 0.5), yy = gAt(mx, mz); addSolid(mx, mz, ry, 0.2, seg + 0.05, yy - 0.5, yy + 1.25, "world"); } }
    var me = new THREE.Mesh(mergeSimple(geos), mm.timber); me.castShadow = true; me.receiveShadow = true; me.userData.noInst = true; scene.add(me); P.mesh = me;
    // a water trough in the corner
    var tx = c[0] + P.hw - 1.6, tz = c[1] + P.hd - 1.2, tm = new THREE.Mesh(mergeSimple([bx(2.2, 0.55, 0.7, tx, gAt(tx, tz) + 0.28, tz)]), mm.timber); tm.castShadow = true; scene.add(tm); COLLIDERS.push([tx, tz, 1.1]); P.trough = [tx, tz];
    P.horses = []; for (var h = 0; h < 3; h++) { var U = { uG: { value: new THREE.Vector4() }, uH: { value: new THREE.Vector4() } }; var sg = new THREE.Group(); sg.scale.setScalar(HORSE.sc * (0.95 + h * 0.04)); var ms = meshesOf("horse", U, "horse"); if (!ms) return; ms.forEach(function (m) { sg.add(m); });
      var g = new THREE.Group(); g.add(sg); var hb = contactBlob(0.95, 2.6); hb.position.z = -0.35; g.add(hb); scene.add(g);
      P.horses.push({ g: g, s: sg, U: U, meshes: ms, x: c[0] + (h - 1) * 4, z: c[1] + (h % 2 ? 2 : -1.5), h: h * 2.1, tgt: null, wait: 2 + h * 3, ph: h, amp: 0, graze: 0, sp: 0 }); } }
  function paddockStep(dt, cam) { var P = PR.paddock; if (!P || !P.horses) return; var d = Math.hypot(cam.x - P.c[0], cam.z - P.c[1]), vis = d < 380; P.horses.forEach(function (H) { if (H.g.visible !== vis) H.g.visible = vis; }); if (!vis) return;
    var t = performance.now() / 1000;
    P.horses.forEach(function (H, i) {
      if (!H.tgt) { H.wait -= dt; if (H.wait <= 0) H.tgt = [P.c[0] + (Math.random() * 2 - 1) * (P.hw - 2.4), P.c[1] + (Math.random() * 2 - 1) * (P.hd - 2.4)]; }
      var want = 0; if (H.tgt) { var dx = H.tgt[0] - H.x, dz = H.tgt[1] - H.z, dd = Math.hypot(dx, dz); if (dd < 0.4) { H.tgt = null; H.wait = 6 + Math.random() * 14; } else { var hw = Math.atan2(dx, dz), dh = wrapA(hw - H.h); H.h += clamp(dh, -dt * 0.9, dt * 0.9); want = Math.abs(dh) > 0.8 ? 0.35 : 1.15; } }
      P.horses.forEach(function (O, j) { if (j === i) return; var ox = H.x - O.x, oz = H.z - O.z, od = Math.hypot(ox, oz); if (od < 2.6 && od > 0.01) { H.x += ox / od * (2.6 - od) * 0.5; H.z += oz / od * (2.6 - od) * 0.5; } });
      H.sp += (want - H.sp) * Math.min(1, dt * 1.5); H.x += Math.sin(H.h) * H.sp * dt; H.z += Math.cos(H.h) * H.sp * dt;
      H.x = clamp(H.x, P.c[0] - P.hw + 1.5, P.c[0] + P.hw - 1.5); H.z = clamp(H.z, P.c[1] - P.hd + 1.5, P.c[1] + P.hd - 1.5);
      var np = bodyPose(H.x, H.z, H.h, HORSE.fore * HORSE.sc, HORSE.hind * HORSE.sc, 0.17, 0.2); np.r = 0; var p = smoothPose(H, "pose", np, dt); H.g.position.set(p.x, p.y, p.z); _e.set(-p.p, p.h, 0, "YXZ"); H.g.rotation.copy(_e);
      var A = H.sp > 0.1 ? 0.3 * Math.min(1, H.sp / 0.8) : 0; H.amp += (A - H.amp) * Math.min(1, dt * 2.5); H.ph = (H.ph + (H.sp / (1.13 * 0.3)) * dt) % (Math.PI * 200);
      var gz = !H.tgt && H.wait > 3 ? 1 : 0; H.graze += (gz - H.graze) * Math.min(1, dt * 0.8);
      if (d < 160) H.U.uH.value.set(H.graze * 0.55 + (H.amp > 0.01 ? Math.sin(H.ph * 2) * 0.05 : Math.sin(t * 0.7 + i) * 0.02), Math.sin(t * (1.2 + i * 0.2) + i) * 0.12, 0, 0);
      H.U.uG.value.set(H.ph % 6.28318, H.amp, 0.55 * Math.min(1, H.amp / 0.2), 0);
      var far = d > 55; if (far !== H.lod) { H.lod = far; H.meshes.forEach(function (m) { if (m.userData.lodGeo) m.geometry = far ? m.userData.lodGeo : m.userData.fullGeo; }); } }); }

  // ─────────────────────────────── hooks ───────────────────────────────
  function world() {
    if (!window.PLAN) return; PR.lines = [];
    [roverLine, coachLine].forEach(function (mk) { try { var L = mk(); sampleLine(L); PR.lines.push(L); } catch (e) { note("line " + (mk.name || ""), e); } });
    ribbonIndex(); PR.lines.forEach(function (L) { (L.surf || []).forEach(function (sf) { planRibbon(sf.pts, sf.w, { mat: L.laneMat === "redg" ? planMats().redg : M.dirt, lift: L.id === "rover" ? 0.246 : 0.22, tile: 4 }, sf.id); PR.ribbons.push({ id: sf.id, w: sf.w }); }); });
    ribbonIndex(); PR.lines.forEach(function (L) { safe("lanes " + L.id, function () { laneSurfaces(L); }); });
    // the ranch yard island: a hitching rail round a young mesquite
    var cl = PR.lines.filter(function (L) { return L.id === "coach"; })[0], yd = cl && cl.yard; if (yd) { try { put("mesquite", yd.c[0], yd.c[1], 0.7, 0.9); var e = PLACE.mesquite[PLACE.mesquite.length - 1]; if (e) e.keep = true; } catch (er) {} PR.yard = yd; }
    // the Frontier Ranch paddock: the spare team rests beside the yard (the paddock spot A2 tried is taken by the hay barn)
    safe("paddock", function () { if (!yd) return; var cands = [[yd.c[0] + 5, yd.c[1] + 24], [yd.c[0] - 8, yd.c[1] + 25], [yd.c[0] + 20, yd.c[1] + 20]];
      for (var i = 0; i < cands.length; i++) { var c = cands[i], ok = true; for (var k = 0; k < 9 && ok; k++) { var x = c[0] + (k % 3 - 1) * 7, z = c[1] + (Math.floor(k / 3) - 1) * 5.5; if (!planSpotOK(x, z, 1.5)) ok = false; }
        if (ok) { PR.paddock = { c: c, hw: 8, hd: 6 }; KEEPOUT.push([c[0], c[1], 10.5]); planKeepout([[c[0] - 8.6, c[1] - 6.6], [c[0] + 8.6, c[1] - 6.6], [c[0] + 8.6, c[1] + 6.6], [c[0] - 8.6, c[1] + 6.6]]); return; } } });
    PR.lines.forEach(function (L) { timetable(L); }); PR.n.world = 1;
  }
  function defer() {
    if (!window.PLAN || !PR.lines.length) return; mats();
    PR.lines.forEach(function (L) { L.veh = []; for (var k = 0; k < L.n; k++) { try { L.veh.push(buildVehicle(L, k)); } catch (e) { note("vehicle " + L.id + k, e); } } L.stops.forEach(function (st) { safe("stop " + st.id, function () { buildStop(L, st); }); }); });
    // the hitching rail round the yard island
    safe("yard", function () { var yd = PR.yard; if (!yd) return; var mm = mats(), r = 3.2, geos = [];
      for (var i = 0; i < 10; i++) { var a = i / 10 * Math.PI * 2, x = yd.c[0] + Math.cos(a) * r, z = yd.c[1] + Math.sin(a) * r, y = gAt(x, z); var gp = new THREE.BoxGeometry(0.14, 1.1, 0.14); gp.translate(x, y + 0.5, z); geos.push(gp);
        var a2 = (i + 1) / 10 * Math.PI * 2, x2 = yd.c[0] + Math.cos(a2) * r, z2 = yd.c[1] + Math.sin(a2) * r, y2 = gAt(x2, z2), L2 = Math.hypot(x2 - x, z2 - z); var gr = new THREE.BoxGeometry(0.09, 0.09, L2 + 0.08); gr.rotateY(Math.atan2(x2 - x, z2 - z)); gr.translate((x + x2) / 2, (y + y2) / 2 + 0.92, (z + z2) / 2); geos.push(gr); }
      var one = mergeSimple(geos);
      if (one) { var me = new THREE.Mesh(one, mm.timber); me.castShadow = true; me.receiveShadow = true; me.userData.noInst = true; scene.add(me); } COLLIDERS.push([yd.c[0], yd.c[1], r + 0.25]); });
    safe("paddock", buildPaddock);
    PR.built = true; PR.n.defer = 1;
  }
  function frame(dt, now) {
    if (!PR.built || !player) return;
    try { if (!PR.obst) { PR.obst = true; PR.lines.forEach(function (L) { safe("obstacles " + L.id, function () { obstaclePass(L); }); }); }
      var t = nowS(), cam = camera.position;
      // back from a hidden tab: the vehicle being ridden waits for its rider instead of jumping ahead along the loop
      if (PR.lastT && PR.ride && t - PR.lastT > 5) PR.ride.V.delay += t - PR.lastT; PR.lastT = t;
      PR.lines.forEach(function (L) { stepLine(L, t, dt, cam); }); boards(now); prompt(); paddockStep(dt, cam);
      if (PR.ride) seatNow(dt);   // again after the vehicle moved this frame, so the rider is drawn in the seat
    } catch (e) { note("frame", e); }
  }
  HK.world.unshift({ name: "planRidesWorld", fn: function () { safe("world", world); } });
  HK.defer.push({ name: "planRidesDefer", fn: function () { safe("defer", defer); } });
  HK.frame.push({ name: "planRidesFrame", fn: frame });
  HK.interior.push({ name: "planRidesSeat", fn: interiorHook });

  // ─────────────────────────────── debug helpers (headless tests) ───────────────────────────────
  PR.debug = {
    line: function (id) { return PR.lines.filter(function (L) { return L.id === id; })[0]; },
    info: function () { return PR.lines.map(function (L) { return { id: L.id, len: +L.P.L.toFixed(0), period: +L.T.P.toFixed(0), stops: L.stops.map(function (s) { return [s.id, +s.s.toFixed(0), +s.off.toFixed(2)]; }), veh: (L.veh || []).map(function (V) { return { s: V.cur ? +V.cur.s.toFixed(1) : null, stop: V.cur ? V.cur.stop : null, delay: +V.delay.toFixed(1), x: +V.g.position.x.toFixed(1), z: +V.g.position.z.toFixed(1), y: +V.g.position.y.toFixed(2), vis: V.g.visible }; }), bad: L.bad ? L.bad.length : null }; }); },
    // move vehicle k of a line to its i-th stop (or arc length s) by shifting its delay
    toStop: function (id, k, si, into) { var L = PR.debug.line(id), V = L.veh[k], st = L.stops[si]; var want = L.T.T[st.i] + (into || 1); var t = nowS() - k * L.T.P / L.veh.length; V.delay = ((t - want) % L.T.P + L.T.P) % L.T.P; V.pose = null; V.sPrev = undefined; return st.name; },
    toS: function (id, k, s) { var L = PR.debug.line(id), V = L.veh[k]; var i = 0; while (i < L.P.N - 1 && L.P.S[i] < s) i++; var want = L.T.T[i] + L.T.dw[i] + 0.01; var t = nowS() - k * L.T.P / L.veh.length; V.delay = ((t - want) % L.T.P + L.T.P) % L.T.P; V.pose = null; V.sPrev = undefined; return i; },
    board: function (id, k) { var L = PR.debug.line(id), V = L.veh[k]; var st = V.cur && V.cur.stop >= 0 ? L.stops[V.cur.stop] : L.stops[0]; return board({ V: V, L: L, st: st }); },
    use: function () { return useKey(); },
    where: function (id, k) { var L = PR.debug.line(id), V = L.veh[k]; var q = pathAt(L.P, V.cur ? V.cur.s : 0); return [q[0], gAt(q[0], q[1]), q[1], q[2]]; },
    // every `step` metres round a loop: how far each wheel (and each hoof) is from the drawn surface under it
    audit: function (id, step) { var L = PR.debug.line(id), M = L.M, out = { max: 0, min: 0, worst: [], n: 0 }, o = new THREE.Object3D();
      function chk(pose, pts, tag, s) { o.position.set(pose.x, pose.y, pose.z); o.rotation.set(-pose.p, pose.h, pose.r, "YXZ"); o.updateMatrixWorld(true);
        pts.forEach(function (lp) { var w = new THREE.Vector3(lp[0], lp[1], lp[2]).applyMatrix4(o.matrixWorld); var g = gAt(w.x, w.z), gap = w.y - g; out.n++; if (gap > out.max) out.max = gap; if (gap < out.min) out.min = gap; if (Math.abs(gap) > 0.12 && out.worst.length < 30) out.worst.push([tag, +s.toFixed(0), +w.x.toFixed(1), +w.z.toFixed(1), +gap.toFixed(2)]); }); }
      for (var s = 0; s < L.P.L; s += step || 2) {
        function wchk(fit, pts, lim) { fit.res.forEach(function (rr, i) { var gap = clamp(rr, -lim, lim) - rr; out.n++; if (gap > out.max) out.max = gap; if (gap < out.min) out.min = gap; if (Math.abs(gap) > 0.05 && out.worst.length < 30) out.worst.push(["wheel", +s.toFixed(0), i, +rr.toFixed(2)]); }); out.susp = Math.max(out.susp || 0, Math.max.apply(null, fit.res.map(Math.abs))); }
        if (L.id === "rover") { var q = pathAt(L.P, s); wchk(bodyFit(q[0], q[1], q[2], ROVER_PTS), ROVER_PTS, 0.14); }
        else { var r = pathAt(L.P, s + M.axR), f = pathAt(L.P, s + M.axF), hc = Math.atan2(f[0] - r[0], f[1] - r[1]); var cx = r[0] + Math.sin(hc) * -M.axR, cz = r[1] + Math.cos(hc) * -M.axR; wchk(bodyFit(cx, cz, hc, COACH_PTS), COACH_PTS, 0.07);
          [HORSE.wheelers, HORSE.leaders].forEach(function (off) { for (var sd = -1; sd <= 1; sd += 2) { var hq = pathAt(L.P, s + off), c = Math.cos(hq[2]), sn = Math.sin(hq[2]); var x = hq[0] + c * HORSE.lat * sd, z = hq[1] - sn * HORSE.lat * sd; var hp = bodyPose(x, z, hq[2], HORSE.fore * HORSE.sc, HORSE.hind * HORSE.sc, 0.17, 0.2); hp.r = 0; chk(hp, [[0.17, 0, HORSE.fore * HORSE.sc], [-0.17, 0, HORSE.fore * HORSE.sc], [0.2, 0, HORSE.hind * HORSE.sc], [-0.2, 0, HORSE.hind * HORSE.sc]], "hoof", s); } }); } }
      out.max = +out.max.toFixed(3); out.min = +out.min.toFixed(3); return out; },
    ground: function (id, s0, s1, step, lat) { var L = PR.debug.line(id), out = []; for (var s = s0; s <= s1; s += step || 0.5) { var q = pathAt(L.P, s), c = Math.cos(q[2]), sn = Math.sin(q[2]), o = lat || 0; var x = q[0] - c * o, z = q[1] + sn * o; out.push([+s.toFixed(1), +x.toFixed(2), +z.toFixed(2), +gAt(x, z).toFixed(3), +getH(x, z).toFixed(3)]); } return out; },
    path: function (id, step) { var L = PR.debug.line(id), out = []; for (var s = 0; s < L.P.L; s += step || 4) { var q = pathAt(L.P, s); out.push([+q[0].toFixed(1), +q[1].toFixed(1)]); } return out; }
  };
})();
