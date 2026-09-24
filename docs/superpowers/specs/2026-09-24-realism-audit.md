# Genesis One realism audit and roadmap (24 Sep 2026)

Goal from the user: AAA realism, no fragmentation, no poor character quality. This audit measured where quality is
lost between the generators and the game, fixed what could be fixed in one pass, and lists the rest in priority order.

## What was measured

| Question | Method | Finding |
|---|---|---|
| Why do characters look worse in game than the generator output? | Neutral-light Blender renders of the raw Meshy mesh, the processed game mesh, and the processed mesh with a flat texture and no normal map | The raw 275k-triangle mesh is clean. Our old decimation to 45k triangles created fold-over triangles (dark crack lines on the face, shattered hair facets). Texture work could never fix that. |
| Why is there patchwork and dark seams on buildings? | Atlas inspection of every processed building | The re-atlased textures are thousands of tiny UV islands with black gutters (up to 4.9 percent of the atlas). Mip-mapping and block compression bleed that black into every seam. |
| Why do walls blur up close? | Texel density | One 2048 px texture covers a whole building, about 1 cm per texel. At walking distance and in first person each texel covers many pixels. |
| Does flattening the generated walls help? | Planarization prototype (scripts/planarize.py) on the saloon, grazing-light renders | Little visible gain: the adobe relief lives in the normal map, not the geometry. Kept as a tool, not rolled out. |
| Is the renderer the bottleneck? | Code review of the post chain | No. The client already runs AgX tone mapping, custom SSAO, bloom, god rays, aerial haze, height fog, grading, SMAA and cascaded shadows. The gap is asset quality. |

## Fixed in this pass

1. **Characters rebuilt from the clean generator mesh.** gltfpack's attribute-aware simplifier (30 percent, 82k
   triangles) keeps the raw quality: real eyes and lips, stubble, soft hair, no cracks. The far LOD is a 7 percent
   version with its joints remapped to the full skeleton. Same rig, so every animation clip, hat, wig and seat fit
   still works. Scripts: `char_v4_install.py`, `fix_winding.py`.
2. **Consistent photoreal reference sheets.** Head and body views are now re-rendered as one sheet per body (GPT
   Image 2 and Nano Banana Pro at 4K), so every view shares one lighting and one identity. Alignment matches the same
   foreground test on both sides and adds an optical-flow refinement that lands eyes, mouth and ears on the mesh's own
   features (silhouette overlap 0.70 to 0.92). Projection blends in two bands (tone averaged across views, detail
   from the most frontal view) and fills gutters. On the clean mesh the generator's own texture is already better,
   so the projection is kept as a tool for future outfits rather than shipped.
3. **Gutter fill on every static asset.** The installer now fills the black gutters between UV islands from
   neighbouring island colours (push-pull) in the albedo, ORM and normal maps before resizing and compression.
4. **Close-range surface detail on buildings.** A world-space triplanar layer adds plaster relief (1.2 m tile) and
   fine grain (0.4 m tile) to albedo and normals, fading out from 3 to 14 m. World space means it never shows chart
   seams and never tiles visibly at distance.
5. **Client fixes.** Per-pixel clothing and skin tint (no more white collar fringes under dark shirts), the shoe tint
   mask works on the centimetre rig, and the NPC far-LOD swap keeps each material slot's own geometry.

6. **Photo facades on the 22 main buildings (HD facades).** Each building's four straight-on elevations were
   re-rendered as 4K photographs with Nano Banana Pro and projected back into its 4096 atlas
   (`bld_edits_prep.py`, `bld_project.py`, `bld_detail_normal.py`, `run_hd.py`). Details below.

## HD facades: how they work and what was learned

- **Prompting.** Asking the model to keep the image "exactly" makes it copy the generator's smear at higher
  resolution. Naming the smear as an artifact to replace ("material repaint", "none of the smeared patterns may
  survive") produces real boards, nail heads, cracked adobe and rusted trim while keeping the layout (silhouette
  overlap 0.99). On plain rear and side walls the model then invents doors, windows and balconies; a second,
  stricter prompt ("texture-only upgrade", every surface keeps its position, extent, colour and brightness, plain
  walls stay plain) fixed most of those views.
- **Agreement mask.** Every re-render is compared with its elevation at a coarse scale in Lab colour (median tone
  match, blurred so grain does not count). Where lightness or colour disagree strongly the old texel is kept, so an
  invented door can never be painted onto a blank wall. Overlays: `elev/edits/<kind>_e<v>_agree.jpg`.
- **Projection.** Per view: a depth render for occlusion, then an emission bake through the camera into the atlas,
  weighted by how squarely the view sees each texel. The colour is baked linear and divided by the weight before
  encoding (dividing an encoded value brightened every oblique texel into blotches; the same fix went into
  `char_project.py`). Each view is tone-matched to the old atlas so untouched texels (roofs, soffits) still blend.
  Because the projection is continuous across UV islands, it also paints over the old chart seams on facades.
- **Relief.** The generator's normal map only knows its own smeared relief. A band-passed luminance of the new photo
  becomes a height field whose texel gradient is a tangent-space normal, folded into the existing normal map by
  whiteout blending where the projection painted.
- **Compression.** The 4096 photo albedo ships as ETC1S KTX2. Measured on the GPU decode against the source it scores
  36 dB (UASTC 4096 scores 41 dB, visually identical) at about a fifth of the bytes, so an HD building file is
  smaller than the old 2048 UASTC one (saloon 14.8 MB against 18.2 MB).

## Pass 12: fixes from the user's screenshots

- **Windows where they make sense.** `win_quads2.py` replaces the window placer: a pane needs one dominant flat
  plane (or a flat wall ring around an open hole), a near-vertical wall, must not be a door (bottom at the floor and
  taller than 1.6 m) and, on buildings with a photo facade, must read as glass in the photo. This removed the frames
  floating over the hangar roof, the glass on hangar doors and the panes on the saloon's plain side walls.
  Runner `run_windows2.py`.
- **No more pale patches.** Rejected blobs in a re-render are repaired in the photo itself with a sideways copy of the
  same wall before projection, the rejection margin is wider, and holes left inside painted walls are filled from
  the surrounding new texture.
- **Standing on what is drawn.** Terrain sampling follows the terrain mesh's triangles, and every road, path, plaza
  and carpet ribbon is rasterised into a 0.5 m walk grid that the road-lift lookup reads, so players, carts and NPCs
  no longer sink up to 34 cm into paving.
- **Terminal exterior.** The generated shell is hidden and a procedural building stands on its footprint: podium,
  curtain wall with bronze mullions and an entrance portal, travertine end blocks, a timber-soffit canopy on steel
  tree columns, and glass that traces a fake hall behind it.
- **Fountains.** Lathe-turned travertine basins and bowls, reflective water with ripples and impact rings, falling
  sheets, GPU spray and foam. The monolith that stood in the main fountain's centre is gone.
- **Hair cards.** Every wig style now carries 400 to 2,000 alpha-tested strand cards grown along its shell
  (`hair_cards_gen.py`, `hair_cards_glb.py`), with anisotropic highlights; the shell stays as the darker base layer.
- **Character studio.** Every change autosaves.
- **Signs.** Text planes flip on back faces, so no sign reads mirrored (the terminal EXIT sign did).
- **Poly Haven.** CC0 photoscans replace the ground, sand, dirt road, concrete paving, rock, plaster, terrazzo,
  corrugated iron and plank sets, matched to the old average colour and gloss (`tex/CREDITS.txt`).

## Roadmap, in order of visual payoff

1. **Buildings: raw-mesh rebuild.** Checked in this pass: the raw generator buildings are confetti atlases too, so a
   gltfpack rebuild alone would not give the character-style jump. The HD facade projection is the building path;
   what remains is its coverage (roofs, soffits and porch undersides keep the old texture) and thin geometry (posts,
   railings), which a fifth, top-down view and a close-up pass on porches would cover.
2. **Extend HD facades** to the remaining building kinds that have no window pass yet (terminal, hangar variants,
   domes, the small houses) once their elevations are rendered.
3. **Characters: clothing variety and hair cards.** Separate clothing meshes (tee, hoodie, jacket) generated on the
   same body silhouette and skinned by weight transfer, so outfits change geometry, not just tint. Replace the
   generated wig shells with hair-card meshes (alpha-to-coverage) for the long styles.
4. **Temporal anti-aliasing.** Foliage and thin wires shimmer. A TAA pass (jittered projection plus history
   reprojection) would remove the shimmer and let the resolution scale drop on weaker GPUs.
5. **Photoscanned material library.** CC0 photoscanned textures and HDRIs (for example Poly Haven) would replace the
   AI-made tiling sets for terrain, roads and the detail layer. Needs your go-ahead to download third-party assets.
6. **Skin shading.** A pre-integrated skin lobe (curvature-driven wrap lighting) and a separate eye material with a
   refracting cornea for close-ups and first person.
