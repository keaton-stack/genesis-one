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
- [ ] still hand work: true hair strand cards (the hair slot uses an anisotropic material instead)
- [ ] optional: repack statics with -vpf -vtf -vn 8 (int8 normals and tangents, KHR_mesh_quantization) to claw back the
      tangent growth; needs a collider and fit smoke test first
