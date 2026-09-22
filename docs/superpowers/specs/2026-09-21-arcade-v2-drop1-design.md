# Genesis Arcade v2, Drop 1: the room

Approved 21 Sep 2026 (option 1 of 3: evolve the existing arcade in place, four drops).

## Goal

Turn the Genesis Arcade from a flat hall of screen cabinets into an immersive blacklight
arcade in the style of the reference photos (neon tube ceiling and wall lines in blue,
magenta and orange, LED tile floor, near-black walls, retro pixel signage), with a bigger
room laid out in zones that the later drops fill: Cabinet Row, Pinball Alley, Prize Lane,
the Lava Room, the Jump Zone and a Multiplayer Corner. Fix pinball. Keep every system that
already works: interior rooms, solids, NPC crowd, the 21 canvas games, the $GBACK economy
and the high-score boards.

## Scope of Drop 1

1. Room: a larger interior (half 32 m instead of 24, height 8 m) built by `furnishArcade`
   with zone floors (UV carpet in the cabinet zones, LED tile grid in the Lava Room,
   rubber in the Jump Zone), neon tube rails with real emissive glow picked up by the
   existing bloom pass, blacklight fill, pixel-font signage per zone and a bigger marquee.
   The exterior hall model is regenerated at a larger footprint (MODEL_SPECS size 78,
   oriented solid 44 x 70) at the same site and rotation.
2. Hero models (Higgsfield image_to_3d, PBR, 14-16k, reviewed in Blender): neon upright
   cabinet, open-cabinet claw with a visible gantry and arm, pinball table with a real
   playfield, Jumpin' Jackpot tower, prize counter, arcade hall exterior. LED tile and
   neon tubes stay procedural.
3. Pinball rebuilt as a 3D table: the playfield is a real inclined plane in the room,
   ball, flippers, bumpers, targets and lanes are meshes, physics runs on the client
   (2D on the incline), score and prize go through the existing `arcade` server action.
   The old 2D pinball canvas game is removed from `ARCADE.GAMES`.
4. Sound: an arcade ambience loop (crowd, bleeps, coin drops) that fades in inside the
   hall, plus attract-mode chatter from nearby cabinets.
5. Placeholders for Drop 2 and 3 attractions: the Lava Room floor already cycles colours
   in attract mode, the Jump Zone has the tower and pad, the Multiplayer Corner has an
   air-hockey table shell. None of them is playable in Drop 1.

## Out of scope for Drop 1

Floor is Lava rounds, Jumpin' Jackpot scoring, the real claw grab, multiplayer lobbies,
new canvas games, server logic changes.

## Architecture

- `public/client.js`: `furnishArcade` is split into `arcadeRoom` (shell, floors, neon,
  signage), `arcadeZones` (per-zone placement), `arcadeMachines` (cabinets, claws,
  pinball tables, jackpot towers) and `arcadePinball` (the 3D table). `SCREEN`,
  `CAB_KIND`, `placeCab` keep their contracts so the 21 games still mount on cabinets.
- `public/arcade_games.js`: unchanged. The 2D pinball entry stays as the definition (name,
  prize curve, board id `pinball`) that the 3D tables use, so old high scores carry over; no
  cabinet mounts its canvas game any more.
- `public/arcade_room.js`: new. `ARCADE_ROOM.build(g, half, hgt)` (room, zones, machines),
  `ARCADE_ROOM.placeCab` (screen cabinets), `Pinball3D` (Machine-compatible 3D table),
  `ARCADE_ROOM.update(dt)` (LED floor, sign blink, attract chatter).
- Models: `public/models/{cab2,claw2,pinball2,jackpot,prizecounter,arcade}.glb` with
  `MODEL_SPECS` entries (props: height-normalised, front = +z, rot 0). The old
  `claw`/`pinball` models stay for the mid-hall rows until Drop 2 replaces claws.
- Lights: the arcade adds at most 6 PointLights (the LIGHTS pool copies the nearest 8),
  neon glow comes from emissive materials and bloom, never from more lights.
- Solids: `solidifyGroup(g, "room")` keeps working because every new machine is a
  Group of meshes; the LED floor and neon tubes are flat or tiny so they are skipped.

## Testing

`bun run build`, `bunx wrangler dev --port 8787`, walk into the arcade in the in-app
browser pane, screenshots of each zone, play one cabinet, one pinball game, check
`renderer.info` draw calls stay under 700 inside the hall. The node smoke test for
`arcade_games.js` must still pass with pinball removed.

## Follow-ups

Drop 2: Lava Room rounds, Jumpin' Jackpot scoring, real claw. Drop 3: multiplayer.
Drop 4: more games.
