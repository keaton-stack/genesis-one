/**
 * R21 NT: the room's outbound state, built once per broadcast.
 *
 * Two wire formats share one source of truth (`logic.viewFor`):
 *
 *   v1 (legacy, every client that does not announce a version, and `?nt=0`):
 *     {type:"state", status, seats, you, connected, view, result, meta}, the whole view every broadcast.
 *     Built exactly as before R21, so a browser still running a cached old client.js sees the same bytes.
 *
 *   v2 (`join` carries `nt: 2`):
 *     full  {type:"nt", f:1, s, ...the v1 envelope}            on join or reconnect, every NT_FULL_MS, and on request ({type:"resync"})
 *     delta {type:"nt", s, t?, N?, P?, X?, K?, KX?, E?}
 *       s   sequence number, +1 per message on this connection (the client asks for a resync on a gap)
 *       t   view.tick
 *       N   {id: player}        players this client does not have yet (the whole record)
 *       P   {id: diff}          players that changed: only the changed fields; "~": [keys removed]
 *       X   [id]                players no longer in the view
 *       K   {key: value}        top-level view keys that changed (vehicles, guestbook, boards, lots, props, av, ...): slow state, sent only on change
 *       KX  [key]               top-level view keys that disappeared
 *       E   {key: value}        envelope fields that changed (status, seats, connected, result)
 *   The WebSocket is ordered and reliable, so what the room sent IS what the client has: the baseline per connection is the last
 *   thing sent, no ack round trip is needed, and a full snapshot every NT_FULL_MS bounds any drift.
 *
 * Player records and slow values are immutable in logic.js (applyAction copies what it changes), so "changed since the last send"
 * is a reference compare; a value that is rebuilt every call with the same content (viewFor's `prices` literal) falls back to a
 * one-level shallow compare and then to a JSON compare.
 *
 * Optional capabilities the client lists in `ntc` (each one switchable from the URL, see client.js NT):
 *   "aoi"  interest management: players within NT_NEAR_M of this client every broadcast, farther ones at most every NT_FAR_MS
 *          (the nearest NT_FAR_CAP of them), the rest at most every NT_REST_MS. Nothing is dropped, only delayed.
 *   "arr"  compact movement: a P entry whose changed fields are only x, z, ry, t (and y) goes as an integer array
 *          [x*100, z*100, ry*1000, t - previous t(, y*100)], exact because logic.js already rounds to those steps.
 */

/** A connection's protocol: 1 legacy, 2 delta. */
export const NT_VERSION = 2;
export const NT_FULL_MS = 5000;
export const NT_NEAR_M = 120;
export const NT_FAR_MS = 450;
export const NT_FAR_CAP = 96;
export const NT_REST_MS = 2400;

export type Rec = Record<string, unknown>;

export interface NtCaps {
  aoi: boolean;
  arr: boolean;
}

/** Per-connection baseline. In memory only: after hibernation it is gone and that connection simply gets a full snapshot. */
export interface NtConn {
  seq: number;
  lastFull: number;
  wantFull: boolean;
  hadView: boolean;
  tick: unknown;
  players: Map<string, Rec>;
  sentAt: Map<string, number>;
  keys: Map<string, unknown>;
  env: { status: unknown; seats: string; connected: number; result: unknown };
  /** The room roster (NtHist.tag) this connection's player baseline equals, or -1. A connection in step with the room gets the
   *  players section every such connection gets, built once per broadcast; `players` is then not kept up to date (`stale`). */
  tag: number;
  stale: boolean;
  /** Players interest management held back last time (their baseline is behind the room). */
  held: Set<string>;
}

export function newNtConn(): NtConn {
  return { seq: 0, lastFull: 0, wantFull: true, hadView: false, tick: undefined, players: new Map(), sentAt: new Map(), keys: new Map(), env: { status: null, seats: "", connected: 0, result: null }, tag: -1, stale: false, held: new Set() };
}

/** The room's roster as of its last broadcast (kept by the room next to the connections, in memory). */
export interface NtHist { tag: number; shown: Record<string, Rec> | null }
export function newNtHist(): NtHist { return { tag: 0, shown: null }; }

/** Counters for the bench and the handoff (cheap; read by tests). */
export const NT_STATS = { full: 0, delta: 0, shared: 0, legacy: 0, skippedFar: 0 };

/** Per-broadcast memo: JSON of values compared more than once, shared by every connection in this broadcast. */
export class Memo {
  private json = new Map<unknown, string>();
  str(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
    let s = this.json.get(v);
    if (s === undefined) { s = JSON.stringify(v) ?? "undefined"; this.json.set(v, s); }
    return s;
  }
}

/** Same value as far as the client is concerned (the client only ever sees JSON). */
function same(a: unknown, b: unknown, memo: Memo): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (!Array.isArray(a) && !Array.isArray(b)) {
    // one-level shallow compare first: viewFor rebuilds small literals (prices) around shared constants on every call
    const ka = Object.keys(a as Rec), kb = Object.keys(b as Rec);
    if (ka.length === kb.length) {
      let eq = true;
      for (const k of ka) if ((a as Rec)[k] !== (b as Rec)[k]) { eq = false; break; }
      if (eq) return true;
    }
  }
  return memo.str(a) === memo.str(b);
}

/** Fields of b that differ from a (undefined counts as absent, exactly as JSON drops it). Null when nothing differs. */
function diff(a: Rec, b: Rec, memo: Memo): Rec | null {
  let out: Rec | null = null;
  for (const k in b) {
    const v = b[k];
    if (v === undefined) continue;
    if (a[k] === v) continue;
    if (typeof v === "object" && v !== null && same(a[k], v, memo)) continue;
    (out ??= {})[k] = v;
  }
  let gone: string[] | null = null;
  for (const k in a) if (a[k] !== undefined && b[k] === undefined) (gone ??= []).push(k);
  if (gone) (out ??= {})["~"] = gone;
  return out;
}

const FAST = new Set(["x", "z", "ry", "t", "y"]);
const exact = (v: unknown, q: number): v is number => typeof v === "number" && Math.round(v * q) / q === v && Math.abs(v * q) < 9e15;
/** The compact movement array, when the diff is movement only and every value round-trips exactly; else the diff object. */
function compact(d: Rec, b: Rec, a: Rec): Rec | number[] {
  for (const k in d) if (!FAST.has(k)) return d;
  const x = b.x, z = b.z, ry = b.ry, t = b.t, ta = a.t;
  if (!exact(x, 100) || !exact(z, 100) || !exact(ry, 1000) || !Number.isInteger(t) || !Number.isInteger(ta)) return d;
  const arr = [Math.round(x * 100), Math.round(z * 100), Math.round(ry * 1000), (t as number) - (ta as number)];
  if ("y" in d) { if (!exact(b.y, 100)) return d; arr.push(Math.round((b.y as number) * 100)); }
  return arr;
}

export interface Envelope {
  status: unknown;
  seats: string[];
  you: string;
  connected: number;
  view: Rec | null;
  result: unknown;
  meta: unknown;
}

/** The legacy message, exactly as room.ts built it before R21. */
export function legacyMessage(env: Envelope): string {
  NT_STATS.legacy++;
  return JSON.stringify({ type: "state", status: env.status, seats: env.seats, you: env.you, connected: env.connected, view: env.view, result: env.result, meta: env.meta });
}

export interface BroadcastCtx {
  memo: Memo;
  now: number;
  seatsJson: string;
  /** Positions for interest management: id -> [x, z]. */
  pos: Map<string, [number, number]>;
  /** Encode once, send to many: a player's diff from a given baseline object, as JSON (and as the compact array), shared by every
   *  connection whose baseline is that same object (all full-rate connections, normally). current object -> baseline -> entry. */
  pd: Map<Rec, Map<Rec, { dd: Rec | null; s?: string; a?: string }>>;
  /** JSON.stringify(id), once per broadcast. */
  ik: Map<string, string>;
  /** This broadcast's roster (the filtered players object every connection's view shares), the previous broadcast's, their tags,
   *  and the players section between them, built on first use (index 0 diff objects, 1 compact arrays). */
  roster: Record<string, Rec> | null;
  prevShown: Record<string, Rec> | null;
  tagPrev: number;
  tagNow: number;
  shared: [string | null, string | null];
  /** Players whose record changed (or who appeared) since the previous broadcast, and who left it; built on first use. */
  moved: { changed: string[]; removed: string[] } | null;
}

export function broadcastCtx(seats: string[], players: Record<string, Rec> | null, now: number): BroadcastCtx {
  const pos = new Map<string, [number, number]>();
  if (players) for (const id in players) { const p = players[id]; if (p && typeof p.x === "number" && typeof p.z === "number") pos.set(id, [p.x, p.z]); }
  return { memo: new Memo(), now, seatsJson: JSON.stringify(seats), pos, pd: new Map(), ik: new Map(), roster: null, prevShown: null, tagPrev: -1, tagNow: -1, shared: [null, null], moved: null };
}

/** Build the v2 message for one connection and advance its baseline. `data` is null when there is nothing to send; `held` is true
 *  when interest management held a far player's change back (the room then schedules another broadcast so it is delivered). */
export function ntMessage(c: NtConn, env: Envelope, caps: NtCaps, bx: BroadcastCtx): { data: string | null; held: boolean } {
  const view = env.view;
  // a connection whose own baseline was not kept (it was in step with the room) and has now fallen out of step: start it over
  const insync = !caps.aoi && !!view && c.tag >= 0 && c.tag === bx.tagPrev && !!bx.roster && view.players === bx.roster && !!bx.prevShown;
  const full = c.wantFull || bx.now - c.lastFull >= NT_FULL_MS || !view !== !c.hadView || (!view && !c.hadView) || (c.stale && !insync);
  if (full) {
    c.wantFull = false; c.lastFull = bx.now; c.hadView = !!view; c.tick = view ? view.tick : undefined; c.seq++; c.stale = false;
    c.tag = view && bx.roster && view.players === bx.roster ? bx.tagNow : -1;
    c.players = new Map(); c.sentAt = new Map(); c.keys = new Map(); c.held = new Set();
    if (view) {
      const ps = (view.players || {}) as Record<string, Rec>;
      for (const id in ps) { const p = ps[id]; if (p) { c.players.set(id, p); c.sentAt.set(id, bx.now); } }
      for (const k in view) if (k !== "players" && k !== "tick") c.keys.set(k, view[k]);
    }
    c.env = { status: env.status, seats: bx.seatsJson, connected: env.connected, result: env.result };
    NT_STATS.full++;
    return { data: '{"type":"nt","f":1,"v":' + NT_VERSION + ',"s":' + c.seq + ',"status":' + bx.memo.str(env.status) + ',"seats":' + bx.seatsJson + ',"you":' + JSON.stringify(env.you) + ',"connected":' + JSON.stringify(env.connected) + ',"view":' + objJson(view, bx.memo) + (env.result === undefined ? "" : ',"result":' + bx.memo.str(env.result)) + (env.meta === undefined ? "" : ',"meta":' + bx.memo.str(env.meta)) + "}", held: false };
  }
  const memo = bx.memo;
  const v = view as Rec;
  const out: Rec = {};
  let any = false, held = false;
  // envelope
  let E: Rec | null = null;
  if (c.env.status !== env.status) { (E ??= {}).status = env.status; c.env.status = env.status; }
  if (c.env.seats !== bx.seatsJson) { (E ??= {}).seats = env.seats; c.env.seats = bx.seatsJson; }
  if (c.env.connected !== env.connected) { (E ??= {}).connected = env.connected; c.env.connected = env.connected; }
  if (!same(c.env.result, env.result, memo)) { (E ??= {}).result = env.result; c.env.result = env.result; }
  if (E) { out.E = E; any = true; }
  // slow top-level state
  let K: Rec | null = null, KX: string[] | null = null;
  for (const k in v) {
    if (k === "players" || k === "tick") continue;
    const val = v[k];
    if (val === undefined) continue;
    if (c.keys.has(k) && same(c.keys.get(k), val, memo)) { c.keys.set(k, val); continue; }
    (K ??= {})[k] = val; c.keys.set(k, val);
  }
  for (const k of c.keys.keys()) if (v[k] === undefined) { (KX ??= []).push(k); }
  if (KX) for (const k of KX) c.keys.delete(k);
  if (K) { out.K = K; any = true; }
  if (KX) { out.KX = KX; any = true; }
  // players
  const ps = (v.players || {}) as Record<string, Rec>;
  const me = caps.aoi ? bx.pos.get(env.you) : undefined;
  const ik = (id: string) => { let k = bx.ik.get(id); if (k === undefined) { k = JSON.stringify(id); bx.ik.set(id, k); } return k; };
  const pstr = (prev: Rec, p: Rec): string | null => {
    let byPrev = bx.pd.get(p); if (!byPrev) { byPrev = new Map(); bx.pd.set(p, byPrev); }
    let e = byPrev.get(prev); if (!e) { e = { dd: diff(prev, p, memo) }; byPrev.set(prev, e); }
    if (!e.dd) return null;
    if (caps.arr) { if (e.a === undefined) e.a = JSON.stringify(compact(e.dd, p, prev)); return e.a; }
    if (e.s === undefined) e.s = JSON.stringify(e.dd); return e.s;
  };
  if (insync) {
    const k = caps.arr ? 1 : 0;
    let sec = bx.shared[k];
    if (sec === null) {
      const prevR = bx.prevShown as Record<string, Rec>; const N: string[] = [], P: string[] = [], X: string[] = [];
      for (const id in ps) { const p = ps[id]; if (!p) continue; const prev = prevR[id]; if (prev === p) continue; if (prev === undefined) { N.push(ik(id) + ":" + memo.str(p)); continue; } const js = pstr(prev, p); if (js !== null) P.push(ik(id) + ":" + js); }
      for (const id in prevR) if (ps[id] === undefined) X.push(id);
      sec = (N.length ? ',"N":{' + N.join(",") + "}" : "") + (P.length ? ',"P":{' + P.join(",") + "}" : "") + (X.length ? ',"X":' + JSON.stringify(X) : "");
      bx.shared[k] = sec;
    }
    c.tag = bx.tagNow; c.stale = true;
    if (!any && !sec && c.tick === v.tick) return { data: null, held };
    c.tick = v.tick; c.seq++; NT_STATS.delta++; NT_STATS.shared++;
    let data = '{"type":"nt","s":' + c.seq + (v.tick === undefined ? "" : ',"t":' + JSON.stringify(v.tick));
    if (out.E) data += ',"E":' + JSON.stringify(out.E);
    if (out.K) { let kk = ""; for (const key in out.K as Rec) kk += (kk ? "," : "") + JSON.stringify(key) + ":" + memo.str((out.K as Rec)[key]); data += ',"K":{' + kk + "}"; }
    if (out.KX) data += ',"KX":' + JSON.stringify(out.KX);
    return { data: data + sec + "}", held };
  }
  // this connection's own baseline: when it was brought up to date in the previous broadcast, only the players that changed since
  // then (and the ones held back) can differ from it, so only those are visited; otherwise every player is
  const fast = !c.stale && c.tag >= 0 && c.tag === bx.tagPrev && !!bx.prevShown && !!bx.roster && v.players === bx.roster;
  let cand: Iterable<string>, gone: Iterable<string>;
  if (fast) {
    let mv = bx.moved;
    if (!mv) { const prevR = bx.prevShown as Record<string, Rec>; mv = { changed: [], removed: [] }; for (const id in ps) if (ps[id] !== prevR[id]) mv.changed.push(id); for (const id in prevR) if (ps[id] === undefined) mv.removed.push(id); bx.moved = mv; }
    cand = c.held.size ? new Set([...mv.changed, ...c.held]) : mv.changed; gone = mv.removed;
  } else { cand = Object.keys(ps); gone = [...c.players.keys()]; }
  c.tag = bx.roster && v.players === bx.roster ? bx.tagNow : -1;
  const heldNow = new Set<string>();
  const N: string[] = [], P: string[] = [];
  let X: string[] | null = null;
  let far: { id: string; d: number }[] | null = null;
  for (const id of cand) {
    const p = ps[id];
    if (!p) continue;
    const prev = c.players.get(id);
    if (prev === p) continue;
    if (prev === undefined) { N.push(ik(id) + ":" + memo.str(p)); c.players.set(id, p); c.sentAt.set(id, bx.now); continue; }
    if (me && id !== env.you) {
      const q = bx.pos.get(id);
      const d = q ? Math.hypot(q[0] - me[0], q[1] - me[1]) : 0;
      if (d > NT_NEAR_M) { (far ??= []).push({ id, d }); continue; }
    }
    const js = pstr(prev, p);
    c.players.set(id, p); c.sentAt.set(id, bx.now);
    if (js !== null) P.push(ik(id) + ":" + js);
  }
  if (far) {
    far.sort((a, b) => a.d - b.d);
    for (let i = 0; i < far.length; i++) {
      const f = far[i]!; const gap = i < NT_FAR_CAP ? NT_FAR_MS : NT_REST_MS;
      if (bx.now - (c.sentAt.get(f.id) ?? 0) < gap) { held = true; heldNow.add(f.id); NT_STATS.skippedFar++; continue; }
      const p = ps[f.id]!, prev = c.players.get(f.id)!;
      const js = pstr(prev, p);
      c.players.set(f.id, p); c.sentAt.set(f.id, bx.now);
      if (js !== null) P.push(ik(f.id) + ":" + js);
    }
  }
  c.held = heldNow;
  for (const id of gone) if (ps[id] === undefined && c.players.has(id)) (X ??= []).push(id);
  if (X) for (const id of X) { c.players.delete(id); c.sentAt.delete(id); }
  if (!any && !N.length && !P.length && !X && c.tick === v.tick) return { data: null, held };
  c.tick = v.tick;
  c.seq++;
  NT_STATS.delta++;
  let data = '{"type":"nt","s":' + c.seq + (v.tick === undefined ? "" : ',"t":' + JSON.stringify(v.tick));
  if (out.E) data += ',"E":' + JSON.stringify(out.E);
  if (out.K) { let k = ""; for (const key in out.K as Rec) k += (k ? "," : "") + JSON.stringify(key) + ":" + memo.str((out.K as Rec)[key]); data += ',"K":{' + k + "}"; }
  if (out.KX) data += ',"KX":' + JSON.stringify(out.KX);
  if (N.length) data += ',"N":{' + N.join(",") + "}";
  if (P.length) data += ',"P":{' + P.join(",") + "}";
  if (X) data += ',"X":' + JSON.stringify(X);
  return { data: data + "}", held };
}

/** JSON.stringify(o) for a plain object, with each value through the per-broadcast memo (so the roster and the slow values a
 *  hundred connections share are serialised once). Same bytes as JSON.stringify: undefined values are skipped. */
function objJson(o: Rec | null, memo: Memo): string {
  if (o === null) return "null";
  let s = "";
  for (const k in o) { const v = o[k]; if (v === undefined || typeof v === "function") continue; s += (s ? "," : "") + JSON.stringify(k) + ":" + memo.str(v); }
  return "{" + s + "}";
}

/** One broadcast for every open connection: the body of Room.broadcast (room.ts prunes closed sockets first and passes `live`).
 *  Kept here, pure, so the bench and the tests run exactly the code the room runs. */
export function roomBroadcast(a: {
  game: { status: unknown; seats: string[]; state: unknown; result: unknown };
  conns: Record<string, string>;
  live: Map<string, { nt?: number; ntc?: string[] }>;
  ntConns: Map<string, { caps: NtCaps; c: NtConn }>;
  /** The room's roster history for the shared players section; omit it and every connection is diffed on its own. */
  hist?: NtHist;
  viewFor: (state: never, playerId: string) => unknown;
  meta: unknown;
  now: number;
}): { msgs: { to: string; data: string }[]; held: boolean } {
  const { game, conns } = a;
  const online = new Set(Object.values(conns));
  const connected = online.size || 1;
  // The room keeps every player it has ever seen (coins, passports, boards stay in state), but each update only carries the
  // players who are connected now or acted within the last few hundred ticks, so the payload and the clients' work no longer
  // grow with the visitor history (it used to send up to 500 stored players every tick).
  const st = game.state as { tick?: number } | null;
  const tick = st && typeof st.tick === "number" ? st.tick : 0;
  // the filtered roster is the same for every connection whose view shares the room's players object, so it is built once
  const shownMemo = new Map<unknown, Record<string, unknown>>();
  const shown = (all: Record<string, { t?: number }>): Record<string, unknown> => {
    const hit = shownMemo.get(all); if (hit) return hit;
    const out: Record<string, unknown> = {};
    for (const id in all) { const p = all[id]; if (online.has(id) || (p && typeof p.t === "number" && tick - p.t <= 600)) out[id] = p; }
    shownMemo.set(all, out);
    return out;
  };
  let bx: BroadcastCtx | null = null;
  const msgs: { to: string; data: string }[] = [];
  let held = false;
  for (const [connId, playerId] of Object.entries(conns)) {
    const view = (game.state ? a.viewFor(game.state as never, playerId) : null) as { players?: Record<string, { t?: number }> } | null;
    if (view && view.players) view.players = shown(view.players) as Record<string, { t?: number }>;
    const env = { status: game.status, seats: game.seats, you: playerId, connected, view: view as Rec | null, result: game.result, meta: a.meta };
    const att = a.live.get(connId);
    if (att && att.nt === NT_VERSION) {
      let nc = a.ntConns.get(connId);
      if (!nc) { const caps = att.ntc || []; nc = { caps: { aoi: caps.includes("aoi"), arr: caps.includes("arr") }, c: newNtConn() }; a.ntConns.set(connId, nc); }
      if (!bx) {
        const all = (game.state as { players?: Record<string, Rec> } | null)?.players ?? null;
        bx = broadcastCtx(game.seats, all, a.now);
        if (a.hist && all) { bx.roster = shown(all) as Record<string, Rec>; bx.prevShown = a.hist.shown; bx.tagPrev = a.hist.tag; bx.tagNow = a.hist.tag + 1; }
      }
      const r = ntMessage(nc.c, env, nc.caps, bx);
      if (r.held) held = true;
      if (r.data !== null) msgs.push({ to: connId, data: r.data });
    } else {
      msgs.push({ to: connId, data: legacyMessage(env) });
    }
  }
  // the roster every connection now holds (or is about to), for the next broadcast's shared section
  if (a.hist) { if (bx && bx.roster) { a.hist.shown = bx.roster; a.hist.tag = bx.tagNow; } else if (!bx) { a.hist.shown = null; a.hist.tag++; } }
  return { msgs, held };
}
