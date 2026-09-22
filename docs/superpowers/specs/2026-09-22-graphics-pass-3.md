# Graphics pass 3: shadows on everything, moonlight, ambient occlusion, road ruts

Requested 22 Sep 2026: "shadows should apply to everything all the time, just at different levels
across the whole map. Sunny = shadows, sunset = most shadows, night = shadows from moonlight ...
shadows on every rock, vegetation, foliage, tree, house, pebbles", plus the remaining passes.

## Shadows

- On High and Ultra every lit mesh casts and receives: props under 3 m, far LOD instances, merged
  instance sets, grass blades, pebbles, rocks and the terrain itself. The add-time rule in the
  scene's `add` override covers groups; a sweep every 3 s (and once after the world builds)
  covers meshes added straight to the scene or into groups already in it. Interiors are flagged
  and left alone (a casting ceiling would black the room out), as are near-invisible transparents,
  the rut decals and anything at cloud height.
- The shadow-casting key light is the sun while it is above the horizon and the moon once it sets
  (cool #9fb4ff, 0.62 at full night), with a short fade through the hand-over, so there are
  shadows around the clock and no more "night = no shadows". Below 7 degrees the key direction is
  clamped so sunset shadows stay long without turning into acne.
- Cascade reach raised to 520 m on High and 900 m on Ultra; the near cascade covers 23 m at 2K.
- Scatter density on the cascaded tiers: pebbles 1300 → 2200, rocks 70 → 110 around the player.

## Ambient occlusion (High 0.55, Ultra 0.7)

Half-resolution horizon-based AO with normals rebuilt from depth (picking the smaller neighbour
difference on each axis so edges stay clean), 8 directions × 3 steps in a 0.55 m radius that
grows slowly with distance, a hard range fall-off at 1.6 radii (this is what stops the halos the
old pass drew around characters), fade-out past 140 m, then the existing depth-aware 7×7 blur.

## Road ruts

Two dark, slightly glossy strips laid 19 percent of the width either side of the centreline of
every dirt road (96 strips), on Medium and up.

## Verified locally

No failed programs, no console errors, 2,725 of 3,766 lit meshes casting before the sweep and
the rest after it (the remainder are interiors and rut decals), moon shadows visible at night,
50 fps on High in the built-in pane with everything casting plus AO.
