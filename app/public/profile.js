/* The player's profile, per wallet (docs/auth.md).
 *
 * Name, look and progress used to live in this browser's localStorage. They now live in the room, under the player id
 * the server derives from the signed-in wallet: name and look in players[id] (their own `name` / `look` actions), the
 * rest in the private progs[id].pf (the `pref` action). Device settings (quality, FOV, sound, volume, radio) stay local.
 *
 *   profileGet(key)       like localStorage.getItem for the keys below
 *   profileSet(key, v)    like localStorage.setItem; sends `pref` for progress keys. Name and look are NOT sent from
 *                         here: the call sites already send their `name` / `look` actions, as before
 *   PROFILE.onView(view)  every state (client.js onState)
 *   PROFILE.onConnect()   every socket open
 *   PROFILE.whenReady(fn) once, after the first state: the server profile is known (or the migration is on its way)
 *
 * Where a value comes from:
 *   1. a write from this session the server has not confirmed yet
 *   2. the server, once it holds this wallet's profile (progs[id].mig); from then on the server is the truth
 *   3. this browser's localStorage, until then (before sign-in, and while the one-time migration is in flight)
 *
 * The first state of a wallet without a server profile sends one `migrate` with this browser's old values. The local
 * data is never deleted or overwritten: once the server leads, writes go to the server only.
 *
 * Those old values belong to ONE wallet: the first to sign in in this browser (g1:local-owner). Any other wallet
 * never reads them and migrates nothing, so it starts as a new player (name prompt, character studio), also after
 * a switch in the wallet extension (web3.js #wswitch). */
(function () {
  "use strict";

  // Mirrors PREF_KEYS in src/logic.js.
  const PF_KEYS = ["g1:bestdrag", "g1:bestlap", "g1:bestobby", "g1:bestrings", "g1:quest", "g1:hunt", "g1:huntdone", "g1:huntt0", "g1:tut", "g1:flown", "g1:visited", "g1:flights", "g1:bike",
    "g1:flightbest", "g1:flightlog", "g1:fa2log", "g1:ro_mbull", "g1:rhkinds"];
  const PF = new Set(PF_KEYS);
  // An unconfirmed name or look (the server normalises them, so they never read back identical) gives way after this.
  const PENDING_MS = 5000;
  // The player id this browser's old data belongs to. A device fact, so plain localStorage, never the server.
  const LOCAL_OWNER = "g1:local-owner";

  let view = null;
  let leading = false;
  let migrateSent = false;
  let ready = false;
  // Known before the first state: the game loads only after sign-in (boot.js), so the wallet's player id is there already.
  // A wallet that does not own this browser's data never reads it, not even in what scripts read while they load.
  let ownsLocal = (function () { const owner = local(LOCAL_OWNER), id = window.GB_WALLET && GB_WALLET.playerId; return !(owner && id && owner !== id); })();
  const readyWaiters = [];
  const pending = new Map(); // key -> { v, at }

  function local(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function setLocal(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

  /** The first wallet to get a state here owns the old data (also one that migrated before this was tracked). */
  function decideOwner(id) {
    const owner = local(LOCAL_OWNER);
    if (!owner) { setLocal(LOCAL_OWNER, id); ownsLocal = true; } else ownsLocal = owner === id;
  }

  function mine() { return view && view.players && view.you ? view.players[view.you] : null; }

  /** The server's default name for a player id (defaultName in src/logic.js): not a name the player chose. */
  function isDefaultName(name, id) { return name === "Visitor " + String(id).slice(0, 4).toUpperCase(); }

  function serverValue(k) {
    const me = mine();
    if (k === "g1:name") return me && me.name && !isDefaultName(me.name, view.you) ? me.name : null;
    if (k === "g1:look") return me && me.look ? JSON.stringify(me.look) : null;
    const pf = view && view.prog && view.prog.pf;
    return pf && typeof pf[k] === "string" ? pf[k] : null;
  }

  function profileGet(k) {
    const p = pending.get(k);
    if (p && !(leading && !PF.has(k) && Date.now() - p.at > PENDING_MS)) return p.v;
    return leading || !ownsLocal ? serverValue(k) : local(k);
  }

  function send(action) { try { if (typeof act === "function") act(action); } catch (e) { console.warn("[profile]", e); } }

  function profileSet(k, v) {
    const value = v === null || v === undefined ? null : String(v);
    pending.set(k, { v: value, at: Date.now() });
    // Before the first state there is no room to send to; whenReady flushes it.
    if (ready && PF.has(k)) send({ t: "pref", k, v: value });
  }

  function migrate() {
    migrateSent = true;
    const pf = {};
    for (const k of PF_KEYS) { const v = profileGet(k); if (v !== null && v !== undefined) pf[k] = v; }
    let look = null;
    try { look = JSON.parse(profileGet("g1:look")); } catch { /* none or broken: the server drops it */ }
    // Sent even when this browser has nothing (or its data belongs to another wallet: profileGet then reads the empty
    // server values): it marks the profile as the server's, so stale data in another browser never moves in later.
    send({ t: "migrate", name: profileGet("g1:name"), look, pf });
  }

  function onView(v) {
    view = v;
    if (!ready && v && v.you) decideOwner(v.you);
    const prog = v && v.prog;
    if (prog && prog.mig) leading = true;
    else if (!migrateSent) migrate();
    for (const [k, p] of pending) if (serverValue(k) === p.v) pending.delete(k);
    if (!ready) {
      ready = true;
      for (const [k, p] of pending) if (PF.has(k)) send({ t: "pref", k, v: p.v });
      while (readyWaiters.length) { const fn = readyWaiters.shift(); try { fn(); } catch (e) { console.error(e); } }
    }
  }

  // A dropped socket may have lost the migrate; ask again on the next one if the server still has no profile.
  function onConnect() { if (!leading) migrateSent = false; }

  window.profileGet = profileGet;
  window.profileSet = profileSet;
  window.PROFILE = {
    onView,
    onConnect,
    whenReady(fn) { if (ready) fn(); else readyWaiters.push(fn); },
    get leading() { return leading; },
  };
})();
