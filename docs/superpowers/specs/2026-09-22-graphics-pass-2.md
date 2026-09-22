# Graphics pass 2: KTX2 textures, AgX tone mapping, SMAA

Requested 22 Sep 2026 ("do the next passes now"), shipped the same night.

## What changed

- **Compressed GPU textures.** Every non-skinned model now carries Basis (ETC1S) textures in
  KTX2 containers (`KHR_texture_basisu`), transcoded on load to whatever the GPU supports. The
  desktop pack drops from 123 MB to 78 MB and the mobile pack (textures at 512) from 78 MB to
  53 MB, and the textures stay compressed in video memory, so the earlier 1024 cap now costs
  roughly a sixth of the memory it did. Characters keep plain textures (they are re-used by the
  CPU pose measurement and are only two bodies), as do the bike and cart models, whose colour
  variants are made by reading texture pixels. `hueShiftTexture` also refuses compressed
  textures rather than throwing, which is what blacked out the first build.
- **Loader.** The r128 `KTX2Loader` (with `BasisTextureLoader`, ktx-parse and zstddec) is bundled
  by esbuild against the page's global `THREE` into `public/lib/ktx2.js`; the transcoder lives in
  `public/lib/basis/`. `gltfLoader()` attaches one shared, support-detected instance.
- **AgX tone mapping** replaces the ACES fit in the final pass (the Sobotka/Wrensch polynomial as
  used by three r160+, with the outset matrix and 2.2 linearisation), exposure retuned. Softer
  highlight roll-off and no hue skew toward yellow in full sun; the existing grade, split tone
  and vignette run after it unchanged.
- **SMAA** on High and Ultra: the composite lands in an 8-bit target, then the three SMAA passes
  (edges, blend weights, blend) from the r128 shader set, with the area and search lookup
  textures lifted from `SMAAPass.js`. FXAA stays for Low and Medium.

## Tooling

- Native `gltfpack` (meshoptimizer v1.2 release, `gpbin/gltfpack.exe` in the session scratchpad)
  is required for `-tc`; the npm build cannot encode Basis. Pipeline: `repack_ktx.py` → capped
  images → `gltfpack -cc -kn -km -ke -noq -tc` (mobile adds `-ts 0.5`).

## Verified locally

Desktop: 95 models, 71 compressed maps, animated characters, SMAA and cascades on, no failed
programs, 72 fps in the pane. Low: mobile pack with KTX2, no failed programs.

## Still on the list

GTAO for High and Ultra (the last screen-space AO drew halos on characters, so it needs normals
and a proper denoise before it goes near live), road decals and prop density, and a three.js
upgrade once the custom material hooks are ported.
