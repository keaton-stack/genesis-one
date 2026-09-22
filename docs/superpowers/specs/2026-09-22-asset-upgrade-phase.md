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
- [ ] install all packs, local smoke test, deploy
- [ ] not done (needs hand modelling, out of automated reach): hair cards and per-region eye/skin materials on the
      single-atlas bodies, window parallax interiors and night emissive masks on the generated buildings, alpha leaf cards
