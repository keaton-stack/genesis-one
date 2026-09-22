# Graphics pass 1: cascaded shadows, grounding, asset tiers

Requested 22 Sep 2026: bring the look closer to GTA 5 without making the game too heavy for weak
PCs or phones. Shipped straight to live (a short local smoke test caught two load-order and
shader bugs before the push).

## What changed

- **Cascaded shadow maps** on High (3 cascades, 420 m) and Ultra (4 cascades, 700 m), all 2K,
  split at roughly 19 / 76 / 420 m (High) so the near cascade is about 1 cm per texel at the
  player's feet while shadows still reach 400 m out. The maps grow outward automatically when the
  camera climbs (balloon, jet, tower). Medium keeps the single 2K map, Low has none. The r128
  CSM add-on is vendored in `public/lib` with two fixes: its frustum class no longer shadows the
  core `THREE.Frustum`, and its shader chunk treats directional lights beyond the cascades (the
  moon, the idle sun) as ordinary lights instead of indexing the cascade table out of range.
- **Every lit material takes the cascades.** `MeshStandardMaterial` and `MeshPhysicalMaterial`
  are subclassed so every material the game or the glTF loader creates registers with the CSM,
  survives `clone()` (copy resets `defines`), chains any custom `onBeforeCompile` the game adds
  (sway, ground blending, edge materials) and keys the program cache on that hook.
- **Contact blobs** under every character on tiers without shadow maps.
- **Dynamic resolution**: a 90-frame window scales the render resolution down (to 0.6) when
  frames run long and back up when there is headroom.
- **Asset tiers.** Models are meshopt-compressed with textures capped at 1024 (characters 2048)
  for desktop, and a second pack `models_m` capped at 512 (characters 1024) plus half-size loose
  textures in `tex_m` for phones, 4-core machines and the Low setting. Originals: 169 MB and
  about 2.8 GB of decoded texture memory; desktop pack 123 MB, mobile pack 78 MB (roughly a
  quarter of the memory). The repack script lives in the session scratchpad
  (`repack_models.py`): GLB → capped images → gltfpack `-cc -kn -km -ke -noq` (no quantization,
  because the client bakes matrices into geometry with `applyMatrix4`).
- Shadow maps are not re-rendered at night, when the cascades contribute nothing.

## Verified locally before the push

Desktop tier: 95 of 95 models, animated characters, 2148 lit materials all on the cascades, no
failed shader programs, 84 fps in the built-in pane. Low tier: mobile pack served (144 requests
to `models_m` and `tex_m`), no shadow maps, blobs on, 99 fps.

## Next passes

KTX2 (Basis) textures for another 4 to 6× on video memory, a three.js upgrade for AgX tone
mapping and better PBR, SMAA or TAA, a GTAO pass for High and Ultra, road decals and prop density.
