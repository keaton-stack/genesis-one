# Asset upgrade phase (Higgsfield 3D + Blender), 22 Sep 2026

Goal: regenerate every game model except the arcade set at high polygon and texture quality, process each one in
Blender into a game-ready LOD chain with baked PBR maps, and ship it through the existing desktop / mobile packs.
The user authorised up to 4930 Higgsfield credits and asked for the "beyond the meshes" items too, character quality first.

## Scope

- Regenerated: characters (char_m, char_f) and their far-LOD proxies, vehicles (cart, bike1, bike2, gbjet, jet),
  animals (10), vegetation (9), rocks and art props (12), buildings (32), jet cabin furniture (5). 74 kinds.
- Kept as they are: the arcade room and machines (arcade, cab, cab2, claw, claw2, pinball, pinball2, racer, jackpot,
  prizecounter) per the user; the 12 fitted accessories (hats, shades) because they are Blender-fitted to the
  current skulls and are re-fitted after the new bodies land; the animation clip files (char_*_idle/run/jump/swim/
  golf/sit/dance1-4) which carry only the skeleton and are reused when the new rig has the same bone names.
- Beyond the meshes: 4K/2K character atlases with normal and roughness maps, new tileable PBR ground/rock/dirt/wood
  sets, leaf-card canopies with sway for the trees, night emissive on the buildings where the atlas allows it.

## Pipeline (per kind)

1. Reference render of the CURRENT model in headless Blender (Eevee, three-quarter view on white) so the new asset
   keeps the design the user already approved. `genesis_data/v2/scripts/render_ref.py`.
2. Concept: GPT Image 2.5 (high, 2k, 3 credits) with the render as the reference image, prompted to keep layout and
   colours and add real material detail. Characters: straight front A-pose sheet.
3. 3D generation: pilot compares Tripo H3.1 (18), Hunyuan3D v3 (19) and Meshy 7 ultra (44), all PBR, on saloon and
   bull; the winner becomes the workhorse. Characters always Meshy 7 ultra + rigging (50) so the rig matches the
   Meshy rig the clips were made on.
4. Blender pass (`v2/scripts/process.py`, headless): import, weld, align yaw to the old model by point-cloud distance
   (so placements and door directions survive), decimate to the tier budget, bake tangent normal + AO from the dense
   generator mesh onto the game mesh, pack ORM, export LOD0 and a 30 % LOD1 for /models/lod.
5. Repack: existing `repack_models.py` + `repack_ktx.py` (desktop 1024 / chars 2048, mobile 512 / 1024, KTX2, meshopt).
   Skinned characters stay uncompressed (client CPU pose measurement). bike1/bike2/cart keep plain textures.
6. Local smoke test at real placements, then deploy in batches. Old models stay in git history.

## Triangle budgets (LOD0 desktop)

| kind | budget |
| --- | --- |
| characters | 45k skinned + 4k far proxy |
| buildings | 40k |
| vehicles | 25k |
| animals | 15k |
| vegetation, rocks, furniture | 8-12k |

## Credit plan

concepts ~250, pilot ~360, characters ~150 (with retries), 72 statics x 18-44 ~1500-2200, upscales/textures ~80.
Running total is kept in `genesis_data/v2/manifest.json` and checked against `balance` before each batch.

## Status

- [x] tooling: Blender 5.2 headless with Cycles on the RTX 5090 verified, reference renders for all 77 kinds done
- [x] pilot: Meshy 7 ultra wins buildings/animals (keeps porches, balconies, signs, faces); Tripo H3.1 wins airy trees and is
      fine for rocks/art; Hunyuan v3 flattened buildings and lost foliage. Decision: Meshy 7 ultra PBR for buildings,
      vehicles, animals, furniture, lamp, art4; Tripo detailed PBR for vegetation, rocks, art1-3, monolith, corten, lantern, sculpture.
- [x] characters: Meshy 7 ultra + rig + Casual_Walk from photoreal A-pose concepts; same 24-bone rig as before, so the
      11 clip files are untouched; 252k/275k tris decimated to 45k with baked normals; hats and shades re-fitted
      (FITRAW updated in client.js); far proxies from the 13.5k LOD1.
- [x] all 70 remaining kinds generated (concepts 3 cr each, 3D 18/44 cr each) and processed through the Blender pass
- [x] beyond the meshes, part 1: 20 new 2K/1K seamless PBR texture sets (sand, sand2, dirt, rock, detail, detail2, turf,
      apron, adobe, corrugated, wood, tile, travertine, terrazzo, wicker, jet_*), normals and roughness derived
      (scripts/pbr_tex.py), installed to tex/ and tex_m/; wind sway already covers every tree and bush via MODEL_SPECS.sway
- [x] install all packs (desktop models/ 290 MB incl. 37 MB lod, mobile models_m/ 82 MB from the LOD1 meshes with 512 px
      textures, tex/ 52 MB), local smoke test on both tiers (95 kinds load, AO + normal maps present, no new console
      errors), commit 3a260fd, deployed 22 Sep 2026
- [x] pass 2 (22 Sep 2026): pavilion regenerated (Meshy 7 again dropped the fabric, so scripts/pavilion_canopy.py adds a
      tensioned saddle canopy spanning the four corner islands), bush1 regenerated from a cropped concept, the five trees
      re-decimated at 20k, then mesquite / ironwood / desertwillow / paloverde / bush1 / bush2 converted to alpha leaf
      cards (scripts/leafcards.py: foliage faces found by albedo, deleted, replaced by crossed cards on a keyed leaf
      cluster texture; ~6k tris per tree instead of 20k, sway applies to the cards)
- [x] characters: bodies split into body / skin / hair / eyes material slots (scripts/char_slots.py: albedo classifier
      plus sclera-located eye spheres); the client gives skin a sheen, hair an anisotropic highlight, eyes a clearcoat,
      and measures fits on a hidden merged mesh (patch_client_v2b.py)
- [x] buildings: window masks painted by GPT Image on two orthographic views per building, projected onto the atlas in
      Cycles (scripts/project_mask.py) and stored in the ORM B channel; the client hook renders a parallax room
      interior with per-window random warm lights at night and glassy roughness by day (26 kinds)
- [x] pass 3 (22 Sep 2026, after the user reported shattered, chrome-looking buildings in game): root cause was the
      Blender export dropping tangents (export_tangents=False), so three.js rebuilt per-triangle tangent frames from
      screen derivatives and the baked normal maps (large corrections across the smoothed hard edges of decimated
      buildings) read as facets. Every processed GLB (LOD0, LOD1, far LOD, characters, accessories) was re-exported with
      MikkTSpace tangents (scripts/retangent.py); gltfpack keeps TANGENT for primitives with a normal map. Packs grew
      about 20 % (float tangents, -noq kept). The window hook was rewritten (patch_client_v2c.py): world-space room grid
      from the derivative face normal (vertex normals are bent on decimated walls) and a small interior-mapping box, dark
      tinted glass with a sky reflection by day, warm random-lit rooms at night; texture fetch kept out of divergent
      branches. Window masks re-baked with a walls-only gate (|world normal z| < 0.55) so roofs, decks and pools painted
      by the mask model drop out; dome, glamp and observatory left the window set (23 kinds). PBR statics: metalness cap
      0.45 and a roughness floor of 0.3 (addRoughFloor) so Meshy metallic parts stop mirroring the sky probe.
- [x] pass 4 (22 Sep 2026, after the user reported walls and windows still fragmented and unreadable signs): the
      generators ship "confetti" atlases (saloon: 10,800 micro charts for 40k triangles), so mip levels bleed between
      charts, text is chopped and window masks can never be clean. Every single-primitive static (63 kinds; leaf-card
      trees, pavilion, plain-texture vehicles and characters left alone) was re-atlased: scripts/xatlas_uv.py writes an
      xatlas layout as TEXCOORD_1 (avg 2,200 charts, 50 % fill; Blender's Smart UV gave 16,000 islands and was dropped),
      scripts/reatlas.py re-projects albedo and ORM from the old layout with EMIT bakes (16 px margin), re-bakes the
      tangent normal from the dense mesh in the process.py frame, and exports LOD0 (+tangents) and LOD1; buildings,
      vehicles, mesa and butte at 4096, the rest at 2048 (install still caps desktop at 2048). run_reatlas.py keeps the
      previous outputs in proc/final_v3bak, proc/<k>/*_v3bak and proc/final/lod_v3bak. Window masks were re-projected on
      the new atlases and grown across each pane with a colour-gated dilation limited to mesh-covered texels
      (scripts/grow_mask.py); window-kind ORM textures are packed as UASTC so the mask edges stay crisp. Day glass now
      carries metalness 0.55 with a blue-grey base so it reflects the sky instead of reading as a black hole.
      Signage: the generator never had crisp lettering, so signs get a view-based touch-up: scripts/render_face.py
      renders the sign face straight on (camera JSON saved), GPT Image 2.5 redraws only the lettering from that render
      (3 credits), scripts/apply_sign.py finds the changed region, project_color.py bakes it through the same camera into
      the atlas and every file carrying the albedo is refreshed. Done for the saloon; other buildings carry no readable text.
- [x] pass 5 (22 Sep 2026): window masks now fill each pane (grown components that cover most of their box are boxed,
      growth confined to a zone around each seed so light interiors cannot run across a wall chart); black squares on
      bushes, trees and walls were NaN tangent frames (Blender exports zero tangents on degenerate uv corners and three
      normalises them to NaN, blacking out whole faces with a normal map): client.js sanitizeTangents() rebuilds them at
      load; black window panes seen from below were the environment probe's black lower hemisphere: envScene now has a
      sand-coloured ground hemisphere tinted by daylight; the walk cycle comes from its own clip file
      (char_<b>_walk.glb: Meshy 3d_rigging on the original character mesh with library clips walking_2 / Walking_Woman,
      8 credits each, scripts/extract_clip.py keeps skeleton + animation and detrends the hips so the cycle stays in
      place) because the embedded generator clip only carried two keys; lower whole-building night glow on window kinds.
- [x] pass 6 (22 Sep 2026, "game looks worse than the renders"): two real quality leaks between the Blender renders and
      the game. (1) Colour maps were ETC1S-compressed (gltfpack default): wood grain, frames and lettering smear into
      blocks. Buildings now pack colour as UASTC on desktop (about +4 MB per building, mobile unchanged). (2) The day
      look replaced every masked glass texel with a synthetic glass material, so any mask imperfection showed as a
      triangular patchwork; the day look now keeps the generator's painted glass (only a glossy sheen and a little
      metalness on masked texels) and the mask drives lit rooms at night only.
- [x] pass 7 (23 Sep 2026): every building except the pavilion rebuilt at 80k triangles (hotel 100k, terminal 110k;
      scripts/run_rebuild80.py drives process.py with the recorded yaw, then the re-atlas chain, masks, the saloon sign
      and a full reinstall); desktop packs carry UASTC colour for every kind and 2048 ORM + normal maps for buildings
      (mobile unchanged). Windows: the room photo is gone, masked glass keeps the painted albedo by day and glows as a
      soft warm interior at night; the terminal gets real glass (the opaque pass discards the mask, a second transparent
      part draws only the glass, so you see through the hall). Locomotion: the 4.6 m/s move speed is a running pace, so
      a Run_02 jog clip (in place, 0.73 s cycle, JOG_SPEED 3.0) covers it and Casual_Walk_inplace covers slow motion;
      RunFast stays for sprint.
- [x] pass 8 (23 Sep 2026, "windows still fragmented, walk is a jog, hands broken"): windows are geometry now.
      Per building: scripts/win_elev.py renders four straight-on elevations plus the projected window mask from the
      same cameras; win_rects.py closes the mask, splits merged runs at profile valleys, keeps boxes whose masked pixels
      are mostly cool (glass) and tightens each box to those pixels (doors and shutters drop out); win_quads.py casts
      rays from each camera to find pane depth and wall normal, builds a quad per rectangle, dedupes across views;
      glb_addglass.py appends a "glass" mesh (pane uv, COLOR_0 random shared by touching panes) to LOD0, LOD1 and the
      nowin copies; run_windows.py chains it (22 kinds, the terminal keeps its see-through mask). The client gives the
      glass mesh a reflective tinted material: sky-biased reflection normal, fresnel alpha, per-window warm room glow at
      night, no shadows; walls of window kinds render plain (no hook). The mask hook and room photo are gone.
      Environment probe: PMREMGenerator.fromScene clips at far=100 by default and the sky sphere sits at 1000, so the
      probe had always been black (a chrome test sphere rendered as a black ball); now far=5000, environmentIntensity
      0.7, generated statics metalness cap 0.3. Characters: the re-rig for the walk/jog clips put the left hand bone
      142 deg off the body's rig, so those tracks landed in the wrong frame; scripts/retarget_clip.py transfers local
      rotations through per-bone frame deltas (R_A = C_parent * R_B * inv(C_i)); walk covers normal move speed at a
      calm cadence (timescale <= 1.3), the jog only bridges walk and sprint.
- [x] pass 9 (23 Sep 2026, "panes mesh into the walls, add first person"): every window now has geometry depth. The
      pane sits 1.2 cm proud of the wall (the earlier 0.012 model-unit offset was 16 cm on the hotel), a "winframe"
      mesh adds four protruding frame bars (6.5 cm wide, 4.5 cm deep, dark painted wood in the client) and a sill under
      ordinary windows (glb_addglass.py takes metres-per-unit from win_scale.json, derived from MODEL_SPECS). Rectangle
      fitting works in metres: panes under 35 cm and facades that are just many small patches (slat screens, mullion
      grids) are dropped, so the gallery's slat wall is no longer covered in blue stickers. First person: O key or the
      VIEW button (index.html #fpvbtn); fpvCamera() sits at the Head bone with the existing yaw/pitch mouse look and
      hides the own body and label; third person resumes for riding, cart, interiors, golf and tower view.
      Rectangle fitting also completes sparse mask components from the render's own glass pixels (cool, not bright,
      inside the silhouette, within 35 cm) so mullioned panes with a thin projected mask still form one window, and
      merges panes within 10 cm of each other into one rectangle before the size and noise rules.
- [ ] still hand work: true hair strand cards (the hair slot uses an anisotropic material instead)
- [ ] optional: repack statics with -vpf -vtf -vn 8 (int8 normals and tangents, KHR_mesh_quantization) to claw back the
      tangent growth; needs a collider and fit smoke test first
- [x] pass 10 (23 Sep 2026, "characters wayyy better"): four things.
      Cart seat: the regenerated cart was 3.2 m long (real carts are 2.4), so its bench sat 1.11 m up over a 0.46 m floor
      and a seated body was buried in the cushion with its feet through the floor; the cart is now 2.5 m (decals scaled),
      the seated pose is measured at runtime from each body's sit clip (measureSit: butt, back plane, knees, feet, head)
      and every cart seat (personal, shuttle driver and passenger, parked, friend's cart, shared vehicles) comes from one
      helper (cartSeatLocal) against the measured bench (CARTG); the driver's hands reach the wheel rim by two-bone IK
      (cartPose). Benches use the same runtime fit (the old SITFIT constants came from a clip with root drift).
      Photoreal re-texture: the rigged bodies are kept; scripts/char_views.py renders ten straight-on ortho views (four
      body, six head, with float depth EXRs), GPT Image 2.5 re-renders each as a photoreal photo (identity from the concept
      sheet), scripts/char_edits_prep.py aligns each edit to its render by silhouette cross-correlation and makes the
      weight masks, scripts/char_project.py bakes them back through each view's camera (depth-tested visibility, camera
      facing to the third power, head views weigh four times body views, skin-slot texels that came back white or very
      dark keep the old texture) into a 4K atlas; scripts/char_retex_install.py installs it (desktop 4096 JPEG, mobile 1024).
      The tint shader is slot-aware now (body: shirt/pants/shoes; skin: skin; hair: hair; eyes: none).
      Note: Cycles' camera space points +Z forward, so depth is abs(Z) in both the Eevee depth render and the bake.
      Hairstyles: ten generated wigs (GPT Image wig photos -> Meshy 7 image-to-3D, scripts/hair_proc.py drops skin
      faces, decimates to 6k, normalises by the outer surface: ear-level band centre at the origin, crown apex at y 0,
      outer half-width 0.1 m, grey auto-levelled albedo) mounted in the head's upright frame from measured skull constants
      (HAIRFIT) plus a per-style thickness and crown inset (HAIR table); loaded lazily per style; the female tail is
      dropped under any wig; a hat hides the wig. Server accepts hair 0-11.
      Studio + HUD: tabbed character studio (Body / Hair / Outfit, thumbnail grid, swatches with an active ring, drag to
      turn, head framing on the hair tab) and a glass HUD (bracket corners, mono readouts, framed compass and map, key
      chips, places rail). Test server note: the wrangler dev bundle in the scratchpad (g1dev/worker/worker.js) is a
      one-off esbuild of app/src/worker.ts and must be rebuilt after server changes.
