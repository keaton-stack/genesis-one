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
const GAMES = ["golf", "course", "obby", "drag", "rings", "hunt", "lap", "rodeo", "dance", "brace", "flight"];   // flight: the Solport Scenic Flight, v = 100000 - points like dance
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
const REWARD = { golf: 150, course: 80, obby: 120, drag: 60, rings: 60, hunt: 90, lap: 40, rodeo: 100, dance: 80, brace: 120, flight: 120 };
// the arcade: a credit costs ARCADE_PLAY, a prize is whatever the cabinet paid out, capped; high scores keep the top eight per game
const ARCADE_PLAY = 20, ARCADE_CAP = 60, ARCADE_BOARD = 8; const ARCADE_RE = /^[a-z]{2,12}$/;
// shared attractions: one Lava Room round at a time (phases pushed by the starter's client), and two air-hockey tables with a host and a challenger
const LAVA_STALE = 300, LAVA_PHASES = ["count", "warn", "lava", "rest", "over"], LAVA_HOT_RE = /^[0-9a-f]{0,40}$/;
const HOCKEY_TABLES = 2, HOCKEY_STALE = 300;
function lavaLive(state) { const L = state.lava; return !!(L && L.phase !== "over" && state.tick - (L.tick || 0) <= LAVA_STALE); }
function hockeyLive(state, table) { const H = (state.hockey || {})[table]; return H && H.host && state.tick - (H.tick || 0) <= HOCKEY_STALE ? H : null; }
const RANKS = [[0, "Passenger"], [400, "Pilot"], [1500, "Captain"], [4000, "Tower"]];
// Sol Passport progression (public/plan_progress.js): stamps, ranks earned by play only (never bought, never tied to coins or tokens)
// and an in-game community impact tally. The client keeps the full ledger; the room keeps a compact copy per player (stamp and award
// bit sets as hex, repeatable xp, the day cap, the visit streak) merged monotonically (bits OR, counters max) so reloads, tabs and
// devices never lose progress, plus the public rank shown on nameplates and the shared impact counters. Clients only send "prog"
// once they see view.progv, so an older room never receives it.
const PROG_V = 1, PROG_HEX_RE = /^[0-9a-f]{0,64}$/, PROG_TITLE_RE = /^[a-z0-9_]{0,24}$/, PROG_NUM_MAX = 1e7;
const IMPACT_KEYS = ["stamps", "talks", "flights", "landings", "acts", "rides", "visits"], IMPACT_STEP = 20;
function progInt(v, max) { return Number.isInteger(v) && v >= 0 && v <= max; }
function hexOr(a, b) { a = a || ""; b = b || ""; let out = ""; for (let i = 0; i < Math.max(a.length, b.length); i++) out += (parseInt(a[i] || "0", 16) | parseInt(b[i] || "0", 16)).toString(16); return out.replace(/0+$/, ""); }
const LOT_NAME_RE = /^[A-Za-z0-9 '.\-]{1,24}$/;
// ── R13 Copper Canyon Customs: golf cart and bike customization (public/plan_bodyshop.js, public/plan/bodyshop.json) ──
// Each item is [id, price, rank]: rank 0 Passenger, 1 Pilot, 2 Captain, 3 Tower (the Sol Passport rank the client reports in "prog",
// me.pr.r). Rank items are earned, not bought: price 0, unlocked at that rank. Stock options (index 0 of each choice, the ten stock
// paints p0 to p9, the six passport reward paints p24 to p29 and every decal, underglow and flag colour) are free and not listed.
// The list order is the bit index of the player's ownership set (me.bso, hex like the passport): never reorder, only append.
const BS_V = 1;
const BS_ITEMS = [
  ["p10", 120, 0], ["p11", 120, 0], ["p12", 120, 0], ["p13", 140, 0], ["p14", 140, 0], ["p15", 140, 0], ["p16", 140, 0], ["p17", 140, 0], ["p18", 160, 0], ["p19", 160, 0], ["p20", 180, 0], ["p21", 180, 0], ["p22", 0, 1], ["p23", 0, 2],
  ["f1", 150, 0], ["f2", 220, 0], ["f3", 0, 1], ["f4", 0, 2], ["f5", 0, 3],
  ["t1", 120, 0], ["t2", 120, 0], ["t3", 200, 0], ["t4", 150, 0],
  ["r1", 60, 0], ["r2", 60, 0], ["r3", 60, 0], ["r4", 80, 0], ["r5", 80, 0], ["r6", 80, 0], ["r7", 100, 0], ["r8", 60, 0], ["r9", 80, 0], ["r10", 80, 0], ["r11", 100, 0],
  ["rs1", 0, 1], ["rs2", 150, 0], ["rs3", 220, 0], ["rs4", 180, 0], ["rs5", 120, 0], ["rs6", 160, 0],
  ["s1", 60, 0], ["s2", 90, 0], ["s3", 90, 0], ["s4", 60, 0], ["s5", 60, 0], ["s6", 90, 0], ["s7", 90, 0], ["s8", 90, 0], ["s9", 90, 0], ["s10", 90, 0], ["s11", 120, 0],
  ["sp1", 160, 0], ["sp2", 140, 0], ["sp3", 120, 0], ["sp4", 140, 0], ["sp5", 180, 0],
  ["w1", 180, 0], ["w2", 220, 0], ["w3", 260, 0], ["w4", 300, 0], ["w5", 240, 0], ["w6", 280, 0], ["w7", 0, 2],
  ["wc1", 150, 0], ["wc2", 80, 0], ["wc3", 0, 1], ["wc4", 120, 0], ["wc5", 100, 0], ["wc6", 60, 0], ["wc7", 100, 0], ["wc8", 120, 0], ["wc9", 120, 0],
  ["ty1", 120, 0], ["ty2", 120, 0], ["ty3", 200, 0], ["ty4", 180, 0],
  ["l1", 400, 0], ["l2", 300, 0],
  ["e1", 60, 0], ["e2", 120, 0], ["e3", 100, 0], ["e4", 100, 0], ["e5", 100, 0], ["e6", 120, 0], ["e7", 0, 1], ["e8", 80, 0],
  ["d1", 150, 0], ["d2", 120, 0], ["d3", 220, 0], ["d4", 200, 0], ["d5", 200, 0], ["d6", 0, 2], ["d7", 300, 0], ["d8", 300, 0], ["d9", 180, 0], ["d10", 180, 0],
  ["pl", 80, 0], ["lb", 120, 0],
  ["a0", 0, 1], ["a1", 0, 2], ["a2", 140, 0], ["a3", 90, 0], ["a4", 220, 0], ["a5", 110, 0], ["a6", 160, 0], ["a7", 130, 0], ["a8", 70, 0], ["a9", 90, 0], ["a10", 50, 0],
  ["h1", 60, 0], ["h2", 90, 0], ["h3", 70, 0], ["h4", 50, 0],
  ["bf2", 40, 0], ["bf3", 40, 0], ["bf4", 50, 0], ["bf5", 50, 0], ["bf6", 60, 0], ["bf7", 50, 0], ["bf8", 50, 0], ["bf9", 50, 0], ["bf10", 0, 1], ["bf11", 0, 3],
  ["bw1", 40, 0], ["bw2", 80, 0], ["bw3", 90, 0], ["bw4", 60, 0], ["bw5", 50, 0], ["bw6", 50, 0], ["bw7", 50, 0],
  ["bt1", 60, 0], ["bt2", 60, 0],
  ["bg1", 20, 0], ["bg2", 30, 0], ["bg3", 30, 0], ["bg4", 30, 0], ["bg5", 30, 0], ["bg6", 30, 0], ["bg7", 30, 0],
  ["bs1", 30, 0], ["bs2", 50, 0], ["bs3", 50, 0], ["bs4", 40, 0], ["bs5", 40, 0], ["bs6", 40, 0], ["bs7", 70, 0],
  ["bb", 60, 0], ["bd1", 90, 0], ["bd2", 60, 0], ["bd3", 90, 0], ["bd4", 70, 0],
];
const BS = {}; BS_ITEMS.forEach((it, i) => { BS[it[0]] = { i, price: it[1], rank: it[2] }; });
// the look fields and their ranges (cart: me.cl, bike: me.bl); 0 is stock and is not stored
const BS_CART = { p: 29, p2: 29, f: 5, t: 4, r: 11, rs: 6, s: 11, sp: 5, s2: 11, w: 7, wc: 9, ty: 4, l: 2, e: 8, d: 10, dc: 9, a: 2047, u: 5, fl: 7, h: 4 };
const BS_BIKE = { f: 11, fe: 11, w: 7, t: 2, g: 7, s: 7, b: 1, d: 4, dc: 9 };
const BS_PLATE_RE = /^[A-Z0-9 ]{1,7}$/, BS_LABEL_RE = /^[A-Za-z0-9 .'!&-]{1,14}$/;
// words a plate or label may not contain (checked on letters only, with common number and symbol swaps undone)
// words a plate or label may not hold: the long ones anywhere in the letters, the short ones as a whole word (common number and symbol swaps undone)
const BS_BAD = ["fuck", "fuk", "fck", "shit", "cunt", "bitch", "nigg", "niga", "faggot", "whore", "slut", "rapist", "nazi", "hitler", "porn", "penis", "vagina", "dildo", "jizz", "asshole", "bastard", "motherf", "retard", "wetback", "tranny", "cocksuck", "pussy", "twat", "wank", "bollock", "titties", "boobs", "cocaine", "heroin", "kike"];
const BS_BAD_WORD = ["ass", "arse", "cum", "sex", "sexy", "spic", "chink", "gook", "fag", "fags", "hoe", "hoes", "tit", "tits", "dick", "dicks", "cock", "rape", "kkk", "anal", "anus", "piss", "crap", "douche", "stfu", "wtf", "kys", "meth", "weed", "milf", "horny", "boob", "suck", "sucks", "nude", "nudes"];
const BS_SWAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i" };
function bsWords(text) { const out = [""]; for (const ch of String(text).toLowerCase()) { const c = BS_SWAP[ch] || ch; if (c >= "a" && c <= "z") out[out.length - 1] += c; else if (out[out.length - 1]) out.push(""); } return out.filter(Boolean); }
function bsRude(text) { const w = bsWords(text), all = w.join(""); for (const b of BS_BAD) if (all.includes(b)) return true; for (const x of w) if (BS_BAD_WORD.includes(x)) return true; return false; }
function bsHas(hex, i) { const d = parseInt((hex || "")[i >> 2] || "0", 16); return ((d >> (i & 3)) & 1) === 1; }
function bsWith(hex, ids) { const a = (hex || "").split(""); for (const id of ids) { const i = BS[id].i; while (a.length <= (i >> 2)) a.push("0"); a[i >> 2] = (parseInt(a[i >> 2], 16) | (1 << (i & 3))).toString(16); } return a.join(""); }
// the items a look uses (ids in BS only: stock and free choices are left out)
function bsItems(cart, bike) {
  const out = [], add = (id) => { if (BS[id] && !out.includes(id)) out.push(id); };
  if (cart) { const c = cart;
    if (c.p) add("p" + c.p); if (c.t) { add("t" + c.t); if (c.p2) add("p" + c.p2); } if (c.f) add("f" + c.f); if (c.r) add("r" + c.r); if (c.rs) add("rs" + c.rs);
    if (c.s) add("s" + c.s); if (c.sp) { add("sp" + c.sp); if (c.s2) add("s" + c.s2); } if (c.w) add("w" + c.w); if (c.wc) add("wc" + c.wc); if (c.ty) add("ty" + c.ty); if (c.l) add("l" + c.l);
    if (c.e) add("e" + c.e); if (c.d) add("d" + c.d); if (c.pl) add("pl"); if (c.lb) add("lb"); if (c.h) add("h" + c.h);
    for (let b = 0; b < 11; b++) if ((c.a || 0) & (1 << b)) add("a" + b); }
  if (bike) { const k = bike; if (k.f) add("bf" + k.f); if (k.fe) add("bf" + k.fe); if (k.w) add("bw" + k.w); if (k.t) add("bt" + k.t); if (k.g) add("bg" + k.g); if (k.s) add("bs" + k.s); if (k.b) add("bb"); if (k.d) add("bd" + k.d); }
  return out;
}
// a cart or bike look from the client: null (back to stock) or an object of small integers (and two short texts on a cart)
function bsLookErr(o, spec, cart) {
  if (o === null) return null; if (!o || typeof o !== "object" || Array.isArray(o)) return "bad look";
  for (const k in o) { if (cart && (k === "pl" || k === "lb")) continue; if (!(k in spec)) return "bad " + k; const v = o[k]; if (!Number.isInteger(v) || v < 0 || v > spec[k]) return "bad " + k; }
  if (cart) { if (o.pl !== undefined && (typeof o.pl !== "string" || !BS_PLATE_RE.test(o.pl) || o.pl.trim() !== o.pl)) return "plates take 1 to 7 capital letters or numbers"; if (o.lb !== undefined && (typeof o.lb !== "string" || !BS_LABEL_RE.test(o.lb) || o.lb.trim() !== o.lb)) return "labels take 1 to 14 letters or numbers"; for (const k of ["pl", "lb"]) if (o[k] !== undefined && bsRude(o[k])) return "please pick a friendlier " + (k === "pl" ? "plate" : "label"); }
  return null;
}
function bsStore(o, spec, cart) { if (!o) return null; const r = {}; for (const k of Object.keys(spec)) if (o[k]) r[k] = o[k]; if (cart) { if (o.pl) r.pl = o.pl; if (o.lb) r.lb = o.lb; } return Object.keys(r).length ? r : null; }
function bsNeed(me, cart, bike) { const owned = (me && me.bso) || ""; return bsItems(cart, bike).filter((id) => !bsHas(owned, BS[id].i)); }
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
    if (l.hair !== undefined && (!Number.isInteger(l.hair) || l.hair < 0 || l.hair > 31)) return { ok: false, error: "bad hair" };
    // R11 character studio: headwear and its colourway, eyewear, accessories (bit mask); all optional small integers
    for (const [k, hi] of [["hw", 15], ["hwc", 7], ["ey", 7], ["ac", 63]]) if (l[k] !== undefined && (!Number.isInteger(l[k]) || l[k] < 0 || l[k] > hi)) return { ok: false, error: "bad " + k };
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
  if (action.t === "arcade") {
    if (typeof action.game !== "string" || !ARCADE_RE.test(action.game)) return { ok: false, error: "unknown game" };
    if (action.op === "coin") { if (!me || (me.coins || 0) < ARCADE_PLAY) return { ok: false, error: "not enough $GBACK" }; return { ok: true }; }
    if (action.op === "prize") { if (!me || !me.arcade || me.arcade.game !== action.game) return { ok: false, error: "insert a coin first" }; if (!num(action.v) || action.v < 0 || action.v > 1e7 || !num(action.p) || action.p < 0) return { ok: false, error: "bad score" }; return { ok: true }; }
    return { ok: false, error: "bad arcade op" };
  }
  if (action.t === "lava") {
    const L = state.lava || null; const coin = me && me.arcade && me.arcade.game === "lava";
    if (action.op === "start") { if (lavaLive(state)) return { ok: false, error: "a round is already running" }; if (!coin) return { ok: false, error: "insert a coin first" }; return { ok: true }; }
    if (action.op === "phase") { if (!L || L.by !== playerId || L.phase === "over") return { ok: false, error: "not your round" }; if (!LAVA_PHASES.includes(action.phase) || action.phase === "count") return { ok: false, error: "bad phase" }; if (!Number.isInteger(action.wave) || action.wave < 0 || action.wave > 99) return { ok: false, error: "bad wave" }; if (action.hot !== undefined && (typeof action.hot !== "string" || !LAVA_HOT_RE.test(action.hot))) return { ok: false, error: "bad tiles" }; return { ok: true }; }
    if (action.op === "join") { if (!lavaLive(state) || L.phase !== "count") return { ok: false, error: "no round to join" }; if (L.players && L.players[playerId]) return { ok: false, error: "already in" }; if (!coin) return { ok: false, error: "insert a coin first" }; return { ok: true }; }
    if (action.op === "out") { if (!L || !L.players || !L.players[playerId] || !L.players[playerId].alive) return { ok: false, error: "not in the round" }; return { ok: true }; }
    return { ok: false, error: "bad lava op" };
  }
  if (action.t === "hockey") {
    if (!Number.isInteger(action.table) || action.table < 0 || action.table >= HOCKEY_TABLES) return { ok: false, error: "no such table" };
    const H = hockeyLive(state, action.table); const coin = me && me.arcade && me.arcade.game === "airhockey";
    if (action.op === "host") { if (H && H.host !== playerId && state.players[H.host]) return { ok: false, error: "that table is taken" }; if (action.end !== 0 && action.end !== 1) return { ok: false, error: "bad end" }; if (!coin) return { ok: false, error: "insert a coin first" }; return { ok: true }; }
    if (action.op === "join") { if (!H || H.host === playerId) return { ok: false, error: "nobody is hosting that table" }; if (H.guest && H.guest !== playerId && state.players[H.guest]) return { ok: false, error: "that table is full" }; if (action.end !== 0 && action.end !== 1) return { ok: false, error: "bad end" }; if (action.end === H.hostEnd) return { ok: false, error: "take the other end" }; if (!coin) return { ok: false, error: "insert a coin first" }; return { ok: true }; }
    if (action.op === "leave") { const T = (state.hockey || {})[action.table]; if (!T || (T.host !== playerId && T.guest !== playerId)) return { ok: false, error: "not at that table" }; return { ok: true }; }
    if (action.op === "ping") { const T = (state.hockey || {})[action.table]; if (!T || T.host !== playerId) return { ok: false, error: "not your table" }; return { ok: true }; }
    return { ok: false, error: "bad hockey op" };
  }
  if (action.t === "prog") {
    for (const k of ["b", "a"]) if (action[k] !== undefined && (typeof action[k] !== "string" || !PROG_HEX_RE.test(action[k]))) return { ok: false, error: "bad passport" };
    for (const k of ["rx", "d", "dv", "vd", "sk", "x"]) if (action[k] !== undefined && !progInt(action[k], PROG_NUM_MAX)) return { ok: false, error: "bad progress" };
    if (action.r !== undefined && !progInt(action.r, 3)) return { ok: false, error: "bad rank" };
    if (action.ti !== undefined && action.ti !== null && (typeof action.ti !== "string" || !PROG_TITLE_RE.test(action.ti))) return { ok: false, error: "bad title" };
    if (action.add !== undefined) { if (!action.add || typeof action.add !== "object" || Array.isArray(action.add)) return { ok: false, error: "bad impact" }; for (const k in action.add) if (!IMPACT_KEYS.includes(k) || !progInt(action.add[k], IMPACT_STEP)) return { ok: false, error: "bad impact" }; }
    return { ok: true };
  }
  if (action.t === "bodyshop") {
    // R13: buy whatever the new look needs and put it on (cart, bike or both); null puts the stock look back
    if (!me) return { ok: false, error: "join first" };
    if (action.cart === undefined && action.bike === undefined) return { ok: false, error: "nothing to apply" };
    const ec = action.cart === undefined ? null : bsLookErr(action.cart, BS_CART, true); if (ec) return { ok: false, error: ec };
    const eb = action.bike === undefined ? null : bsLookErr(action.bike, BS_BIKE, false); if (eb) return { ok: false, error: eb };
    const need = bsNeed(me, action.cart || null, action.bike || null), rank = me.pr && Number.isInteger(me.pr.r) ? me.pr.r : 0;
    let cost = 0; for (const id of need) { const it = BS[id]; if (it.rank > rank) return { ok: false, error: "reach " + RANKS[it.rank][1] + " to unlock that" }; cost += it.price; }
    if ((me.coins || 0) < cost) return { ok: false, error: "not enough coins" };
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

  let boards = state.boards || { golf: [], course: [], obby: [], drag: [] }; let arcade = state.arcade || {};
  let lots = state.lots || defaultLots();
  let props = state.props || [];
  let av = state.av || null, duel = state.duel || null; let lava = state.lava || null, hockey = state.hockey || {};
  let progs = state.progs || {}, impact = state.impact || {};
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
    for (const k of ["hw", "hwc", "ey", "ac"]) if (Number.isInteger(action.look[k])) me.look[k] = action.look[k];
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
      veh.x = home.x; veh.z = home.z; veh.y = 0; veh.ry = home.ry; veh.pitch = 0; veh.roll = 0;
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
    veh.roll = veh.kind === "jet" && num(action.roll) ? Math.max(-1.6, Math.min(1.6, Math.round(action.roll * 1000) / 1000)) : 0;   // the bank, so everyone sees a turning jet bank
    veh.t = tick;
    V[me.veh] = veh;
    me.x = veh.x; me.z = veh.z; me.ry = veh.ry;
    // riders travel with the vehicle so zones, hotspots and the minimap follow them
    for (const id of veh.riders) if (players[id] && players[id].veh === me.veh) players[id] = { ...players[id], x: veh.x, z: veh.z, ry: veh.ry };
  } else if (action.t === "arcade") {
    if (action.op === "coin") { me.coins = (me.coins || 0) - ARCADE_PLAY; me.arcade = { game: action.game, tick }; me.xp = (me.xp || 0) + 2; }
    else { const prize = Math.min(ARCADE_CAP, Math.round(action.p)); me.coins = (me.coins || 0) + prize; me.xp = (me.xp || 0) + 5 + Math.round(prize / 4); me.arcade = null; me.plays = (me.plays || 0) + 1;
      const list = [...((state.arcade || {})[action.game] || []), { by: me.name, v: Math.round(action.v), tick }]; list.sort((a, b) => b.v - a.v); arcade = { ...(state.arcade || {}), [action.game]: list.slice(0, ARCADE_BOARD) }; }
  } else if (action.t === "lava") {
    if (action.op === "start") lava = { by: playerId, phase: "count", wave: 0, hot: "", tick, players: { [playerId]: { alive: true, waves: 0, name: me.name } } };
    else if (action.op === "phase") { const ps = { ...(lava.players || {}) }; if (action.phase === "over") for (const id in ps) if (ps[id].alive) ps[id] = { ...ps[id], alive: false, waves: action.wave }; lava = { ...lava, phase: action.phase, wave: action.wave, hot: action.hot === undefined ? lava.hot : action.hot, tick, players: ps }; }
    else if (action.op === "join") lava = { ...lava, tick, players: { ...(lava.players || {}), [playerId]: { alive: true, waves: 0, name: me.name } } };
    else if (action.op === "out") lava = { ...lava, tick, players: { ...lava.players, [playerId]: { ...lava.players[playerId], alive: false, waves: lava.wave } } };
  } else if (action.t === "hockey") {
    const T = hockey[action.table] || null;
    if (action.op === "host") hockey = { ...hockey, [action.table]: { host: playerId, hostEnd: action.end, guest: null, tick } };
    else if (action.op === "join") hockey = { ...hockey, [action.table]: { ...T, guest: playerId, tick } };
    else if (action.op === "leave") { if (T && T.host === playerId) { hockey = { ...hockey }; delete hockey[action.table]; } else if (T) hockey = { ...hockey, [action.table]: { ...T, guest: null, tick } }; }
    else if (action.op === "ping") hockey = { ...hockey, [action.table]: { ...T, tick } };
  } else if (action.t === "prog") {
    const P = { ...(progs[playerId] || {}) };
    if (action.b !== undefined) P.b = hexOr(P.b, action.b);
    if (action.a !== undefined) P.a = hexOr(P.a, action.a);
    if (action.rx !== undefined) P.rx = Math.max(P.rx || 0, action.rx);
    if (action.d !== undefined) { if (action.d > (P.d || 0)) { P.d = action.d; P.dv = action.dv || 0; } else if (action.d === P.d) P.dv = Math.max(P.dv || 0, action.dv || 0); }
    if (action.vd !== undefined) { if (action.vd > (P.vd || 0)) { P.vd = action.vd; P.sk = action.sk || 1; } else if (action.vd === P.vd) P.sk = Math.max(P.sk || 0, action.sk || 0); }
    progs = { ...progs, [playerId]: P };
    const pr = me.pr || { x: 0, r: 0, t: null };
    me.pr = { x: action.x !== undefined ? action.x : pr.x, r: action.r !== undefined ? action.r : pr.r, t: action.ti !== undefined ? action.ti || null : pr.t };
    if (action.add) { const I = { ...impact }; for (const k in action.add) I[k] = (I[k] || 0) + action.add[k]; impact = I; }
  } else if (action.t === "bodyshop") {
    const need = bsNeed(me, action.cart || null, action.bike || null); let cost = 0; for (const id of need) cost += BS[id].price;
    me.coins = (me.coins || 0) - cost; if (need.length) { me.bso = bsWith(me.bso, need); me.xp = (me.xp || 0) + 10; }
    if (action.cart !== undefined) me.cl = bsStore(action.cart, BS_CART, true);
    if (action.bike !== undefined) me.bl = bsStore(action.bike, BS_BIKE, false);
    me.bst = tick;
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
  return { tick, players, vehicles: V, guestbook, boards, lots, props, av, duel, arcade, lava, hockey, progs, impact };
}

export function isGameOver() {
  return { over: false };
}

// Nothing is hidden in a walkthrough: everyone sees everyone.
export function viewFor(state, playerId) {
  return { you: playerId, tick: state.tick, players: state.players, vehicles: vehicles(state), guestbook: state.guestbook, boards: state.boards || { golf: [], course: [], obby: [], drag: [] }, lots: state.lots || defaultLots(), props: state.props || [], av: state.av || null, duel: state.duel || null, arcade: state.arcade || {}, lava: state.lava || null, hockey: state.hockey || {}, prices: { catalog: CATALOG, shop: SHOP, lot: LOT_PRICE, build: BUILD_PRICE }, ranks: RANKS, progv: PROG_V, bsv: BS_V, prog: (state.progs || {})[playerId] || null, impact: state.impact || {} };
}
