# Genesis Arcade v2, Drop 2: the attractions

Started 22 Sep 2026 on top of Drop 1 (the room). Scope from the Drop 1 follow-ups: Floor Is
Lava rounds, Jumpin' Jackpot scoring, the real claw. All three run on the client and settle
through the existing `arcade` server action (`coin` costs 20 $GBACK, `prize` pays up to 60 and
keeps a top-eight board per game id), so `src/logic.js` does not change. Game ids are
`lava`, `jackpot` and `grab` (the old canvas claw keeps `claw`).

## 1. Floor Is Lava (the Lava Room)

- Start: a pseudo-cabinet at the Lava Room gate (kind `lava`). E at the gate inserts a coin
  and starts a 3 second countdown; the player walks in normally. Unlike every other
  machine the player is NOT frozen: `startArcade` skips the cabinet framing for kind
  `lava`, the camera stays the normal third-person camera and WASD keeps moving the avatar.
- Rounds: the LED floor (12 x 12 tiles) switches from attract mode to round mode. Each wave
  picks a set of tiles (35 percent on wave 1 rising to 65 percent), shows them as a warning
  (orange pulse, 1.1 s falling to 0.6 s), then turns them to lava (HDR red) for 1.0 s. A wave
  survived is worth 100 points plus 10 per second alive. Standing on a lava tile, or leaving
  the grid after the countdown, ends the run.
- Prize: `min(60, floor(score / 90))`, so ten clean waves pay out the cap.
- Everyone else in the room sees the floor in attract mode; the round is local (lobbies are
  Drop 3).

## 2. Jumpin' Jackpot (Jump Zone)

- Each of the three towers gets a pad pseudo-cabinet (kind `jackpot`) and a light column: 24
  LED tiles up the tower face, procedural, so it works with or without the generated model.
- Play: the light bounces up and down the column, speeding up each shot. SPACE stops it.
  Points by height: top tile is the JACKPOT (1000 and a jackpot flash), the next two 400 and
  200, then 25 per tile. Three shots per coin; the score is the sum.
- Prize: `min(60, floor(score / 40))`.

## 3. The real claw (the two open cabinets by the door)

- Each `claw2` cabinet gets a pseudo-cabinet (kind `grab`) and a mechanism built inside the
  model's footprint: a gantry rail, a carriage, the claw body with three fingers, a bin of
  nine plush balls (three sizes, brand colours) and a chute corner.
- Play: WASD moves the carriage over the bin, SPACE drops. The claw descends, closes, lifts.
  A plush within 9 cm of the claw centre is caught with 72 percent odds (85 for the small
  ones, 55 for the big ones); a caught plush rides to the chute and drops. Three drops per
  coin. Points: 150 small, 250 medium, 450 large.
- Prize: `min(60, floor(score / 25))`.

## Architecture

- `public/arcade_room.js`: new section `Drop 2` with `LavaMachine`, `JackpotMachine`,
  `ClawMachine`, all Machine-compatible (`state`, `game`, `insertCoin`, `abort`, `step`,
  `onOver`), registered in `ARC.cabs` by `R.build` and advanced by the existing
  `updateArcade` loop. `SCREEN` and `CAB_KIND` get entries for the three kinds at build time
  so `nearestCab`/`cabFront`/the E prompt work unchanged, and the defs are pushed into
  `ARCADE.GAMES` so the high-score board lists them.
- `public/client.js`: `startArcade`, `arcadeCam` and `updateArcade` learn one thing: kind
  `lava` is free-roam (no freeze, no cabinet camera, the avatar's room-local position is
  passed to the machine each frame).
- Sound: existing `sfx`/`tone` only.

## Follow-ups

Drop 3: multiplayer lobbies (Lava Room rounds shared through the room state, air hockey).
Drop 4: more games.
