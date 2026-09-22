# three.js r128 → r170 upgrade (shipped 22 Sep 2026)

Started 22 Sep 2026 after graphics pass 3 and finished the same night. Main now runs three r170.

## Done on the branch

- `public/lib/three-bundle.js`: r170 core plus GLTFLoader, SkeletonUtils, CSM, KTX2Loader,
  MeshoptDecoder and the SMAA shaders, bundled with esbuild (entry in the session scratchpad
  `three-up/entry.js`) and exposed as `window.THREE`; index.html loads it instead of the r128
  script plus nine add-ons. The r170 basis transcoder replaced the r128 one in `public/lib/basis`.
- `THREE.ColorManagement.enabled = false` (hex colours stay as authored) and a `Light.prototype`
  intensity accessor that scales raw intensities by π (directional, hemisphere) or 1.7 (point,
  spot) to keep the r128 legacy-light look; the light pool copies raw `_intensity`.
- `encoding` → `colorSpace` everywhere; `tiled()` flags only colour maps sRGB (normal and
  roughness maps stay linear, r170 decodes sRGB in hardware); sky textures stay undecoded.
- `boneTransform` → `applyBoneTransform`; loader materials re-created through `wrapMat()` so they
  are the CSM subclass; the sun and moon are removed from the scene under CSM (the r170 chunk
  indexes cascades for every directional light).
- Hooks: `USE_UV` define, `vUv` → `vMapUv`, colour samplers re-encoded with `sRGBTransferOETF`
  to match r128's undecoded reads, `perturbNormal2Arb` replaced.

## What the last three bugs were

1. **Black night / flat day.** Not the normal hook after all. r170's `applyBoneTransform(index, vector)`
   expects `vector` to hold the vertex position on entry (r128's `boneTransform` read it itself), so the
   70 head-detail meshes baked from the skinned character came out all NaN. NaN geometry in the shadow
   depth pass poisoned the cascades, so the terrain read as fully shadowed. Both call sites now fill the
   vector first; NaN count is 0.
2. **Washed-out daylight.** The day key intensity was read back through the new scaling accessor and
   written again, so the sun got π² instead of π. It now uses the raw value.
3. **Normal-map port.** The terrain and rock hooks reuse the renderer's `tbn` instead of calling the
   removed `perturbNormal2Arb`; data maps (`_n`, `_r`) are flagged linear so r170's hardware sRGB decode
   leaves them alone; colour samplers in the hooks are re-encoded with `sRGBTransferOETF` so the blends
   match what r128 read undecoded; the hooks' `vUv` became `vMapUv` (r170's `vUv` is untransformed).

Also removed: the r128 add-on files the page no longer loads (`GLTFLoader.js`, `SkeletonUtils.js`,
`lib/CSM*.js`, `lib/Frustum.js`, `lib/meshopt_decoder.js`, `lib/ktx2.js`, `lib/SMAAShader.js`).

## Verified locally before the push

High: 95 models, animated characters, KTX2, SMAA, cascades and AO on, 0 failed programs, 0 NaN
geometries, sun 5.4 (1.72 × π) by day, moon by night, arcade interior correct, 41 fps in the pane.
Medium: single 2K shadow map, day and night correct, 59 fps.
