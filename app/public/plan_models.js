// Genesis One master plan: model specs for newly generated models (merged into MODEL_SPECS by loadModels).
// Loaded before client.js. Classic script: never declare top-level const/let/var here, register on window only.
// A spec here uses the same shape as MODEL_SPECS in client.js, e.g. { size: 12 } or { height: 9, prop: true, solid: 0 };
// optional extras read by loadModels: win: true (window shader), door: true (enterable, like the store).
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
// R9 (HANDOFF_R9_HITCHES.md, hitches): ?r9=0 turns every R9 change off, ?r9<letter>=0 one part of it (letters in the handoff)
window.R9 = window.R9 || (function () { var q = location.search, on = !/[?&]r9=0\b/.test(q); return { on: on, n: {}, part: function (k) { return on && !new RegExp("[?&]r9" + k + "=0(?![\\w])").test(q); } }; })();
window.PLAN_MODEL_SPECS = window.PLAN_MODEL_SPECS || {};

// ── the IMPL new-model kinds (C3 group A + C4 group B, registered by C5, 24 Sep 2026): 33 static kinds + the rigged host ──
// Every GLB is in metres, centred on its footprint, standing on y = 0, with its front (door, entrance, stage opening,
// sign face, hatch, nose, head) toward +Z, so rot is 0 and a placed model faces (sin yaw, cos yaw) exactly as IMPL.md
// says. size = the model's own longest footprint side (client scale 1 = the installed metric size).
// Buildings: box: 1 = one oriented box solid over 0.9 of the footprint (walls fit long barns, sheds and storefronts);
// solid = the circle inscribed in that box, so the building is still in COLLIDERS (vegetation, benches and lamps keep
// off it, the camera pulls in before a wall) without the circle ever reaching past the box. Long buildings also get
// circle end caps along their long axis (hook below), so nothing is scattered into their ends either.
// Props: prop: true (no pad grading, no AO decal), solid = collider radius (0 = walk through / walk onto).
// Walk-through props (portal_arch, frontier_arch, sun_gate) are solid 0; their posts and footings get box solids (hook
// below; positions measured from the installed meshes, ground slice under 1.2 m).
// Bridges are solid 0 so players can walk onto the deck; the module lays the walk ribbon at the deck height
// (PLAN_MODEL_INFO[kind].deck, metres above the model base). creek_rock box: 1 is a standable stepping stone.
// Animals: animal: true is data only (the client spawns fauna by explicit kind); they head along +Z.
// host is NOT a MODEL_SPECS kind on purpose: it is a rigged 24-bone Meshy skin (same joint names as char_m / char_f)
// whose mesh sits under a 0.01-scaled Armature node, so the static instancing path of loadModels bakes that 0.01 into
// the geometry and the instance comes out 1.7 cm tall (verified in game), and it would cost 4.8 to 6.9 MB at boot for a
// statue in A-pose. MODELS.host stays undefined, planPut("host") returns null (PLAN_FALLBACK.host is null) and the
// Outpost module loads PLAN_MODEL_INFO.host.file itself: gltfLoader() + THREE.SkeletonUtils.clone + AnimationMixer, like
// the player characters (retarget the char_f clips first: its Hips rest frame is 123 degrees from char_f's).
// agave_cluster and yucca_cluster sway in the wind: the sway shader needs instancing, so place them with put() or
// planPut(), never makeModel().
(function () {
  var S = window.PLAN_MODEL_SPECS;
  var add = function (k, sp) { S[k] = Object.assign({}, sp, S[k] || {}); };   // an entry another agent set first keeps its keys
  // C3 group A: buildings and hero props (Meshy 7 ultra / Tripo H3.1, v2 pipeline)
  add("lodge_lobby",   { size: 28.48, rot: 0, box: 1, solid: 11.7 });   // 26.0 x 8.0 x 28.5 m
  add("livery",        { size: 19.98, rot: 0, box: 1, solid: 7.2 });    // 16.0 x 11.7 x 20.0 m
  add("mission",       { size: 28.98, rot: 0 });                         // 24.0 x 13.8 x 29.0 m (dish on top), default circle
  add("gbarn",         { size: 20.0,  rot: 0, box: 1, solid: 4.58 });   // 10.2 x 11.7 x 20.0 m
  add("bandshell",     { size: 24.0,  rot: 0, box: 1, solid: 7.0 });    // 24.0 x 12.3 x 15.5 m, stage opening +Z (south at rot 0)
  add("storefront_sl", { size: 12.0,  rot: 0, box: 1, solid: 3.5 });    // 7.8 x 5.9 x 12.0 m
  add("portal_arch",   { size: 26.0,  rot: 0, prop: true, solid: 0 });  // 26 x 9 x 10 m, passage along Z
  add("hangarhome2",   { size: 30.8,  rot: 0, box: 1, solid: 13.5, door: true });   // 30.8 x 10.4 x 30.0 m; D3: enterable (the hangar home room), used for the plan hangarhome buildings via PLAN_ALIAS
  add("pilothouse",    { size: 20.32, rot: 0, box: 1, solid: 7.2 });    // 20.3 x 11.7 x 16.0 m (pylon at the back)
  add("habitat",       { size: 13.39, rot: 0, box: 1, solid: 1.5 });    // 3.35 x 4.6 x 13.4 m, hatch +Z, dome collar -Z
  add("flightdeck",    { size: 19.97, rot: 0, box: 1, solid: 5.4 });    // 20.0 x 7.2 x 12.0 m
  add("shed",          { size: 20.0,  rot: 0, box: 1, solid: 4.94 });   // 11.0 x 7.9 x 20.0 m
  add("sun_gate",      { size: 22.01, rot: 0, prop: true, solid: 0 });  // 22.0 x 11.0 x 15.7 m, walk under
  add("frontier_arch", { size: 18.0,  rot: 0, prop: true, solid: 0 });  // 18.0 x 8.6 x 2.9 m, walk under along Z
  add("frontier_well", { size: 5.86,  rot: 0, prop: true, solid: 2.8 });  // 5.85 x 6.0 x 5.86 m (sized to the 6 m height)
  add("little_hangar", { size: 9.64,  rot: 0, prop: true, solid: 3.2 });  // 9.6 x 5.5 x 8.0 m (x0.85 for a kid-scale deck)
  // C4 group B: vehicles, landmarks, planting, park pieces and farm animals (Tripo H3.1, v2 pipeline)
  add("biplane",        { size: 9,    prop: true, solid: 2.2, rot: 0 });   // 9.0 x 3.2 x 6.8 m
  add("stagecoach",     { size: 6,    prop: true, solid: 1.2, rot: 0 });   // 2.4 x 3.3 x 6.0 m
  add("rover",          { size: 5,    prop: true, solid: 1.5, rot: 0 });   // 2.6 x 2.5 x 5.0 m
  add("stratos",        { height: 4,  prop: true, solid: 1.9, rot: 0 });   // 3.8 x 4.0 x 3.9 m
  add("lander",         { size: 10,   prop: true, solid: 2.5, rot: 0 });   // 10.0 x 8.0 x 10.0 m
  add("agave_cluster",  { size: 2,    prop: true, solid: 0.5, sway: 0.06, rot: 0 });
  add("yucca_cluster",  { size: 2,    prop: true, solid: 0.4, sway: 0.15, rot: 0 });
  add("grotto",         { size: 9,    prop: true, solid: 3, rot: 0 });     // 9.0 x 3.2 x 8.2 m
  add("bridge_trestle", { size: 12,   prop: true, solid: 0, rot: 0 });     // 2.5 x 4.1 x 12.0 m, deck 3.14 m
  add("bridge_truss",   { size: 12,   prop: true, solid: 0, rot: 0 });     // 3.4 x 3.2 x 12.0 m, deck 1.71 m
  add("creek_rock",     { size: 1.5,  prop: true, solid: 0, box: 1, rot: 0 });
  add("cow",            { size: 2.3,  prop: true, solid: 0, animal: true, rot: 0 });
  add("goat",           { size: 1.3,  prop: true, solid: 0, animal: true, rot: 0 });
  add("sheep",          { size: 1.35, prop: true, solid: 0, animal: true, rot: 0 });
  add("pig",            { size: 1.6,  prop: true, solid: 0, animal: true, rot: 0 });
  add("chicken",        { height: 0.45, prop: true, solid: 0, animal: true, rot: 0 });
  add("dog",            { height: 0.68, prop: true, solid: 0, animal: true, rot: 0 });
})();

// installed facts for module authors (not specs): size [x, height, z] in metres at scale 1, what faces +Z, deck = the
// walkable top above the model base (sink a bridge or stepping stone by it to meet the path), posts = the walk-through
// props' post boxes in model space [lx, lz, w, d, height (default: the model height)] (added as solids by the hook
// below; set e.noPosts = true on a PLACE entry before DEFER to skip them), clear = the clear width between the posts.
window.PLAN_MODEL_INFO = window.PLAN_MODEL_INFO || {
  lodge_lobby: { size: [26.0, 7.95, 28.48], front: "entry canopy, pivot door and steps" },
  livery: { size: [16.0, 11.68, 19.98], front: "LIVERY STABLE false front, stable doors about 3.4 m" },
  mission: { size: [24.0, 13.8, 28.98], front: "entrance and MISSION CONTROL sign, doors about 3.8 m" },
  gbarn: { size: [10.18, 11.66, 20.0], front: "gable with X-braced sliding doors" },
  bandshell: { size: [24.0, 12.29, 15.54], front: "stage opening, stage deck about 0.9 m" },
  storefront_sl: { size: [7.78, 5.91, 12.0], front: "shop door and display windows" },
  portal_arch: { size: [26.0, 9.0, 10.0], front: "THE CROSSING on both faces, passage along Z", posts: [[-11.9, 0, 2.2, 10.0], [11.9, 0, 2.2, 10.0]], clear: 21.6 },
  hangarhome2: { size: [30.8, 10.42, 30.0], front: "glass hangar door and front door" },
  pilothouse: { size: [20.32, 11.72, 16.0], front: "double doors (PILOT HOUSE pylon at the back, -Z)" },
  habitat: { size: [3.35, 4.6, 13.39], front: "hatch and stairs (airlock collar at -Z mates with a dome)" },
  flightdeck: { size: [19.97, 7.17, 12.0], front: "FLIGHT DECK sign and terrace" },
  shed: { size: [10.97, 7.86, 20.0], front: "roll-up door and personnel door" },
  sun_gate: { size: [22.01, 11.0, 15.71], front: "two-peak shell, long axis X, walk-under clearance about 3.5 m at the low edges", posts: [[-9.75, -7.0, 2.0, 2.0, 3.0], [-9.75, 7.0, 2.0, 2.0, 3.0], [9.75, -7.0, 2.0, 2.0, 3.0], [9.75, 7.0, 2.0, 2.0, 3.0]] },
  frontier_arch: { size: [18.0, 8.59, 2.93], front: "lantern face, blank sign board for a text plane, about 5 m clear under the sign; 11.8 m clear between the stone plinths, so it needs scale 1.4 to straddle a 16 m carriageway", posts: [[-6.95, -0.2, 2.0, 2.2], [6.95, -0.2, 2.0, 2.2]], clear: 11.8 },
  frontier_well: { size: [5.85, 6.0, 5.86], front: "headframe face-on, crank on the right, rim about 1.1 m" },
  little_hangar: { size: [9.64, 5.52, 7.99], front: "open truss side with slides, deck about 2.3 m" },
  host: { size: [0.87, 1.7, 0.28], front: "face", rigged: true, file: "/models/host.glb", mobile: "/models_m/host.glb", lod: "/models/lod/host.glb", solid: 0.35, note: "A-pose, 24-bone Meshy rig (char_m / char_f joint names), 45k tris on both tiers, embedded clip Armature|Casual_Walk|baselayer has 2 keys only" },
  biplane: { size: [9.0, 3.17, 6.82], front: "nose and propeller" },
  stagecoach: { size: [2.42, 3.25, 6.0], front: "tow pole and driver's box" },
  rover: { size: [2.56, 2.55, 5.0], front: "nose, headlights and console" },
  stratos: { size: [3.75, 4.0, 3.92], front: "entry hatch and step" },
  lander: { size: [10.0, 7.96, 9.98], front: "hatch and ladder leg" },
  agave_cluster: { size: [1.87, 1.16, 2.0], front: "none" },
  yucca_cluster: { size: [1.41, 2.79, 2.0], front: "none" },
  grotto: { size: [9.0, 3.19, 8.24], front: "seep face and spill basin lip" },
  bridge_trestle: { size: [2.46, 4.09, 12.0], front: "a deck end (walk axis Z)", deck: 3.14 },
  bridge_truss: { size: [3.41, 3.23, 12.0], front: "a deck end (walk axis Z)", deck: 1.71 },
  creek_rock: { size: [1.5, 0.56, 1.37], front: "none", deck: 0.54 },
  cow: { size: [1.19, 1.73, 2.3], front: "head" }, goat: { size: [0.43, 1.11, 1.3], front: "head" }, sheep: { size: [0.5, 1.12, 1.35], front: "head" },
  pig: { size: [0.65, 0.93, 1.6], front: "snout" }, chicken: { size: [0.2, 0.45, 0.38], front: "beak" }, dog: { size: [0.31, 0.68, 0.86], front: "head" },
};

// ── collision and scale for the new kinds (PLAN mode hooks; client globals by bare name at call time) ──
(function () {
  var H = window.PLAN_HOOKS, INFO = window.PLAN_MODEL_INFO;
  // the new buildings were generated at the IMPL human scale (doors 2.3 to 3.8 m): the plan footprint may shrink one to
  // fit its lot, never enlarge it. That cap now lives in the client's planKind (D1 folded the old capNative hook into it).
  var BOXED = ["lodge_lobby", "livery", "gbarn", "bandshell", "storefront_sl", "hangarhome2", "pilothouse", "habitat", "flightdeck", "shed"];
  // circles inside the box solid along the long axis of a long building: [x, z, r] into COLLIDERS (scatter, camera, NPCs)
  function endCaps() {
    for (var b = 0; b < BOXED.length; b++) { var k = BOXED[b], L = PLACE[k], m = MODELS[k]; if (!L || !m) continue;
      for (var i = 0; i < L.length; i++) { var e = L[i]; if (e.capped) continue; e.capped = 1; var sc = e[4] || 1;
        var alongZ = m.sz >= m.sx, lng = (alongZ ? m.sz : m.sx) * 0.45 * sc, rad = (alongZ ? m.sx : m.sz) * 0.45 * sc, d = lng - rad; if (d < rad * 0.25) continue;
        var n = Math.ceil(d / rad), cs = Math.cos(e[3]), sn = Math.sin(e[3]);
        for (var s = 1; s <= n; s++) for (var sg = -1; sg <= 1; sg += 2) { var o = sg * d * s / n, lx = alongZ ? 0 : o, lz = alongZ ? o : 0;
          COLLIDERS.push([e[0] + lx * cs + lz * sn, e[2] - lx * sn + lz * cs, rad]); } } } }
  // the walk-through props' posts as box solids, at the final ground height (defer: after terrain hooks and instancing)
  function posts() {
    for (var k in INFO) { var P = INFO[k].posts, L = PLACE[k], m = MODELS[k]; if (!P || !L || !m) continue;
      for (var i = 0; i < L.length; i++) { var e = L[i]; if (e.posted || e.noPosts) continue; e.posted = 1; var sc = e[4] || 1, cs = Math.cos(e[3]), sn = Math.sin(e[3]);
        for (var p = 0; p < P.length; p++) { var lx = P[p][0] * sc, lz = P[p][1] * sc; addSolid(e[0] + lx * cs + lz * sn, e[2] - lx * sn + lz * cs, e[3], P[p][2] * sc, P[p][3] * sc, e[1] - 0.3, e[1] + (P[p][4] || m.height) * sc, "world"); } } } }
  // first world hook: queue the end caps behind every module's world hook (planHooks re-reads the list length, so a
  // hook pushed now runs last), before the vegetation is scattered
  H.world.push({ name: "planModelsWorld", fn: function () { H.world.push({ name: "planModelsCaps", fn: endCaps }); } });
  H.terrain.push({ name: "planModelsCapsLate", fn: endCaps });   // anything placed after the world phase (idempotent)
  H.defer.push({ name: "planModelsPosts", fn: posts });
})();
