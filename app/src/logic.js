/**
 * GENESIS ONE — shared-world walkthrough.
 *
 * One persistent room where visitors walk the 430-acre site together. The
 * server holds every visitor's position, name, emote and chat line, the shared
 * vehicles (golf carts and the Giveback jet) and a guestbook. There is no
 * winning: isGameOver() is always false, so the room stays open.
 *
 * Pure rules only: no imports, no timers, no randomness, JSON state.
 */

export const meta = { game: "Genesis One", minPlayers: 1, maxPlayers: 500 };

// World bounds in metres from the apron origin (see public/site.json).
const BOUND = 1400;
// Home base: Bisbee-Douglas International, 16 km north-west of the site.
const HOME = { x: -9290, z: -13820, r: 900 };
function onLand(x, z) { return (Math.abs(x) <= BOUND && Math.abs(z) <= BOUND) || (Math.abs(x - HOME.x) <= HOME.r && Math.abs(z - HOME.z) <= HOME.r); }
const AIR_BOUND = 20000;
// Furthest a single position update may jump per action. Walking sends at
// most 8 updates a second; vehicles are faster.
const MAX_STEP = { walk: 90, cart: 160, jet: 900, flight: 3000 };
const MAX_ALT = 2500;
const EMOTES = ["wave", "cheer", "point", "sit", "dance1", "dance2", "dance3", "dance4", "horn", "bell"];
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,18}$/;
const SIGN_MAX = 80;
const SAY_MAX = 80;
const GUESTBOOK_MAX = 60;
const BOARD_MAX = 10;
const GAMES = ["golf", "course", "obby", "drag", "rings", "hunt", "lap", "rodeo", "dance", "brace"];
const AV_OPTS = { main: [null, "film", "trailer", "off"], side: [null, "trailer", "film", "off"], wall: [null, "loop", "off"] };
const DUEL_WINDOW_TICKS = 1500, DUEL_STAKE = 40;
// ── economy ──
const START_COINS = 500;
const SHOP = { hat_cap: 120, hat_cowboy: 220, hat_band: 90, hat_trucker: 150, hat_beanie: 80, outfit_flight: 300, outfit_ranch: 260, outfit_desert: 240, meal: 25, coffee: 10, art: 400,
  gear_tee_gb: 140, gear_tee_black: 120, gear_hoodie_gb: 280, gear_vest_crew: 220, gear_jersey_gb: 260, gear_shades: 110, gear_bandana: 70, gear_backpack_gb: 240, gear_watch: 180, gear_lanyard: 50, gear_scarf: 90, gear_chain: 160 };
const GEAR_SLOT = { gear_tee_gb: "top", gear_tee_black: "top", gear_hoodie_gb: "top", gear_vest_crew: "top", gear_jersey_gb: "top", gear_shades: "face", gear_bandana: "neck", gear_scarf: "neck", gear_chain: "neck", gear_backpack_gb: "back", gear_watch: "wrist", gear_lanyard: "neck" };
const CATALOG = { bench: 30, picnic: 40, firepit: 50, lights: 45, cactuspot: 20, fountain: 120, flag: 60, signpost: 40, lounger: 35, umbrella: 30, mailbox: 20, boulder: 25, saguaro: 60, paloverde: 80, mesquite: 70, table: 35, chair: 15, bed: 90, sofa: 80, rug: 25, lamp: 30, shelf: 45, kitchen: 120, stool: 15, cup: 5, glass: 5, plate: 5, bottle: 8, tv: 90, plant: 20, art: 60, bar: 100, desk: 50, fridge: 70, fireplace: 140, hottub: 200, hammock: 45, grill: 55, cooler: 15, guitar: 40 };
const PROP_MAX = 600, PROP_PER = 80;
const LOT_PRICE = 1200;
const BUILD_KINDS = ["home", "dome", "pavilion", "casita"];
const BUILD_PRICE = { home: 900, dome: 500, pavilion: 400, casita: 600 };
const REWARD = { golf: 150, course: 80, obby: 120, drag: 60, rings: 60, hunt: 90, lap: 40, rodeo: 100, dance: 80, brace: 120 };
const RANKS = [[0, "Passenger"], [400, "Pilot"], [1500, "Captain"], [4000, "Tower"]];
const LOT_NAME_RE = /^[A-Za-z0-9 '.\-]{1,24}$/;
function defaultLots() { const lots = {}; for (let i = 0; i < 24; i++) lots["lot" + i] = { owner: null, build: null, name: null }; return lots; }
const SEATS = 4;                 // one driver + three riders
const BOARD_RANGE = 14;          // metres from the vehicle to climb in
const DRIVER_STALE_TICKS = 400;  // a silent driver loses the wheel

// Shared vehicles. Positions are world metres (x east, z south).
function defaultVehicles() {
  return {
    cart1: { kind: "cart", x: 18, z: 40, y: 0, ry: 1.2, pitch: 0, driver: null, riders: [], t: 0 },
    cart2: { kind: "cart", x: 26, z: 46, y: 0, ry: 1.2, pitch: 0, driver: null, riders: [], t: 0 },
    cart3: { kind: "cart", x: 300, z: 690, y: 0, ry: 0.4, pitch: 0, driver: null, riders: [], t: 0 },
    cart4: { kind: "cart", x: 312, z: 700, y: 0, ry: 0.4, pitch: 0, driver: null, riders: [], t: 0 },
    cart5: { kind: "cart", x: 830, z: 260, y: 0, ry: 2.4, pitch: 0, driver: null, riders: [], t: 0 },
    cart6: { kind: "cart", x: 120, z: -40, y: 0, ry: 3.0, pitch: 0, driver: null, riders: [], t: 0 },
    jet1:  { kind: "jet",  x: -40, z: 70, y: 0, ry: 2.28, pitch: 0, driver: null, riders: [], t: 0 },
    jet2:  { kind: "jet",  x: HOME.x + 40, z: HOME.z + 60, y: 0, ry: 2.0, pitch: 0, driver: null, riders: [], t: 0 },
    jet3:  { kind: "jet",  x: HOME.x - 10, z: HOME.z + 90, y: 0, ry: 2.0, pitch: 0, driver: null, riders: [], t: 0 },
  };
}

function defaultName(playerId) {
  return "Visitor " + String(playerId).slice(0, 4).toUpperCase();
}

function freshPlayer(playerId) {
  return { name: defaultName(playerId), x: 100, z: -34, ry: 0, emote: null, emoteTick: 0, t: 0, veh: null, say: null, sayTick: 0, cart: false, ball: null, look: null, xp: 0, coins: START_COINS, owned: [], hat: null, outfit: null, energy: 100, played: 0 };
}

export function setup(players) {
  const roster = {};
  for (const id of players) roster[id] = freshPlayer(id);
  return { tick: 0, players: roster, vehicles: defaultVehicles(), guestbook: [], boards: { golf: [], course: [], obby: [], drag: [], rings: [], hunt: [], lap: [] }, lots: defaultLots() };
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function vehicles(state) {
  return state.vehicles || defaultVehicles();
}

export function validateAction(state, playerId, action) {
  if (!action || typeof action !== "object") return { ok: false, error: "bad action" };
  const me = state.players[playerId];
  const V = vehicles(state);

  if (action.t === "move") {
    if (me && me.veh) return { ok: false, error: "you are riding" };
    if (!num(action.x) || !num(action.z) || !num(action.ry)) return { ok: false, error: "bad position" };
    if (!onLand(action.x, action.z)) return { ok: false, error: "outside the site" };
    if (me) {
      const dx = action.x - me.x, dz = action.z - me.z;
      const step = action.pose === "flight" ? MAX_STEP.flight : action.cart || (action.pose && action.pose !== "sit" && action.pose !== "dance") ? MAX_STEP.cart : MAX_STEP.walk;
      if (dx * dx + dz * dz > step * step) return { ok: false, error: "moved too far" };
    }
    if (action.cart !== undefined && typeof action.cart !== "boolean") return { ok: false, error: "bad cart flag" };
    if (action.pose !== undefined && action.pose !== null && (typeof action.pose !== "string" || !/^[a-z]{1,12}(:[A-Za-z0-9_.:-]{1,48})?$/.test(action.pose))) return { ok: false, error: "bad pose" };
    return { ok: true };
  }
  if (action.t === "ball") {
    if (action.b === null) return { ok: true };
    if (!action.b || !num(action.b.x) || !num(action.b.z) || !num(action.b.h)) return { ok: false, error: "bad ball" };
    if (!onLand(action.b.x, action.b.z)) return { ok: false, error: "outside the site" };
    return { ok: true };
  }
  if (action.t === "score") {
    if (!GAMES.includes(action.game)) return { ok: false, error: "unknown game" };
    if (!num(action.v) || action.v <= 0 || action.v > 1e7) return { ok: false, error: "bad score" };
    return { ok: true };
  }
  if (action.t === "look") {
    const l = action.look; if (!l || typeof l !== "object") return { ok: false, error: "bad look" };
    for (const k of ["skin", "shirt", "pants"]) if (typeof l[k] !== "string" || !/^[0-9a-f]{6}$/.test(l[k])) return { ok: false, error: "bad colour" };
    if (l.hair !== undefined && (!num(l.hair) || l.hair < 0 || l.hair > 4)) return { ok: false, error: "bad hair" };
    if (l.body !== undefined && l.body !== "m" && l.body !== "f") return { ok: false, error: "bad body" };
    for (const k of ["shoes", "hairc"]) if (l[k] !== undefined && (typeof l[k] !== "string" || !/^[0-9a-f]{6}$/.test(l[k]))) return { ok: false, error: "bad colour" };
    if (l.height !== undefined && (!num(l.height) || l.height < 0.88 || l.height > 1.12)) return { ok: false, error: "bad height" };
    if (l.cartc !== undefined && (!Number.isInteger(l.cartc) || l.cartc < 0 || l.cartc > 15)) return { ok: false, error: "bad cart colour" };
    return { ok: true };
  }
  if (action.t === "tick") {
    // one minute of play: a little xp and a coin. Capped by the tick gap so it cannot be farmed.
    if (me && state.tick - (me.lastTick || 0) < 8) return { ok: false, error: "too soon" };
    return { ok: true };
  }
  if (action.t === "buy") {
    if (!(action.item in SHOP)) return { ok: false, error: "no such item" };
    if (!me || me.coins < SHOP[action.item]) return { ok: false, error: "not enough coins" };
    if ((action.item.startsWith("hat_") || action.item.startsWith("outfit_") || action.item.startsWith("gear_")) && me.owned && me.owned.includes(action.item)) return { ok: false, error: "already owned" };
    return { ok: true };
  }
  if (action.t === "wear") {
    if (action.hat !== null && action.hat !== undefined && (!me || !me.owned || !me.owned.includes(action.hat))) return { ok: false, error: "you do not own that" };
    if (action.outfit !== null && action.outfit !== undefined && (!me || !me.owned || !me.owned.includes(action.outfit))) return { ok: false, error: "you do not own that" };
    if (action.gear !== undefined) { if (!action.gear || typeof action.gear !== "object") return { ok: false, error: "bad gear" }; for (const slot in action.gear) { const it = action.gear[slot]; if (it === null) continue; if (typeof it !== "string" || GEAR_SLOT[it] !== slot) return { ok: false, error: "bad gear" }; if (!me || !me.owned || !me.owned.includes(it)) return { ok: false, error: "you do not own that" }; } }
    return { ok: true };
  }
  if (action.t === "prop") {
    const props = state.props || [];
    if (action.op === "add") { if (!(action.kind in CATALOG)) return { ok: false, error: "no such item" }; if (!num(action.x) || !num(action.y) || !num(action.z) || !num(action.ry)) return { ok: false, error: "bad position" }; if (action.room !== undefined && action.room !== null && (typeof action.room !== "string" || action.room.length > 24)) return { ok: false, error: "bad room" };
      if (!action.room && !onLand(action.x, action.z)) return { ok: false, error: "outside the site" }; if (!me || me.coins < CATALOG[action.kind]) return { ok: false, error: "not enough coins" }; if (props.length >= PROP_MAX) return { ok: false, error: "the site is full" }; if (props.filter((p) => p.by === playerId).length >= PROP_PER) return { ok: false, error: "you have placed the maximum" }; return { ok: true }; }
    if (action.op === "remove") { const p = props.find((q) => q.id === action.id); if (!p) return { ok: false, error: "no such item" }; if (p.by !== playerId) return { ok: false, error: "not yours" }; return { ok: true }; }
    return { ok: false, error: "bad op" };
  }
  if (action.t === "lot") {
    const lots = state.lots || defaultLots(); const lot = lots[action.id]; if (!lot) return { ok: false, error: "no such lot" };
    if (action.op === "buy") { if (lot.owner) return { ok: false, error: "already owned" }; if (!me || me.coins < LOT_PRICE) return { ok: false, error: "not enough coins" }; return { ok: true }; }
    if (action.op === "build") { if (lot.owner !== playerId) return { ok: false, error: "not your lot" }; if (!BUILD_KINDS.includes(action.kind)) return { ok: false, error: "unknown building" }; if (!me || me.coins < BUILD_PRICE[action.kind]) return { ok: false, error: "not enough coins" }; return { ok: true }; }
    if (action.op === "name") { if (lot.owner !== playerId) return { ok: false, error: "not your lot" }; if (typeof action.name !== "string" || !LOT_NAME_RE.test(action.name.trim())) return { ok: false, error: "bad name" }; return { ok: true }; }
    return { ok: false, error: "bad lot op" };
  }
  if (action.t === "warp") {
    if (me && me.veh) return { ok: false, error: "leave the vehicle first" };
    if (!num(action.x) || !num(action.z)) return { ok: false, error: "bad position" };
    if (!onLand(action.x, action.z)) return { ok: false, error: "outside the site" };
    return { ok: true };
  }
  if (action.t === "board") {
    const veh = V[action.v];
    if (!veh) return { ok: false, error: "no such vehicle" };
    if (me && me.veh) return { ok: false, error: "already riding" };
    if (me) {
      const dx = veh.x - me.x, dz = veh.z - me.z;
      if (dx * dx + dz * dz > BOARD_RANGE * BOARD_RANGE) return { ok: false, error: "too far from the vehicle" };
    }
    const driverFree = !veh.driver || !state.players[veh.driver] || state.players[veh.driver].veh !== action.v || state.tick - state.players[veh.driver].t > DRIVER_STALE_TICKS;
    const riders = veh.riders.filter((id) => state.players[id] && state.players[id].veh === action.v);
    if (!driverFree && riders.length >= SEATS - 1) return { ok: false, error: "vehicle is full" };
    return { ok: true };
  }
  if (action.t === "leave") {
    if (!me || !me.veh) return { ok: false, error: "not riding" };
    return { ok: true };
  }
  if (action.t === "drive") {
    if (!me || !me.veh) return { ok: false, error: "not riding" };
    const veh = V[me.veh];
    if (!veh) return { ok: false, error: "no such vehicle" };
    if (veh.driver !== playerId) return { ok: false, error: "not the driver" };
    if (!num(action.x) || !num(action.z) || !num(action.ry)) return { ok: false, error: "bad position" };
    const y = num(action.y) ? action.y : 0, pitch = num(action.pitch) ? action.pitch : 0;
    if (veh.kind === "jet" ? (Math.abs(action.x) > AIR_BOUND || Math.abs(action.z) > AIR_BOUND) : !onLand(action.x, action.z)) return { ok: false, error: "outside the site" };
    if (y < 0 || y > MAX_ALT) return { ok: false, error: "bad altitude" };
    if (veh.kind !== "jet" && y > 0) return { ok: false, error: "carts do not fly" };
    const dx = action.x - veh.x, dz = action.z - veh.z, dy = y - veh.y, step = MAX_STEP[veh.kind];
    if (dx * dx + dz * dz + dy * dy > step * step) return { ok: false, error: "moved too far" };
    return { ok: true };
  }
  if (action.t === "quest") {
    if (!Number.isInteger(action.step) || action.step < 0 || action.step > 4) return { ok: false, error: "bad step" };
    if (((me && me.quest) || 0) !== action.step) return { ok: false, error: "step already claimed" };
    return { ok: true };
  }
  if (action.t === "name") {
    if (typeof action.name !== "string" || !NAME_RE.test(action.name.trim())) return { ok: false, error: "name must be 1-18 letters, numbers, spaces" };
    return { ok: true };
  }
  if (action.t === "emote") {
    if (!EMOTES.includes(action.e)) return { ok: false, error: "unknown emote" };
    return { ok: true };
  }
  if (action.t === "av") {
    for (const k in AV_OPTS) if (!AV_OPTS[k].includes(action[k] === undefined ? null : action[k])) return { ok: false, error: "bad " + k };
    return { ok: true };
  }
  if (action.t === "say" || action.t === "sign") {
    if (typeof action.text !== "string") return { ok: false, error: "bad text" };
    const text = action.text.trim(), max = action.t === "say" ? SAY_MAX : SIGN_MAX;
    if (text.length < 1 || text.length > max) return { ok: false, error: "1-" + max + " characters" };
    if (/[\u0000-\u001F\u007F]/.test(text)) return { ok: false, error: "no control characters" };
    return { ok: true };
  }
  return { ok: false, error: "unknown action" };
}

export function applyAction(state, playerId, action) {
  const tick = state.tick + 1;
  const players = { ...state.players };
  const me = { ...(players[playerId] || freshPlayer(playerId)) };
  const V = { ...vehicles(state) };
  let guestbook = state.guestbook;

  let boards = state.boards || { golf: [], course: [], obby: [], drag: [] };
  let lots = state.lots || defaultLots();
  let props = state.props || [];
  let av = state.av || null, duel = state.duel || null;
  if (action.t === "move") {
    me.x = Math.round(action.x * 100) / 100;
    me.z = Math.round(action.z * 100) / 100;
    me.ry = Math.round(action.ry * 1000) / 1000;
    if (action.cart !== undefined) me.cart = action.cart;
    if (action.pose !== undefined) me.pose = action.pose || null;
    if (typeof action.y === "number" && isFinite(action.y)) me.y = Math.round(action.y * 100) / 100;
  } else if (action.t === "ball") {
    me.ball = action.b ? { x: Math.round(action.b.x * 100) / 100, z: Math.round(action.b.z * 100) / 100, h: Math.round(action.b.h) } : null;
  } else if (action.t === "score") {
    const list = [...(boards[action.game] || []), { by: me.name, v: Math.round(action.v), tick }];
    list.sort((a, b) => a.v - b.v);
    boards = { ...boards, [action.game]: list.slice(0, BOARD_MAX) };
    me.coins = (me.coins || 0) + REWARD[action.game]; me.xp = (me.xp || 0) + REWARD[action.game];
    // dance battles are duels: whoever finished on the floor within the last 1500 ticks (a couple of minutes of play) is your rival; the higher score takes the stake from the other
    if (action.game === "dance") {
      const now = tick; const mine = 100000 - Math.round(action.v); let rival = null;
      for (const [pid, q] of Object.entries(players)) { if (pid === playerId || !q.danceAt || now - q.danceAt > DUEL_WINDOW_TICKS) continue; if (!rival || q.danceAt > rival.q.danceAt) rival = { pid, q }; }
      if (rival) { const rq = { ...rival.q }; const theirs = rq.danceScore || 0; const iWin = mine >= theirs; const winner = iWin ? me : rq, loser = iWin ? rq : me; const amount = Math.min(DUEL_STAKE, Math.max(0, loser.coins || 0)); loser.coins = (loser.coins || 0) - amount; winner.coins = (winner.coins || 0) + amount; duel = { id: tick, a: me.name, ai: playerId, as: mine, b: rq.name, bi: rival.pid, bs: theirs, winner: winner.name, wi: iWin ? playerId : rival.pid, amount, at: now }; rq.danceAt = 0; me.danceAt = 0; players[rival.pid] = rq; }
      else { me.danceAt = now; me.danceScore = mine; }
    }
  } else if (action.t === "look") {
    me.look = { skin: action.look.skin, shirt: action.look.shirt, pants: action.look.pants, hair: action.look.hair || 0, body: action.look.body === "f" ? "f" : "m", shoes: action.look.shoes || "f5f1e6", hairc: action.look.hairc || "1c1512", height: action.look.height || 1, cartc: Number.isInteger(action.look.cartc) ? action.look.cartc : 0 };
  } else if (action.t === "tick") {
    me.lastTick = tick; me.played = (me.played || 0) + 1; me.xp = (me.xp || 0) + 5; me.coins = (me.coins || 0) + 3; me.energy = Math.max(0, (me.energy === undefined ? 100 : me.energy) - 2);
  } else if (action.t === "buy") {
    me.coins -= SHOP[action.item];
    if (action.item.startsWith("hat_") || action.item.startsWith("outfit_")) { me.owned = [...(me.owned || []), action.item]; if (action.item.startsWith("hat_")) me.hat = action.item; else me.outfit = action.item; }
    else if (action.item.startsWith("gear_")) { me.owned = [...(me.owned || []), action.item]; me.gear = { ...(me.gear || {}), [GEAR_SLOT[action.item]]: action.item }; }
    else if (action.item === "meal") me.energy = 100; else if (action.item === "coffee") me.energy = Math.min(100, (me.energy || 0) + 40); else if (action.item === "art") { me.owned = [...(me.owned || []), "art" + tick]; }
    me.xp = (me.xp || 0) + 10;
  } else if (action.t === "wear") {
    if (action.hat !== undefined) me.hat = action.hat; if (action.outfit !== undefined) me.outfit = action.outfit; if (action.gear !== undefined) { const g = { ...(me.gear || {}) }; for (const slot in action.gear) { if (action.gear[slot] === null) delete g[slot]; else g[slot] = action.gear[slot]; } me.gear = g; }
  } else if (action.t === "prop") {
    props = [...props];
    if (action.op === "add") { props.push({ id: "p" + tick.toString(36) + "_" + String(playerId).replace(/[^a-z0-9]/gi, "").slice(0, 6) + "_" + props.length.toString(36), by: playerId, kind: action.kind, x: Math.round(action.x * 100) / 100, y: Math.round(action.y * 100) / 100, z: Math.round(action.z * 100) / 100, ry: Math.round(action.ry * 100) / 100, room: action.room || null }); me.coins -= CATALOG[action.kind]; me.xp = (me.xp || 0) + 4; }
    else if (action.op === "remove") { const i = props.findIndex((q) => q.id === action.id); if (i >= 0) props.splice(i, 1); }
  } else if (action.t === "lot") {
    const lot = { ...lots[action.id] };
    if (action.op === "buy") { lot.owner = playerId; lot.name = me.name; me.coins -= LOT_PRICE; me.xp = (me.xp || 0) + 100; }
    else if (action.op === "build") { lot.build = action.kind; me.coins -= BUILD_PRICE[action.kind]; me.xp = (me.xp || 0) + 60; }
    else if (action.op === "name") lot.name = action.name.trim();
    lots = { ...lots, [action.id]: lot };
  } else if (action.t === "warp") {
    me.x = Math.round(action.x * 100) / 100;
    me.z = Math.round(action.z * 100) / 100;
  } else if (action.t === "board") {
    const veh = { ...V[action.v], riders: [...V[action.v].riders] };
    const driverFree = !veh.driver || !players[veh.driver] || players[veh.driver].veh !== action.v || tick - players[veh.driver].t > DRIVER_STALE_TICKS;
    veh.riders = veh.riders.filter((id) => id !== playerId && players[id] && players[id].veh === action.v);
    if (driverFree) {
      if (veh.driver && players[veh.driver] && players[veh.driver].veh === action.v) {
        // a stale driver is bumped to the ground
        players[veh.driver] = { ...players[veh.driver], veh: null };
      }
      veh.driver = playerId;
    } else {
      veh.riders.push(playerId);
    }
    veh.t = tick;
    V[action.v] = veh;
    me.veh = action.v;
    me.x = veh.x; me.z = veh.z;
  } else if (action.t === "leave") {
    const veh = { ...V[me.veh], riders: [...V[me.veh].riders] };
    if (veh.driver === playerId) veh.driver = null;
    veh.riders = veh.riders.filter((id) => id !== playerId);
    veh.t = tick;
    // a jet abandoned in the air or off the site flies itself back to the apron,
    // and its last occupant is dropped there too
    const home = defaultVehicles()[me.veh];
    if (veh.kind === "jet" && !veh.driver && veh.riders.length === 0 && (veh.y > 0 || !onLand(veh.x, veh.z))) {
      veh.x = home.x; veh.z = home.z; veh.y = 0; veh.ry = home.ry; veh.pitch = 0;
    }
    V[me.veh] = veh;
    // step out beside the vehicle
    me.x = Math.round((veh.x + Math.cos(veh.ry) * 3) * 100) / 100;
    me.z = Math.round((veh.z - Math.sin(veh.ry) * 3) * 100) / 100;
    if (!onLand(me.x, me.z)) { me.x = home.x + 4; me.z = home.z + 4; }
    me.veh = null;
  } else if (action.t === "drive") {
    const veh = { ...V[me.veh] };
    veh.x = Math.round(action.x * 100) / 100;
    veh.z = Math.round(action.z * 100) / 100;
    veh.y = num(action.y) ? Math.round(action.y * 100) / 100 : 0;
    veh.ry = Math.round(action.ry * 1000) / 1000;
    veh.pitch = num(action.pitch) ? Math.round(action.pitch * 1000) / 1000 : 0;
    veh.t = tick;
    V[me.veh] = veh;
    me.x = veh.x; me.z = veh.z; me.ry = veh.ry;
    // riders travel with the vehicle so zones, hotspots and the minimap follow them
    for (const id of veh.riders) if (players[id] && players[id].veh === me.veh) players[id] = { ...players[id], x: veh.x, z: veh.z, ry: veh.ry };
  } else if (action.t === "quest") {
    me.quest = action.step + 1; me.coins = (me.coins || 0) + 25; me.xp = (me.xp || 0) + 15;
  } else if (action.t === "name") {
    me.name = action.name.trim();
  } else if (action.t === "av") {
    av = { main: action.main || null, side: action.side || null, wall: action.wall || null, by: me.name, tick };
  } else if (action.t === "emote") {
    me.emote = action.e;
    me.emoteTick = tick;
  } else if (action.t === "say") {
    me.say = action.text.trim();
    me.sayTick = tick;
  } else if (action.t === "sign") {
    const entry = { by: me.name, text: action.text.trim(), tick };
    guestbook = [...state.guestbook, entry].slice(-GUESTBOOK_MAX);
  }

  me.t = tick;
  players[playerId] = me;
  return { tick, players, vehicles: V, guestbook, boards, lots, props, av, duel };
}

export function isGameOver() {
  return { over: false };
}

// Nothing is hidden in a walkthrough: everyone sees everyone.
export function viewFor(state, playerId) {
  return { you: playerId, tick: state.tick, players: state.players, vehicles: vehicles(state), guestbook: state.guestbook, boards: state.boards || { golf: [], course: [], obby: [], drag: [] }, lots: state.lots || defaultLots(), props: state.props || [], av: state.av || null, duel: state.duel || null, prices: { catalog: CATALOG, shop: SHOP, lot: LOT_PRICE, build: BUILD_PRICE }, ranks: RANKS };
}
