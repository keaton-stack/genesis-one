# three.js r128 → r170 upgrade (branch `three-upgrade`, not shipped)

Started 22 Sep 2026 after graphics pass 3. The branch boots and every shader compiles, but it is
not ready for live. Left here so the next session does not start from zero.

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

## Still wrong

1. The terrain hooks' blended normal blacks the ground out at night and flattens it by day
   (verified: clearing `gmat.normalMap` restores the r128 look). Both the `getTangentFrame` and
   the `tbn` forms fail; next step is dumping the compiled fragment around the hook and comparing
   `mapN` / `normalScale` values.
2. 70 meshes (3,449 vertices each, in Groups) report NaN bounding spheres at load; identify the
   model kind and check `applyMatrix4` on its geometry.
3. A large green plane appears in the sky in daylight (cloud or turf material); not diagnosed.
4. Point/spot intensities and interior lighting need a tuning pass after the above.

Main stays on r128; AgX, KTX2, SMAA, CSM and AO already ship there, so the upgrade's remaining
value is the newer PBR model and BatchedMesh, not something players are waiting on.
