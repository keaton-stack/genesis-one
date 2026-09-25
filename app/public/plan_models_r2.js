// Genesis One round 2 (IMPL2.md): model specs for the round 2 asset kinds (merged into MODEL_SPECS by loadModels).
// Loaded before client.js, right after plan_models.js. Classic script: never declare top-level const/let/var here, register
// on window only. Written by the round 2 assets register task (R) from genesis_data\masterplan\assets_r2\specs_P.json,
// specs_C1.json, specs_C2.json and specs_C3.json (25 Sep 2026), then extended by the round 2b register task from
// specs_R2A.json .. specs_R2G.json (25 Sep 2026: 35 more kinds, and the rigged will and paul switched on in PLAN_MODEL_INFO).
// Details per kind: assets_r2\HANDOFF_R2.md.
//
// Loading rule (client.js loadModels): a PLAN_MODEL_SPECS kind is downloaded only if the plan's buildings use it, the
// planting tables use it, or a module lists it in window.PLAN_MODEL_NEEDS. The scanned rocks (ph_boulder_N, ph_rock_N,
// ph_moonrock_N, ph_stones, ph_sandrocks) are added by the client itself (XR_RE, planRocks). Registering a kind here costs
// nothing at boot until some module needs it: modules decide what loads.
//
// Every GLB is in metres, centred on its footprint, standing on y = 0, front toward +Z (a placed model faces
// (sin yaw, cos yaw)); size = the model's longest footprint side, height = its height, so client scale 1 is the real
// object. Tiers: desktop models/<kind>.glb (KTX2 UASTC, meshopt), mobile models_m/<kind>.glb (ETC1S 512), far LOD
// models/lod/<kind>.glb (128). Exception: the jets keep the old jet convention in the file (nose on -X) and turn with rot.
window.PLAN_HOOKS = window.PLAN_HOOKS || { terrain: [], world: [], defer: [], frame: [], interior: [] };
window.PLAN_MODEL_SPECS = window.PLAN_MODEL_SPECS || {};

(function () {
  var S = window.PLAN_MODEL_SPECS;
  var add = function (k, sp) { S[k] = Object.assign({}, sp, S[k] || {}); };   // an entry another agent set first keeps its keys

  // ── task P: Poly Haven CC0 scans (free), real size at scale 1. prop: true everywhere (no pad grading, no AO decal).
  // solid = collider radius in metres (scales with the placement); box: 1 = oriented standable box over 0.9 of the
  // footprint. Small rocks, stones, the sand patch and every shrub are walk-through (solid 0). sway = the instanced wind
  // shader: place swaying kinds with put() or planPut(), never makeModel(). Cut-out leaves are alphaMode MASK (alpha
  // tested, double sided). EXCEPTION to scale 1 = real size: the moon rock scans are 7 to 25 cm pebbles, so their spec
  // size is 8 x the scan and scale 1 is a 0.6 to 2.0 m Outpost boulder (the GLBs stay at the real scan size).
  // Sizes in the comments: x width x height x z depth at scale 1, then the Poly Haven asset.
  // rocks and boulders (the client's planRocks picks these up by name, XR_RE)
  add("ph_boulder_1",    { size: 2.533, prop: true, solid: 0.56, box: 1, rot: 0 });   // 2.533 x 0.879 x 1.234 m, namaqualand_boulder_02
  add("ph_boulder_2",    { size: 3.064, prop: true, solid: 1.08, box: 1, rot: 0 });   // 2.402 x 1.475 x 3.064 m, namaqualand_boulder_03
  add("ph_boulder_3",    { size: 2.526, prop: true, solid: 1.12, box: 1, rot: 0 });   // 2.526 x 1.903 x 2.499 m, namaqualand_boulder_04
  add("ph_boulder_4",    { size: 1.363, prop: true, solid: 0.34, box: 1, rot: 0 });   // 1.363 x 0.535 x 0.746 m, namaqualand_boulder_05
  add("ph_boulder_5",    { size: 1.212, prop: true, solid: 0.3, box: 1, rot: 0 });    // 0.674 x 0.653 x 1.212 m, namaqualand_boulder_06
  add("ph_rock_1",       { size: 0.55, prop: true, solid: 0, rot: 0 });              // 0.364 x 0.252 x 0.55 m, namaqualand_boulders_01
  add("ph_rock_2",       { size: 0.584, prop: true, solid: 0, rot: 0 });             // 0.34 x 0.208 x 0.584 m, namaqualand_boulders_01
  add("ph_rock_3",       { size: 0.32, prop: true, solid: 0, rot: 0 });              // 0.169 x 0.144 x 0.32 m, rock_07
  add("ph_rock_4",       { size: 0.145, prop: true, solid: 0, rot: 0 });             // 0.074 x 0.033 x 0.145 m, rock_09
  add("ph_rock_5",       { size: 0.146, prop: true, solid: 0, rot: 0 });             // 0.146 x 0.071 x 0.089 m, stone_01
  add("ph_rock_6",       { size: 0.499, prop: true, solid: 0, rot: 0 });             // 0.404 x 0.154 x 0.499 m, namaqualand_rocks_01
  add("ph_stones",       { size: 0.32, prop: true, solid: 0, rot: 0 });              // 0.32 x 0.084 x 0.286 m, namaqualand_stones_01
  add("ph_sandrocks",    { size: 4.391, prop: true, solid: 0, rot: 0 });             // 4.391 x 0.393 x 3.61 m, sand_rocks_small_01
  add("ph_moonrock_1",   { size: 1.696, prop: true, solid: 0.4, box: 1, rot: 0 });   // 1.696 x 0.6 x 0.896 m at scale 1 (8 x moon_rock_01)
  add("ph_moonrock_2",   { size: 2.008, prop: true, solid: 0.89, box: 1, rot: 0 });  // 1.968 x 1.616 x 2.008 m (8 x moon_rock_02)
  add("ph_moonrock_3",   { size: 0.896, prop: true, solid: 0.31, box: 1, rot: 0 });  // 0.896 x 0.464 x 0.688 m (8 x moon_rock_03)
  add("ph_moonrock_4",   { size: 1.392, prop: true, solid: 0.43, box: 1, rot: 0 });  // 0.96 x 0.432 x 1.392 m (8 x moon_rock_04)
  add("ph_moonrock_5",   { size: 0.648, prop: true, solid: 0.26, box: 1, rot: 0 });  // 0.576 x 0.584 x 0.648 m (8 x moon_rock_05)
  add("ph_moonrock_6",   { size: 0.736, prop: true, solid: 0.31, box: 1, rot: 0 });  // 0.688 x 0.44 x 0.736 m (8 x moon_rock_06)
  add("ph_moonrock_7",   { size: 0.776, prop: true, solid: 0.27, box: 1, rot: 0 });  // 0.776 x 0.48 x 0.592 m (8 x moon_rock_07)
  // shrubs, succulents and quiver trees (sway: instanced placement only)
  add("ph_shrub_1",      { height: 1.012, prop: true, solid: 0, sway: 0.6, rot: 0 });    // 1.034 x 1.012 x 0.716 m, searsia_lucida
  add("ph_shrub_2",      { height: 0.538, prop: true, solid: 0, sway: 0.7, rot: 0 });    // 0.697 x 0.538 x 0.843 m, wild_rooibos_bush
  add("ph_shrub_3",      { height: 1.293, prop: true, solid: 0, sway: 0.9, rot: 0 });    // 1.767 x 1.293 x 2.285 m, shrub_02
  add("ph_shrub_4",      { height: 1.66, prop: true, solid: 0, sway: 0.5, rot: 0 });     // 1.509 x 1.66 x 1.249 m, searsia_lucida
  add("ph_shrub_5",      { height: 0.364, prop: true, solid: 0, sway: 1.0, rot: 0 });    // 0.307 x 0.364 x 0.282 m, shrub_01
  add("ph_shrub_6",      { height: 0.401, prop: true, solid: 0, sway: 1.0, rot: 0 });    // 0.225 x 0.401 x 0.208 m, shrub_03
  add("ph_shrub_7",      { height: 0.213, prop: true, solid: 0, sway: 1.0, rot: 0 });    // 0.278 x 0.213 x 0.294 m, shrub_04
  add("ph_succulent_1",  { height: 0.226, prop: true, solid: 0, sway: 0.1, rot: 0 });    // 0.487 x 0.226 x 0.504 m, cheiridopsis_succulent
  add("ph_succulent_2",  { height: 1.722, prop: true, solid: 0, sway: 0.25, rot: 0 });   // 1.008 x 1.722 x 1.055 m, othonna_cerarioides
  add("ph_succulent_3",  { height: 0.079, prop: true, solid: 0, rot: 0 });               // 0.638 x 0.079 x 0.499 m, crystalline_iceplant
  add("ph_quiver_1",     { height: 2.674, prop: true, solid: 0.25, sway: 0.06, rot: 0 });   // 1.181 x 2.674 x 0.969 m, quiver_tree_01
  add("ph_quiver_2",     { height: 1.42, prop: true, solid: 0.22, sway: 0.06, rot: 0 });    // 0.871 x 1.42 x 0.88 m, quiver_tree_02
  // street furniture
  add("ph_planter_1",    { size: 0.913, prop: true, solid: 0.19, box: 1, rot: 0 });   // 0.913 x 0.425 x 0.414 m, planter_box_01
  add("ph_planter_2",    { size: 1.252, prop: true, solid: 0.21, box: 1, rot: 0 });   // 1.252 x 0.453 x 0.467 m, planter_box_02
  add("ph_planter_3",    { size: 0.914, prop: true, solid: 0.3, box: 1, rot: 0 });    // 0.914 x 0.855 x 0.656 m, planter_box_03
  add("ph_picnic",       { size: 3.022, prop: true, solid: 1.01, box: 1, rot: 0 });   // 2.241 x 0.746 x 3.022 m, wooden_picnic_table (benches along Z)
  add("ph_firepit",      { size: 1.448, prop: true, solid: 0.65, rot: 0 });           // 1.448 x 0.388 x 1.433 m, stone_fire_pit
  add("ph_streetlamp_1", { height: 3.87, prop: true, solid: 0.2, rot: 0 });           // 0.703 x 3.87 x 0.386 m, street_lamp_01 (glass = 'glass' material)
  add("ph_streetlamp_2", { height: 1.674, prop: true, solid: 0, rot: 0 });            // 0.386 x 1.674 x 0.807 m, street_lamp_02: WALL lantern, plate on -Z
  add("ph_patioset",     { size: 1.717, prop: true, solid: 0.33, box: 1, rot: 0 });   // 0.742 x 0.859 x 1.717 m, outdoor_table_chair_set_01
  add("ph_sofa_1",       { size: 1.807, prop: true, solid: 0.37, box: 1, rot: 0 });   // 1.807 x 0.709 x 0.818 m, sofa_02 (seat front +Z)
  add("ph_sofa_2",       { size: 2.731, prop: true, solid: 0.42, box: 1, rot: 0 });   // 2.731 x 1.118 x 0.925 m, sofa_03 (seat front +Z)

  // ── task C2: the partner booth (Meshy 7 ultra, v2 pipeline). Industry Partners hall in the terminal: Stellar Aviation,
  // FinanceAdvisors.com, JetFinders, Freedom Air, one booth each at scale 1.0. solid 0: the booth's walls, desk, chairs,
  // table and planter are box solids the placing module adds from PLAN_MODEL_INFO.booth_lux.solids (addSolid or
  // addSolidLocal); the 0.158 m stone platform needs a walk floor at 0.16 or a 16 cm step.
  add("booth_lux",       { size: 8.0, rot: 0, prop: true, solid: 0 });                // 8.0 x 3.91 x 5.05 m, open front +Z, brand wall -Z

  // ── task R2B: the jets and the fly-in cabin set (Meshy, booth_lux generator-surface route). Jets: the files keep the old jet convention (nose on -X,
  // span on z); rot Math.PI / 2 turns the nose to +Z exactly like jet / gbjet; vehicle: true (no far LOD in loadModels, the lod files exist anyway).
  // Cabin pieces: front +Z at rot 0, solid 0 (plan_flyin.js builds the cabin collision itself). Sizes: x width x height x z depth at scale 1.
  add("cab_seat",          { height: 1.12, prop: true, solid: 0, rot: 0 });                         // 0.777 x 1.12 x 0.812 m, front: +Z
  add("jet_heavy",         { size: 30.4, vehicle: true, rot: Math.PI / 2 });                        // 30.378 x 7.8 x 30.4 m (span x height x length in game), nose +Z after rot
  add("jet_mid",           { size: 20.983, vehicle: true, rot: Math.PI / 2 });                      // 20.983 x 6.1 x 20.9 m (span x height x length in game), nose +Z after rot
  add("jet_light",         { size: 16.188, vehicle: true, rot: Math.PI / 2 });                      // 16.188 x 5.1 x 15.6 m (span x height x length in game), nose +Z after rot
  add("cab_divan",         { size: 2.1, prop: true, solid: 0, rot: 0 });                            // 2.1 x 0.714 x 0.657 m, front: +Z
  add("cab_table",         { size: 1.0, prop: true, solid: 0, rot: 0 });                            // 1 x 0.74 x 0.589 m, front: long axis x
  add("cab_galley",        { height: 1.95, prop: true, solid: 0, rot: 0 });                         // 1.218 x 1.95 x 0.6 m, front: +Z
  add("cab_credenza",      { size: 1.871, prop: true, solid: 0, rot: 0 });                          // 1.871 x 0.8 x 0.44 m, front: +Z
  add("cab_bulkhead",      { height: 1.95, prop: true, solid: 0, rot: 0 });                         // 2.4 x 1.95 x 0.324 m, front: +Z
  add("gbjet2",            { size: 30.4, vehicle: true, rot: Math.PI / 2 });                        // 30.381 x 7.8 x 30.4 m (span x height x length in game), nose +Z after rot

  // ── task R2C: the terminal set (Meshy, booth_lux route). Box solids through the spec (box: 1); desk, counter, carousel and cafe boxes for
  // addSolidLocal are in PLAN_MODEL_INFO.<kind>.solids. gbank is NOT registered (R2C regen: shards in the glazing and fins, no climbable stair).
  add("term_checkin",      { size: 3.27, rot: 0, prop: true, solid: 0.55, box: 1 });                // 3.27 x 1.255 x 1.299 m, front: +Z
  add("term_seating",      { size: 2.6, rot: 0, prop: true, solid: 0.3, box: 1 });                  // 2.6 x 0.857 x 0.75 m, front: +Z
  add("term_carousel",     { size: 6.4, rot: 0, prop: true, solid: 1.7, box: 1 });                  // 6.4 x 1.03 x 3.823 m, front: no front
  add("term_cafe",         { size: 4.28, rot: 0, prop: true, solid: 1.5, box: 1 });                 // 4.28 x 2.714 x 3.621 m, front: +Z
  add("term_info",         { size: 2.09, rot: 0, prop: true, solid: 0.95, box: 1 });                // 2.09 x 1.375 x 2.09 m, front: +Z
  add("term_planter",      { height: 3.2, rot: 0, prop: true, solid: 0.6 });                        // 2.576 x 3.2 x 2.228 m, front: none

  // ── task R2D: GBANK furniture (Tripo, decimated and baked). exec_desk height 1.164 is the brass lamp top (fit by width); lounge_chair and bench_lux have
  // no spec solid: the placing module adds the seat and back boxes from PLAN_MODEL_INFO.<kind>.solids.
  add("exec_desk",         { size: 2.0, rot: 0, prop: true, solid: 0.45, box: 1 });                 // 2 x 1.164 x 1.064 m, front: +Z
  add("bookcase",          { height: 2.3, rot: 0, prop: true, solid: 0.18, box: 1 });               // 1.172 x 2.3 x 0.393 m, front: +Z
  add("lounge_chair",      { size: 0.85, rot: 0, prop: true, solid: 0 });                           // 0.85 x 0.851 x 0.8 m, front: +Z
  add("bench_lux",         { size: 1.9, rot: 0, prop: true, solid: 0 });                            // 1.9 x 0.85 x 0.65 m, front: +Z

  // ── task R2E: luxury street pieces (Tripo, decimated and baked). lux_lamp and stone_pillar carry a 'glass' part (client glass shader, lit at night).
  // pergola solid 0 (walk under it; footing and post boxes in PLAN_MODEL_INFO.pergola.solids).
  add("planter_lux",       { size: 1.304, rot: 0, prop: true, solid: 0.55, box: 1 });               // 1.302 x 1.572 x 1.304 m, front: +Z
  add("pergola",           { size: 4.0, rot: 0, prop: true, solid: 0 });                            // 3.997 x 2.891 x 3.999 m, front: +Z
  add("lux_lamp",          { height: 3.2, rot: 0, prop: true, solid: 0.25 });                       // 0.623 x 3.201 x 0.612 m, front: +Z
  add("fence_lux",         { size: 3.0, rot: 0, prop: true, solid: 0, box: 1 });                    // 2.997 x 3 x 0.327 m, front: +Z
  add("stone_pillar",      { height: 2.2, rot: 0, prop: true, solid: 0.33, box: 1 });               // 0.726 x 2.201 x 0.725 m, front: +Z

  // ── task R2F: palms (Tripo trunk, baked, plus alpha-tested frond cards, MASK 0.4). sway: instanced placement only (put() / planPut(), never makeModel()).
  // Trunk base on the origin; solid = collider radius at the trunk base.
  add("fanpalm2",          { height: 12.0, prop: true, solid: 0.4, sway: 0.15, rot: 0 });           // 5.79 x 12 x 5.99 m, front: +Z
  add("datepalm",          { height: 10.0, prop: true, solid: 0.42, sway: 0.15, rot: 0 });          // 7.99 x 10 x 7.53 m, front: +Z
  add("canarypalm",        { height: 9.0, prop: true, solid: 0.75, sway: 0.12, rot: 0 });           // 8.46 x 9 x 8.28 m, front: +Z

  // ── task R2G: cacti (Tripo, spines opened out of the mesh and baked into the maps). Rigid (no sway). Sink each by PLAN_MODEL_INFO.<kind>.base.sink_m on slopes.
  add("saguaro_young",     { height: 1.6, rot: 0, prop: true, solid: 0.17 });                       // 0.343 x 1.6 x 0.356 m, front: none
  add("saguaro_mid",       { height: 5.0, rot: 0, prop: true, solid: 0.4 });                        // 2.33 x 5 x 1.282 m, front: +Z
  add("saguaro_giant",     { height: 12.0, rot: 0, prop: true, solid: 0.85 });                      // 5.175 x 12 x 3.436 m, front: +Z
  add("barrel_cactus",     { height: 0.9, rot: 0, prop: true, solid: 0.23 });                       // 0.488 x 0.9 x 0.462 m, front: none
  add("prickly_pear",      { height: 1.5, rot: 0, prop: true, solid: 0.65 });                       // 1.97 x 1.5 x 0.624 m, front: +Z
  add("cholla",            { height: 2.0, rot: 0, prop: true, solid: 0.3 });                        // 1.198 x 2 x 0.763 m, front: +Z
  add("organ_pipe",        { height: 4.5, rot: 0, prop: true, solid: 0.55 });                       // 1.759 x 4.5 x 1.433 m, front: +Z

  // not registered: gbank (R2C listed it for regeneration; plan_gbank.js keeps its procedural pavilion). will and paul are rigged and
  // live in PLAN_MODEL_INFO only (never PLAN_MODEL_SPECS: the static path bakes the Armature scale into the geometry).
})();

// installed facts for module authors (not specs): size [x, height, z] in metres at scale 1, what faces +Z, the source scan.
window.PLAN_MODEL_INFO = window.PLAN_MODEL_INFO || {};
(function () {
  var INFO = window.PLAN_MODEL_INFO;
  var put = function (k, v) { if (!INFO[k]) INFO[k] = v; };   // an entry another agent set first wins
  var R2 = {
    ph_boulder_1: { size: [2.533, 0.879, 1.234], front: "none", src: "polyhaven:namaqualand_boulder_02" },
    ph_boulder_2: { size: [2.402, 1.475, 3.064], front: "none", src: "polyhaven:namaqualand_boulder_03" },
    ph_boulder_3: { size: [2.526, 1.903, 2.499], front: "none", src: "polyhaven:namaqualand_boulder_04" },
    ph_boulder_4: { size: [1.363, 0.535, 0.746], front: "none", src: "polyhaven:namaqualand_boulder_05" },
    ph_boulder_5: { size: [0.674, 0.653, 1.212], front: "none", src: "polyhaven:namaqualand_boulder_06" },
    ph_rock_1: { size: [0.364, 0.252, 0.55], front: "none", src: "polyhaven:namaqualand_boulders_01" },
    ph_rock_2: { size: [0.34, 0.208, 0.584], front: "none", src: "polyhaven:namaqualand_boulders_01" },
    ph_rock_3: { size: [0.169, 0.144, 0.32], front: "none", src: "polyhaven:rock_07" },
    ph_rock_4: { size: [0.074, 0.033, 0.145], front: "none", src: "polyhaven:rock_09" },
    ph_rock_5: { size: [0.146, 0.071, 0.089], front: "none", src: "polyhaven:stone_01" },
    ph_rock_6: { size: [0.404, 0.154, 0.499], front: "none", src: "polyhaven:namaqualand_rocks_01" },
    ph_stones: { size: [0.32, 0.084, 0.286], front: "none", src: "polyhaven:namaqualand_stones_01" },
    ph_sandrocks: { size: [4.391, 0.393, 3.61], front: "none", src: "polyhaven:sand_rocks_small_01", note: "a flat patch of small rocks bedded in sand, walk over it" },
    ph_moonrock_1: { size: [1.696, 0.6, 0.896], front: "none", src: "polyhaven:moon_rock_01", scan_scale: 0.125 },
    ph_moonrock_2: { size: [1.968, 1.616, 2.008], front: "none", src: "polyhaven:moon_rock_02", scan_scale: 0.125 },
    ph_moonrock_3: { size: [0.896, 0.464, 0.688], front: "none", src: "polyhaven:moon_rock_03", scan_scale: 0.125 },
    ph_moonrock_4: { size: [0.96, 0.432, 1.392], front: "none", src: "polyhaven:moon_rock_04", scan_scale: 0.125 },
    ph_moonrock_5: { size: [0.576, 0.584, 0.648], front: "none", src: "polyhaven:moon_rock_05", scan_scale: 0.125 },
    ph_moonrock_6: { size: [0.688, 0.44, 0.736], front: "none", src: "polyhaven:moon_rock_06", scan_scale: 0.125 },
    ph_moonrock_7: { size: [0.776, 0.48, 0.592], front: "none", src: "polyhaven:moon_rock_07", scan_scale: 0.125 },
    ph_shrub_1: { size: [1.034, 1.012, 0.716], front: "none", src: "polyhaven:searsia_lucida" },
    ph_shrub_2: { size: [0.697, 0.538, 0.843], front: "none", src: "polyhaven:wild_rooibos_bush" },
    ph_shrub_3: { size: [1.767, 1.293, 2.285], front: "none", src: "polyhaven:shrub_02" },
    ph_shrub_4: { size: [1.509, 1.66, 1.249], front: "none", src: "polyhaven:searsia_lucida" },
    ph_shrub_5: { size: [0.307, 0.364, 0.282], front: "none", src: "polyhaven:shrub_01" },
    ph_shrub_6: { size: [0.225, 0.401, 0.208], front: "none", src: "polyhaven:shrub_03" },
    ph_shrub_7: { size: [0.278, 0.213, 0.294], front: "none", src: "polyhaven:shrub_04" },
    ph_succulent_1: { size: [0.487, 0.226, 0.504], front: "none", src: "polyhaven:cheiridopsis_succulent" },
    ph_succulent_2: { size: [1.008, 1.722, 1.055], front: "none", src: "polyhaven:othonna_cerarioides" },
    ph_succulent_3: { size: [0.638, 0.079, 0.499], front: "none", src: "polyhaven:crystalline_iceplant", note: "a flat ground-cover mat" },
    ph_quiver_1: { size: [1.181, 2.674, 0.969], front: "none", src: "polyhaven:quiver_tree_01" },
    ph_quiver_2: { size: [0.871, 1.42, 0.88], front: "none", src: "polyhaven:quiver_tree_02" },
    ph_planter_1: { size: [0.913, 0.425, 0.414], front: "+Z", src: "polyhaven:planter_box_01" },
    ph_planter_2: { size: [1.252, 0.453, 0.467], front: "+Z", src: "polyhaven:planter_box_02" },
    ph_planter_3: { size: [0.914, 0.855, 0.656], front: "+Z", src: "polyhaven:planter_box_03" },
    ph_picnic: { size: [2.241, 0.746, 3.022], front: "benches along the long Z axis", src: "polyhaven:wooden_picnic_table" },
    ph_firepit: { size: [1.448, 0.388, 1.433], front: "+Z", src: "polyhaven:stone_fire_pit" },
    ph_streetlamp_1: { size: [0.703, 3.87, 0.386], front: "cross bar along X", src: "polyhaven:street_lamp_01", note: "the glass is a material named 'glass' (the client's glass shader: tinted by day, warm at night)" },
    ph_streetlamp_2: { size: [0.386, 1.674, 0.807], front: "lantern arm toward +Z, wall plate at the back (-Z face)", src: "polyhaven:street_lamp_02", note: "a WALL lantern: mount it on a wall or a pillar top at its height with makeModel, not on the ground" },
    ph_patioset: { size: [0.742, 0.859, 1.717], front: "table and two chairs, set long axis Z", src: "polyhaven:outdoor_table_chair_set_01" },
    ph_sofa_1: { size: [1.807, 0.709, 0.818], front: "seat front +Z", src: "polyhaven:sofa_02" },
    ph_sofa_2: { size: [2.731, 1.118, 0.925], front: "seat front +Z", src: "polyhaven:sofa_03" },
    // the partner booth, measured on the installed mesh by C2 (model frame at scale 1: x right, y up, z toward the front)
    booth_lux: {
      size: [8.0, 3.91, 5.05],
      front: "+Z: the open side (desk front-left, lounge front-right); the brand wall is at the back (-Z), the screen wing wall on the right (+X)",
      files: { desktop: "/models/booth_lux.glb", mobile: "/models_m/booth_lux.glb", far_lod: "/models/lod/booth_lux.glb" },
      platform_top: 0.158, canopy_soffit: 3.665, clear_height_over_platform: 3.5,
      platform_note: "the whole 8 x 5.05 m footprint is a raised stone platform, top 0.158 m, brass edge; lay a walk floor at 0.16 (or accept a 16 cm step) so players stand on it",
      brand_wall: { face_z: -2.5, faces: "+Z", lightbox: { x: [-2.9, 3.1], y: [0.3, 3.6] }, logo_zone: { x: [-2.45, 2.55], y: [1.2, 3.3], center: [0.05, 2.25, -2.47], w: 5.0, h: 2.1 },
        note: "the warm white lightbox is blank; put the partner logo or wordmark on a plane at z -2.47 of about 5.0 x 2.1 m centred at (0.05, 2.25) (it also hides an uneven grey band at y 3.1 to 3.3); for a backlit look use an emissive or MeshBasicMaterial plane (no real lights)" },
      screen: { x_face: 3.83, faces: "-X", z: [-0.9, 1.4], y: [1.6, 2.8], center: [3.82, 2.2, 0.25], w: 2.3, h: 1.2, note: "dark blank flat panel on the inner face of the right wing wall; put a video or image plane at x 3.82 facing -X" },
      desk: { x: [-3.76, -1.31], z: [0.24, 1.66], top_y: 1.315, staff_spot: [-2.55, 0.158, 0.6], staff_faces: "+Z", visitor_spot: [-2.55, 0.158, 2.25], visitor_faces: "-Z", note: "curved reception counter open toward the back: the staff stands inside the curve (inside the desk solid box, so place the NPC directly)" },
      lounge: { chairs: [{ center: [1.16, -0.2], seat_y: 0.68 }, { center: [2.33, 1.64], seat_y: 0.68 }], table: { center: [0.72, 1.6], top_y: 0.62, r: 0.6 } },
      planter: { center: [3.45, -1.9], r: 0.5, top_y: 3.22, note: "olive tree in a stone pot, back right corner" },
      post: { center: [-3.92, -2.42], note: "black steel post at the back-left corner (the canopy is carried by the brand wall, the wing wall and this post; the front is open)" },
      solids: { format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, cx, cz, w, d, y0, y1)",
        back_wall: [0.0, -2.42, 8.0, 0.22, 0, 3.91], wing_wall: [3.86, 0.22, 0.28, 3.12, 0, 3.7], desk: [-2.53, 0.95, 2.45, 1.42, 0, 1.32], planter: [3.45, -1.9, 0.86, 1.0, 0, 1.3],
        chair_back: [1.16, -0.2, 1.16, 0.93, 0, 1.05], chair_front: [2.33, 1.64, 1.03, 1.04, 0, 1.06], table: [0.72, 1.62, 1.18, 1.17, 0, 0.62] },
      scale_note: "scale 1 is real size (desk top 1.15 m over the platform, tub chair seats 0.52 m over it); use 1.0 for every partner booth (Stellar reads largest by its placement and signage); above about 1.1 the furniture reads oversized",
      load_note: "a PLAN_MODEL_SPECS kind: it loads only when a module pushes 'booth_lux' into window.PLAN_MODEL_NEEDS; then MODELS.booth_lux exists and makeModel('booth_lux') / put() work",
    },
  };
  for (var k in R2) put(k, R2[k]);

  // round 2b (the register task, from specs_R2B .. specs_R2G _info, values exactly as the processors measured them on the installed
  // meshes): files, real size [x, height, z] at scale 1, front, anchors (seat heights, desk staff and visitor spots, counter and
  // screen rectangles, doorway, solids as [cx, cz, w, d, y0, y1] boxes in the model frame). pergola.posts is a description
  // object, not the plan_models.js posts array, so the planModelsPosts hook skips it (use pergola.solids for its corners).
  var R2B = {
    cab_seat: {
      size: [0.777, 1.12, 0.812],
      files: { desktop: "/models/cab_seat.glb", mobile: "/models_m/cab_seat.glb", far_lod: "/models/lod/cab_seat.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the sitter faces +Z (quilted seat and back, walnut armrest caps, round swivel base)",
      seat_y: 0.533,
      armrest_top_y: 0.684,
      sit_spot: [0.0, 0.533, 0.041],
      seat_front_z: 0.406,
      headrest_top_y: 1.12,
      note: "single club seat (Gulfstream G650 / Global 7500 class); seat height is the quilted cushion top at the centre",
    },
    jet_heavy: {
      size: [30.378, 7.8, 30.4],
      size_note: "[span x, height y, length z] in the game frame at scale 1 (the loaded model after the spec rot)",
      front: "nose +Z in game (spec rot Math.PI / 2, identical to jet / gbjet); in the GLB file the nose is on -X and the span on z",
      files: { desktop: "/models/jet_heavy.glb", mobile: "/models_m/jet_heavy.glb", far_lod: "/models/lod/jet_heavy.glb" },
      vehicle: true,
      anchors_game_frame: {
        note: "metres at scale 1, game frame (nose +Z, left wing +X, base y 0, footprint centred)",
        nose_tip: [-0.0, 2.165, 15.2],
        tail_end: [-4.845, 7.241, -15.2],
        fin_top: [0.013, 7.8, -13.108],
        wingtip_left: [15.189, 4.115, -4.664],
        wingtip_right: [-15.189, 4.149, -4.685],
        fuselage_width: 2.554,
        fuselage_top_y: 4.416,
        fuselage_bottom_y: 1.534,
        gear_ground_points_xz: [[-2.322, -1.832], [0.007, 12.769], [2.367, -1.887]],
      },
      note: "Gulfstream G650 class: real 30.4 m span, 30.4 m long, 7.8 m tall. Length and height are exact; the wings were stretched spanwise outboard of the landing gear (sweep and dihedral kept, winglets rigid) to reach the real span, and the cross-section scale comes from the real height. Spec size = the longest footprint side, so scale 1 is real size.",
    },
    jet_mid: {
      size: [20.983, 6.1, 20.9],
      size_note: "[span x, height y, length z] in the game frame at scale 1 (the loaded model after the spec rot)",
      front: "nose +Z in game (spec rot Math.PI / 2, identical to jet / gbjet); in the GLB file the nose is on -X and the span on z",
      files: { desktop: "/models/jet_mid.glb", mobile: "/models_m/jet_mid.glb", far_lod: "/models/lod/jet_mid.glb" },
      vehicle: true,
      anchors_game_frame: {
        note: "metres at scale 1, game frame (nose +Z, left wing +X, base y 0, footprint centred)",
        nose_tip: [-0.0, 1.641, 10.45],
        tail_end: [-0.014, 5.637, -10.45],
        fin_top: [-0.013, 6.1, -8.681],
        wingtip_left: [10.492, 3.436, -3.351],
        wingtip_right: [-10.492, 3.424, -3.277],
        fuselage_width: 2.354,
        fuselage_top_y: 3.789,
        fuselage_bottom_y: 1.03,
        gear_ground_points_xz: [[-1.298, 0.27], [0.006, 8.114], [1.257, 0.321]],
      },
      note: "Challenger 350 class: real 21.0 m span, 20.9 m long, 6.1 m tall. Length and height are exact; the wings were stretched spanwise outboard of the landing gear (sweep and dihedral kept, winglets rigid) to reach the real span, and the cross-section scale comes from the real height. Spec size = the longest footprint side, so scale 1 is real size.",
    },
    jet_light: {
      size: [16.188, 5.1, 15.6],
      size_note: "[span x, height y, length z] in the game frame at scale 1 (the loaded model after the spec rot)",
      front: "nose +Z in game (spec rot Math.PI / 2, identical to jet / gbjet); in the GLB file the nose is on -X and the span on z",
      files: { desktop: "/models/jet_light.glb", mobile: "/models_m/jet_light.glb", far_lod: "/models/lod/jet_light.glb" },
      vehicle: true,
      anchors_game_frame: {
        note: "metres at scale 1, game frame (nose +Z, left wing +X, base y 0, footprint centred)",
        nose_tip: [0.031, 1.303, 7.8],
        tail_end: [-2.787, 4.805, -7.8],
        fin_top: [0.003, 5.1, -6.423],
        wingtip_left: [8.094, 2.435, -2.337],
        wingtip_right: [-8.094, 2.435, -2.288],
        fuselage_width: 1.932,
        fuselage_top_y: 3.061,
        fuselage_bottom_y: 0.885,
        gear_ground_points_xz: [[-1.469, -0.888], [-0.028, 5.732], [1.487, -0.86]],
      },
      note: "Phenom 300 class: real 16.2 m span, 15.6 m long, 5.1 m tall. Length and height are exact; the wings were stretched spanwise outboard of the landing gear (sweep and dihedral kept, winglets rigid) to reach the real span, and the cross-section scale comes from the real height. Spec size = the longest footprint side, so scale 1 is real size.",
    },
    cab_divan: {
      size: [2.1, 0.714, 0.657],
      files: { desktop: "/models/cab_divan.glb", mobile: "/models_m/cab_divan.glb", far_lod: "/models/lod/cab_divan.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: seat front; long axis x",
      seat_y: 0.431,
      back_top_y: 0.714,
      arm_top_y: 0.685,
      sit_spots: [[-0.62, 0.431, 0.082], [0.0, 0.431, 0.082], [0.62, 0.431, 0.082]],
      note: "three-place divan (quilted seat, three back cushions, two accent pillows, walnut burl plinth and end caps with cup holders); the walnut plinth band was raised 1.3x so the seat sits at a real divan height",
    },
    cab_table: {
      size: [1.0, 0.74, 0.589],
      files: { desktop: "/models/cab_table.glb", mobile: "/models_m/cab_table.glb", far_lod: "/models/lod/cab_table.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "long axis x; symmetric",
      top_y: 0.74,
      top_rect_x: [-0.5, 0.5],
      top_rect_z: [-0.295, 0.295],
      top_thickness: 0.026,
      pedestal: "single chrome column at the centre, round base plate",
      note: "fold-out walnut burl table, both leaves open (seam across the middle); the xz footprint keeps the concept's proportions (1.0 x 0.59 m, a real club-four table) and only the chrome column was lengthened to put the top at 0.74 m",
    },
    cab_galley: {
      size: [1.218, 1.95, 0.6],
      files: { desktop: "/models/cab_galley.glb", mobile: "/models_m/cab_galley.glb", far_lod: "/models/lod/cab_galley.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: counter, appliances and drawers; the back (-Z) and sides are plain walnut",
      counter_y: 0.959,
      counter_front_z: 0.296,
      staff_spot: [0.0, 0.0, 0.65],
      staff_faces: "-Z",
      note: "forward galley: two ovens behind glass on top, quartz counter and backsplash with a sink and an espresso machine, walnut drawers below. Real proportions kept (uniform scale to 1.95 m tall), so it is 1.22 m wide, not 1.9: fill a longer bay with plain walnut units at the sides, as plan_flyin.js already does",
    },
    cab_credenza: {
      size: [1.871, 0.8, 0.44],
      files: { desktop: "/models/cab_credenza.glb", mobile: "/models_m/cab_credenza.glb", far_lod: "/models/lod/cab_credenza.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: drawers and doors; long axis x",
      top_y: 0.605,
      decanter_set: { x: [-0.135, 0.2], z: [-0.104, 0.078], top_y: 0.8 },
      note: "low walnut burl sideboard with a cream leather top rim, chrome pulls and a crystal decanter tray at the centre of the top (height includes the decanter). Uniform scale to 0.8 m overall keeps the concept's proportions: 1.87 m long; in a 1.25 m bay it would scale to a 0.43 m high top, so give it a bay of about 1.9 m (or place other dressing on the free ends of the top)",
    },
    cab_bulkhead: {
      size: [2.4, 1.95, 0.324],
      files: { desktop: "/models/cab_bulkhead.glb", mobile: "/models_m/cab_bulkhead.glb", far_lod: "/models/lod/cab_bulkhead.glb" },
      units: "metres at scale 1, model frame (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the screen side (faces into the cabin)",
      screen: {
        x: [-0.901, 0.269],
        y: [0.865, 1.529],
        center: [-0.316, 1.197, 0.108],
        w: 1.17,
        h: 0.664,
        faces: "+Z",
        face_z_range: [0.052, 0.117],
        note: "blank glossy black screen inside a thin chrome frame on the walnut centre panel; the panel and the screen follow the partition's gentle curve (face z range above), so a flat video or map plane of about w x h at center (4 mm proud of the median face) covers it; at the ends it stands up to a few cm off the curved face",
      },
      doorway: { x: [0.542, 1.02], width: 0.477, top_y: 1.77 },
      face_z_at_centre: 0.139,
      note: "curved full-width partition: walnut burl centre panel with the screen, cream leather side columns, an open doorway with a leather-lined jamb on the +x side. Scaled 2.4 m wide x 1.95 m tall (a 15 % vertical stretch against a uniform scale) so it fills a G650-class cabin section",
    },
    gbjet2: {
      size: [30.381, 7.8, 30.4],
      size_note: "[span x, height y, length z] in the game frame at scale 1 (the loaded model after the spec rot)",
      front: "nose +Z in game (spec rot Math.PI / 2, identical to jet / gbjet); in the GLB file the nose is on -X and the span on z",
      files: { desktop: "/models/gbjet2.glb", mobile: "/models_m/gbjet2.glb", far_lod: "/models/lod/gbjet2.glb" },
      vehicle: true,
      anchors_game_frame: {
        note: "metres at scale 1, game frame (nose +Z, left wing +X, base y 0, footprint centred)",
        nose_tip: [-0.01, 2.392, 15.2],
        tail_end: [-4.867, 7.376, -15.2],
        fin_top: [0.023, 7.8, -12.399],
        wingtip_left: [15.19, 4.485, -4.973],
        wingtip_right: [-15.19, 4.503, -4.95],
        fuselage_width: 2.584,
        fuselage_top_y: 4.886,
        fuselage_bottom_y: 1.553,
        gear_ground_points_xz: [[-2.442, -1.553], [-0.045, 12.239], [2.408, -1.524]],
      },
      note: "G650 class, Giveback One livery: real 30.4 m span, 30.4 m long, 7.8 m tall. Length and height are exact; the wings were stretched spanwise outboard of the landing gear (sweep and dihedral kept, winglets rigid) to reach the real span, and the cross-section scale comes from the real height. Spec size = the longest footprint side, so scale 1 is real size. GIVEBACK wordmark (the brand's own letters from Branding/3.png) repainted in white on both sides of the green fin, reading left to right from either side (the generated texture had misspelt it on one side). Hero jet of the fly-in and the rideable Giveback One.",
    },
    term_checkin: {
      size: [3.27, 1.255, 1.299],
      min: [-1.635, 0.0, -0.65],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_checkin.glb", mobile: "/models_m/term_checkin.glb", far_lod: "/models/lod/term_checkin.glb" },
      front: "+Z: the customer side (tall curved travertine front with the walnut transaction ledge and the brass kick band); the staff side with the lower work surface and the two monitors is at the back (-Z)",
      what: "two-position check-in counter: travertine, walnut ledge, brushed brass kick band, two monitors facing the staff, brass baggage-scale plate on the right end",
      ledge_top: 1.1,
      ledge: { x: [-1.47, 1.46], z: [0.08, 0.6] },
      work_surface_top: 0.75,
      work_surface: { x: [-1.36, 1.4], z: [-0.6, 0.27], note: "staff desk height (seated or perched agents)" },
      monitors: [{ center: [-0.6, 1.16, 0.2], faces: "-Z" }, { center: [0.6, 1.16, 0.2], faces: "-Z" }],
      staff_spots: [[-0.6, 0.0, -1.0], [0.6, 0.0, -1.0]],
      staff_faces: "+Z",
      visitor_spots: [[-0.6, 0.0, 1.15], [0.6, 0.0, 1.15]],
      visitor_faces: "-Z",
      solids: {
        counter: [0.0, -0.03, 3.27, 1.26, 0.0, 1.1],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      scale_note: "scale 1 is real size (ledge 1.10 m, work surface 0.75 m); for a longer bank of desks place several side by side about 3.3 m apart",
      tris: { desktop: 36356, mobile: 36356, far_lod: 11935 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_checkin.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    term_seating: {
      size: [2.6, 0.857, 0.75],
      min: [-1.3, 0.0, -0.375],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_seating.glb", mobile: "/models_m/term_seating.glb", far_lod: "/models/lod/term_seating.glb" },
      front: "+Z: the seats face +Z (backs toward -Z)",
      what: "bench of four linked lounge seats: cognac leather, brushed brass frame, walnut armrests",
      seat_top: 0.47,
      armrest_top: 0.63,
      back_top: 0.86,
      seats: [{ center: [-0.975, 0.47, 0.1] }, { center: [-0.325, 0.47, 0.1] }, { center: [0.325, 0.47, 0.1] }, { center: [0.975, 0.47, 0.1] }],
      sit_note: "a seated character's hips at (seat x, 0.47, 0.10) facing +Z; seat pitch 0.65 m",
      solids: {
        bench: [0.0, 0.0, 2.6, 0.72, 0.0, 0.62],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      mobile_note: "the mobile pack is simplified by gltfpack to half the triangles (19.6k) because the hall places many rows; desktop keeps the full 39k mesh",
      tris: { desktop: 39172, mobile: 19585, far_lod: 13799 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_seating.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    term_carousel: {
      size: [6.4, 1.03, 3.823],
      min: [-3.2, 0.0, -1.912],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_carousel.glb", mobile: "/models_m/term_carousel.glb", far_lod: "/models/lod/term_carousel.glb" },
      front: "no front (symmetric stadium); the long axis is X",
      what: "flat-plate baggage carousel: brushed steel slats sloping in toward a central travertine island, brushed brass outer rim, three leather suitcases on the belt",
      rim_top: 0.45,
      belt: { y: [0.37, 0.54], note: "the plates slope up toward the island" },
      island_top: 1.03,
      island: { x: [-1.84, 2.18], z: [-0.7, 0.7] },
      outline: { x: [-3.2, 3.2], z: [-1.91, 1.91] },
      bag_zone: { note: "place extra bags on the belt ring at y 0.46, between the rim (|z| < 1.8) and the island (|z| > 0.75), or along the rounded ends" },
      solids: {
        carousel: [0.0, 0.0, 6.2, 3.7, 0.0, 0.65],
        island: [0.17, 0.0, 4.0, 1.4, 0.0, 1.03],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      scale_note: "scale 1 is real size for a regional terminal (6.4 x 3.8 m, rim 0.45 m, suitcases about 0.8 m long); do not scale above 1.15 or the bags read oversized",
      tris: { desktop: 38073, mobile: 38073, far_lod: 18421 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_carousel.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    term_cafe: {
      size: [4.28, 2.714, 3.621],
      min: [-2.14, 0.0, -1.81],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_cafe.glb", mobile: "/models_m/term_cafe.glb", far_lod: "/models/lod/term_cafe.glb" },
      front: "+Z: the customer side (curved travertine counter with the pastry display case front-left); the barista zone is inside the curve and the walnut back shelving with the espresso station is at the back (-Z)",
      what: "cafe and espresso bar kiosk: curved travertine counter with fluted walnut ends, white marble top, glass pastry case, espresso machine and grinder, walnut canopy on two posts with a brass pendant bar, walnut back shelving with cups",
      counter_top: 1.1,
      pastry_case_top: 1.38,
      canopy_soffit: 2.55,
      canopy_top: 2.71,
      pendant_bar: { y: [2.12, 2.32], z: [0.31, 0.42], x: [-1.64, 1.26] },
      staff_spot: [-0.4, 0.0, -0.3],
      staff_faces: "+Z",
      espresso_station: [0.6, 1.1, -0.85],
      visitor_spot: [0.6, 0.0, 1.75],
      visitor_faces: "-Z",
      back_note: "the back (-Z) is a plain tan service wall behind the shelving: stand the kiosk with its back to a wall, a column line or a planter row",
      solids: {
        left_counter_and_case: [-1.72, 0.2, 0.84, 3.0, 0.0, 1.4],
        front_counter_1: [-0.9, 1.55, 1.0, 0.4, 0.0, 1.1],
        front_counter_2: [-0.15, 1.2, 0.9, 0.5, 0.0, 1.1],
        front_counter_3: [0.5, 0.75, 0.8, 0.6, 0.0, 1.1],
        front_counter_4: [1.1, 0.25, 0.8, 0.6, 0.0, 1.1],
        front_counter_5: [1.7, -0.45, 0.8, 1.0, 0.0, 1.1],
        back_shelving: [-0.44, -1.56, 2.3, 0.52, 0.0, 2.3],
        espresso_block: [0.81, -0.81, 1.3, 0.62, 0.0, 2.3],
        post_left: [-1.94, -0.71, 0.42, 0.26, 0.0, 2.55],
        post_right: [1.71, -0.21, 0.16, 0.26, 0.0, 2.55],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      cleanup: "Meshy see-through membranes removed before processing (the tent between the pendant bar and the canopy, three oblique sheets in the shelving)",
      tris: { desktop: 36406, mobile: 36406, far_lod: 22751 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_cafe.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    term_info: {
      size: [2.09, 1.375, 2.09],
      min: [-1.045, 0.0, -1.045],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_info.glb", mobile: "/models_m/term_info.glb", far_lod: "/models/lod/term_info.glb" },
      front: "+Z: the visitor side; the monitor stands on the inner shelf at the front of the ring facing the staff inside, the brochure rack and the brass bell are on the +X side",
      what: "round information desk: travertine drum, walnut ring top, brushed brass bands, slim monitor, brass bell, glass brochure rack",
      desk_top: 1.08,
      outer_radius: 1.045,
      inner_floor: 0.03,
      monitor_shelf_top: 0.86,
      monitor: { center: [0.05, 1.2, 0.45], faces: "-Z" },
      brochures: { center: [0.8, 1.2, 0.0] },
      staff_spot: [0.0, 0.03, -0.35],
      staff_faces: "+Z",
      staff_note: "the ring is closed: the staff stands inside it (placed, no entry gap)",
      visitor_spot: [0.0, 0.0, 1.55],
      visitor_faces: "-Z",
      solids: {
        drum: [0.0, 0.0, 2.05, 2.05, 0.0, 1.08],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      tris: { desktop: 34579, mobile: 34579, far_lod: 14011 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_info.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    term_planter: {
      size: [2.576, 3.2, 2.228],
      min: [-1.288, 0.0, -1.114],
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate by the placement yaw and scale with the placement",
      files: { desktop: "/models/term_planter.glb", mobile: "/models_m/term_planter.glb", far_lod: "/models/lod/term_planter.glb" },
      front: "none (rotate freely)",
      what: "square travertine planter with a brushed brass rim, gravel mulch and a multi-trunk olive tree",
      box: { x: [-0.61, 0.49], z: [-0.5, 0.59], top: 0.94, center: [-0.06, 0.045] },
      canopy: { y: [1.9, 3.2], spread: [2.58, 2.23] },
      solids: {
        planter: [-0.06, 0.045, 1.12, 1.11, 0.0, 0.94],
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame; for addSolid(x, z, ry, w, d, y0, y1) or addSolidLocal(g, lx, lz, w, d, y0, y1) after rotating (cx, cz) by the placement yaw",
      },
      note: "no sway (indoor); the canopy is 2.6 m wide, keep 1.4 m clear of walls and ceilings above 3.2 m",
      tris: { desktop: 20331, mobile: 20331, far_lod: 18737 },
      source: "Meshy 7 (image to 3D) from masterplan/assets_r2/concepts/term_planter.png; generator surface kept, 4096 re-atlas with the generator normal map transferred, 2048 desktop maps",
    },
    exec_desk: {
      size: [2.0, 1.164, 1.064],
      files: { desktop: "/models/exec_desk.glb", mobile: "/models_m/exec_desk.glb", far_lod: "/models/lod/exec_desk.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the visitor side (the brass lamp stands on the visitor half at the left, base at x -0.75 z +0.17, its head reaching toward the centre); the executive sits at -Z facing +Z, the closed laptop lies on the executive's half",
      top_y: 0.748,
      top_note: "cream leather writing surface 0.748 m (walnut rim 0.743); closed laptop top 0.774 (x -0.25..0.20, z -0.23..0.03); brass lamp base 0.781 at (-0.75, 0.17), lamp head up to 1.164 reaching x -0.35",
      knee_clearance_y: 0.582,
      legs: "two black steel and brass sled frames at x -0.92 and +0.92 (posts at z -0.43 and +0.43, runners on the floor along z)",
      staff_spot: [0.0, 0.0, -0.95],
      staff_faces: "+Z",
      chair_spot: [0.0, 0.0, -0.8],
      chair_note: "desk chair (not part of the model) centred here, seat front toward +Z; the knee well is open between the sled frames",
      visitor_spot: [0.0, 0.0, 1.1],
      visitor_faces: "-Z",
      visitor_chairs: [[-0.55, 0.0, 1.25], [0.55, 0.0, 1.25]],
      solids: {
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1)",
        desk: [0.0, 0.0, 2.0, 1.06, 0, 0.78],
      },
      fit_note: "the model height 1.164 is the lamp top, not the desk: fit by width (size 2.0 = real size at scale 1) or give a fit box at least 1.17 m high. A fit box of [2.4, 0.78, 1.1] (plan_gbank.js placeModel, min of the three ratios) shrinks it to 0.67 (a 1.34 m desk with its top at 0.50 m); a height target of 1.2 or more keeps scale 1.0 to 1.03",
      packs: { desktop: { kb: 3658, tris: 19999 }, mobile: { kb: 439, tris: 5999 }, lod: { kb: 188, tris: 2139 } },
      source: "Tripo (about 1.9M tris) decimated in Blender, normal and AO baked from the dense mesh, clean xatlas atlas (2048), KTX2 + meshopt",
    },
    bookcase: {
      size: [1.172, 2.3, 0.393],
      files: { desktop: "/models/bookcase.glb", mobile: "/models_m/bookcase.glb", far_lod: "/models/lod/bookcase.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the open shelves and the cabinet doors; closed walnut back panel at -Z (stand it with the back against a wall, the model back face is at z -0.196)",
      shelf_tops_y: [0.582, 0.905, 1.232, 1.581, 1.919],
      top_panel_y: [2.246, 2.3],
      shelf_note: "five open bays above a two-door base cabinet (doors 0.06 to 0.556 m, cabinet top 0.582); the lowest open shelf is the cabinet top; the shelves run from the back panel (z -0.17) to the front edge (z +0.19), brass uprights at x -0.57 and +0.57",
      contents: "hardcover books with plain spines, ceramic vases, a stone bowl and a small bronze figure are part of the mesh (no loose objects); the warm shelf lighting is painted into the albedo (no emissive), so an emissive strip is optional",
      solids: {
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1)",
        case: [0.0, 0.0, 1.17, 0.39, 0, 2.3],
      },
      fit_note: "real size at scale 1 (1.17 wide, 2.30 tall, 0.39 deep). A fit box of [3.0, 3.1, 0.5] (plan_gbank.js north wall) gives scale 1.28 (1.50 x 2.94 x 0.50 m, limited by the depth); for a 3 m run of shelving place two or three at scale 1.0 to 1.3 side by side (width 1.17 x scale each)",
      packs: { desktop: { kb: 5674, tris: 29996 }, mobile: { kb: 703, tris: 8997 }, lod: { kb: 318, tris: 3442 } },
      source: "Tripo (about 1.9M tris) decimated in Blender, normal and AO baked from the dense mesh, clean xatlas atlas (2048), KTX2 + meshopt",
    },
    lounge_chair: {
      size: [0.85, 0.851, 0.8],
      files: { desktop: "/models/lounge_chair.glb", mobile: "/models_m/lounge_chair.glb", far_lod: "/models/lod/lounge_chair.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the seat front; walnut shell back at -Z; four-star brass swivel base",
      seat_y: 0.47,
      seat_center: [0.0, 0.47, 0.08],
      sit_faces: "+Z",
      arm_top_y: 0.59,
      arms_x: [-0.37, 0.37],
      back_top_y: 0.85,
      base_note: "swivel column under the shell centre, star feet reach the 0.85 x 0.80 footprint corners",
      solids: {
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1)",
        seat: [0.0, 0.05, 0.72, 0.62, 0.05, 0.47],
        back: [0.0, -0.3, 0.8, 0.18, 0.0, 0.85],
      },
      fit_note: "real size at scale 1 (0.85 wide, 0.85 tall, 0.80 deep); a fit box of [0.9, 0.95, 0.9] gives scale 1.06",
      packs: { desktop: { kb: 4936, tris: 25000 }, mobile: { kb: 529, tris: 7500 }, lod: { kb: 280, tris: 3915 } },
      source: "Tripo (about 1.9M tris) decimated in Blender, normal and AO baked from the dense mesh, clean xatlas atlas (2048), KTX2 + meshopt",
    },
    bench_lux: {
      size: [1.9, 0.85, 0.65],
      files: { desktop: "/models/bench_lux.glb", mobile: "/models_m/bench_lux.glb", far_lod: "/models/lod/bench_lux.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); rotate and scale with the placement",
      front: "+Z: the sitters face +Z; slatted teak backrest leaning back at -Z; cast stone end plinths at both ends",
      seat_y: 0.44,
      seat_z: [-0.12, 0.3],
      sit_faces: "+Z",
      seats: [[-0.52, 0.44, 0.08], [0.0, 0.44, 0.08], [0.52, 0.44, 0.08]],
      seat_span_x: [-0.78, 0.78],
      arm_top_y: 0.63,
      arms_x: [-0.83, 0.83],
      back_top_y: 0.85,
      back_z: [-0.325, -0.15],
      plinths: "stone plinths x -0.95..-0.78 and +0.78..+0.95, full depth z -0.32..+0.32, top at the seat height",
      solids: {
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1)",
        seat: [0.0, 0.02, 1.9, 0.46, 0.05, 0.44],
        back: [0.0, -0.25, 1.9, 0.12, 0.0, 0.85],
      },
      fit_note: "matches plan_enrich.js benchSolids (seat box 0.46 deep to y + 0.46 at z +0.02, back slab at z -0.27 to y + 0.86) at scale 1; in plan_gbank.js a fit box of [2.2, 0.9, 0.8] gives scale 1.06",
      scale_note: "processed per axis from the Tripo mesh (length 1.939, height 1.569, depth 1.608 x the raw): a uniform scale put the seat at 0.55 m at 1.9 m length; the length is about 1.2 x the height ratio, which reads as a three-seat bench",
      packs: { desktop: { kb: 5253, tris: 19999 }, mobile: { kb: 546, tris: 5998 }, lod: { kb: 256, tris: 2485 } },
      source: "Tripo (about 1.9M tris) decimated in Blender, normal and AO baked from the dense mesh, clean xatlas atlas (2048), KTX2 + meshopt",
    },
    planter_lux: {
      size: [1.302, 1.572, 1.304],
      front: "+Z (square and near symmetric: any yaw works; rotate randomly along a path)",
      files: { desktop: "/models/planter_lux.glb", mobile: "/models_m/planter_lux.glb", far_lod: "/models/lod/planter_lux.glb" },
      tris: { desktop: 11999, mobile: 4799, far_lod: 1272 },
      kb: { desktop: 3228, mobile: 553, far_lod: 134 },
      units: "metres at scale 1 (x right, y up, z front), footprint centred on the origin, base y 0",
      body: { w: 1.14, y: [0, 0.58], note: "board-formed concrete box" },
      band: { w: 1.21, y: [0.58, 0.99], note: "weathered corten band with a brushed brass rim" },
      rim_top_y: 0.99,
      soil_y: 0.95,
      plants_top_y: 1.57,
      overhang: "trailing groundcover sprigs reach +-0.65 m, which is the bbox; the solid box is 0.9 x the bbox (1.17 m) to the full height",
      planting: "blue agave in the centre, three golden barrel cacti, trailing succulent groundcover in decomposed granite",
      solid: "spec box: 1 plus a 0.55 m circle",
    },
    pergola: {
      size: [3.997, 2.891, 3.999],
      front: "+Z (square and symmetric; the roof boards run along Z)",
      files: { desktop: "/models/pergola.glb", mobile: "/models_m/pergola.glb", far_lod: "/models/lod/pergola.glb" },
      tris: { desktop: 15000, mobile: 6000, far_lod: 1745 },
      kb: { desktop: 4749, mobile: 560, far_lod: 127 },
      units: "metres at scale 1 (x right, y up, z front), footprint centred on the origin, base y 0",
      posts: { centers: [[-1.744, -1.744], [-1.744, 1.744], [1.744, -1.744], [1.744, 1.744]], w: 0.155, y: [0.58, 2.89], note: "black steel posts" },
      footings: {
        centers: [[-1.738, -1.735], [-1.738, 1.735], [1.738, -1.735], [1.738, 1.735]],
        w: 0.5,
        top_y: 0.58,
        note: "stone-clad footings with a cast cap",
      },
      clear_between_posts: 3.33,
      headroom: { under_beams: 2.64, under_cable_and_joists: 2.45, under_lowest_bulb: 2.27 },
      roof: { top_y: 2.891, slat_underside_y: 2.65, note: "cedar slat roof: real slats underneath, board pattern painted on the flat top" },
      festoon_bulbs: {
        centers: [
          [0.34, 2.57, -1.65],
          [1.65, 2.57, -1.43],
          [-1.63, 2.54, -1.24],
          [-0.66, 2.38, -1.04],
          [1.15, 2.35, -0.45],
          [1.17, 2.33, -0.05],
          [1.36, 2.35, 0.64],
          [-1.2, 2.35, 0.75],
          [1.51, 2.41, 1.11],
          [-1.13, 2.42, 1.24],
          [1.68, 2.54, 1.55],
          [-1.04, 2.57, 1.66],
        ],
        note: "12 Edison bulbs on a black cable under the slats (baked texture, not emissive): put a small warm halo sprite at each centre x scale for a lit festoon at night",
      },
      solids: {
        format: "[cx, cz, w, d, y0, y1] boxes in the model frame (rotate by the placement yaw); for addSolid(x, z, ry, w, d, y0, y1)",
        footings: [
          [-1.738, -1.735, 0.5, 0.5, 0, 0.58],
          [-1.738, 1.735, 0.5, 0.5, 0, 0.58],
          [1.738, -1.735, 0.5, 0.5, 0, 0.58],
          [1.738, 1.735, 0.5, 0.5, 0, 0.58],
        ],
        posts: [
          [-1.744, -1.744, 0.16, 0.16, 0, 2.89],
          [-1.744, 1.744, 0.16, 0.16, 0, 2.89],
          [1.744, -1.744, 0.16, 0.16, 0, 2.89],
          [1.744, 1.744, 0.16, 0.16, 0, 2.89],
        ],
        note: "spec solid is 0 so people walk under the roof; add these (or four 0.3 m circles at the footing centres) for the corners",
      },
    },
    lux_lamp: {
      size: [0.623, 3.201, 0.612],
      front: "+Z (square lantern, symmetric: any yaw works)",
      files: { desktop: "/models/lux_lamp.glb", mobile: "/models_m/lux_lamp.glb", far_lod: "/models/lod/lux_lamp.glb" },
      tris: { desktop: 6005, mobile: 2705, far_lod: 1155 },
      kb: { desktop: 2496, mobile: 404, far_lod: 129 },
      units: "metres at scale 1 (x right, y up, z front), footprint centred on the origin, base y 0",
      base: { w: 0.47, y: [0, 0.45], note: "grey stone plinth" },
      post: { r: 0.11, y: [0.45, 2.12], note: "black steel post with brass collars" },
      lantern: {
        center: [0, 2.44, 0],
        glass_y: [2.19, 2.69],
        glass_half_width: [0.154, 0.226],
        outer_half_width: 0.29,
        roof_y: [2.7, 3.0],
        top_y: 3.201,
        note: "black and brass tapered lantern with three candle bulbs inside; the generator's grey lattice grid across the panes was removed so the panes read as the concept's clear glass",
      },
      night: "the lantern glass is a separate mesh with the material named 'glass' (four tapered panes, 8 triangles, COLOR_0.r = 0.9, pane uv 0..1), the last part in all three files: loadModels swaps in glassMaterial(), tinted reflective glass by day and a warm lit pane at night (WIN.u.uNight, the same path as ph_streetlamp_1 and the window glass). The pane glow is soft; for a lamp that reads as a light source from a distance add a halo sprite or a pooled PointLight (warm, about 0xffc98a, range 10 to 15 m) at lantern.center x the placement scale, like the old lamp's DETAILS.bulbs and DETAILS.halo",
      solid: "0.25 m circle (post and plinth)",
    },
    fence_lux: {
      size: [2.997, 3.0, 0.327],
      front: "+Z (both faces are finished alike; the panel is a straight run along X)",
      files: { desktop: "/models/fence_lux.glb", mobile: "/models_m/fence_lux.glb", far_lod: "/models/lod/fence_lux.glb" },
      tris: { desktop: 7993, mobile: 3596, far_lod: 1082 },
      kb: { desktop: 3340, mobile: 402, far_lod: 106 },
      units: "metres at scale 1 (x along the fence, y up, z across), footprint centred on the origin, base y 0",
      centred: "yes: the panel and both posts are centred on x = 0 and z = 0 (the steel panel plane sits at z +0.007)",
      overall: { w: 3.0, h: 3.0, d: 0.328, note: "spec size 3.0 scales the 2.997 m file to exactly 3.0 m wide in game" },
      posts: {
        w: 0.276,
        d: 0.328,
        centers_x: [-1.362, 1.362],
        outer_x: [-1.5, 1.5],
        inner_x: [-1.224, 1.224],
        cap_y: [2.7, 3.0],
        note: "square ledgestone-clad posts with brushed brass caps, one at each end",
      },
      post_to_post: { centre_to_centre: 2.724, clear_between_posts: 2.448 },
      panel: {
        x: [-1.224, 1.224],
        bottom_rail_y: [0.05, 0.2],
        pickets_y: [0.2, 2.25],
        band_y: [2.25, 2.75],
        top_rail_y: 2.8,
        note: "black powder-coated pickets, laser-cut desert band (saguaros, agaves, mountains, sun) under the top rail",
      },
      tiling: "end to end at the model width (3.0 m x scale) the panels butt post to post, so every joint is a paired pier of two 0.276 m posts (0.55 m); plan_enrich's runway fence does exactly this (spacing MODELS.fence_lux.sx x sc). For one shared post per joint instead, place at 2.724 m x scale; the next panel's post then lands exactly on this one's, which only looks right with the same yaw and base height (otherwise the coincident stone faces z-fight), so prefer the butt joint",
      aviation: "3.0 m tall at scale 1 (the runway fence limit is about 3 m); plan_enrich scales it to 2.66 m",
      prep_note: "the generator drew the panel 1.23 wide : 1 high; it was scaled per axis to 3.0 x 3.0 m, so its stones and pickets are 23 percent taller than drawn",
      solid: "spec box: 1 (a 2.7 x 0.29 m box to the full height, rotated with the placement), no circle",
    },
    stone_pillar: {
      size: [0.726, 2.201, 0.725],
      front: "+Z (square and symmetric: any yaw works)",
      files: { desktop: "/models/stone_pillar.glb", mobile: "/models_m/stone_pillar.glb", far_lod: "/models/lod/stone_pillar.glb" },
      tris: { desktop: 6007, mobile: 2707, far_lod: 1049 },
      kb: { desktop: 2878, mobile: 398, far_lod: 139 },
      units: "metres at scale 1 (x right, y up, z front), footprint centred on the origin, base y 0",
      body: { w: 0.62, y: [0, 1.33], note: "stacked tan ledgestone" },
      cap: { w: 0.726, y: [1.33, 1.505], top_y: 1.505, note: "cast stone cap" },
      lantern: {
        center: [0, 1.795, 0],
        glass_y: [1.65, 1.94],
        glass_half_width: [0.104, 0.128],
        base_y: [1.505, 1.65],
        top_y: 2.202,
        note: "black and brass lantern on a plinth; the generator's opaque white panes were removed and replaced by the glass mesh (a brass candle post stands inside)",
      },
      night: "the lantern glass is a separate mesh with the material named 'glass' (four tapered panes, 8 triangles, COLOR_0.r = 0.9, pane uv 0..1), the last part in all three files: loadModels swaps in glassMaterial(), tinted reflective glass by day and a warm lit pane at night (WIN.u.uNight, the same path as ph_streetlamp_1 and the window glass). The pane glow is soft; for a lamp that reads as a light source from a distance add a halo sprite or a pooled PointLight (warm, about 0xffc98a, range 10 to 15 m) at lantern.center x the placement scale, like the old lamp's DETAILS.bulbs and DETAILS.halo",
      scale_note: "plan_bounds scales it to 2.75 m (x1.25): lantern centre then at y 2.24; plan_enrich places it at scale 1 between fence bays",
      solid: "spec box: 1 (0.65 m box to the full height) plus a 0.33 m circle",
    },
    fanpalm2: {
      name: "Mexican fan palm (Washingtonia robusta)",
      size: [5.79, 12.0, 5.99],
      front: "+Z (radially symmetric; no preferred front)",
      files: { desktop: "/models/fanpalm2.glb", mobile: "/models_m/fanpalm2.glb", far_lod: "/models/lod/fanpalm2.glb" },
      tris: { desktop: 8948, mobile: 7220, far_lod: 1216 },
      kb: { desktop: 6665, mobile: 772, far_lod: 104 },
      trunk_radius_base: 0.4,
      crown_heart_y: 9.6,
      canopy_radius: 3.0,
      skirt: { y: [6.3, 9.8], r: [0.45, 0.8], note: "dry skirt of dead fronds under the crown (Tripo skirt mesh plus shaggy alpha skirt cards)" },
      clearance_y: 5.8,
      clearance_note: "nothing but the trunk below 5.8 m: people, carts and signs pass under the crown",
      crown: "32 costapalmate fan blades on petioles (pleated fan cards, textures cut from the concept's fans), upright blades on top, blades held across the petiole around the heart, hanging blades below",
      parts: "two parts in this order in every tier: a_trunk (bark, albedo 2048 desktop / 1024 mobile + tangent normal, no ORM so roughness 0.8 metalness 0) and b_fronds (material leaf_<kind>: alpha-tested cards, alphaMode MASK, alphaCutoff 0.4, double sided, custom normals bent out of the crown); the far LOD pairs with the main model's parts by index",
      sway: "sway uses the client's instanced wind shader (addSway: displacement grows with height squared, so the trunk base stays put and the crown moves); place with put() or planPut() only, never makeModel()",
      base_ring_r: 0.78,
    },
    datepalm: {
      name: "date palm (Phoenix dactylifera)",
      size: [7.99, 10.0, 7.53],
      front: "+Z (radially symmetric; no preferred front)",
      files: { desktop: "/models/datepalm.glb", mobile: "/models_m/datepalm.glb", far_lod: "/models/lod/datepalm.glb" },
      tris: { desktop: 9239, mobile: 8343, far_lod: 1595 },
      kb: { desktop: 7262, mobile: 1147, far_lod: 136 },
      trunk_radius_base: 0.4,
      crown_heart_y: 7.05,
      canopy_radius: 4.0,
      date_clusters_y: [5.0, 6.8],
      clearance_y: 3.6,
      clearance_note: "the lowest drooping frond tips are at about 3.6 m: walkable under the crown",
      crown: "56 pinnate fronds (V-folded, twisted cards textured with five blue-green fronds cut from the concept), young fronds upright, old fronds arching down; golden date clusters (Tripo mesh) under the crown",
      parts: "two parts in this order in every tier: a_trunk (bark, albedo 2048 desktop / 1024 mobile + tangent normal, no ORM so roughness 0.8 metalness 0) and b_fronds (material leaf_<kind>: alpha-tested cards, alphaMode MASK, alphaCutoff 0.4, double sided, custom normals bent out of the crown); the far LOD pairs with the main model's parts by index",
      sway: "sway uses the client's instanced wind shader (addSway: displacement grows with height squared, so the trunk base stays put and the crown moves); place with put() or planPut() only, never makeModel()",
      base_ring_r: 0.85,
    },
    canarypalm: {
      name: "Canary Island date palm (Phoenix canariensis)",
      size: [8.46, 9.0, 8.28],
      front: "+Z (radially symmetric; no preferred front)",
      files: { desktop: "/models/canarypalm.glb", mobile: "/models_m/canarypalm.glb", far_lod: "/models/lod/canarypalm.glb" },
      tris: { desktop: 9880, mobile: 8728, far_lod: 1852 },
      kb: { desktop: 6968, mobile: 989, far_lod: 141 },
      trunk_radius_base: 0.74,
      crown_heart_y: 5.35,
      canopy_radius: 4.2,
      knuckle_y: [4.3, 5.35],
      clearance_y: 2.7,
      clearance_note: "the lowest arching frond tips are at about 2.7 m: a player walks under them, a cart or sign up to 2.5 m clears",
      crown: "72 deep green pinnate fronds (cards textured with four fronds cut from the concept) in a dense round dome; thick diamond-patterned trunk and pineapple knuckle from the Tripo mesh",
      parts: "two parts in this order in every tier: a_trunk (bark, albedo 2048 desktop / 1024 mobile + tangent normal, no ORM so roughness 0.8 metalness 0) and b_fronds (material leaf_<kind>: alpha-tested cards, alphaMode MASK, alphaCutoff 0.4, double sided, custom normals bent out of the crown); the far LOD pairs with the main model's parts by index",
      sway: "sway uses the client's instanced wind shader (addSway: displacement grows with height squared, so the trunk base stays put and the crown moves); place with put() or planPut() only, never makeModel()",
      base_ring_r: 0.95,
    },
    saguaro_young: {
      size: [0.343, 1.6, 0.356],
      front: "none (a single ribbed column, rotate freely); +Z is the concept's view",
      files: { desktop: "/models/saguaro_young.glb", mobile: "/models_m/saguaro_young.glb", far_lod: "/models/lod/saguaro_young.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [-0.003, -0.003],
        radius_at_ground: 0.078,
        radius_at_5cm: 0.115,
        closed_bottom: true,
        rim_gap_m: 0.007,
        sink_m: 0.03,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [0.003, -0.002],
        r_p90_from_origin: 0.165,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.17,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.75, 1.3],
      tris: { desktop: 10000, mobile: 3000, far_lod: 1400 },
      kb: { desktop: 2538, mobile: 315, far_lod: 153 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    saguaro_mid: {
      size: [2.33, 5.0, 1.282],
      front: "+Z: the concept's view, the two arms spread left and right across X (lower arm on -X)",
      files: { desktop: "/models/saguaro_mid.glb", mobile: "/models_m/saguaro_mid.glb", far_lod: "/models/lod/saguaro_mid.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [0.125, 0.141],
        radius_at_ground: 0.146,
        radius_at_5cm: 0.32,
        closed_bottom: true,
        rim_gap_m: 0.033,
        sink_m: 0.06,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [0.044, 0.128],
        r_p90_from_origin: 0.397,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.4,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.8, 1.2],
      tris: { desktop: 14000, mobile: 4200, far_lod: 1960 },
      kb: { desktop: 5932, mobile: 378, far_lod: 188 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    saguaro_giant: {
      size: [5.175, 12.0, 3.436],
      front: "+Z: the concept's view, the arms spread across X, the down-bent arm low on -X",
      files: { desktop: "/models/saguaro_giant.glb", mobile: "/models_m/saguaro_giant.glb", far_lod: "/models/lod/saguaro_giant.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [-0.026, -0.107],
        radius_at_ground: 0.256,
        radius_at_5cm: 0.441,
        closed_bottom: true,
        rim_gap_m: 0.025,
        sink_m: 0.08,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [-0.051, -0.034],
        r_p90_from_origin: 0.88,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.85,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.8, 1.1],
      tris: { desktop: 20000, mobile: 6000, far_lod: 2800 },
      kb: { desktop: 6925, mobile: 493, far_lod: 257 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    barrel_cactus: {
      size: [0.488, 0.9, 0.462],
      front: "none (rotate freely); it leans slightly toward +X, +Z is the concept's view",
      files: { desktop: "/models/barrel_cactus.glb", mobile: "/models_m/barrel_cactus.glb", far_lod: "/models/lod/barrel_cactus.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [0.048, 0.001],
        radius_at_ground: 0.138,
        radius_at_5cm: 0.167,
        closed_bottom: true,
        rim_gap_m: 0.001,
        sink_m: 0.03,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.18, 0.585],
        center: [-0.007, -0.0],
        r_p90_from_origin: 0.233,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.23,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.6, 1.3],
      tris: { desktop: 12000, mobile: 3600, far_lod: 1680 },
      kb: { desktop: 2865, mobile: 349, far_lod: 174 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    prickly_pear: {
      size: [1.97, 1.5, 0.624],
      front: "+Z: the face of the fan of pads (2.0 m across X, 0.65 m deep in Z); turn it broadside to the path",
      files: { desktop: "/models/prickly_pear.glb", mobile: "/models_m/prickly_pear.glb", far_lod: "/models/lod/prickly_pear.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [0.025, 0.023],
        radius_at_ground: 0.054,
        radius_at_5cm: 0.069,
        closed_bottom: true,
        rim_gap_m: 0.014,
        sink_m: 0.05,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [-0.016, 0.042],
        r_p90_from_origin: 0.762,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.65,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.7, 1.3],
      tris: { desktop: 18000, mobile: 5400, far_lod: 2520 },
      kb: { desktop: 6062, mobile: 392, far_lod: 208 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    cholla: {
      size: [1.198, 2.0, 0.763],
      front: "+Z: the concept's view (branches spread across X); reads well from any side",
      files: { desktop: "/models/cholla.glb", mobile: "/models_m/cholla.glb", far_lod: "/models/lod/cholla.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [0.05, 0.0],
        radius_at_ground: 0.071,
        radius_at_5cm: 0.077,
        closed_bottom: true,
        rim_gap_m: 0.003,
        sink_m: 0.03,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [0.035, 0.027],
        r_p90_from_origin: 0.359,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.3,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.7, 1.3],
      tris: { desktop: 18000, mobile: 5400, far_lod: 2520 },
      kb: { desktop: 6615, mobile: 419, far_lod: 218 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
    organ_pipe: {
      size: [1.759, 4.5, 1.433],
      front: "+Z: the concept's view (the stems fan across X); reads well from any side",
      files: { desktop: "/models/organ_pipe.glb", mobile: "/models_m/organ_pipe.glb", far_lod: "/models/lod/organ_pipe.glb" },
      units: "metres in the model frame at scale 1 (x right, y up, z toward the front); origin = footprint (bbox) centre on the ground, as the client re-centres it",
      base: {
        center: [0.015, 0.052],
        radius_at_ground: 0.178,
        radius_at_5cm: 0.189,
        closed_bottom: true,
        rim_gap_m: 0.011,
        sink_m: 0.04,
        sink_note: "the closed body stands on its base at y = 0, no roots or loose bits below it; the base rim is within rim_gap_m of the ground all round. Sink it by sink_m plus radius_at_5cm x terrain slope (tan) so the downhill edge never floats, all times the placement scale",
      },
      trunk: {
        zone_y: [0.3, 1.2],
        center: [0.0, 0.074],
        r_p90_from_origin: 0.57,
        note: "the collider (solid, a circle at the placement point = the origin) covers this ring",
      },
      solid: 0.55,
      sway: "none (cacti are rigid; safe for makeModel as well as put / planPut)",
      scale_range: [0.8, 1.2],
      tris: { desktop: 18000, mobile: 5400, far_lod: 2520 },
      kb: { desktop: 6125, mobile: 409, far_lod: 196 },
      source: "Tripo (Higgsfield) raw of about 1.9 M triangles from the round 2 concept; spines removed from the geometry by a morphological opening and baked into the colour, normal and AO maps; rib pleats kept in the mesh",
    },
  };
  for (var k2 in R2B) put(k2, R2B[k2]);

  // the rigged partner characters (IMPL2: Will Deitrick at GBANK, Paul Mazzapica at the FinanceAdvisors.com booth), installed by R2A on
  // the host route and switched on by the round 2b register task (every file checked on disk: file, mobile, lod, walk, idle). Like
  // PLAN_MODEL_INFO.host they are NOT PLAN_MODEL_SPECS kinds: load .file with gltfLoader() (.mobile on the /models_m tier), clone with
  // THREE.SkeletonUtils.clone and drive with THREE.AnimationMixer; the walk / idle files are skeleton-only glbs whose tracks bind by
  // joint name (clip names 'walk' and 'idle', no scale tracks). plan_gbank.js (will) and plan_terminal.js (paul) switch to the rig
  // by themselves once these entries exist.
  var RIGGED = {
    will: {
      installed: true,
      size: [1.109, 1.83, 0.357],
      size_note: "[x, height, z] in metres at scale 1 in the rest A-pose (arms out); standing in the idle clip the footprint is about 0.56 x 0.37 m and the top of the head 1.82 m (knees unlocked 1 cm)",
      front: "face (+Z), feet on y = 0, footprint centred on the origin",
      rigged: true,
      file: "/models/will.glb",
      mobile: "/models_m/will.glb",
      lod: "/models/lod/will.glb",
      walk: "/models/will_walk.glb",
      idle: "/models/will_idle.glb",
      solid: 0.35,
      height: 1.83,
      who: "Will Deitrick, Managing Director, Riverside Management Group",
      files: {
        desktop: { path: "/models/will.glb", kb: 6212, tris: 45000, textures: "JPEG, base colour 3072, ORM 2048" },
        mobile: { path: "/models_m/will.glb", kb: 4751, tris: 45000, textures: "JPEG 1536" },
        far_lod: { path: "/models/lod/will.glb", kb: 1501, tris: 13500, textures: "JPEG 256", note: "skinned too (same 24-joint rig), plays the same clips" },
        idle: { path: "/models/will_idle.glb", kb: 80 },
        walk: { path: "/models/will_walk.glb", kb: 77 },
      },
      clips: {
        idle: {
          name: "idle",
          duration_s: 8.0,
          loop: "seamless (every motion periodic over 8 s)",
          what: "a calm front-facing standing idle authored for this rig (genesis_data/v2/scripts/r2a_idle.py): arms hanging at the sides, elbows soft, slow breathing, a slow weight shift with both feet pinned flat by two-bone IK, a gentle look left and right that always returns to the front. The body keeps facing +Z, so turning the model (rotation.y) toward the visitor faces him at the visitor. The char_m idle was not used: it is a sideways stance that swings the shoulders through about 90 degrees.",
          soles_m: [-0.0007, -0.0005, -0.0003],
          forearm_roll_deg: { Left: -12.0, Right: 9.0 },
        },
        walk: {
          name: "walk",
          duration_s: 4.2,
          source: "models/char_m_walk.glb retargeted (r2a_retarget.py: the retarget_clip.py math plus pose-matched arms, no scale tracks)",
          in_place: true,
          speed_at_timescale_1_mps: 0.72,
          feet: "seated in the clip: the raw char_m walk carries the soles 0.0953 m up (the host compensates about 9 cm in plan_outpost.js); here the Hips were lowered by that much, so do NOT add a HOST_DROP style foot drop",
          timescale_note: "to walk at v m/s set the action time scale to v / 0.72 (1.1 m/s: 1.53)",
        },
        embedded: {
          name: "Armature|Casual_Walk|baselayer",
          duration_s: 4.23,
          note: "Meshy's own walk for this rig, still inside the body file (127 keys); not needed when the clip files load",
        },
      },
      rig: {
        joints: 24,
        names: "char_m / char_f joint names (Hips, Spine02, Spine01, Spine, neck, Head, head_end, headfront, Left/Right Shoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase)",
        armature_node_scale: 0.0101667,
        note: "Meshy auto-rig in an A-pose; the Armature node carries the real-size scale",
      },
      anchors_m: {
        top_of_head: 1.83,
        head_joint_y: 1.629,
        face_front_joint: [0.0, 1.629, 0.124],
        neck_joint_y: 1.556,
        eye_line_approx: 1.7,
        talk_camera_aim: "Head joint + 0.07 m (y about 1.7)",
        hands_in_idle: [[0.245, 0.896, 0.067], [-0.236, 0.9, 0.067]],
        label_y: 2.25,
        collider_radius: 0.35,
      },
      texture_note: "the atlas has about 1,100 to 1,500 charts with 16 px gutters at 4096 (12 px at 3072, 6 px at 1536): set map.anisotropy = MAX_ANISO (the client's own constant) on the loaded material, like the sign textures, so sleeves seen at grazing angles do not pick up neighbouring charts from the deep mip levels; checked in game with mipmaps off: no seams",
      material: "one material: base colour (the generator's atlas) + ORM (baked AO in R, roughness 0.72, metal 0), no normal map, no emissive (the generator's emissive copy of the albedo removed), KHR_materials_specular colour 1.0 (was 2.0, read as wet plastic); double sided",
      processing: "welded the uv-seam vertex splits and rebuilt smooth normals (the raw normals were split at every atlas chart border and shaded as facets on the face), scaled on the Armature node to the real height, decimated only the body (head above the neck and both hands kept at full resolution) to 45k triangles, AO baked on the game mesh itself, then the albedo re-projected (4096 bake, Lanczos to the tier size) onto a clean xatlas layout with 16 px gutters because the generator atlas is about a thousand touching micro charts that bleed into each other in the mip chain (skin-coloured scratches on the navy clothes in game); the face charts are laid out 2 to 2.4 times larger and the tiers carry 3072 / 1536, so the face is sharper than the generator's own atlas",
      placement: "plan_gbank.js places him in the RMG suite beside the desk (WILL_AT [-3.3, -6.3] in the pavilion frame, y = suite floor + 0.014) and turns him toward a visitor on that floor; willLoad() starts once PLAN_MODEL_INFO.will exists and the camera is within 140 m, loads file (mobile on the /models_m tier), willLoaded() keeps scale 1 (1.83 m is inside its 1.55 to 2.1 m band) and plays the idle clip file (scale tracks filtered); the charcoal-suit stand-in hides once the rig plays",
      note: "Will Deitrick, Managing Director, Riverside Management Group; Meshy 7 rigged character from the approved concept (assets_r2/concepts/will.png). load like PLAN_MODEL_INFO.host: gltfLoader() on file (mobile on the /models_m tier; ASSET.models + '/<kind>.glb' picks the tier), THREE.SkeletonUtils.clone for each copy, THREE.AnimationMixer; the clip files are skeleton-only glbs (no mesh) whose tracks bind by joint name, clip names 'idle' and 'walk', no scale tracks (filtering .scale tracks, as plan_gbank.js does, is harmless). Never put this kind in PLAN_MODEL_SPECS: the static loadModels path bakes the Armature node scale into the geometry (the 1.7 cm statue bug of host).",
    },
    paul: {
      installed: true,
      size: [1.031, 1.8, 0.322],
      size_note: "[x, height, z] in metres at scale 1 in the rest A-pose (arms out); standing in the idle clip the footprint is about 0.57 x 0.36 m and the top of the head 1.79 m (knees unlocked 1 cm)",
      front: "face (+Z), feet on y = 0, footprint centred on the origin",
      rigged: true,
      file: "/models/paul.glb",
      mobile: "/models_m/paul.glb",
      lod: "/models/lod/paul.glb",
      walk: "/models/paul_walk.glb",
      idle: "/models/paul_idle.glb",
      solid: 0.35,
      height: 1.8,
      who: "Paul Mazzapica, Co-Founder and President, FinanceAdvisors.com",
      files: {
        desktop: { path: "/models/paul.glb", kb: 5922, tris: 44999, textures: "JPEG, base colour 3072, ORM 2048" },
        mobile: { path: "/models_m/paul.glb", kb: 4578, tris: 44999, textures: "JPEG 1536" },
        far_lod: { path: "/models/lod/paul.glb", kb: 1489, tris: 13499, textures: "JPEG 256", note: "skinned too (same 24-joint rig), plays the same clips" },
        idle: { path: "/models/paul_idle.glb", kb: 80 },
        walk: { path: "/models/paul_walk.glb", kb: 78 },
      },
      clips: {
        idle: {
          name: "idle",
          duration_s: 8.0,
          loop: "seamless (every motion periodic over 8 s)",
          what: "a calm front-facing standing idle authored for this rig (genesis_data/v2/scripts/r2a_idle.py): arms hanging at the sides, elbows soft, slow breathing, a slow weight shift with both feet pinned flat by two-bone IK, a gentle look left and right that always returns to the front. The body keeps facing +Z, so turning the model (rotation.y) toward the visitor faces him at the visitor. The char_m idle was not used: it is a sideways stance that swings the shoulders through about 90 degrees.",
          soles_m: [-0.0001, -0.0001, -0.0001],
          forearm_roll_deg: { Left: 39.0, Right: -39.0 },
        },
        walk: {
          name: "walk",
          duration_s: 4.2,
          source: "models/char_m_walk.glb retargeted (r2a_retarget.py: the retarget_clip.py math plus pose-matched arms, no scale tracks)",
          in_place: true,
          speed_at_timescale_1_mps: 0.68,
          feet: "seated in the clip: the raw char_m walk carries the soles 0.091 m up (the host compensates about 9 cm in plan_outpost.js); here the Hips were lowered by that much, so do NOT add a HOST_DROP style foot drop",
          timescale_note: "to walk at v m/s set the action time scale to v / 0.68 (1.1 m/s: 1.62)",
        },
        embedded: {
          name: "Armature|Casual_Walk|baselayer",
          duration_s: 4.23,
          note: "Meshy's own walk for this rig, still inside the body file (127 keys); not needed when the clip files load",
        },
      },
      rig: {
        joints: 24,
        names: "char_m / char_f joint names (Hips, Spine02, Spine01, Spine, neck, Head, head_end, headfront, Left/Right Shoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase)",
        armature_node_scale: 0.01,
        note: "Meshy auto-rig in an A-pose; the Armature node carries the real-size scale",
      },
      anchors_m: {
        top_of_head: 1.8,
        head_joint_y: 1.609,
        face_front_joint: [0.0, 1.609, 0.143],
        neck_joint_y: 1.496,
        eye_line_approx: 1.68,
        talk_camera_aim: "Head joint + 0.07 m (y about 1.68)",
        hands_in_idle: [[0.247, 0.856, 0.098], [-0.231, 0.852, 0.098]],
        label_y: 2.25,
        collider_radius: 0.35,
      },
      texture_note: "the atlas has about 1,100 to 1,500 charts with 16 px gutters at 4096 (12 px at 3072, 6 px at 1536): set map.anisotropy = MAX_ANISO (the client's own constant) on the loaded material, like the sign textures, so sleeves seen at grazing angles do not pick up neighbouring charts from the deep mip levels; checked in game with mipmaps off: no seams",
      material: "one material: base colour (the generator's atlas) + ORM (baked AO in R, roughness 0.72, metal 0), no normal map, no emissive (the generator's emissive copy of the albedo removed), KHR_materials_specular colour 1.0 (was 2.0, read as wet plastic); double sided",
      processing: "welded the uv-seam vertex splits and rebuilt smooth normals (the raw normals were split at every atlas chart border and shaded as facets on the face), scaled on the Armature node to the real height, decimated only the body (head above the neck and both hands kept at full resolution) to 45k triangles, AO baked on the game mesh itself, then the albedo re-projected (4096 bake, Lanczos to the tier size) onto a clean xatlas layout with 16 px gutters because the generator atlas is about a thousand touching micro charts that bleed into each other in the mip chain (skin-coloured scratches on the navy clothes in game); the face charts are laid out 2 to 2.4 times larger and the tiers carry 3072 / 1536, so the face is sharper than the generator's own atlas",
      placement: "the FinanceAdvisors.com booth in the terminal Industry Partners hall: on booth_lux he stands at desk.staff_spot [-2.55, 0.158, 0.6] in the booth frame, facing +Z (feet on the platform top 0.158). plan_terminal.js paulRig() loads him once PLAN_MODEL_INFO.paul exists and the player is inside the terminal (file, or mobile on the /models_m tier), rescales only if his height is outside 15 percent of size[1], plays an embedded clip named idle, stand, breath or talk if there is one (there is none: the embedded clip is Casual_Walk), otherwise the idle clip file, and swaps him in for the FinanceAdvisors placeholder at its position and yaw",
      note: "Paul Mazzapica, Co-Founder and President, FinanceAdvisors.com; Meshy 7 rigged character from the approved concept (assets_r2/concepts/paul.png). load like PLAN_MODEL_INFO.host: gltfLoader() on file (mobile on the /models_m tier; ASSET.models + '/<kind>.glb' picks the tier), THREE.SkeletonUtils.clone for each copy, THREE.AnimationMixer; the clip files are skeleton-only glbs (no mesh) whose tracks bind by joint name, clip names 'idle' and 'walk', no scale tracks (filtering .scale tracks, as plan_gbank.js does, is harmless). Never put this kind in PLAN_MODEL_SPECS: the static loadModels path bakes the Armature node scale into the geometry (the 1.7 cm statue bug of host).",
    },
  };
  for (var r in RIGGED) if (RIGGED[r].installed) put(r, RIGGED[r]);
})();
