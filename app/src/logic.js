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
const MAX_STEP = { walk: 90, cart: 160, jet: 900 };
const MAX_ALT = 2500;
const EMOTES = ["wave", "cheer", "point", "sit"];
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,18}$/;
const SIGN_MAX = 80;
const SAY_MAX = 80;
const GUESTBOOK_MAX = 60;
const BOARD_MAX = 10;
const GAMES = ["golf", "course", "obby", "drag"];
// ── economy ──
const START_COINS = 500;
const SHOP = { hat_cap: 120, hat_cowboy: 220, hat_band: 90, outfit_flight: 300, outfit_ranch: 260, outfit_desert: 240, meal: 25, coffee: 10, art: 400 };
const LOT_PRICE = 1200;
const BUILD_KINDS = ["home", "dome", "pavilion", "casita"];
const BUILD_PRICE = { home: 900, dome: 500, pavilion: 400, casita: 600 };
const REWARD = { golf: 150, course: 80, obby: 120, drag: 60 };
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
  return { name: defaultName(playerId), x: HOME.x + 20, z: HOME.z + 40, ry: 0, emote: null, emoteTick: 0, t: 0, veh: null, say: null, sayTick: 0, cart: false, ball: null, look: null, xp: 0, coins: START_COINS, owned: [], hat: null, outfit: null, energy: 100, played: 0 };
}

export function setup(players) {
  const roster = {};
  for (const id of players) roster[id] = freshPlayer(id);
  return { tick: 0, players: roster, vehicles: defaultVehicles(), guestbook: [], boards: { golf: [], course: [], obby: [], drag: [] }, lots: defaultLots() };
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
      const step = action.cart ? MAX_STEP.cart : MAX_STEP.walk;
      if (dx * dx + dz * dz > step * step) return { ok: false, error: "moved too far" };
    }
    if (action.cart !== undefined && typeof action.cart !== "boolean") return { ok: false, error: "bad cart flag" };
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
    if (l.hair !== undefined && (!num(l.hair) || l.hair < 0 || l.hair > 3)) return { ok: false, error: "bad hair" };
    if (l.body !== undefined && l.body !== "m" && l.body !== "f") return { ok: false, error: "bad body" };
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
    if ((action.item.startsWith("hat_") || action.item.startsWith("outfit_")) && me.owned && me.owned.includes(action.item)) return { ok: false, error: "already owned" };
    return { ok: true };
  }
  if (action.t === "wear") {
    if (action.hat !== null && action.hat !== undefined && (!me || !me.owned || !me.owned.includes(action.hat))) return { ok: false, error: "you do not own that" };
    if (action.outfit !== null && action.outfit !== undefined && (!me || !me.owned || !me.owned.includes(action.outfit))) return { ok: false, error: "you do not own that" };
    return { ok: true };
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
  if (action.t === "name") {
    if (typeof action.name !== "string" || !NAME_RE.test(action.name.trim())) return { ok: false, error: "name must be 1-18 letters, numbers, spaces" };
    return { ok: true };
  }
  if (action.t === "emote") {
    if (!EMOTES.includes(action.e)) return { ok: false, error: "unknown emote" };
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
  if (action.t === "move") {
    me.x = Math.round(action.x * 100) / 100;
    me.z = Math.round(action.z * 100) / 100;
    me.ry = Math.round(action.ry * 1000) / 1000;
    if (action.cart !== undefined) me.cart = action.cart;
  } else if (action.t === "ball") {
    me.ball = action.b ? { x: Math.round(action.b.x * 100) / 100, z: Math.round(action.b.z * 100) / 100, h: Math.round(action.b.h) } : null;
  } else if (action.t === "score") {
    const list = [...(boards[action.game] || []), { by: me.name, v: Math.round(action.v), tick }];
    list.sort((a, b) => a.v - b.v);
    boards = { ...boards, [action.game]: list.slice(0, BOARD_MAX) };
    me.coins = (me.coins || 0) + REWARD[action.game]; me.xp = (me.xp || 0) + REWARD[action.game];
  } else if (action.t === "look") {
    me.look = { skin: action.look.skin, shirt: action.look.shirt, pants: action.look.pants, hair: action.look.hair || 0, body: action.look.body === "f" ? "f" : "m" };
  } else if (action.t === "tick") {
    me.lastTick = tick; me.played = (me.played || 0) + 1; me.xp = (me.xp || 0) + 5; me.coins = (me.coins || 0) + 3; me.energy = Math.max(0, (me.energy === undefined ? 100 : me.energy) - 2);
  } else if (action.t === "buy") {
    me.coins -= SHOP[action.item];
    if (action.item.startsWith("hat_") || action.item.startsWith("outfit_")) { me.owned = [...(me.owned || []), action.item]; if (action.item.startsWith("hat_")) me.hat = action.item; else me.outfit = action.item; }
    else if (action.item === "meal") me.energy = 100; else if (action.item === "coffee") me.energy = Math.min(100, (me.energy || 0) + 40); else if (action.item === "art") { me.owned = [...(me.owned || []), "art" + tick]; }
    me.xp = (me.xp || 0) + 10;
  } else if (action.t === "wear") {
    if (action.hat !== undefined) me.hat = action.hat; if (action.outfit !== undefined) me.outfit = action.outfit;
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
  } else if (action.t === "name") {
    me.name = action.name.trim();
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
  return { tick, players, vehicles: V, guestbook, boards, lots };
}

export function isGameOver() {
  return { over: false };
}

// Nothing is hidden in a walkthrough: everyone sees everyone.
export function viewFor(state, playerId) {
  return { you: playerId, tick: state.tick, players: state.players, vehicles: vehicles(state), guestbook: state.guestbook, boards: state.boards || { golf: [], course: [], obby: [], drag: [] }, lots: state.lots || defaultLots(), prices: { shop: SHOP, lot: LOT_PRICE, build: BUILD_PRICE }, ranks: RANKS };
}
