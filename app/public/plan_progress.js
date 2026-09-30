// plan_progress.js: the Sol Passport, ranks (Passenger, Pilot, Captain, Tower) and the community impact meter (round 3, progression).
// Loaded before client.js. Classic script: everything lives in the IIFE; client globals are reached by bare name at call time.
//   load   window.PLAN_PROGRESS (the public API) exists at once; awards made before /plan/progress.json arrives are queued.
//   world  hooks the client without editing it: act (activity completions), showTalk / startTour / openNearest (conversation stamps,
//          the Tower Lookout), setName (the rank badge on every nameplate), updateWallet / rankOf (the old coin rank line), closeCards,
//          openCartCard (reward paints); adds the reward paints to CART_COLORS; builds the HUD chip, the passport, the lookout and the
//          community pieces at Compass Plaza.
//   frame  arrival stamps, rides, landings, the daily visit, the room sync, the effects (fireworks, drones, beacon, festoon bulbs).
// Persistence: localStorage "g1:prog:v1" (versioned; every change is a read-modify-write so several tabs share one ledger, and the
// storage event refreshes the others). When the room supports it (view.progv, see src/logic.js "prog"), a compact copy lives in the
// room under the player id (stamp and award bit sets, repeatable XP, the day cap, the streak), merged both ways, so progress follows
// the player; the room also holds the shared in-game impact counters and each player's public rank (nameplates).
// Every word, XP value, threshold and reward is in /plan/progress.json. Ranks are earned by play only: never bought, never tied to
// coins, tokens or money. The impact meter is an in-game counter: no money figures, no donation claims.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
(function () {
  "use strict";
  var HK = window.PLAN_HOOKS;
  var LS_KEY = "g1:prog:v1";
  var API = window.PLAN_PROGRESS = window.PLAN_PROGRESS || {};
  var S = API._s = { data: null, ready: false, hooked: false, built: false, queue: [], ev: {}, errs: [], rec: null, cur: null,
    stampIdx: {}, stampByN: {}, placeStamps: [], talkStamps: {}, awardBits: {}, bitAwards: {}, server: false, serverSeen: "", lastPush: 0,
    lastPushKey: "", impactOverride: null, t: { arr: 0, sync: 0, ride: 0, day: 0, resolve: 0, hud: 0 }, ride: null, air: false, lastLanding: 0,
    cheerSeen: {}, capToast: -1, dirty: true, lookout: null, fx: null, lblImgs: [], lblReady: [], fontsOK: false, open: false, tab: "stamps", chap: null };
  API.errs = S.errs;
  function note(where, e) { var m = where + ": " + ((e && e.message) || e); S.errs.push(m); if (S.errs.length < 12) console.warn("plan_progress " + m, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""); }
  function safe(name, fn) { try { return fn(); } catch (e) { note(name, e); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function nowS() { return Math.floor(Date.now() / 1000); }
  function today() { return Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000); }
  function fmt(n) { return Math.round(n || 0).toLocaleString("en-US"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function $id(id) { return document.getElementById(id); }
  function D() { return S.data || {}; }
  function X() { return D().xp || {}; }
  function copy(k, dflt) { var c = D().copy || {}; return c[k] || dflt; }

  // ───────────────────────── events and the public API ─────────────────────────
  function emit(ev, data) { var l = S.ev[ev]; if (!l) return; for (var i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { note("listener " + ev, e); } } }
  API.on = function (ev, fn) { if (typeof fn !== "function") return function () {}; (S.ev[ev] = S.ev[ev] || []).push(fn); return function () { var l = S.ev[ev] || []; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; };
  // award(kind, data): kind is stamp {id}, talk {id}, activity {game}, arcade, flight {score 0..100}, landing, ride {kind}, quest {step};
  // any other kind counts as an activity of that name. Returns the XP gained (null while the data is still loading: it is queued).
  API.award = function (kind, data) { if (!S.ready) { S.queue.push([kind, data]); return null; } return safe("award " + kind, function () { return doAward(String(kind || ""), data || {}); }) || 0; };
  API.stamp = function (id) { return API.award("stamp", { id: id }); };
  API.xp = function () { return S.cur ? S.cur.xp : 0; };
  API.rank = function () { var c = S.cur; if (!c) return { index: 0, id: "passenger", name: "Passenger" }; var R = rankDef(c.rank); return { index: c.rank, id: R.id, name: R.name, xp: c.xp, next: c.next ? { id: c.next.id, name: c.next.name, xp: c.next.xp } : null }; };
  API.has = function (rewardId) { return !!S.cur && unlockedReward(rewardId); };
  API.state = function () { var c = S.cur || {}; var r = S.rec || {}; return { xp: c.xp || 0, rank: c.rank || 0, stamps: Object.keys(r.st || {}), awards: Object.keys(r.aw || {}), chapters: c.chapters || [], impact: impactTotals(), server: S.server, streak: r.sk || 0, title: r.ti || null }; };
  API.open = function (tab) { safe("open", function () { openPassport(tab); }); };
  API.close = function () { closePassport(); };

  // ───────────────────────── data ─────────────────────────
  fetch("/plan/progress.json?v=" + (window.BUILD || "dev")).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (!d) { note("progress.json", "missing"); return; } setData(d); }).catch(function (e) { note("progress.json", e); });
  function setData(d) {
    S.data = d; S.stampIdx = {}; S.stampByN = {}; S.placeStamps = []; S.talkStamps = {}; S.awardBits = {}; S.bitAwards = {};
    (d.chapters || []).forEach(function (c) { (c.stamps || []).forEach(function (s) { s.chapter = c; S.stampIdx[s.id] = s; S.stampByN[s.n] = s; if (s.talk) S.talkStamps[s.talk] = s; else S.placeStamps.push(s); }); });
    var bit = function (k, b) { if (b === undefined || b === null || b < 0 || b > 255) return; S.awardBits[k] = b; S.bitAwards[b] = k; };
    (d.chapters || []).forEach(function (c) { bit("chapter:" + c.id, c.n); });
    (d.activities || []).forEach(function (a) { bit("first:" + a.id, 32 + a.n); });
    ((d.impact || {}).milestones || []).forEach(function (m) { bit("community:" + m.id, 64 + m.n); });
    ((d.xp || {}).streaks || []).forEach(function (s, i) { bit("streak:" + s[0], 80 + i); });
    for (var q = 0; q < 8; q++) bit("quest:" + q, 88 + q);
    (d.rides || []).forEach(function (r) { bit("ride:" + r.id, 96 + r.n); });
    bit("first:flight", 112); bit("first:landing", 113); bit("passport", 114);
    S.rec = load(); S.cur = compute(S.rec); S.ready = true; S.dirty = true;
    if (S.hooked) { safe("resolve", resolveStamps); addPaints(); }
    var q2 = S.queue.splice(0); q2.forEach(function (a) { API.award(a[0], a[1]); });
    emit("ready", API.state());
  }
  function rankDef(i) { var R = D().ranks || []; return R[clamp(i | 0, 0, Math.max(0, R.length - 1))] || { id: "passenger", name: "Passenger", xp: 0, color: "#f5f1e6", perks: [] }; }
  function rankColor(i) { return rankDef(i).color || "#f5f1e6"; }
  function chapterById(id) { var C = D().chapters || []; for (var i = 0; i < C.length; i++) if (C[i].id === id) return C[i]; return null; }
  function activityById(id) { var A = D().activities || []; for (var i = 0; i < A.length; i++) if (A[i].id === id) return A[i]; return null; }
  function rideById(id) { var A = D().rides || []; for (var i = 0; i < A.length; i++) if (A[i].id === id) return A[i]; return null; }
  function milestones() { return ((D().impact || {}).milestones || []).slice().sort(function (a, b) { return a.at - b.at; }); }
  function titleName(id) { if (!id) return null; var T = D().titles || []; for (var i = 0; i < T.length; i++) if (T[i].id === id) return T[i].name; return null; }

  // ───────────────────────── the ledger (localStorage, versioned) ─────────────────────────
  function blank() { return { v: 1, st: {}, aw: {}, rx: 0, d: 0, dv: 0, vd: 0, sk: 0, c: {}, pend: {}, ti: null, seenRank: -1, capDay: 0, created: nowS() }; }
  function norm(r) { var b = blank(); for (var k in b) if (r[k] === undefined || r[k] === null && k !== "ti") r[k] = b[k]; if (typeof r.st !== "object") r.st = {}; if (typeof r.aw !== "object") r.aw = {}; if (typeof r.c !== "object") r.c = {}; if (typeof r.pend !== "object") r.pend = {}; return r; }
  var LS_OK = true;
  function load() {
    if (!LS_OK) return S.rec || blank();
    var raw = null; try { raw = localStorage.getItem(LS_KEY); } catch (e) { LS_OK = false; return S.rec || blank(); }
    if (!raw) return S.rec ? JSON.parse(JSON.stringify(S.rec)) : blank();
    try { var r = JSON.parse(raw); if (r && r.v === 1) return norm(r); } catch (e) { try { localStorage.setItem(LS_KEY + ":bad", raw); } catch (e2) {} }
    return blank();
  }
  function save(r) { S.rec = r; if (!LS_OK) return; try { localStorage.setItem(LS_KEY, JSON.stringify(r)); } catch (e) { LS_OK = false; } }
  window.addEventListener("storage", function (e) { if (e.key !== LS_KEY || !S.ready) return; safe("storage", function () { S.rec = load(); S.cur = compute(S.rec); S.dirty = true; refreshOwnLabel(); if (S.open) renderPassport(); }); });

  // XP: stamps and one-time awards are valued from progress.json at read time; repeatable XP (activities, flights, landings, rides after
  // the first, and daily visits) is the running total rx, with the repeat part capped per day (d, dv).
  function stampXP(s) { var x = X(); if (s.xp) return s.xp; return s.kind === "partner" ? (x.stamp_partner || 100) : s.kind === "local" ? (x.stamp_local || 50) : (x.stamp_place || 40); }
  function awardXP(k) {
    var x = X(), p = k.split(":");
    if (p[0] === "chapter") { var c = chapterById(p[1]); return c ? (c.bonus || x.chapter_bonus || 250) : 0; }
    if (k === "first:flight") return x.first_flight || 150; if (k === "first:landing") return x.first_landing || 100;
    if (p[0] === "first") return activityById(p[1]) ? (x.first_activity || 100) : 0;
    if (p[0] === "community") return x.community_share || 150;
    if (p[0] === "streak") { var L = x.streaks || []; for (var i = 0; i < L.length; i++) if (String(L[i][0]) === p[1]) return L[i][1]; return 0; }
    if (p[0] === "quest") return x.quest_step || 25;
    if (p[0] === "ride") return rideById(p[1]) ? (x.first_ride || 60) : 0;
    if (k === "passport") return x.passport_complete || 1000;
    return 0;
  }
  function required(c) { return (c.stamps || []).filter(function (s) { return !s.missing; }); }
  function compute(r) {
    var xp = 0, n = 0, total = 0;
    for (var id in r.st) { var s = S.stampIdx[id]; if (s) { xp += stampXP(s); n++; } }
    for (var k in r.aw) xp += awardXP(k);
    xp += r.rx || 0;
    var R = D().ranks || [{ xp: 0 }], rank = 0; for (var i = 0; i < R.length; i++) if (xp >= R[i].xp) rank = i;
    var next = R[rank + 1] || null;
    var chapters = (D().chapters || []).map(function (c) { var req = required(c), got = 0; req.forEach(function (s) { if (r.st[s.id]) got++; }); total += req.length; return { id: c.id, name: c.name, got: got, total: req.length, done: !!r.aw["chapter:" + c.id] }; });
    return { xp: xp, rank: rank, next: next, prevXp: (R[rank] || { xp: 0 }).xp, stamps: n, total: total, chapters: chapters };
  }
  function unlockedBy(u) {
    if (!u || !S.rec || !S.cur) return false; var p = u.split(":"), r = S.rec;
    if (p[0] === "rank") { var R = D().ranks || []; for (var i = 0; i < R.length; i++) if (R[i].id === p[1]) return S.cur.rank >= i; return false; }
    if (p[0] === "chapter") return !!r.aw["chapter:" + p[1]];
    if (p[0] === "streak") return !!r.aw["streak:" + p[1]];
    if (u === "passport") return !!r.aw.passport;
    return false;
  }
  function unlockedReward(id) { var L = (D().titles || []).concat(D().paints || []); for (var i = 0; i < L.length; i++) if (L[i].id === id) return unlockedBy(L[i].unlock); return false; }
  function unlockText(u) {
    if (!u) return ""; var p = u.split(":");
    if (p[0] === "rank") { var R = D().ranks || []; for (var i = 0; i < R.length; i++) if (R[i].id === p[1]) return "Reach " + R[i].name; }
    if (p[0] === "chapter") { var c = chapterById(p[1]); return "Complete " + (c ? c.name : p[1]); }
    if (p[0] === "streak") return "A " + p[1] + " day visit streak";
    if (u === "passport") return "Complete the whole passport";
    return u;
  }

  // commit: read-modify-write of the ledger, then the derived awards (chapters, passport), the rank check and the effects.
  function commit(fn, opts) {
    opts = opts || {}; var r = load(); var fx = []; var before = compute(r).xp;
    var out = fn(r, fx);
    checkCompletions(r, fx);
    var after = compute(r);
    if (r.seenRank < 0) r.seenRank = after.rank; else if (after.rank > r.seenRank) { fx.push({ type: "rank", rank: after.rank, prev: r.seenRank }); r.seenRank = after.rank; }
    save(r); S.cur = after; S.dirty = true;
    var gained = after.xp - before;
    if (gained) emit("xp", { xp: after.xp, gained: gained });
    for (var i = 0; i < fx.length; i++) { var f = fx[i]; if (opts.silent && f.type !== "rank") continue; safe("fx " + f.type, function () { runFx(f); }); }
    if (fx.some(function (f) { return f.type === "rank"; })) refreshOwnLabel();
    return out === undefined ? gained : out;
  }
  function checkCompletions(r, fx) {
    var C = D().chapters || [], all = C.length > 0;
    for (var i = 0; i < C.length; i++) { var c = C[i], req = required(c); var done = req.length > 0 && req.every(function (s) { return !!r.st[s.id]; }); if (!done) { all = false; continue; } var k = "chapter:" + c.id; if (!r.aw[k]) { r.aw[k] = nowS(); fx.push({ type: "chapter", chapter: c, xp: awardXP(k) }); } }
    if (all && !r.aw.passport) { r.aw.passport = nowS(); fx.push({ type: "passport", xp: awardXP("passport") }); }
  }
  function bump(r, key, n) { n = n || 1; r.c[key] = (r.c[key] || 0) + n; r.pend[key] = Math.min(500, (r.pend[key] || 0) + n); }
  function repeatXP(r, amount, fx) {
    var day = today(); if (r.d !== day) { r.d = day; r.dv = 0; }
    var cap = X().daily_repeat_cap || 500; var give = Math.max(0, Math.min(amount, cap - r.dv)); r.dv += give; r.rx += give;
    if (give < amount && r.capDay !== day) { r.capDay = day; fx.push({ type: "toast", k: "Daily repeat XP reached", t: "Stamps, firsts and bonuses still count today", xp: 0 }); }
    return give;
  }

  // ───────────────────────── awards ─────────────────────────
  function doAward(kind, data) {
    if (kind === "stamp") return doStamp(data.id);
    if (kind === "talk") return doTalk(data.id);
    if (kind === "flight") return doFlight(+data.score || 0);
    if (kind === "landing") return doLanding();
    if (kind === "ride") return doRide(String(data.kind || "ride"));
    if (kind === "quest") return doQuest(data.step | 0);
    if (kind === "arcade") return doActivity("arcade", data.game);
    if (kind === "activity" || kind === "score" || kind === "game") return doActivity(String(data.game || data.id || "activity"), data.sub);
    return doActivity(kind, null);
  }
  function doStamp(id) {
    var s = S.stampIdx[id]; if (!s || (S.rec && S.rec.st[id])) return 0;
    return commit(function (r, fx) { if (r.st[id]) return 0; r.st[id] = nowS(); bump(r, s.talk ? "talks" : "stamps"); fx.push({ type: "stamp", s: s, xp: stampXP(s) }); });
  }
  function doTalk(id) { var s = S.talkStamps[id]; return s ? doStamp(s.id) : 0; }
  function doActivity(game, sub) {
    var a = activityById(game); var name = a ? a.name : String(game).replace(/[_-]+/g, " ");
    return commit(function (r, fx) {
      bump(r, "acts"); var k = "first:" + game;
      if (a && S.awardBits[k] !== undefined && !r.aw[k]) { r.aw[k] = nowS(); fx.push({ type: "toast", k: "First time", t: name, xp: awardXP(k) }); emit("activity", { game: game, first: true }); return; }
      var g = repeatXP(r, X().activity || 20, fx); if (g) fx.push({ type: "toast", k: "Activity", t: name, xp: g, quiet: true }); emit("activity", { game: game, first: false });
    });
  }
  function doFlight(score) {
    return commit(function (r, fx) {
      bump(r, "flights");
      if (!r.aw["first:flight"]) { r.aw["first:flight"] = nowS(); fx.push({ type: "toast", k: "First flight", t: "Giveback One", xp: awardXP("first:flight") }); return; }
      var x = X(); var bonus = Math.round(clamp(score, 0, 100) / 100 * (x.flight_score_max || 60)); var g = repeatXP(r, (x.flight || 40) + bonus, fx); fx.push({ type: "toast", k: "Flight complete", t: "Giveback One", xp: g });
    });
  }
  function doLanding() {
    var t = Date.now(); if (t - S.lastLanding < 20000) return 0; S.lastLanding = t;
    return commit(function (r, fx) {
      bump(r, "landings");
      if (!r.aw["first:landing"]) { r.aw["first:landing"] = nowS(); fx.push({ type: "toast", k: "First landing", t: "Welcome back to Solport", xp: awardXP("first:landing") }); return; }
      var g = repeatXP(r, X().landing || 25, fx); fx.push({ type: "toast", k: "Landing", t: "Smooth landing", xp: g, quiet: true });
    });
  }
  function doRide(kind) {
    var rd = rideById(kind); var name = rd ? rd.name : kind;
    return commit(function (r, fx) {
      bump(r, "rides"); var k = "ride:" + kind;
      if (rd && !r.aw[k]) { r.aw[k] = nowS(); fx.push({ type: "toast", k: "First ride", t: name, xp: awardXP(k) }); return; }
      var g = repeatXP(r, X().ride || 10, fx); if (g) fx.push({ type: "toast", k: "Ride", t: name, xp: g, quiet: true });
    });
  }
  function doQuest(step) { var k = "quest:" + step; if (S.awardBits[k] === undefined || (S.rec && S.rec.aw[k])) return 0; return commit(function (r, fx) { if (r.aw[k]) return; r.aw[k] = nowS(); fx.push({ type: "toast", k: "Day one", t: "Step " + (step + 1) + " done", xp: awardXP(k) }); }); }
  function doVisit() {
    var day = today(); if (S.rec && S.rec.vd === day) return 0;
    return commit(function (r, fx) {
      if (r.vd === day) return; var sk = r.vd === day - 1 ? (r.sk || 0) + 1 : 1; r.vd = day; r.sk = sk; bump(r, "visits");
      var x = X(); var g = (x.visit || 25) + (x.visit_streak_step || 5) * Math.min(sk - 1, x.visit_streak_cap || 10); r.rx += g;
      fx.push({ type: "toast", k: sk > 1 ? "Daily visit · " + sk + " day streak" : "Daily visit", t: sk > 1 ? "Welcome back" : "Welcome to Genesis One", xp: g });
      (x.streaks || []).forEach(function (st) { var k = "streak:" + st[0]; if (sk >= st[0] && !r.aw[k]) { r.aw[k] = nowS(); fx.push({ type: "toast", k: "Streak bonus", t: st[0] + " days in a row", xp: st[1] }); } });
    });
  }
  function doCommunity(m) { var k = "community:" + m.id; if (!S.rec || S.rec.aw[k]) return 0; return commit(function (r, fx) { if (r.aw[k]) return; r.aw[k] = nowS(); fx.push({ type: "milestone", m: m, xp: awardXP(k) }); }); }

  // ───────────────────────── the room sync (compact copy, merged both ways) ─────────────────────────
  function bitsHex(bits) { var nib = []; bits.forEach(function (b) { var k = b >> 2; while (nib.length <= k) nib.push(0); nib[k] |= 1 << (b & 3); }); return nib.map(function (v) { return v.toString(16); }).join("").replace(/0+$/, ""); }
  function hexBits(h) { var out = []; h = String(h || ""); for (var i = 0; i < h.length; i++) { var v = parseInt(h[i], 16) || 0; for (var j = 0; j < 4; j++) if (v & (1 << j)) out.push(i * 4 + j); } return out; }
  function hexOr(a, b) { a = a || ""; b = b || ""; var o = ""; for (var i = 0; i < Math.max(a.length, b.length); i++) o += ((parseInt(a[i] || "0", 16) | parseInt(b[i] || "0", 16))).toString(16); return o.replace(/0+$/, ""); }
  function compact(r) {
    var sb = [], ab = []; for (var id in r.st) { var s = S.stampIdx[id]; if (s) sb.push(s.n); } for (var k in r.aw) { var b = S.awardBits[k]; if (b !== undefined) ab.push(b); }
    return { b: bitsHex(sb), a: bitsHex(ab), rx: r.rx | 0, d: r.d | 0, dv: r.dv | 0, vd: r.vd | 0, sk: r.sk | 0 };
  }
  function mergeServer(P) {
    if (!P) return; var key = JSON.stringify(P); if (key === S.serverSeen) return; S.serverSeen = key;
    var r0 = S.rec || load(); var need = false;
    hexBits(P.b).forEach(function (n) { var s = S.stampByN[n]; if (s && !r0.st[s.id]) need = true; });
    hexBits(P.a).forEach(function (b) { var k = S.bitAwards[b]; if (k && !r0.aw[k]) need = true; });
    if ((P.rx | 0) > r0.rx || (P.vd | 0) > r0.vd || ((P.vd | 0) === r0.vd && (P.sk | 0) > r0.sk) || (P.d | 0) > r0.d || ((P.d | 0) === r0.d && (P.dv | 0) > r0.dv)) need = true;
    if (!need) return;
    commit(function (r) {
      hexBits(P.b).forEach(function (n) { var s = S.stampByN[n]; if (s && !r.st[s.id]) r.st[s.id] = nowS(); });
      hexBits(P.a).forEach(function (b) { var k = S.bitAwards[b]; if (k && !r.aw[k]) r.aw[k] = nowS(); });
      if ((P.rx | 0) > r.rx) r.rx = P.rx | 0;
      if ((P.d | 0) > r.d) { r.d = P.d | 0; r.dv = P.dv | 0; } else if ((P.d | 0) === r.d && (P.dv | 0) > r.dv) r.dv = P.dv | 0;
      if ((P.vd | 0) > r.vd) { r.vd = P.vd | 0; r.sk = P.sk | 0; } else if ((P.vd | 0) === r.vd && (P.sk | 0) > r.sk) r.sk = P.sk | 0;
    }, { silent: true });
    if (S.open) renderPassport();
  }
  function syncTick() {
    var v = null; try { v = view; } catch (e) { return; } if (!v) return;
    S.server = v.progv === 1;
    if (!S.server) return;
    var mine = v.players && v.players[ME];
    if (mine && mine.pr && mine.pr.t && S.rec && !S.rec.ti && !S.rec.tiSet) commit(function (r) { if (!r.ti && !r.tiSet) r.ti = mine.pr.t; }, { silent: true });
    mergeServer(v.prog);
    var r = S.rec, c = compact(r), P = v.prog || {};
    var pub = { x: S.cur.xp | 0, r: S.cur.rank | 0, t: r.ti || null };
    var cur = (mine && mine.pr) || {};
    var dirty = hexOr(P.b, c.b) !== (P.b || "") || hexOr(P.a, c.a) !== (P.a || "") || c.rx > (P.rx | 0) || c.d > (P.d | 0) || (c.d === (P.d | 0) && c.dv > (P.dv | 0)) || c.vd > (P.vd | 0) || (c.vd === (P.vd | 0) && c.sk > (P.sk | 0)) || cur.x !== pub.x || cur.r !== pub.r || (cur.t || null) !== pub.t;
    var pend = r.pend || {}, add = null, step = 20; for (var k in pend) if (pend[k] > 0) { add = add || {}; add[k] = Math.min(step, pend[k]); }
    if (!dirty && !add) return;
    var t = Date.now(); var a = { t: "prog", b: c.b, a: c.a, rx: c.rx, d: c.d, dv: c.dv, vd: c.vd, sk: c.sk, x: pub.x, r: pub.r, ti: pub.t };
    var key = JSON.stringify(a); if (!add && key === S.lastPushKey && t - S.lastPush < 8000) return; if (t - S.lastPush < 1500) return;
    if (add) a.add = add;
    var send = S.act0 || (typeof act === "function" ? act : null); if (!send) return;
    send({ t: a.t, b: a.b, a: a.a, rx: a.rx, d: a.d, dv: a.dv, vd: a.vd, sk: a.sk, x: a.x, r: a.r, ti: a.ti, add: a.add });
    S.lastPush = t; S.lastPushKey = key;
    if (add) commit(function (rr) { for (var k2 in add) { rr.pend[k2] = Math.max(0, (rr.pend[k2] || 0) - add[k2]); if (!rr.pend[k2]) delete rr.pend[k2]; } }, { silent: true });
  }

  // ───────────────────────── community impact ─────────────────────────
  var IMPACT_KEYS = ["stamps", "talks", "flights", "landings", "acts", "rides", "visits"];
  function impactTotals() {
    var src = null, shared = false; try { if (S.server && view && view.impact) { src = view.impact; shared = true; } } catch (e) {}
    if (!src) src = (S.rec && S.rec.c) || {};
    var o = { shared: shared, total: 0, rows: {} }; IMPACT_KEYS.forEach(function (k) { var v = src[k] | 0; o.rows[k] = v; o.total += v; });
    if (S.impactOverride !== null) { o.total = S.impactOverride; o.override = true; }
    var mine = 0; var c = (S.rec && S.rec.c) || {}; IMPACT_KEYS.forEach(function (k) { mine += c[k] | 0; }); o.mine = mine;
    return o;
  }
  function impactTick() {
    var I = impactTotals(); var M = milestones(); var contributed = I.mine > 0 || (S.cur && S.cur.stamps > 0);
    for (var i = 0; i < M.length; i++) { var m = M[i]; if (I.total >= m.at) { fxEnable(m.id); if (contributed && !I.override) doCommunity(m); } }
    S.impact = I;
  }

  // ───────────────────────── client hooks ─────────────────────────
  function hookClient() {
    if (S.hooked) return; S.hooked = true;
    // every activity the game already reports to the room: the score boards, arcade prizes, the day one steps
    if (typeof act === "function") { var act0 = act; S.act0 = act0; act = function (a) { var ret = act0.apply(this, arguments); try { onAct(a); } catch (e) { note("act", e); } return ret; }; }
    if (typeof showTalk === "function") { var st0 = showTalk; showTalk = function (c, idx) { var ret = st0.apply(this, arguments); try { if (c) onTalk(c); } catch (e) { note("talk", e); } return ret; }; }
    if (typeof startTour === "function") { var tour0 = startTour; startTour = function () { try { API.award("talk", { id: "sky" }); } catch (e) {} return tour0.apply(this, arguments); }; }
    if (typeof openNearest === "function") { var on0 = openNearest; openNearest = function () { try { var nh = (player && typeof nearestHotspot === "function") ? nearestHotspot() : null; if (nh && nh.prog === "lookout" && !riding && !inside) { lookoutUse(); return; } if (nh && nh.play === "tour") API.award("talk", { id: "sky" }); } catch (e) { note("openNearest", e); } return on0.apply(this, arguments); }; }
    if (typeof setName === "function") { var sn0 = setName; S.setName0 = sn0; setName = function (g, name) { try { if (rankLabel(g, name)) return; } catch (e) { note("setName", e); } return sn0.apply(this, arguments); }; }
    if (typeof updateWallet === "function") { var uw0 = updateWallet; updateWallet = function (p) { try { lastRank = null; } catch (e) {} var ret = uw0.apply(this, arguments); try { var el = $id("rank"); if (el && S.cur) el.textContent = rankLine(); } catch (e) {} return ret; }; }
    if (typeof rankOf === "function") { rankOf = function () { return S.cur ? rankDef(S.cur.rank).name : "Passenger"; }; }
    if (typeof closeCards === "function") { var cc0 = closeCards; closeCards = function () { var ret = cc0.apply(this, arguments); try { if (!S.opening) closePassport(true); } catch (e) {} return ret; }; }
    if (typeof openCartCard === "function") { var oc0 = openCartCard; openCartCard = function () { try { paintButtons(); } catch (e) { note("paints", e); } return oc0.apply(this, arguments); }; }
    addPaints();
  }
  // the reward paints: colours 10 to 15 (the room accepts cart colours 0 to 15), added on every client so everyone sees them
  function addPaints() { try { (D().paints || []).forEach(function (p) { if (typeof CART_COLORS !== "undefined" && p.cartc >= 10 && p.cartc <= 15) CART_COLORS[p.cartc] = { name: p.name, hue: p.hue, sat: p.sat, light: p.light }; }); } catch (e) { note("cart colours", e); } }
  function onAct(a) {
    if (!a || typeof a !== "object") return;
    if (a.t === "score" && a.game) API.award("activity", { game: a.game });
    else if (a.t === "arcade" && a.op === "prize") API.award("arcade", { game: a.game });
    else if (a.t === "quest" && typeof a.step === "number") API.award("quest", { step: a.step });
  }
  function onTalk(c) {
    var id = c.id || null;
    if (!id && window.PLAN_TALK) for (var k in PLAN_TALK) if (PLAN_TALK[k] === c) { id = k; break; }
    if (id) API.award("talk", { id: id });
  }
  function rankLine() { var c = S.cur; if (!c) return ""; var R = rankDef(c.rank); return R.name + " · " + fmt(c.xp) + " XP" + (c.next ? " · " + fmt(c.next.xp - c.xp) + " to " + c.next.name : " · top rank"); }

  // ───────────────────────── nameplates: the rank badge everyone sees ─────────────────────────
  function insigniaSVG(r, uid) {
    var id = "pg" + (uid || "") + r;
    var bg = ["#10261a", "#0d2a19", "url(#" + id + "g)", "#0b1d2b"][r] || "#10261a", ring = ["#d9d1bb", "#4DDE6F", "#6b4f12", "#7fe3f0"][r] || "#d9d1bb", ink = ["#f5f1e6", "#4DDE6F", "#20170a", "#f4cd5a"][r] || "#f5f1e6";
    var defs = '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".55" stop-color="#f4cd5a"/><stop offset="1" stop-color="#b8852a"/></linearGradient></defs>';
    var wingL = "M28 31.5C22 30.5 14 28 7 24.5C8.5 27.5 11 29.6 14 30.9C11.6 31 10 30.8 8.6 30.5C10.6 32.6 13.6 33.9 17 34.3C15 34.9 13.6 35 12.2 34.9C14.6 36.7 19 37.3 28 35.7Z";
    var wings = '<path d="' + wingL + '" fill="' + ink + '"/><path d="' + wingL + '" fill="' + ink + '" transform="matrix(-1 0 0 1 64 0)"/>';
    var star = function (cx, cy, rr, f) { var p = ""; for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? rr * 0.45 : rr; p += (i ? "L" : "M") + (cx + Math.cos(a) * q).toFixed(2) + " " + (cy + Math.sin(a) * q).toFixed(2); } return '<path d="' + p + 'Z" fill="' + f + '"/>'; };
    var body = "";
    if (r === 0) body = '<path d="M32 13C33.6 13 34.4 15 34.4 17.5L34.4 26L50 34L50 37.5L34.4 33L34 43L39 47L39 49.5L32 47.8L25 49.5L25 47L30 43L29.6 33L14 37.5L14 34L29.6 26L29.6 17.5C29.6 15 30.4 13 32 13Z" fill="' + ink + '"/>';
    else if (r === 1) body = wings + '<circle cx="32" cy="33.6" r="5.4" fill="' + bg + '" stroke="' + ink + '" stroke-width="1.8"/>' + star(32, 33.8, 3.4, ink);
    else if (r === 2) body = wings + '<circle cx="32" cy="33.6" r="5.2" fill="' + ink + '"/>' + star(32, 20.5, 5.2, ink) + '<rect x="24" y="43" width="16" height="2.4" rx="1" fill="' + ink + '"/><rect x="26.5" y="47" width="11" height="2.2" rx="1" fill="' + ink + '"/>';
    else body = '<path d="M28.6 51L29.6 31.5L25.4 29.6L26.9 23.2L37.1 23.2L38.6 29.6L34.4 31.5L35.4 51Z" fill="' + ink + '"/><path d="M27.8 26.3L36.2 26.3" stroke="#0b1d2b" stroke-width="1.6"/><g stroke="#7fe3f0" stroke-width="1.8" stroke-linecap="round"><path d="M32 19.2L32 13.6"/><path d="M27.2 20.2L23.6 16.6"/><path d="M36.8 20.2L40.4 16.6"/><path d="M25.4 22.6L20.4 21.2"/><path d="M38.6 22.6L43.6 21.2"/></g>';
    var outer = r === 3 ? '<circle cx="32" cy="32" r="30.6" fill="none" stroke="#f4cd5a" stroke-width="1.6"/>' : "";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + defs + '<circle cx="32" cy="32" r="29" fill="' + bg + '" stroke="' + ring + '" stroke-width="' + (r === 2 ? 2.4 : 2.6) + '"/><circle cx="32" cy="32" r="24.6" fill="none" stroke="' + ring + '" stroke-opacity=".45" stroke-width="1"/>' + outer + body + '</svg>';
  }
  function lblImages() {
    if (S.lblImgs.length) return;
    for (var r = 0; r < 4; r++) (function (r) { var im = new Image(); im.onload = function () { S.lblReady[r] = true; refreshAllLabels(); }; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(insigniaSVG(r, "l")); S.lblImgs[r] = im; })(r);
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { S.fontsOK = true; refreshAllLabels(); }); } catch (e) {}
  }
  function pidOf(g) {
    if (typeof player !== "undefined" && g === player) return ME;
    var u = g.userData; if (u.progPid !== undefined) return u.progPid;
    var pid = null; try { avatars.forEach(function (a, id) { if (a.g === g) pid = id; }); } catch (e) {}
    if (pid !== null) u.progPid = pid; return pid;
  }
  function publicRank(pid) {
    if (pid === ME) { if (!S.cur) return null; return { r: S.cur.rank, t: S.rec && S.rec.ti }; }
    try { var p = view && view.players && view.players[pid]; if (p && p.pr && typeof p.pr.r === "number") return { r: clamp(p.pr.r | 0, 0, 3), t: p.pr.t || null }; } catch (e) {}
    return null;
  }
  function rankLabel(g, name) {
    if (!g || !g.userData) return false; var pid = pidOf(g); if (pid === null || pid === undefined) return false;
    var base = String(name || "").split(" · ")[0]; var pr = publicRank(pid);
    var key = base + "|" + (pr ? pr.r + ":" + (pr.t || "") : "-") + "|" + (pr && S.lblReady[pr.r] ? 1 : 0) + (S.fontsOK ? "f" : "");
    if (g.userData.name === name && g.userData.progKey === key) return true;
    var old = g.userData.label; var vis = old ? old.visible : true;
    g.userData.decalKey = null; if (old) { g.remove(old); if (old.userData && old.userData.progLabel) { try { old.material.map.dispose(); old.material.dispose(); } catch (e) {} } }
    var l = makeRankLabel(base, pr); l.visible = vis; g.add(l); g.userData.label = l; g.userData.name = name; g.userData.progKey = key;
    return true;
  }
  function makeRankLabel(name, pr) {
    var W = 512, H = 176; var c = document.createElement("canvas"); c.width = W; c.height = H; var x = c.getContext("2d");
    var rk = pr ? pr.r : -1; var col = rk >= 0 ? rankColor(rk) : "#f5f1e6";
    var sub = pr ? (titleName(pr.t) || rankDef(rk).name) : null; if (sub) sub = sub.toUpperCase();
    var nf = 52; var font = function (s) { return "600 " + s + "px 'Space Grotesk', system-ui, sans-serif"; };
    x.font = font(nf); var nw = x.measureText(name).width; var badge = rk >= 0 ? 112 : 0; var maxW = W - 52 - badge;
    while (nw > maxW && nf > 26) { nf -= 2; x.font = font(nf); nw = x.measureText(name).width; }
    var sw = 0; if (sub) { x.font = "700 21px 'JetBrains Mono', ui-monospace, monospace"; try { x.letterSpacing = "3px"; } catch (e) {} sw = x.measureText(sub).width; }
    var pw = Math.min(W - 6, Math.max(nw, sw) + 44 + badge), px0 = (W - pw) / 2, top = 16, ph = H - 32;
    x.beginPath(); if (x.roundRect) x.roundRect(px0, top, pw, ph, 30); else x.rect(px0, top, pw, ph);
    x.fillStyle = "rgba(10,22,16,.66)"; x.fill();
    if (rk >= 2) { x.lineWidth = 3.5; x.strokeStyle = rk === 3 ? "rgba(127,227,240,.95)" : "rgba(244,205,90,.95)"; x.stroke(); if (rk === 3) { x.beginPath(); if (x.roundRect) x.roundRect(px0 + 5, top + 5, pw - 10, ph - 10, 25); x.lineWidth = 1.5; x.strokeStyle = "rgba(244,205,90,.8)"; x.stroke(); } }
    else if (rk === 1) { x.lineWidth = 2; x.strokeStyle = "rgba(77,222,111,.55)"; x.stroke(); }
    if (rk >= 0) { var bs = 96, bx = px0 + 14, by = (H - bs) / 2; if (S.lblReady[rk] && S.lblImgs[rk]) x.drawImage(S.lblImgs[rk], bx, by, bs, bs); else { x.beginPath(); x.arc(bx + bs / 2, by + bs / 2, bs / 2 - 4, 0, Math.PI * 2); x.fillStyle = "#10261a"; x.fill(); x.lineWidth = 4; x.strokeStyle = col; x.stroke(); } }
    var tx = px0 + (rk >= 0 ? 14 + 96 + 16 : 22);
    try { x.letterSpacing = "0px"; } catch (e) {}
    x.textAlign = rk >= 0 ? "left" : "center"; var cx = rk >= 0 ? tx : W / 2;
    x.font = font(nf); x.fillStyle = "#f5f1e6"; x.textBaseline = "alphabetic"; x.fillText(name, cx, sub ? 92 : 106);
    if (sub) { x.font = "700 21px 'JetBrains Mono', ui-monospace, monospace"; try { x.letterSpacing = "3px"; } catch (e) {} x.fillStyle = col; x.fillText(sub, cx, 128); }
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(2.6, 2.6 * H / W, 1); s.position.y = 2.46; s.userData.progLabel = true; s.renderOrder = 5;
    return s;
  }
  function refreshOwnLabel() { try { if (typeof player !== "undefined" && player && player.userData) { player.userData.name = null; player.userData.progKey = null; } } catch (e) {} }
  function refreshAllLabels() { refreshOwnLabel(); try { avatars.forEach(function (a) { if (a.g && a.g.userData) a.g.userData.progKey = null; }); } catch (e) {} }

  // ───────────────────────── stamps: where they are ─────────────────────────
  function placeOf(id) { try { if (typeof planPlace === "function") { var q = planPlace(id); if (q) return q; } } catch (e) {} var P = window.PLAN; if (!P || !P.places) return null; for (var i = 0; i < P.places.length; i++) if (P.places[i].id === id) return P.places[i]; return null; }
  function cleanName(n) { return String(n || "").replace(/\s*\([^)]*\)\s*$/, "").trim(); }
  function resolveStamps() {
    var any = false;
    S.placeStamps.forEach(function (s) {
      if (s.at === "gbank") { var st = window.PLAN_GBANK && PLAN_GBANK.site; if (st && isFinite(st.cx)) { s.x = st.cx; s.z = st.cz; } s.r = s.r || 24; s.missing = !isFinite(s.x); return; }
      if (!s.place) { s.missing = !isFinite(s.x); return; }
      var q = placeOf(s.place); if (!q) { s.missing = !!window.PLAN; return; }
      s.x = q.x; s.z = q.z; s.r = s.r || clamp((q.r || 20) * 0.85, 14, 42); s.pname = cleanName(q.name); s.missing = false; any = true;
    });
    if (S.rec) S.cur = compute(S.rec); S.dirty = true; return any;
  }
  function stampName(s) {
    if (s.name) return s.name; if (s.pname) return s.pname;
    if (s.talk) { try { var c = castById(s.talk); if (c && c.name) return c.name; } catch (e) {} }
    return s.id;
  }
  function stampOrg(s) { if (s.org) return s.org; if (s.talk) { try { var c = castById(s.talk); if (c && c.role) return String(c.role); } catch (e) {} } return ""; }
  function arrivalTick() {
    if (!player || (typeof FLY !== "undefined" && FLY.on) || !S.rec) return;
    var px = player.position.x, pz = player.position.z;
    try { var gy = (typeof planGroundAt === "function" && window.PLAN) ? planGroundAt(px, pz) : getH(px, pz); if (player.position.y - gy > 16 && !(S.lookout && S.lookout.on)) return; } catch (e) {}
    for (var i = 0; i < S.placeStamps.length; i++) { var s = S.placeStamps[i]; if (s.missing || S.rec.st[s.id] || !isFinite(s.x)) continue; var dx = px - s.x, dz = pz - s.z; if (dx * dx + dz * dz < s.r * s.r) doStamp(s.id); }
  }

  // ───────────────────────── rides and landings ─────────────────────────
  function rideKind() {
    try { if (window.PLAN_RIDES && PLAN_RIDES.ride) { var Rd = PLAN_RIDES.ride; var k = (Rd.L && Rd.L.kind) || (Rd.V && Rd.V.L && Rd.V.L.kind) || (Rd.V && Rd.V.kind); return k === "stagecoach" ? "stagecoach" : "rover"; } } catch (e) {}
    try { if (window.PLAN_CROSSING && PLAN_CROSSING.ride) return "crossing"; } catch (e) {}
    try { if (SITES.ride) return "shuttle"; } catch (e) {}
    try { if (RIDE_ON.id) return "friend"; } catch (e) {}
    try { if (riding && !riding.driver) return riding.kind === "jet" ? "jet" : "cart"; } catch (e) {}
    return null;
  }
  function rideTick(now) {
    var k = rideKind(); var R = S.ride;
    if (R && R.k !== k) { if (now - R.t0 > 15000) API.award("ride", { kind: R.k }); S.ride = null; R = null; }
    if (!R && k) S.ride = { k: k, t0: now };
    try {
      if (riding && riding.kind === "jet" && riding.driver && view && view.vehicles && view.vehicles[riding.id]) { var y = view.vehicles[riding.id].y || 0; if (y > 40) S.air = true; else if (S.air && y < 0.8) { S.air = false; API.award("landing"); } }
      else S.air = false;
    } catch (e) {}
  }
  // Captain's Cheer: a cheer by anyone at Captain or Tower launches a gold firework over them, on every client (emote and rank are synced)
  function cheerTick() {
    var v = null; try { v = view; } catch (e) {} if (!v || !v.players) return;
    for (var id in v.players) { var p = v.players[id]; if (!p || p.emote !== "cheer") continue; var seen = S.cheerSeen[id]; S.cheerSeen[id] = p.emoteTick; if (seen === undefined || seen === p.emoteTick) continue;
      var pr = publicRank(id); if (!pr || pr.r < 2) continue; var g = id === ME ? player : ((avatars.get(id) || {}).g); if (!g || !g.visible) continue;
      if (Math.hypot(g.position.x - camera.position.x, g.position.z - camera.position.z) > 400) continue;
      fxBurst(g.position.x, g.position.y + 9, g.position.z, pr.r === 3 ? [0.5, 0.9, 1] : [1, 0.82, 0.36], 80, 10); }
  }

  // ───────────────────────── the Tower Lookout (Tower rank): the roof deck of the Solport control tower ─────────────────────────
  function buildLookout() {
    var L = D().lookout; if (!L || typeof PLACE === "undefined" || !PLACE[L.place || "tower"] || !PLACE[L.place || "tower"][0]) return;
    var e = PLACE[L.place || "tower"][0]; var sc = e[4] || 1; var deck = e[1] + (L.deckUp || 24.9) * sc;
    var O = S.lookout = { x: e[0], z: e[2], y: deck, sc: sc, on: false, col: null, solids: [] };
    // collision: an inner ring keeps visitors off the antenna field, an outer ring is the parapet; the deck itself is a walkable solid
    var ring = function (r, n, h, tag) { for (var i = 0; i < n; i++) { var a = (i + 0.5) / n * Math.PI * 2; var len = 2 * r * Math.tan(Math.PI / n) + 0.35; var sd = addSolid(O.x + Math.cos(a) * r, O.z + Math.sin(a) * r, -a + Math.PI / 2, len, 0.3, deck - 0.4, deck + h, tag); if (sd) O.solids.push(sd); } };
    var top = addSolid(O.x, O.z, 0, 11.6 * sc, 11.6 * sc, deck - 0.5, deck, "lookout:deck"); if (top) O.solids.push(top);
    ring(4.05 * sc, 10, 2.4, "lookout:in"); ring(6.2 * sc, 14, 1.3, "lookout:rail");
    // a slim glass parapet with a gold cap rail round the roof edge
    var g = new THREE.Group(); g.name = "progLookout"; g.position.set(O.x, deck, O.z);
    var glass = new THREE.Mesh(new THREE.CylinderGeometry(6.02 * sc, 6.02 * sc, 1.02, 56, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe6ee, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    glass.position.y = 0.51; g.add(glass);
    var gold = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.85, roughness: 0.32 });
    var cap = new THREE.Mesh(new THREE.TorusGeometry(6.02 * sc, 0.045, 6, 72), gold); cap.rotation.x = Math.PI / 2; cap.position.y = 1.04; g.add(cap);
    var postG = new THREE.CylinderGeometry(0.035, 0.035, 1.04, 6); var posts = new THREE.InstancedMesh(postG, gold, 16); var m4 = new THREE.Matrix4();
    for (var i = 0; i < 16; i++) { var a = i / 16 * Math.PI * 2; m4.makeTranslation(Math.cos(a) * 6.02 * sc, 0.52, Math.sin(a) * 6.02 * sc); posts.setMatrixAt(i, m4); } g.add(posts);
    g.traverse(function (o) { o.userData.noCull = true; o.userData.noInst = true; }); scene.add(g); O.g = g;
    // the lift: E at the foot of the tower (or on the roof, to come down)
    var hs = { x: O.x, z: O.z, r: 7.5, t: L.name || "Tower Lookout", k: "Tower rank · press E", p: L.locked || "", prog: "lookout" };
    try { hotspots.unshift(hs); } catch (e) {} O.hs = hs;
  }
  function lookoutUse() {
    var O = S.lookout, L = D().lookout || {}; if (!O) return;
    if (O.on || player.position.y > O.y - 2) { lookoutDown(); return; }
    if (!S.cur || S.cur.rank < (L.minRank || 3)) { var need = (D().ranks || [])[L.minRank || 3]; setStatus((L.locked || "The Tower Lookout opens at Tower rank.") + (need && S.cur ? " " + fmt(need.xp - S.cur.xp) + " XP to go." : ""), true); try { sfx("ui"); } catch (e) {} return; }
    lookoutUp();
  }
  function lookoutUp() {
    var O = S.lookout; if (!O) return; var fade = $id("fade");
    if (fade) { fade.style.transition = "opacity .35s"; fade.style.opacity = 1; }
    setTimeout(function () { safe("lookout up", function () {
      towerCollider(false); var a = Math.atan2(-142 - O.z, 129 - O.x); var r = 5.1 * O.sc;
      player.position.set(O.x + Math.cos(a) * r, O.y + 0.02, O.z + Math.sin(a) * r); try { airborne = false; vy = 0; } catch (e) {}
      try { yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); } catch (e) {} O.on = true;
      try { S.act0({ t: "warp", x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2) }); lastSent.x = player.position.x; lastSent.z = player.position.z; pushMove(true); } catch (e) {}
      setStatus("Tower Lookout · walk round the roof · E to take the lift down"); try { sfx("board"); } catch (e) {}
      if (fade) setTimeout(function () { fade.style.opacity = 0; }, 250);
    }); }, 380);
  }
  function lookoutDown() {
    var O = S.lookout; if (!O) return; O.on = false; towerCollider(true);
    var a = Math.atan2(-142 - O.z, 129 - O.x); try { warpTo(O.x + Math.cos(a) * 11, O.z + Math.sin(a) * 11); } catch (e) { note("lookout down", e); }
    setStatus("back on the apron"); try { sfx("board"); } catch (e) {}
  }
  function towerCollider(on) {
    var O = S.lookout; if (!O) return;
    try { if (!on) { for (var i = COLLIDERS.length - 1; i >= 0; i--) { var c = COLLIDERS[i]; if (Math.hypot(c[0] - O.x, c[1] - O.z) < 1 && c[2] > 3 && c[2] < 9) { O.col = c; COLLIDERS.splice(i, 1); } } } else if (O.col && COLLIDERS.indexOf(O.col) < 0) { COLLIDERS.push(O.col); O.col = null; } } catch (e) { note("collider", e); }
  }
  function lookoutTick() {
    var O = S.lookout; if (!O || !O.on || !player) return;
    var d = Math.hypot(player.position.x - O.x, player.position.z - O.z);
    if (player.position.y < O.y - 3 || d > 9 || (typeof inside !== "undefined" && inside)) { O.on = false; towerCollider(true); }
  }

  // ───────────────────────── community pieces at Compass Plaza and the effects ─────────────────────────
  function groundAt(x, z) { try { if (typeof planGroundAt === "function" && window.PLAN) return planGroundAt(x, z); } catch (e) {} var y = 0; try { y = getH(x, z); } catch (e) {} try { y += roadLiftAt(x, z) || 0; } catch (e) {} return y; }
  function dotTexture() {
    var c = document.createElement("canvas"); c.width = c.height = 64; var x = c.getContext("2d"); var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.85)"); gr.addColorStop(0.6, "rgba(255,255,255,.18)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c); return t;
  }
  function fxInit() {
    if (S.fx) return S.fx; var F = S.fx = { on: {}, plaza: null, parts: null, drones: null, beacon: null, banners: null, bulbs: null, slot: -1, tex: dotTexture() };
    var q = placeOf("compass_plaza"); F.plaza = q ? { x: q.x, z: q.z, r: q.r || 45 } : { x: 821.8, z: 472.8, r: 45 }; F.plaza.y = groundAt(F.plaza.x, F.plaza.z);
    // particles (fireworks, the Captain's Cheer, the rank-up burst): one Points object, recycled
    var N = 900; var geo = new THREE.BufferGeometry(); var pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    var mat = new THREE.PointsMaterial({ size: 1.6, map: F.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true });
    var pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.userData.noCull = true; pts.userData.noInst = true; pts.renderOrder = 3; scene.add(pts);
    F.parts = { pts: pts, geo: geo, N: N, pos: pos, col: col, vel: new Float32Array(N * 3), base: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), drag: new Float32Array(N), head: 0, live: 0, rockets: [] };
    return F;
  }
  function fxBurst(x, y, z, rgb, count, speed) {
    var F = fxInit(), P = F.parts; count = count || 80; speed = speed || 12;
    for (var i = 0; i < count; i++) { var k = P.head; P.head = (P.head + 1) % P.N; var u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = speed * (0.75 + Math.random() * 0.35);
      P.pos[k * 3] = x; P.pos[k * 3 + 1] = y; P.pos[k * 3 + 2] = z; P.vel[k * 3] = Math.cos(th) * s * v; P.vel[k * 3 + 1] = u * v + 2; P.vel[k * 3 + 2] = Math.sin(th) * s * v;
      var tw = 0.85 + Math.random() * 0.3; P.base[k * 3] = rgb[0] * tw; P.base[k * 3 + 1] = rgb[1] * tw; P.base[k * 3 + 2] = rgb[2] * tw; P.life[k] = P.max[k] = 1.5 + Math.random() * 1.1; P.drag[k] = 1.6; }
    P.live = 4;
  }
  function fxRocket(x, z, h, rgb) { var F = fxInit(); var y0 = groundAt(x, z) + 1; F.parts.rockets.push({ x: x, y: y0, z: z, vy: h / 1.3, t: 1.3, rgb: rgb }); F.parts.live = 4; }
  function fxParticles(dt) {
    var F = S.fx; if (!F || !F.parts) return; var P = F.parts; if (P.live <= 0 && !P.rockets.length) return;
    var any = false;
    for (var j = P.rockets.length - 1; j >= 0; j--) { var R = P.rockets[j]; R.t -= dt; R.y += R.vy * dt; R.vy *= Math.exp(-dt * 0.8);
      var k0 = P.head; P.head = (P.head + 1) % P.N; P.pos[k0 * 3] = R.x + (Math.random() - 0.5) * 0.3; P.pos[k0 * 3 + 1] = R.y; P.pos[k0 * 3 + 2] = R.z + (Math.random() - 0.5) * 0.3; P.vel[k0 * 3] = 0; P.vel[k0 * 3 + 1] = -2; P.vel[k0 * 3 + 2] = 0; P.base[k0 * 3] = 1; P.base[k0 * 3 + 1] = 0.75; P.base[k0 * 3 + 2] = 0.45; P.life[k0] = P.max[k0] = 0.5; P.drag[k0] = 2;
      if (R.t <= 0) { P.rockets.splice(j, 1); fxBurst(R.x, R.y, R.z, R.rgb, 110, 15); } }
    for (var i = 0; i < P.N; i++) { if (P.life[i] <= 0) continue; P.life[i] -= dt; var i3 = i * 3;
      if (P.life[i] <= 0) { P.pos[i3 + 1] = -9999; P.col[i3] = P.col[i3 + 1] = P.col[i3 + 2] = 0; continue; } any = true;
      var dr = Math.exp(-dt * P.drag[i]); P.vel[i3] *= dr; P.vel[i3 + 1] = P.vel[i3 + 1] * dr - 5.5 * dt; P.vel[i3 + 2] *= dr;
      P.pos[i3] += P.vel[i3] * dt; P.pos[i3 + 1] += P.vel[i3 + 1] * dt; P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
      var f = P.life[i] / P.max[i]; var a = f > 0.7 ? 1 : f / 0.7; a = a * a * (0.8 + 0.2 * Math.sin(i + P.life[i] * 30)); P.col[i3] = P.base[i3] * a; P.col[i3 + 1] = P.base[i3 + 1] * a; P.col[i3 + 2] = P.base[i3 + 2] * a; }
    P.geo.attributes.position.needsUpdate = true; P.geo.attributes.color.needsUpdate = true; if (!any && !P.rockets.length) P.live -= dt;
  }
  function fxEnable(id) {
    var F = fxInit(); if (F.on[id]) return; F.on[id] = true;
    safe("fx " + id, function () { if (id === "banners") buildBanners(); else if (id === "lanterns") buildBulbs(); else if (id === "drones") buildDrones(); else if (id === "beacon") buildBeacon(); });
  }
  // a clear spot for a pole: no collider, solid, placed model or walk centre line within reach
  function nearPlaced(cx, cz, R) {
    var out = []; try { for (var k in PLACE) { var L = PLACE[k]; if (!L || !L.length) continue; for (var m = 0; m < L.length; m++) { var e = L[m]; if (e && Math.abs(e[0] - cx) < R && Math.abs(e[2] - cz) < R) out.push([e[0], e[2], 1.6 * (e[4] || 1)]); } } } catch (e) {}
    try { COLLIDERS.forEach(function (c) { if (Math.abs(c[0] - cx) < R && Math.abs(c[1] - cz) < R) out.push([c[0], c[1], c[2]]); }); } catch (e) {}
    try { SOLIDS.forEach(function (s) { if (Math.abs(s.x - cx) < R && Math.abs(s.z - cz) < R) out.push([s.x, s.z, Math.hypot(s.hw, s.hd)]); }); } catch (e) {}
    return out;
  }
  function clearSpot(x, z, rr) {
    var N = S.fx && S.fx.near; if (N) for (var i = 0; i < N.length; i++) { var q = N[i]; if (Math.hypot(q[0] - x, q[1] - z) < q[2] + rr) return false; }
    try { var rs = nearestRoadSeg(x, z); if (rs && rs.d < rs.w / 2 + rr) return false; } catch (e) {}
    return true;
  }
  function bannerTexture(kind) {
    var c = document.createElement("canvas"); c.width = 256; c.height = 768; var x = c.getContext("2d");
    var gold = kind === 1; var bg = x.createLinearGradient(0, 0, 0, 768); if (gold) { bg.addColorStop(0, "#f7d774"); bg.addColorStop(1, "#c9962e"); } else { bg.addColorStop(0, "#1c5c35"); bg.addColorStop(1, "#0c2a18"); }
    x.fillStyle = bg; x.fillRect(0, 0, 256, 768);
    x.strokeStyle = gold ? "rgba(40,28,6,.7)" : "rgba(244,205,90,.9)"; x.lineWidth = 6; x.strokeRect(14, 14, 228, 740);
    x.beginPath(); x.moveTo(14, 700); x.lineTo(128, 756); x.lineTo(242, 700); x.stroke();
    var ink = gold ? "#1a1406" : "#f5f1e6", acc = gold ? "#0f3a22" : "#f4cd5a";
    // the compass star
    x.save(); x.translate(128, 170); x.fillStyle = acc; x.beginPath(); for (var i = 0; i < 16; i++) { var a = -Math.PI / 2 + i * Math.PI / 8, r = i % 2 ? 22 : (i % 4 === 0 ? 70 : 40); x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); x.restore();
    x.fillStyle = ink; x.textAlign = "center"; x.font = "400 58px Anton, Impact, sans-serif";
    ["GENESIS", "ONE"].forEach(function (w, i) { x.fillText(w, 128, 330 + i * 66); });
    x.font = "700 21px 'JetBrains Mono', monospace"; try { x.letterSpacing = "5px"; } catch (e) {} x.fillStyle = acc;
    x.fillText(gold ? "SOL PASSPORT" : "COMMUNITY", 128, 470); x.fillText(gold ? "EVERY STAMP" : "IN-GAME", 128, 510); x.fillText(gold ? "COUNTS" : "IMPACT", 128, 544);
    try { x.letterSpacing = "0px"; } catch (e) {} x.font = "400 30px Anton, Impact, sans-serif"; x.fillStyle = ink; x.fillText("SOLPORT", 128, 640);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function buildBanners() {
    var F = fxInit(), P = F.plaza; var spots = []; F.near = nearPlaced(P.x, P.z, P.r + 20);
    // a pole every 45 degrees or so just outside the paved circle, on a clear spot; the banner hangs beside the pole on two arms
    // (tangent to the plaza) and faces the plaza centre
    var R0 = P.r + 3.5; for (var i = 0; i < 24 && spots.length < 8; i++) {
      var a = (i / 24) * Math.PI * 2 + 0.13; var ok = null;
      for (var dr = 0; dr <= 6 && !ok; dr += 1.5) { var x = P.x + Math.cos(a) * (R0 + dr), z = P.z + Math.sin(a) * (R0 + dr); var ux = (P.x - x), uz = (P.z - z), ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul; var tx = -uz, tz = ux;
        if (clearSpot(x, z, 1.4) && clearSpot(x + tx * 1.15, z + tz * 1.15, 1.3) && spots.every(function (s) { return Math.hypot(s[0] - x, s[1] - z) > 26; })) ok = [x, z, a, tx, tz]; }
      if (ok) spots.push(ok);
    }
    F.bannerSpots = spots; if (!spots.length) return;
    var g = new THREE.Group(); g.name = "progBanners";
    var steel = new THREE.MeshStandardMaterial({ color: 0x2b2f2c, metalness: 0.7, roughness: 0.45 });
    var poleG = new THREE.CylinderGeometry(0.1, 0.13, 10.4, 10); poleG.translate(0, 5.2, 0);
    var armG = new THREE.CylinderGeometry(0.045, 0.045, 2.05, 6); armG.rotateZ(Math.PI / 2); armG.translate(1.02, 0, 0);
    var finG = new THREE.SphereGeometry(0.19, 12, 8);
    var poles = new THREE.InstancedMesh(poleG, steel, spots.length), arms = new THREE.InstancedMesh(armG, steel, spots.length * 2), fins = new THREE.InstancedMesh(finG, new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.9, roughness: 0.3 }), spots.length);
    var texA = bannerTexture(0), texB = bannerTexture(1);
    var mk = function (tex) { return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.FrontSide }); };
    var bG = new THREE.PlaneGeometry(1.7, 5.1); var nA = Math.ceil(spots.length / 2), nB = Math.floor(spots.length / 2);
    var bA = new THREE.InstancedMesh(bG, mk(texA), nA * 2), bB = new THREE.InstancedMesh(bG, mk(texB), Math.max(1, nB * 2));
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), eu = new THREE.Euler(); var ia = 0, ib = 0;
    spots.forEach(function (s, i) {
      var y = groundAt(s[0], s[1]); var tx = s[3], tz = s[4]; var face = Math.atan2(tz, -tx);   // +z of the plane points to the plaza centre: u = (tz, -tx)
      m.makeTranslation(s[0], y - 0.3, s[1]); poles.setMatrixAt(i, m);
      m.makeTranslation(s[0], y + 10.2, s[1]); fins.setMatrixAt(i, m);
      for (var j = 0; j < 2; j++) { eu.set(0, Math.atan2(-tz, tx), 0); q.setFromEuler(eu); v.set(s[0], y + (j ? 4.25 : 9.25), s[1]); m.compose(v, q, sc); arms.setMatrixAt(i * 2 + j, m); }
      var list = i % 2 ? bB : bA; var idx = i % 2 ? ib : ia; var cx = s[0] + tx * 1.12, cz = s[1] + tz * 1.12;
      for (var side = 0; side < 2; side++) { eu.set(0, face + (side ? Math.PI : 0), 0); q.setFromEuler(eu); var nx = Math.sin(face), nz = Math.cos(face); var o = side ? -0.035 : 0.035; v.set(cx + nx * o, y + 6.72, cz + nz * o); m.compose(v, q, sc); list.setMatrixAt(idx * 2 + side, m); }
      if (i % 2) ib++; else ia++;
    });
    [poles, arms, fins, bA, bB].forEach(function (o) { o.instanceMatrix.needsUpdate = true; o.castShadow = true; o.receiveShadow = false; o.userData.noCull = true; o.userData.noInst = true; g.add(o); });
    scene.add(g); F.banners = g;
  }
  // festoon bulbs strung between the banner poles (the Lantern Ring), glowing after dark
  function buildBulbs() {
    var F = fxInit(); if (!F.bannerSpots) buildBanners(); var S2 = F.bannerSpots || []; if (S2.length < 2) return;
    var pts = [], P = F.plaza; var order = S2.slice().sort(function (a, b) { return a[2] - b[2]; });
    for (var i = 0; i < order.length; i++) { var A = order[i], B = order[(i + 1) % order.length]; var ya = groundAt(A[0], A[1]) + 9.95, yb = groundAt(B[0], B[1]) + 9.95; var L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L > 70) continue; var n = Math.max(8, Math.round(L / 1.6));
      for (var k = 1; k < n; k++) { var t = k / n; var sag = Math.sin(t * Math.PI) * Math.min(3.2, L * 0.08); pts.push(A[0] + (B[0] - A[0]) * t, ya + (yb - ya) * t - sag, A[1] + (B[1] - A[1]) * t); } }
    var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    var mat = new THREE.PointsMaterial({ size: 0.9, map: F.tex, color: 0xffc977, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true });
    var b = new THREE.Points(geo, mat); b.frustumCulled = false; b.userData.noCull = true; b.userData.noInst = true; scene.add(b); F.bulbs = b;
  }
  // the drone show: 180 lights flying formations over Compass Plaza after dark, timed by the wall clock so everyone sees the same figure
  function sampleText(txt, n, w, h) {
    var c = document.createElement("canvas"); c.width = 420; c.height = 110; var x = c.getContext("2d"); x.fillStyle = "#fff"; x.font = "400 92px Anton, Impact, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, 210, 58);
    var d = x.getImageData(0, 0, 420, 110).data, cand = []; for (var yy = 0; yy < 110; yy += 3) for (var xx = 0; xx < 420; xx += 3) if (d[(yy * 420 + xx) * 4 + 3] > 140) cand.push([xx, yy]);
    var out = []; for (var i = 0; i < n; i++) { var p = cand[Math.floor(i * cand.length / n)] || [210, 55]; out.push([(p[0] / 420 - 0.5) * w, (0.5 - p[1] / 110) * h]); } return out;
  }
  function buildDrones() {
    var F = fxInit(); var N = 180;
    var ring = [], grid = [], star = [], jet = [];
    for (var i = 0; i < N; i++) { var a = i / N * Math.PI * 2; ring.push([Math.cos(a) * 26, Math.sin(a) * 26]); grid.push([((i % 18) - 8.5) * 3.2, (Math.floor(i / 18) - 4.5) * 3.2]); }
    for (var j = 0; j < N; j++) { var t = j / N, arm = Math.floor(t * 16), f = t * 16 - arm; var a0 = -Math.PI / 2 + arm * Math.PI / 8, a1 = a0 + Math.PI / 8; var r0 = arm % 2 ? 11 : (arm % 4 === 0 ? 32 : 20), r1 = (arm + 1) % 2 ? 11 : ((arm + 1) % 4 === 0 ? 32 : 20); star.push([Math.cos(a0) * r0 * (1 - f) + Math.cos(a1) * r1 * f, -(Math.sin(a0) * r0 * (1 - f) + Math.sin(a1) * r1 * f)]); }
    var jp = [[0, 22], [2.6, 14], [3, 4], [26, -6], [26, -10], [3, -6], [2.2, -18], [9, -24], [9, -27], [0, -24], [-9, -27], [-9, -24], [-2.2, -18], [-3, -6], [-26, -10], [-26, -6], [-3, 4], [-2.6, 14]];
    var per = 0, segs = []; for (var s = 0; s < jp.length; s++) { var A = jp[s], B = jp[(s + 1) % jp.length]; var L = Math.hypot(B[0] - A[0], B[1] - A[1]); segs.push([A, B, L]); per += L; }
    for (var q = 0; q < N; q++) { var dist = q / N * per; for (var s2 = 0; s2 < segs.length; s2++) { if (dist <= segs[s2][2]) { var u = dist / segs[s2][2]; jet.push([segs[s2][0][0] + (segs[s2][1][0] - segs[s2][0][0]) * u, segs[s2][0][1] + (segs[s2][1][1] - segs[s2][0][1]) * u + 4]); break; } dist -= segs[s2][2]; } }
    var text = sampleText("GENESIS ONE", N, 78, 20);
    F.forms = [{ p: grid, c: [0.95, 0.95, 1] }, { p: ring, c: [0.3, 0.87, 0.44] }, { p: text, c: [1, 0.85, 0.4] }, { p: jet, c: [0.9, 0.97, 1] }, { p: star, c: [0.96, 0.78, 0.3] }];
    var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    var mat = new THREE.PointsMaterial({ size: 1.5, map: F.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true });
    var d = new THREE.Points(geo, mat); d.frustumCulled = false; d.userData.noCull = true; d.userData.noInst = true; d.visible = false; scene.add(d); F.drones = { pts: d, geo: geo, N: N, yaw: 0 };
  }
  function droneTick() {
    var F = S.fx; if (!F || !F.drones) return; var Dr = F.drones, P = F.plaza; var nt = 0; try { nt = night; } catch (e) {}
    var cd = Math.hypot(camera.position.x - P.x, camera.position.z - P.z); var show = nt > 0.55 && cd < 2600; Dr.pts.visible = show; if (!show) return;
    var T = Date.now() / 1000, hold = 13, cyc = hold * F.forms.length, ph = T % cyc, fi = Math.floor(ph / hold), ft = ph - fi * hold;
    var A = F.forms[(fi + F.forms.length - 1) % F.forms.length], B = F.forms[fi]; var k = clamp(ft / 3.5, 0, 1); k = k * k * (3 - 2 * k);
    var want = Math.atan2(camera.position.x - P.x, camera.position.z - P.z); var dy = Math.atan2(Math.sin(want - Dr.yaw), Math.cos(want - Dr.yaw)); Dr.yaw += dy * 0.02;
    var rx = Math.cos(Dr.yaw), rz = -Math.sin(Dr.yaw); var cy = P.y + 78; var pos = Dr.geo.attributes.position.array, col = Dr.geo.attributes.color.array;
    for (var i = 0; i < Dr.N; i++) { var a = A.p[i], b = B.p[i]; var px = a[0] + (b[0] - a[0]) * k, py = a[1] + (b[1] - a[1]) * k; var wob = Math.sin(T * 1.7 + i) * 0.25;
      pos[i * 3] = P.x + rx * px; pos[i * 3 + 1] = cy + py + wob; pos[i * 3 + 2] = P.z + rz * px;
      var tw = 0.85 + 0.15 * Math.sin(T * 5 + i * 1.3); for (var c = 0; c < 3; c++) col[i * 3 + c] = (A.c[c] + (B.c[c] - A.c[c]) * k) * tw * clamp((nt - 0.55) / 0.2, 0, 1); }
    Dr.geo.attributes.position.needsUpdate = true; Dr.geo.attributes.color.needsUpdate = true;
  }
  function buildBeacon() {
    var F = fxInit(); var q = placeOf("outpost_beacon"); var x = q ? q.x : 860, z = q ? q.z : 455; var y = groundAt(x, z);
    var c = document.createElement("canvas"); c.width = 4; c.height = 128; var cx = c.getContext("2d"); var gr = cx.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, "rgba(255,210,110,0)"); gr.addColorStop(0.55, "rgba(255,210,110,.45)"); gr.addColorStop(1, "rgba(255,220,140,1)"); cx.fillStyle = gr; cx.fillRect(0, 0, 4, 128);
    var t = new THREE.CanvasTexture(c); var mat = new THREE.MeshBasicMaterial({ map: t, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    var geo = new THREE.CylinderGeometry(1.6, 2.6, 520, 20, 1, true); geo.translate(0, 260, 0); var m = new THREE.Mesh(geo, mat); m.position.set(x, y + 4, z); m.frustumCulled = false; m.userData.noCull = true; m.userData.noInst = true; m.visible = false; scene.add(m); F.beacon = m;
  }
  function fxTick(dt, now) {
    var F = S.fx; if (!F) return; var nt = 0; try { nt = night; } catch (e) {}
    fxParticles(dt); droneTick();
    if (F.bulbs) F.bulbs.material.color.setRGB(1, 0.79, 0.47).multiplyScalar(0.25 + 0.95 * clamp(nt * 1.4, 0, 1));
    if (F.beacon) { F.beacon.visible = nt > 0.3; F.beacon.material.opacity = 0.55 * clamp((nt - 0.3) / 0.3, 0, 1); }
    // the fireworks: one rocket in each 6 s slot after dark, seeded by the slot so every client fires the same show
    if (F.on.fireworks && nt > 0.6) { var P = F.plaza; var cd = Math.hypot(camera.position.x - P.x, camera.position.z - P.z); var slot = Math.floor(Date.now() / 6000);
      if (slot !== F.slot) { F.slot = slot; if (cd < 1800) { var h = hash("fw" + slot); var a = (h % 360) / 57.3, rr = 8 + (h >> 9) % 18; var cols = [[1, 0.82, 0.36], [0.3, 0.87, 0.44], [0.96, 0.95, 0.9], [0.5, 0.9, 1], [1, 0.55, 0.45]]; fxRocket(P.x + Math.cos(a) * rr, P.z + Math.sin(a) * rr, 70 + (h >> 4) % 40, cols[(h >> 3) % cols.length]); } } }
  }

  // ───────────────────────── UI: styles ─────────────────────────
  var CSS = [
    "#pp-chip{position:fixed;left:18px;top:110px;width:228px;padding:9px 11px 9px 10px;display:none;pointer-events:auto;cursor:pointer;background:var(--glass,rgba(7,17,12,.62));border:1px solid var(--line2,rgba(245,241,230,.14));border-radius:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:6;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:border-color .2s,transform .2s;user-select:none}",
    "#pp-chip.on{display:block}#pp-chip:hover{border-color:var(--green,#4DDE6F)}#pp-chip.pulse{animation:ppPulse 1.2s ease 2}",
    "@keyframes ppPulse{0%,100%{box-shadow:0 10px 30px rgba(0,0,0,.35)}50%{box-shadow:0 0 0 2px rgba(244,205,90,.7),0 0 26px rgba(244,205,90,.45)}}",
    "#pp-chip .r1{display:flex;align-items:center;gap:9px}#pp-chip .ins{width:34px;height:34px;flex:none}#pp-chip .ins svg{width:100%;height:100%;display:block}",
    "#pp-chip .rk{font-family:Anton,Impact,sans-serif;font-size:19px;letter-spacing:.07em;line-height:1;text-transform:uppercase}",
    "#pp-chip .xp{margin-left:auto;text-align:right;font:600 10px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:var(--cream,#f5f1e6)}#pp-chip .xp small{display:block;color:var(--dim,rgba(245,241,230,.62));font-size:8.5px;letter-spacing:.14em;margin-top:2px}",
    "#pp-chip .bar{height:5px;border-radius:3px;background:rgba(245,241,230,.12);margin-top:8px;overflow:hidden}#pp-chip .bar i{display:block;height:100%;width:0;border-radius:3px;transition:width .8s cubic-bezier(.2,.8,.2,1)}",
    "#pp-chip .r3{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font:600 8.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim,rgba(245,241,230,.62))}",
    "#pp-chip kbd{display:inline-block;padding:0 5px;border:1px solid rgba(77,222,111,.45);background:rgba(77,222,111,.1);color:var(--green,#4DDE6F);border-radius:4px;font:600 9px 'JetBrains Mono',monospace;margin-right:5px}",
    "#pp-chip .cm{margin-top:7px;padding-top:6px;border-top:1px solid rgba(245,241,230,.1);font:600 8.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--dim,rgba(245,241,230,.62));display:flex;justify-content:space-between;gap:6px}#pp-chip .cm b{color:#f4cd5a;font-weight:600}",
    "#pp-chip .cbar{height:3px;border-radius:2px;background:rgba(245,241,230,.1);margin-top:4px;overflow:hidden}#pp-chip .cbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f4cd5a,#ffe7a6);transition:width .8s}",
    "#pp-toasts{position:fixed;left:18px;top:212px;width:260px;display:flex;flex-direction:column;gap:6px;pointer-events:none;z-index:6}",
    ".pp-t{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;background:rgba(7,17,12,.86);border:1px solid rgba(244,205,90,.45);border-radius:12px;color:var(--cream,#f5f1e6);box-shadow:0 10px 30px rgba(0,0,0,.4);animation:ppIn .35s cubic-bezier(.2,.8,.2,1);backdrop-filter:blur(8px)}",
    ".pp-t.q{border-color:rgba(245,241,230,.16)}.pp-t.out{animation:ppOut .4s ease forwards}.pp-t svg{width:40px;height:40px;flex:none}",
    ".pp-t .k{font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#f4cd5a}.pp-t .n{font:600 13px 'Space Grotesk',system-ui,sans-serif;line-height:1.2;margin-top:1px}.pp-t em{margin-left:auto;font:400 17px Anton,Impact,sans-serif;letter-spacing:.04em;color:var(--green,#4DDE6F);font-style:normal;white-space:nowrap}",
    "@keyframes ppIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}@keyframes ppOut{to{opacity:0;transform:translateX(-14px)}}",
    // the passport
    "#pp{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:25;background:radial-gradient(ellipse at center,rgba(4,10,7,.55),rgba(4,10,7,.82));backdrop-filter:blur(3px)}#pp.on{display:flex}",
    "#pp .bk{position:relative;display:flex;width:min(1020px,96vw);height:min(660px,92vh);padding:12px;border-radius:18px;background:linear-gradient(135deg,#123522,#0a2014 55%,#0d2819);box-shadow:0 40px 100px rgba(0,0,0,.7),inset 0 0 0 1px rgba(244,205,90,.35),inset 0 0 0 5px #0b2215,inset 0 0 0 6px rgba(244,205,90,.25);animation:ppOpen .45s cubic-bezier(.2,.8,.2,1)}",
    "@keyframes ppOpen{from{opacity:0;transform:scale(.94) rotateX(8deg)}to{opacity:1;transform:none}}",
    "#pp .pg{position:relative;flex:1;min-width:0;overflow:hidden;color:#12301f;background-color:#f3ecda;background-image:repeating-radial-gradient(circle at 18% 28%,rgba(26,94,58,.055) 0 1px,transparent 1px 9px),repeating-radial-gradient(circle at 86% 78%,rgba(154,100,16,.05) 0 1px,transparent 1px 11px),linear-gradient(180deg,#f6f0e0,#ede3cc)}",
    "#pp .pl{border-radius:10px 3px 3px 10px;box-shadow:inset -18px 0 26px -18px rgba(60,40,10,.45);display:flex;flex-direction:column;padding:18px 22px 12px}",
    "#pp .pr{border-radius:3px 10px 10px 3px;box-shadow:inset 18px 0 26px -18px rgba(60,40,10,.45);display:flex;flex-direction:column}",
    "#pp .pr .sc{flex:1;overflow-y:auto;padding:18px 24px 18px 26px;scrollbar-width:thin;scrollbar-color:rgba(18,48,31,.35) transparent}",
    "#pp .x{position:absolute;right:-12px;top:-12px;width:34px;height:34px;border-radius:50%;border:1px solid rgba(244,205,90,.6);background:#0b2215;color:#f4cd5a;font:600 16px 'Space Grotesk',sans-serif;cursor:pointer;z-index:2;box-shadow:0 6px 18px rgba(0,0,0,.5)}#pp .x:hover{background:#133a24}",
    "#pp .hd{display:flex;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid rgba(18,48,31,.18)}#pp .hd img{height:26px;filter:brightness(.25) sepia(1) hue-rotate(80deg) saturate(3)}",
    "#pp .hd b{display:block;font:400 22px Anton,Impact,sans-serif;letter-spacing:.14em;color:#0f3a22}#pp .hd i{display:block;font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#7a6a45;font-style:normal;margin-top:2px}",
    "#pp .id{display:flex;gap:16px;margin-top:14px;align-items:center}#pp .id .big{width:92px;height:92px;flex:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.25))}#pp .id .big svg{width:100%;height:100%}",
    "#pp .lb{font:600 8px 'JetBrains Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:#8a7a55}#pp .nm{font:400 24px Anton,Impact,sans-serif;letter-spacing:.06em;line-height:1.05;color:#12301f;text-transform:uppercase;word-break:break-word}",
    "#pp .rkn{font:400 17px Anton,Impact,sans-serif;letter-spacing:.1em;text-transform:uppercase;margin-top:1px}#pp .tl{font:600 11px 'Space Grotesk',sans-serif;color:#3d5446;margin-top:2px}",
    "#pp .xpb{margin-top:12px}#pp .xpb .row{display:flex;justify-content:space-between;align-items:baseline;font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.1em;color:#4a5a4e;text-transform:uppercase}#pp .xpb .row b{font:400 20px Anton,Impact,sans-serif;letter-spacing:.04em;color:#12301f}",
    "#pp .xpb .br{height:8px;border-radius:5px;background:rgba(18,48,31,.12);margin-top:5px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}#pp .xpb .br i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#2a7a3e,#4DDE6F 60%,#f4cd5a)}",
    "#pp .stats{display:flex;gap:6px;margin-top:10px}#pp .stats div{flex:1;padding:6px 4px;border:1px solid rgba(18,48,31,.16);border-radius:8px;text-align:center;background:rgba(255,255,255,.35)}#pp .stats b{display:block;font:400 18px Anton,Impact,sans-serif;letter-spacing:.03em;color:#12301f}#pp .stats span{font:600 7.5px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#7a6a45}",
    "#pp .tabs{display:flex;gap:4px;margin-top:12px;padding:3px;border-radius:9px;background:rgba(18,48,31,.08)}#pp .tabs button{flex:1;padding:7px 4px;border:0;border-radius:7px;background:transparent;font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#4a5a4e;cursor:pointer}#pp .tabs button.on{background:#12301f;color:#f4cd5a}#pp .tabs button:hover:not(.on){background:rgba(18,48,31,.12)}",
    "#pp .chs{flex:1;overflow-y:auto;margin-top:10px;padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(18,48,31,.3) transparent}#pp .ch{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px;cursor:pointer;font:600 12.5px 'Space Grotesk',sans-serif;color:#1d3a28}#pp .ch:hover{background:rgba(18,48,31,.08)}#pp .ch.on{background:rgba(18,48,31,.14)}",
    "#pp .ch .dt{width:10px;height:10px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 2px rgba(255,255,255,.5)}#pp .ch .ct{margin-left:auto;font:600 9.5px 'JetBrains Mono',monospace;letter-spacing:.06em;color:#6b7a6e}#pp .ch .sl{width:18px;height:18px;flex:none}",
    "#pp .mrz{margin-top:8px;padding-top:7px;border-top:1px dashed rgba(18,48,31,.25);font:600 10px 'JetBrains Mono',monospace;letter-spacing:.16em;color:rgba(18,48,31,.55);white-space:nowrap;overflow:hidden;line-height:1.5}",
    "#pp h3{margin:0;font:400 26px Anton,Impact,sans-serif;letter-spacing:.06em;color:#12301f;text-transform:uppercase}#pp .sub{font:600 9px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#8a7a55;margin-top:3px}",
    "#pp .rw{margin-top:10px;padding:8px 11px;border-radius:9px;border:1px dashed rgba(18,48,31,.3);font:500 12px 'Space Grotesk',sans-serif;color:#2c4636;background:rgba(255,255,255,.3)}#pp .rw b{font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#9a6410;margin-right:6px}",
    "#pp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:14px 10px;margin-top:14px}",
    "#pp .st{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0}#pp .st .sv{width:104px;height:104px}#pp .st .sv svg{width:100%;height:100%;overflow:visible}",
    "#pp .st .sn{font:600 11.5px 'Space Grotesk',sans-serif;color:#1d3a28;line-height:1.2;margin-top:3px;max-width:118px}#pp .st.no .sn{color:#6f7d72}#pp .st .sa{font:600 8px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a7a55;margin-top:3px;max-width:118px}",
    "#pp .st button,#pp .btn2{margin-top:5px;padding:4px 9px;border-radius:6px;border:1px solid rgba(18,48,31,.35);background:rgba(255,255,255,.45);font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#12301f;cursor:pointer}#pp .st button:hover,#pp .btn2:hover{background:#12301f;color:#f4cd5a}#pp .st button:disabled{opacity:.45;cursor:default;background:transparent;color:#6f7d72}",
    "#pp .rkc{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}#pp .rc{position:relative;padding:12px;border-radius:12px;border:1px solid rgba(18,48,31,.18);background:rgba(255,255,255,.35)}#pp .rc.cur{border:2px solid #2a7a3e;background:rgba(77,222,111,.1)}#pp .rc.lock{opacity:.7}",
    "#pp .rc .top{display:flex;align-items:center;gap:10px}#pp .rc .top svg{width:46px;height:46px}#pp .rc .n{font:400 20px Anton,Impact,sans-serif;letter-spacing:.08em;text-transform:uppercase}#pp .rc .q{font:600 8.5px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#7a6a45}",
    "#pp .rc ul{margin:8px 0 0;padding-left:16px;font:500 11.5px/1.4 'Space Grotesk',sans-serif;color:#2c4636}#pp .rc .tag{position:absolute;right:10px;top:10px;font:600 8px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;padding:2px 6px;border-radius:5px;background:#12301f;color:#f4cd5a}",
    "#pp h4{margin:18px 0 6px;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:#8a7a55}",
    "#pp .chips{display:flex;flex-wrap:wrap;gap:6px}#pp .chip{padding:5px 10px;border-radius:999px;border:1px solid rgba(18,48,31,.3);background:rgba(255,255,255,.4);font:600 11px 'Space Grotesk',sans-serif;color:#1d3a28;cursor:pointer}#pp .chip.on{background:#12301f;color:#f4cd5a;border-color:#12301f}#pp .chip.lock{opacity:.55;cursor:default;border-style:dashed}",
    "#pp .pts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}#pp .pt{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;border:1px solid rgba(18,48,31,.2);background:rgba(255,255,255,.35);font:600 11.5px 'Space Grotesk',sans-serif;color:#1d3a28}#pp .pt i{width:20px;height:20px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 2px rgba(255,255,255,.4),0 1px 3px rgba(0,0,0,.3)}#pp .pt small{display:block;font:600 8px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a7a55}#pp .pt.lock{opacity:.55}",
    "#pp .big-n{font:400 58px Anton,Impact,sans-serif;letter-spacing:.02em;color:#12301f;line-height:1}#pp .imp .lbl{font:600 9px 'JetBrains Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:#9a6410}",
    "#pp .ibar{position:relative;height:12px;border-radius:7px;background:rgba(18,48,31,.12);margin:12px 0 4px;box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}#pp .ibar i{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background:linear-gradient(90deg,#c9962e,#f4cd5a)}",
    "#pp .ms{display:flex;align-items:flex-start;gap:10px;padding:8px 2px;border-bottom:1px solid rgba(18,48,31,.1)}#pp .ms .ic{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font:700 12px 'Space Grotesk';border:1.5px solid rgba(18,48,31,.35);color:#12301f}#pp .ms.ok .ic{background:#2a7a3e;border-color:#2a7a3e;color:#f4ecd8}",
    "#pp .ms b{font:600 13px 'Space Grotesk',sans-serif;color:#12301f}#pp .ms p{margin:1px 0 0;font:500 11.5px/1.35 'Space Grotesk',sans-serif;color:#4a5a4e}#pp .ms .at{margin-left:auto;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#8a7a55;white-space:nowrap}",
    "#pp .rows{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:6px}#pp .rows div{display:flex;justify-content:space-between;font:500 12px 'Space Grotesk',sans-serif;color:#2c4636;padding:3px 0;border-bottom:1px dotted rgba(18,48,31,.2)}#pp .rows b{font:600 11px 'JetBrains Mono',monospace;color:#12301f}",
    "#pp .note{margin-top:12px;font:500 11px/1.45 'Space Grotesk',sans-serif;color:#5b6a5f;font-style:italic}",
    "#pp .how{counter-reset:h;margin-top:10px}#pp .hw{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid rgba(18,48,31,.1)}#pp .hw::before{counter-increment:h;content:counter(h);width:24px;height:24px;flex:none;border-radius:50%;background:#12301f;color:#f4cd5a;display:grid;place-items:center;font:600 11px 'JetBrains Mono',monospace}",
    "#pp .hw b{font:600 13px 'Space Grotesk',sans-serif;color:#12301f}#pp .hw p{margin:2px 0 0;font:500 11.5px/1.4 'Space Grotesk',sans-serif;color:#4a5a4e}#pp .hw em{margin-left:auto;padding-left:8px;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.06em;color:#2a7a3e;font-style:normal;text-align:right;max-width:150px}",
    "#pp .thr{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}#pp .thr div{text-align:center;padding:7px 2px;border-radius:9px;background:rgba(18,48,31,.07)}#pp .thr svg{width:34px;height:34px}#pp .thr b{display:block;font:400 14px Anton,Impact,sans-serif;letter-spacing:.06em;text-transform:uppercase}#pp .thr span{font:600 8.5px 'JetBrains Mono',monospace;color:#7a6a45}",
    // the rank-up and chapter moments
    "#pp-up{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:40;background:radial-gradient(circle at center,rgba(8,20,13,.55),rgba(4,10,7,.85));pointer-events:auto}#pp-up.on{display:flex}",
    "#pp-up .in{position:relative;text-align:center;color:#f5f1e6;padding:30px 36px 26px;width:min(460px,92vw);animation:ppRise .6s cubic-bezier(.2,.9,.2,1)}",
    "@keyframes ppRise{from{opacity:0;transform:translateY(24px) scale(.92)}to{opacity:1;transform:none}}",
    "#pp-up .rays{position:absolute;left:50%;top:92px;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;background:repeating-conic-gradient(from 0deg,rgba(244,205,90,.22) 0 6deg,transparent 6deg 18deg);-webkit-mask:radial-gradient(circle,#000 20%,transparent 68%);mask:radial-gradient(circle,#000 20%,transparent 68%);animation:ppSpin 14s linear infinite;pointer-events:none}",
    "@keyframes ppSpin{to{transform:rotate(360deg)}}#pp-up .ins{position:relative;width:132px;height:132px;margin:0 auto;filter:drop-shadow(0 10px 30px rgba(244,205,90,.35));animation:ppPop .7s cubic-bezier(.2,1.4,.3,1)}#pp-up .ins svg{width:100%;height:100%}",
    "@keyframes ppPop{from{transform:scale(.3) rotate(-20deg);opacity:0}to{transform:none;opacity:1}}",
    "#pp-up .k{position:relative;margin-top:16px;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.3em;text-transform:uppercase;color:#4DDE6F}#pp-up .n{position:relative;font:400 54px Anton,Impact,sans-serif;letter-spacing:.06em;line-height:1.05;text-transform:uppercase;text-shadow:0 4px 24px rgba(0,0,0,.6)}",
    "#pp-up .b{position:relative;margin:6px 0 0;color:rgba(245,241,230,.85);font:500 14px 'Space Grotesk',sans-serif}#pp-up ul{position:relative;list-style:none;margin:14px 0 0;padding:12px 14px;border-radius:12px;background:rgba(7,17,12,.72);border:1px solid rgba(244,205,90,.35);text-align:left}",
    "#pp-up li{font:500 13px/1.45 'Space Grotesk',sans-serif;padding:3px 0 3px 22px;position:relative}#pp-up li::before{content:'';position:absolute;left:4px;top:9px;width:9px;height:9px;border-radius:2px;background:#f4cd5a;transform:rotate(45deg)}",
    "#pp-up button{position:relative;margin-top:16px;padding:10px 22px;border-radius:10px;border:0;background:#4DDE6F;color:#0a1610;font:600 14px 'Space Grotesk',sans-serif;cursor:pointer}",
    "@media (max-width:760px){#pp-chip{top:auto;bottom:156px;left:10px;width:188px;padding:7px 9px}#pp-chip .cm{display:none}#pp-chip .ins{width:28px;height:28px}#pp-chip .rk{font-size:16px}#pp-toasts{top:auto;bottom:250px;left:10px;width:min(260px,70vw)}",
    "#pp .bk{flex-direction:column;overflow-y:auto;height:94vh;width:96vw;padding:8px}#pp .pg{flex:none;overflow:visible}#pp .pl{border-radius:10px 10px 3px 3px;padding:14px 14px 10px}#pp .pr{border-radius:3px 3px 10px 10px}#pp .pr .sc{padding:14px;overflow:visible;flex:none}#pp .chs{flex:none;max-height:none;display:flex;flex-wrap:wrap;gap:4px}#pp .ch{padding:5px 8px;font-size:11.5px;background:rgba(18,48,31,.06)}#pp .ch .sl{display:none}",
    "#pp .grid{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}#pp .st .sv{width:88px;height:88px}#pp .rkc{grid-template-columns:1fr}#pp .rows{grid-template-columns:1fr}#pp .x{right:6px;top:6px}#pp .mrz{display:none}#pp-up .n{font-size:42px}}",
    "body.photo #pp-chip,body.photo #pp-toasts{display:none!important}"
  ].join("\n");

  // ───────────────────────── UI: the HUD chip and the toasts ─────────────────────────
  function buildUI() {
    if (S.built) return; S.built = true;
    var st = document.createElement("style"); st.id = "pp-css"; st.textContent = CSS; document.head.appendChild(st);
    var chip = document.createElement("div"); chip.id = "pp-chip"; chip.className = "hud"; chip.title = "Sol Passport (" + (D().keyLabel || "J") + ")";
    chip.innerHTML = '<div class="r1"><div class="ins"></div><div class="rk"></div><div class="xp"></div></div><div class="bar"><i></i></div><div class="r3"><span class="nx"></span><span><kbd>' + esc(D().keyLabel || "J") + '</kbd>' + esc(copy("hudHint", "Passport")) + '</span></div><div class="cm"><span>Community <b class="cv"></b></span><span class="cn"></span></div><div class="cbar"><i></i></div>';
    chip.addEventListener("click", function () { togglePassport(); });
    document.body.appendChild(chip);
    var tw = document.createElement("div"); tw.id = "pp-toasts"; tw.className = "hud"; document.body.appendChild(tw);
    var pp = document.createElement("div"); pp.id = "pp"; pp.innerHTML = '<div class="bk"><button class="x" title="Close (Esc)">✕</button><section class="pg pl"></section><section class="pg pr"><div class="sc"></div></section></div>';
    pp.addEventListener("click", function (e) { if (e.target === pp) closePassport(); });
    pp.querySelector(".x").addEventListener("click", function () { closePassport(); });
    document.body.appendChild(pp);
    var up = document.createElement("div"); up.id = "pp-up"; up.addEventListener("click", function (e) { if (e.target === up || e.target.tagName === "BUTTON") hideMoment(); }); document.body.appendChild(up);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    svg.innerHTML = '<defs><filter id="pp-ink" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="1" seed="3" result="m"/><feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9" result="mm"/><feComposite in="d" in2="mm" operator="in"/></filter></defs>';
    document.body.appendChild(svg);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", placeToasts);
  }
  function onKey(e) {
    var t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if ($id("pp-up") && $id("pp-up").classList.contains("on") && (e.code === "Escape" || e.code === "Enter")) { hideMoment(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (S.open) { if (e.code === "Escape" || e.code === (D().key || "KeyJ")) { closePassport(); e.preventDefault(); } e.stopImmediatePropagation(); return; }
    if (typing) return; try { if (chatOpen) return; } catch (x) {}
    if (e.code === (D().key || "KeyJ") && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { if (typeof FLY !== "undefined" && FLY.on) return; togglePassport(); e.preventDefault(); }
  }
  function placeToasts() { var c = $id("pp-chip"), t = $id("pp-toasts"); if (!c || !t || innerWidth <= 760) return; var r = c.getBoundingClientRect(); if (r.height) t.style.top = Math.round(r.bottom + 8) + "px"; }
  function hudTick() {
    var chip = $id("pp-chip"); if (!chip || !S.cur) return;
    var show = !!player && !(typeof FLY !== "undefined" && FLY.on); try { var ld = $id("load"); if (ld && !ld.classList.contains("off") && getComputedStyle(ld).opacity > 0.5) show = false; } catch (e) {}
    chip.classList.toggle("on", show);
    if (!S.dirty && S.hudImp === (S.impact && S.impact.total)) return; S.dirty = false; S.hudImp = S.impact && S.impact.total;
    var c = S.cur, R = rankDef(c.rank), col = R.color || "#f5f1e6";
    if (chip.dataset.rk !== String(c.rank)) { chip.querySelector(".ins").innerHTML = insigniaSVG(c.rank, "c"); chip.dataset.rk = String(c.rank); }
    var rk = chip.querySelector(".rk"); rk.textContent = R.name; rk.style.color = col;
    chip.querySelector(".xp").innerHTML = fmt(c.xp) + " XP<small>" + c.stamps + " / " + c.total + " stamps</small>";
    var pct = c.next ? clamp((c.xp - c.prevXp) / Math.max(1, c.next.xp - c.prevXp), 0, 1) : 1; var bi = chip.querySelector(".bar i"); bi.style.width = (pct * 100).toFixed(1) + "%"; bi.style.background = "linear-gradient(90deg," + col + ",#f4cd5a)";
    chip.querySelector(".nx").textContent = c.next ? fmt(c.next.xp - c.xp) + " XP to " + c.next.name : "Top rank";
    var I = S.impact || impactTotals(), M = milestones(), nm = null, prev = 0; for (var i = 0; i < M.length; i++) { if (I.total < M[i].at) { nm = M[i]; break; } prev = M[i].at; }
    chip.querySelector(".cv").textContent = fmt(I.total); chip.querySelector(".cn").textContent = nm ? "Next " + fmt(nm.at) : "All unlocked";
    chip.querySelector(".cbar i").style.width = (nm ? clamp((I.total - prev) / Math.max(1, nm.at - prev), 0, 1) * 100 : 100).toFixed(1) + "%";
    placeToasts();
  }
  function toast(k, t, xp, quiet, svg) {
    var box = $id("pp-toasts"); if (!box) return; var d = document.createElement("div"); d.className = "pp-t" + (quiet ? " q" : "");
    d.innerHTML = (svg || "") + '<div><div class="k">' + esc(k) + '</div><div class="n">' + esc(t) + '</div></div>' + (xp ? "<em>+" + fmt(xp) + " XP</em>" : "");
    box.appendChild(d); while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { d.classList.add("out"); setTimeout(function () { if (d.parentNode) d.remove(); }, 450); }, quiet ? 2600 : 4200);
    var chip = $id("pp-chip"); if (chip && !quiet) { chip.classList.remove("pulse"); void chip.offsetWidth; chip.classList.add("pulse"); }
  }
  function runFx(f) {
    if (f.type === "stamp") { toast(copy("stampToast", "Passport stamp"), stampName(f.s), f.xp, false, stampSVG(f.s, true, true)); try { sfx("coin"); } catch (e) {} emit("stamp", { id: f.s.id, name: stampName(f.s), xp: f.xp, chapter: f.s.chapter.id }); }
    else if (f.type === "toast") { toast(f.k, f.t, f.xp, f.quiet); if (!f.quiet) try { sfx("coin"); } catch (e) {} }
    else if (f.type === "chapter") { var c = f.chapter; emit("district", { id: c.id, name: c.name, xp: f.xp }); emit("reward", { chapter: c.id, rewards: chapterRewards(c).map(function (r) { return r.id; }) }); queueMoment({ kind: "chapter", chapter: c, xp: f.xp }); }
    else if (f.type === "passport") { queueMoment({ kind: "passport", xp: f.xp }); }
    else if (f.type === "milestone") { toast("Community milestone", f.m.name + " unlocked", f.xp); emit("milestone", { id: f.m.id, name: f.m.name }); try { sfx("rank"); } catch (e) {} }
    else if (f.type === "rank") { emit("rank", { rank: f.rank, prev: f.prev, name: rankDef(f.rank).name }); queueMoment({ kind: "rank", rank: f.rank }); try { logLine("Genesis One", (localStorage.getItem("g1:name") || "You") + " is now a " + rankDef(f.rank).name); } catch (e) {} }
  }

  // ───────────────────────── the celebration moments (rank up, chapter complete, passport complete) ─────────────────────────
  var MQ = [];
  function queueMoment(m) { MQ.push(m); if (!$id("pp-up").classList.contains("on")) nextMoment(); }
  function nextMoment() {
    var m = MQ.shift(); var up = $id("pp-up"); if (!m) { up.classList.remove("on"); return; }
    var h = "";
    if (m.kind === "rank") { var R = rankDef(m.rank); h = '<div class="rays"></div><div class="ins">' + insigniaSVG(m.rank, "u") + '</div><div class="k">' + esc(copy("rankUp", "Rank up")) + '</div><div class="n" style="color:' + esc(R.color) + '">' + esc(R.name) + '</div><p class="b">' + esc(R.blurb || "") + '</p><ul>' + (R.perks || []).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + '</ul><button>Continue</button>';
      try { sfx("rank"); } catch (e) {} try { if (S.act0) S.act0({ t: "emote", e: "cheer" }); } catch (e) {}
      try { var rgb = m.rank >= 3 ? [0.5, 0.9, 1] : m.rank === 2 ? [1, 0.82, 0.36] : [0.3, 0.87, 0.44]; fxBurst(player.position.x, player.position.y + 6, player.position.z, rgb, 120, 9); setTimeout(function () { fxBurst(player.position.x, player.position.y + 9, player.position.z, [1, 0.82, 0.36], 90, 11); }, 500); } catch (e) {} }
    else if (m.kind === "chapter") { var c = m.chapter; var rw = chapterRewards(c); h = '<div class="rays"></div><div class="ins">' + sealSVG(c) + '</div><div class="k">' + esc(copy("chapterDone", "Chapter complete")) + '</div><div class="n" style="font-size:40px">' + esc(c.name) + '</div><p class="b">+' + fmt(m.xp) + ' XP bonus</p><ul>' + rw.map(function (r) { return "<li>" + esc(r.label) + "</li>"; }).join("") + (rw.length ? "" : "<li>A new seal in your passport</li>") + '</ul><button>Continue</button>';
      try { sfx("rank"); } catch (e) {} try { fxBurst(player.position.x, player.position.y + 7, player.position.z, [1, 0.82, 0.36], 100, 10); } catch (e) {} }
    else if (m.kind === "passport") { h = '<div class="rays"></div><div class="ins">' + insigniaSVG(3, "p") + '</div><div class="k">Passport complete</div><div class="n" style="font-size:42px">Every stamp collected</div><p class="b">+' + fmt(m.xp) + ' XP and the Sol Voyager title</p><button>Continue</button>'; try { sfx("rank"); } catch (e) {} }
    up.innerHTML = '<div class="in">' + h + '</div>'; up.classList.add("on"); try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    clearTimeout(S.upT); S.upT = setTimeout(hideMoment, 9000);
  }
  function hideMoment() { clearTimeout(S.upT); var up = $id("pp-up"); if (!up) return; up.classList.remove("on"); if (MQ.length) setTimeout(nextMoment, 250); }

  // ───────────────────────── stamps, seals (SVG) ─────────────────────────
  function stampSVG(s, got, mini) {
    var c = s.chapter || {}, ink = c.ink || "#1d7a45", name = stampName(s).toUpperCase(), rot = got ? ((hash(s.id) % 26) - 13) : 0; var id = "pa" + s.n + (mini ? "m" : "");
    var ts = S.rec && S.rec.st[s.id]; var date = ts ? new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "";
    if (!got) {
      var nm0 = name.length > 16 ? name.slice(0, 15) + "…" : name;
      return '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(18,48,31,.28)" stroke-width="1.6" stroke-dasharray="4 4"/><text x="50" y="47" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-weight="600" font-size="7.5" fill="rgba(18,48,31,.38)">' + esc(nm0) + '</text><text x="50" y="60" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="6" letter-spacing="1.2" fill="rgba(18,48,31,.32)">' + (s.talk ? "MEET" : "VISIT") + '</text></svg>';
    }
    var nm = name.length > 30 ? name.slice(0, 29) + "…" : name;
    if (s.talk) {
      var org = stampOrg(s).toUpperCase(); org = org.length > 30 ? org.slice(0, 29) + "…" : org; var fs = name.length > 14 ? 10 : 12.5;
      return '<svg viewBox="0 0 100 100"><g transform="rotate(' + rot + ' 50 50)" filter="' + (mini ? "" : "url(#pp-ink)") + '" opacity=".92"><rect x="6" y="20" width="88" height="60" rx="9" fill="none" stroke="' + ink + '" stroke-width="3"/><rect x="11" y="25" width="78" height="50" rx="6" fill="none" stroke="' + ink + '" stroke-width="1"/>'
        + '<text x="50" y="37" text-anchor="middle" font-family="JetBrains Mono,monospace" font-weight="700" font-size="5.6" letter-spacing="1.6" fill="' + ink + '">' + (s.kind === "partner" ? "INDUSTRY PARTNER" : "LOCAL OF GENESIS ONE") + '</text>'
        + '<text x="50" y="52" text-anchor="middle" font-family="Anton,Impact,sans-serif" font-size="' + fs + '" letter-spacing=".6" fill="' + ink + '">' + esc(nm) + '</text>'
        + '<text x="50" y="61.5" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-weight="600" font-size="4.6" fill="' + ink + '">' + esc(org) + '</text>'
        + '<text x="50" y="71" text-anchor="middle" font-family="JetBrains Mono,monospace" font-weight="700" font-size="5" letter-spacing="1" fill="' + ink + '">' + esc(date || "MET") + '</text></g></svg>';
    }
    var r = 38.5, circ = 2 * Math.PI * r; var fsz = clamp(Math.floor(circ * 0.6 / Math.max(8, nm.length) / 0.62), 5, 8.6);
    return '<svg viewBox="0 0 100 100"><defs><path id="' + id + '" d="M50 50 m-' + r + ' 0 a' + r + ' ' + r + ' 0 1 1 ' + (2 * r) + ' 0 a' + r + ' ' + r + ' 0 1 1 -' + (2 * r) + ' 0"/></defs><g transform="rotate(' + rot + ' 50 50)" filter="' + (mini ? "" : "url(#pp-ink)") + '" opacity=".92">'
      + '<circle cx="50" cy="50" r="46" fill="none" stroke="' + ink + '" stroke-width="3.2"/><circle cx="50" cy="50" r="31" fill="none" stroke="' + ink + '" stroke-width="1.2"/>'
      + '<text font-family="JetBrains Mono,monospace" font-weight="700" font-size="' + fsz + '" letter-spacing="1.1" fill="' + ink + '"><textPath href="#' + id + '" startOffset="25%" text-anchor="middle">' + esc(nm) + '</textPath></text>'
      + chapterGlyph(c.id, ink)
      + '<text x="50" y="66" text-anchor="middle" font-family="JetBrains Mono,monospace" font-weight="700" font-size="5.2" letter-spacing=".8" fill="' + ink + '">' + esc(date) + '</text>'
      + '<text x="50" y="41" text-anchor="middle" font-family="Anton,Impact,sans-serif" font-size="6.5" letter-spacing="1.4" fill="' + ink + '">SOLPORT</text></g></svg>';
  }
  function chapterGlyph(id, ink) {
    var g = { solport: "M50 44L51.4 50.4L58 53.6L58 55L51.4 53.2L51.2 57.4L53.2 59L53.2 60L50 59.3L46.8 60L46.8 59L48.8 57.4L48.6 53.2L42 55L42 53.6L48.6 50.4Z", outpost: "M42 58A8 8 0 0 1 58 58Z M48.5 48L51.5 48L51 44L49 44Z", park: "M50 44C54 48 56 51 56 54A6 6 0 0 1 44 54C44 51 46 48 50 44Z", design: "M50 43L52 50L59 52L52 54L50 61L48 54L41 52L48 50Z", mainstreet: "M43 60L43 49L50 44L57 49L57 60Z" }[id];
    if (!g) g = "M50 45L52.1 49.6L57 50.1L53.3 53.4L54.4 58.2L50 55.7L45.6 58.2L46.7 53.4L43 50.1L47.9 49.6Z";
    return '<path d="' + g + '" fill="' + ink + '" transform="translate(0 -1)"/>';
  }
  function sealSVG(c) {
    var ink = (c && c.ink) || "#1d7a45"; var p = ""; for (var i = 0; i < 24; i++) { var a = i / 24 * Math.PI * 2, r = i % 2 ? 42 : 47; p += (i ? "L" : "M") + (50 + Math.cos(a) * r).toFixed(1) + " " + (50 + Math.sin(a) * r).toFixed(1); }
    return '<svg viewBox="0 0 100 100"><path d="' + p + 'Z" fill="' + ink + '"/><circle cx="50" cy="50" r="34" fill="none" stroke="#f4cd5a" stroke-width="2"/><path d="M36 51L46 61L65 40" fill="none" stroke="#f4cd5a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function chapterRewards(c) {
    var out = []; (D().titles || []).forEach(function (t) { if (t.unlock === "chapter:" + c.id) out.push({ id: t.id, label: "Title: " + t.name }); });
    (D().paints || []).forEach(function (p) { if (p.unlock === "chapter:" + c.id) out.push({ id: p.id, label: "Cart paint: " + p.name }); });
    return out;
  }

  // ───────────────────────── the passport ─────────────────────────
  function togglePassport() { if (S.open) closePassport(); else openPassport(); }
  function openPassport(tab) {
    if (!S.ready || !S.built) return; S.opening = true; try { if (typeof closeCards === "function") closeCards(); } catch (e) {} S.opening = false;
    if (tab) S.tab = tab; if (!S.chap) { var cs = S.cur.chapters, pick = null; for (var i = 0; i < cs.length; i++) if (!cs[i].done && cs[i].got > 0) { pick = cs[i].id; break; } S.chap = pick || (cs[0] && cs[0].id); }
    S.open = true; $id("pp").classList.add("on"); renderPassport(); try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {} try { sfx("ui"); } catch (e) {}
  }
  function closePassport(quiet) { if (!S.open) return; S.open = false; var p = $id("pp"); if (p) p.classList.remove("on"); if (!quiet) try { sfx("ui"); } catch (e) {} }
  function holderName() { try { var n = view && view.players && view.players[ME] && view.players[ME].name; if (n) return n; } catch (e) {} return localStorage.getItem("g1:name") || "Visitor"; }
  function renderPassport() {
    var pp = $id("pp"); if (!pp || !S.cur) return; var c = S.cur, r = S.rec, R = rankDef(c.rank);
    var pl = pp.querySelector(".pl"), sc = pp.querySelector(".pr .sc");
    var pct = c.next ? clamp((c.xp - c.prevXp) / Math.max(1, c.next.xp - c.prevXp), 0, 1) : 1; var name = holderName();
    var chs = c.chapters.map(function (h) { var ch = chapterById(h.id); return '<div class="ch' + (S.tab === "stamps" && S.chap === h.id ? " on" : "") + '" data-ch="' + esc(h.id) + '"><span class="dt" style="background:' + esc(ch.ink) + '"></span>' + esc(h.name) + '<span class="ct">' + h.got + "/" + h.total + '</span>' + (h.done ? '<span class="sl">' + sealSVG(ch) + '</span>' : '<span class="sl"></span>') + '</div>'; }).join("");
    var mrzName = name.toUpperCase().replace(/[^A-Z0-9]+/g, "<"); var l1 = ("P<" + (copy("mrzTag", "SOL")) + "<<" + mrzName + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").slice(0, 44);
    var l2 = ("G1" + String(c.stamps).padStart(3, "0") + "<" + R.name.toUpperCase() + "<<" + String(c.xp).padStart(6, "0") + "<<SOLPORT<DOUGLAS<AZ<<<<<<<<<<<<<<<<<<<<").slice(0, 44);
    pl.innerHTML = '<div class="hd"><img src="/logo.png" alt=""><div><b>' + esc(copy("title", "SOL PASSPORT")) + '</b><i>' + esc(copy("issuer", "Genesis One · Solport, Douglas, Arizona")) + '</i></div></div>'
      + '<div class="id"><div class="big">' + insigniaSVG(c.rank, "b") + '</div><div style="min-width:0"><div class="lb">Holder</div><div class="nm">' + esc(name) + '</div><div class="lb" style="margin-top:6px">Rank</div><div class="rkn" style="color:' + (c.rank === 0 ? "#6b5d3a" : c.rank === 1 ? "#1f7a3e" : c.rank === 2 ? "#9a6a10" : "#1b7f8c") + '">' + esc(R.name) + '</div>' + (r.ti ? '<div class="tl">' + esc(titleName(r.ti) || "") + '</div>' : "") + '</div></div>'
      + '<div class="xpb"><div class="row"><span><b>' + fmt(c.xp) + '</b> XP</span><span>' + (c.next ? fmt(c.next.xp - c.xp) + " to " + esc(c.next.name) : "Top rank") + '</span></div><div class="br"><i style="width:' + (pct * 100).toFixed(1) + '%"></i></div></div>'
      + '<div class="stats"><div><b>' + c.stamps + '/' + c.total + '</b><span>Stamps</span></div><div><b>' + c.chapters.filter(function (h) { return h.done; }).length + '/' + c.chapters.length + '</b><span>Chapters</span></div><div><b>' + (r.sk || 0) + '</b><span>Day streak</span></div></div>'
      + '<div class="tabs">' + [["stamps", "Stamps"], ["ranks", "Ranks"], ["community", "Community"], ["how", "Rank up"]].map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + '</div>'
      + '<div class="chs">' + chs + '</div><div class="mrz">' + esc(l1) + "<br>" + esc(l2) + '</div>';
    pl.querySelectorAll(".tabs button").forEach(function (b) { b.onclick = function () { S.tab = b.dataset.tab; renderPassport(); try { sfx("ui"); } catch (e) {} }; });
    pl.querySelectorAll(".ch").forEach(function (b) { b.onclick = function () { S.tab = "stamps"; S.chap = b.dataset.ch; renderPassport(); try { sfx("ui"); } catch (e) {} }; });
    var h = S.tab === "ranks" ? ranksPage() : S.tab === "community" ? communityPage() : S.tab === "how" ? howPage() : chapterPage(S.chap);
    sc.innerHTML = h; sc.scrollTop = 0; bindPage(sc);
  }
  function chapterPage(id) {
    var c = chapterById(id) || (D().chapters || [])[0]; if (!c) return ""; var r = S.rec, cur = S.cur; var h = (cur.chapters.filter(function (x) { return x.id === c.id; })[0]) || { got: 0, total: 0 };
    var rw = chapterRewards(c).map(function (x) { return x.label; }); rw.push("+" + fmt(c.bonus || X().chapter_bonus || 250) + " XP");
    var canTravel = cur.rank >= 1;
    var cells = (c.stamps || []).filter(function (s) { return !s.missing; }).map(function (s) {
      var got = !!r.st[s.id]; var act = "";
      if (s.talk) act = got ? '<div class="sa">' + esc(stampOrg(s)) + '</div>' : '<div class="sa">' + esc(copy("talkTo", "Talk to")) + " " + esc(stampName(s)) + '</div>';
      else if (got) act = canTravel ? '<button data-travel="' + esc(s.id) + '">' + esc(copy("travel", "Travel")) + '</button>' : '<button disabled title="' + esc(copy("travelLocked", "Stamp Travel unlocks at Pilot")) + '">' + esc(copy("travel", "Travel")) + ' · Pilot</button>';
      else act = '<button data-guide="' + esc(s.id) + '">Guide me</button>';
      return '<div class="st' + (got ? "" : " no") + '"><div class="sv">' + stampSVG(s, got) + '</div><div class="sn">' + esc(stampName(s)) + '</div>' + act + '</div>';
    }).join("");
    return '<h3 style="color:' + esc(c.ink) + '">' + esc(c.name) + '</h3><div class="sub">' + esc(c.sub || "") + " · " + h.got + " of " + h.total + " stamped" + (r.aw["chapter:" + c.id] ? " · complete" : "") + '</div><div class="rw"><b>Reward</b>' + esc(rw.join(" · ")) + '</div><div class="grid">' + cells + '</div>';
  }
  function ranksPage() {
    var cur = S.cur, r = S.rec, R = D().ranks || [];
    var cards = R.map(function (k, i) { var st = i < cur.rank ? "Unlocked" : i === cur.rank ? "Current" : fmt(k.xp - cur.xp) + " XP to go"; return '<div class="rc' + (i === cur.rank ? " cur" : i > cur.rank ? " lock" : "") + '"><span class="tag">' + esc(st) + '</span><div class="top">' + insigniaSVG(i, "r") + '<div><div class="n" style="color:' + (i === 0 ? "#6b5d3a" : i === 1 ? "#1f7a3e" : i === 2 ? "#9a6a10" : "#1b7f8c") + '">' + esc(k.name) + '</div><div class="q">From ' + fmt(k.xp) + ' XP</div></div></div><ul>' + (k.perks || []).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + '</ul></div>'; }).join("");
    var titles = '<span class="chip' + (!r.ti ? " on" : "") + '" data-title="">' + esc(rankDef(cur.rank).name) + ' (rank)</span>' + (D().titles || []).map(function (t) { var ok = unlockedBy(t.unlock); return '<span class="chip' + (r.ti === t.id ? " on" : "") + (ok ? "" : " lock") + '" ' + (ok ? 'data-title="' + esc(t.id) + '"' : 'title="' + esc(unlockText(t.unlock)) + '"') + '>' + esc(t.name) + '</span>'; }).join("");
    var lk = null; try { lk = savedLook(); } catch (e) {}
    var paints = (D().paints || []).map(function (p) { var ok = unlockedBy(p.unlock); var on = lk && lk.cartc === p.cartc; return '<div class="pt' + (ok ? "" : " lock") + '"><i style="background:' + esc(p.swatch) + '"></i><div style="flex:1;min-width:0">' + esc(p.name) + '<small>' + (ok ? (on ? "On your cart" : "Unlocked") : esc(unlockText(p.unlock))) + '</small></div>' + (ok && !on ? '<button class="btn2" data-paint="' + p.cartc + '">Paint</button>' : "") + '</div>'; }).join("");
    return '<h3>Ranks and rewards</h3><div class="sub">Earned by play only · never bought</div><div class="rkc">' + cards + '</div><h4>Your title on your nameplate</h4><div class="chips">' + titles + '</div><h4>Golf cart paints</h4><div class="pts">' + paints + '</div><p class="note">' + esc(D().rules || "") + '</p>';
  }
  function communityPage() {
    var I = S.impact || impactTotals(), M = milestones(); var top = M.length ? M[M.length - 1].at : 1; var nm = null; for (var i = 0; i < M.length; i++) if (I.total < M[i].at) { nm = M[i]; break; }
    var rows = ((D().impact || {}).rows || []).map(function (w) { return '<div><span>' + esc(w.name) + '</span><b>' + fmt(I.rows[w.key] || 0) + '</b></div>'; }).join("");
    var ms = M.map(function (m) { var ok = I.total >= m.at; return '<div class="ms' + (ok ? " ok" : "") + '"><span class="ic">' + (ok ? "✓" : "") + '</span><div><b>' + esc(m.name) + '</b><p>' + esc(m.desc) + '</p></div><span class="at">' + (ok ? "Unlocked" : fmt(m.at)) + '</span></div>'; }).join("");
    var marks = M.map(function (m) { return '<span style="position:absolute;top:-3px;bottom:-3px;width:2px;background:rgba(18,48,31,.35);left:' + (m.at / top * 100).toFixed(2) + '%"></span>'; }).join("");
    return '<div class="imp"><div class="lbl">' + esc((D().impact || {}).label || "In-game impact") + (I.shared ? " · shared by everyone on the site" : "") + '</div><div class="big-n">' + fmt(I.total) + '</div><div class="sub">' + (nm ? fmt(nm.at - I.total) + " to " + esc(nm.name) : "Every milestone unlocked") + '</div>'
      + '<div class="ibar"><i style="width:' + clamp(I.total / top * 100, 0, 100).toFixed(2) + '%"></i>' + marks + '</div>'
      + (I.shared ? "" : '<p class="note" style="margin-top:4px">' + esc(copy("offline", "Showing your own contribution until the shared counter is available.")) + '</p>')
      + '<h4>Milestones</h4>' + ms + '<h4>What counts</h4><div class="rows">' + rows + '</div><div class="rows" style="margin-top:8px"><div><span>Your contribution</span><b>' + fmt(I.mine) + '</b></div></div><p class="note">' + esc((D().impact || {}).note || "") + '</p></div>';
  }
  function howPage() {
    var R = D().ranks || [];
    var thr = '<div class="thr">' + R.map(function (k, i) { return '<div>' + insigniaSVG(i, "h") + '<b>' + esc(k.name) + '</b><span>' + fmt(k.xp) + ' XP</span></div>'; }).join("") + '</div>';
    var list = (D().howto || []).map(function (w) { return '<div class="hw"><div style="flex:1;min-width:0"><b>' + esc(w.t) + '</b><p>' + esc(w.d) + '</p></div><em>' + esc(w.xp) + '</em></div>'; }).join("");
    return '<h3>How to rank up</h3><div class="sub">Passenger · Pilot · Captain · Tower</div>' + thr + '<div class="how">' + list + '</div><p class="note">' + esc(D().rules || "") + ' Repeat XP each day is capped at ' + fmt(X().daily_repeat_cap || 500) + ' XP.</p>';
  }
  function bindPage(sc) {
    sc.querySelectorAll("[data-travel]").forEach(function (b) { b.onclick = function () { var s = S.stampIdx[b.dataset.travel]; if (!s || !isFinite(s.x)) return; if (!S.cur || S.cur.rank < 1) return; closePassport(); safe("travel", function () { var p = typeof snapToBuilt === "function" ? snapToBuilt(s.x + 8, s.z + 8) : [s.x + 8, s.z + 8]; warpTo(p[0], p[1]); try { navClear(true); } catch (e) {} setStatus("Stamp Travel · " + stampName(s)); }); }; });
    sc.querySelectorAll("[data-guide]").forEach(function (b) { b.onclick = function () { var s = S.stampIdx[b.dataset.guide]; if (!s || !isFinite(s.x)) return; closePassport(); safe("guide", function () { var nm = stampName(s); var tmp = [nm, s.x, s.z]; var had = HUBS.some(function (h) { return h[0] === nm; }); if (!had) HUBS.push(tmp); navTo(nm); if (!had) { var i = HUBS.indexOf(tmp); if (i >= 0) HUBS.splice(i, 1); } }); }; });
    sc.querySelectorAll("[data-title]").forEach(function (b) { b.onclick = function () { var v = b.dataset.title || null; commit(function (r) { r.ti = v; r.tiSet = 1; }, { silent: true }); refreshOwnLabel(); S.lastPushKey = ""; renderPassport(); try { sfx("ui"); } catch (e) {} }; });
    sc.querySelectorAll("[data-paint]").forEach(function (b) { b.onclick = function () { applyPaint(+b.dataset.paint); renderPassport(); }; });
  }
  function applyPaint(ci) {
    var p = (D().paints || []).filter(function (q) { return q.cartc === ci; })[0]; if (p && !unlockedBy(p.unlock)) { setStatus(unlockText(p.unlock) + " to unlock " + p.name, true); return; }
    safe("paint", function () { var lk = savedLook() || { skin: "e8c19a", shirt: "4dde6f", pants: "2b3a4a" }; lk.cartc = ci; localStorage.setItem("g1:look", JSON.stringify(lk)); act({ t: "look", look: lk }); applyCartLook(player, lk); setStatus("your cart is now " + (p ? p.name : "repainted")); try { sfx("buy"); } catch (e) {} });
  }
  // the golf cart card: the reward paints appear after the ten stock colours, locked until earned
  function paintButtons() {
    var card = $id("cartc"); if (!card) return; var row = card.querySelector(".row"); if (!row) return; var P = D().paints || [];
    P.forEach(function (p) {
      var b = row.querySelector('[data-c="' + p.cartc + '"]'); var ok = unlockedBy(p.unlock);
      if (!b) { b = document.createElement("button"); b.className = "btn ghost ccb pp-paint"; b.dataset.c = String(p.cartc); b.innerHTML = '<i style="background:' + esc(p.swatch) + '"></i>' + esc(p.name); row.appendChild(b); b.addEventListener("click", function () { if (!unlockedBy(p.unlock)) return; applyPaint(p.cartc); card.querySelectorAll(".ccb").forEach(function (q) { q.classList.toggle("on", q === b); }); }); }
      b.style.opacity = ok ? "" : ".45"; b.title = ok ? p.name : unlockText(p.unlock) + " to unlock"; b.style.cursor = ok ? "" : "not-allowed";
    });
  }

  // ───────────────────────── hooks ─────────────────────────
  HK.world.push({ name: "progress", fn: function () {
    hookClient(); lblImages();
    if (S.ready) resolveStamps();
    safe("ui", buildUI); safe("lookout", buildLookout);
  } });
  HK.frame.push({ name: "progress", fn: function (dt, now) {
    if (!S.hooked) return; if (!S.ready) return; if (!S.built) safe("ui", buildUI);
    var T = S.t;
    if (now - T.resolve > 5000) { T.resolve = now; if (S.placeStamps.some(function (s) { return !isFinite(s.x) && !s.missing; })) resolveStamps(); }
    if (now - T.arr > 250) { T.arr = now; safe("arrive", arrivalTick); safe("lookout tick", lookoutTick); }
    if (now - T.ride > 500) { T.ride = now; safe("ride", function () { rideTick(now); }); safe("cheer", cheerTick); }
    if (now - T.sync > 1000) { T.sync = now; safe("sync", syncTick); safe("impact", impactTick); }
    if (now - T.day > 10000 && player && !(typeof FLY !== "undefined" && FLY.on)) { T.day = now; var ok = false; try { ok = !!introduced || !view; } catch (e) { ok = true; } ["name", "creator"].forEach(function (id) { var el = $id(id); if (el && el.classList.contains("on")) ok = false; }); if (ok) safe("visit", doVisit); }
    if (now - T.hud > 200) { T.hud = now; safe("hud", hudTick); }
    safe("fx", function () { fxTick(dt, now); });
  } });

  // test helpers (headless QA only; nothing here changes XP)
  API.debug = {
    impact: function (n) { S.impactOverride = (n === null || n === undefined) ? null : +n; S.dirty = true; impactTick(); return impactTotals(); },
    burst: function () { if (player) fxBurst(player.position.x, player.position.y + 8, player.position.z, [1, 0.82, 0.36], 90, 11); },
    moment: function (kind, arg) { if (kind === "rank") queueMoment({ kind: "rank", rank: arg | 0 }); else if (kind === "chapter") queueMoment({ kind: "chapter", chapter: chapterById(arg) || D().chapters[0], xp: 250 }); },
    compact: function () { return S.rec ? compact(S.rec) : null; },
    lookout: function () { return S.lookout ? { x: S.lookout.x, y: S.lookout.y, z: S.lookout.z, on: S.lookout.on } : null; },
    lookoutUp: function () { lookoutUp(); }, lookoutDown: function () { lookoutDown(); },
    fx: function () { return S.fx ? { on: S.fx.on, banners: (S.fx.bannerSpots || []).length, bulbs: !!S.fx.bulbs, drones: !!S.fx.drones, beacon: !!S.fx.beacon } : null; }
  };
})();
