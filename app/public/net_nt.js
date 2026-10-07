/* R21 NT: client half of the room's v2 state protocol (server half: src/net.ts, which documents the format).
   NTNET.apply(st, msg) folds one "nt" message into the client's copy of the legacy state message and returns
   { msg, changed, removed } (msg has exactly the shape of a v1 {type:"state"} message, so onState and every reader of `view`
   are unchanged), or { resync: true } when a message is missing (the caller asks the room for a full snapshot).
   A changed player becomes a new object with the new fields; unchanged players and slow values keep their identity.
   Pure: no DOM, no three.js, so the Node load harness and the round-trip tests run the same code. */
var NTNET = (function () {
  "use strict";
  function create() { return { seq: 0, msg: null, waiting: false }; }
  function mergeP(old, d) {
    var p = {}, k;
    for (k in old) p[k] = old[k];
    if (Array.isArray(d)) { p.x = d[0] / 100; p.z = d[1] / 100; p.ry = d[2] / 1000; p.t = (old.t || 0) + d[3]; if (d.length > 4) p.y = d[4] / 100; return p; }
    for (k in d) { if (k === "~") continue; p[k] = d[k]; }
    var gone = d["~"]; if (gone) for (var i = 0; i < gone.length; i++) delete p[gone[i]];
    return p;
  }
  function apply(st, m) {
    if (m.f) {
      st.seq = m.s; st.waiting = false;
      st.msg = { type: "state", status: m.status, seats: m.seats, you: m.you, connected: m.connected, view: m.view, result: m.result, meta: m.meta };
      return { msg: st.msg, changed: null, removed: null, full: true };
    }
    if (!st.msg || m.s !== st.seq + 1) { if (st.waiting) return { skip: true }; st.waiting = true; return { resync: true }; }
    st.seq = m.s;
    var msg = st.msg, v = msg.view, k, i, id;
    var E = m.E; if (E) for (k in E) msg[k] = E[k];
    var changed = [], removed = null;
    if (v) {
      if (m.t !== undefined) v.tick = m.t;
      var K = m.K; if (K) for (k in K) v[k] = K[k];
      var KX = m.KX; if (KX) for (i = 0; i < KX.length; i++) delete v[KX[i]];
      var ps = v.players || (v.players = {});
      var N = m.N; if (N) for (id in N) { ps[id] = N[id]; changed.push(id); }
      var P = m.P; if (P) for (id in P) { var o = ps[id]; ps[id] = o ? mergeP(o, P[id]) : P[id]; changed.push(id); }
      var X = m.X; if (X) { removed = X; for (i = 0; i < X.length; i++) delete ps[X[i]]; }
    }
    return { msg: msg, changed: changed, removed: removed, full: false };
  }
  return { create: create, apply: apply, version: 2 };
})();
if (typeof window !== "undefined") window.NTNET = NTNET;
if (typeof globalThis !== "undefined") globalThis.NTNET = NTNET;
