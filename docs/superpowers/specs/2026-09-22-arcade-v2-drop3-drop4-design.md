# Genesis Arcade v2, Drops 3 and 4: multiplayer, more games, two fixes

Started 22 Sep 2026 on top of Drop 2. Requested together: "do drops 3 and 4, but also fix the
pinball since the flaps face outwards and you cant hit the ball. Then fix the jumpin jackpot
game, the real way to play is to have light go around in circles and you have to jump over the
light when its near the ground."

## Fixes

- **Pinball flippers.** The flipper bars extended from the pivot toward the side walls, so the
  ball fell through the centre untouched. They now extend inward from the pivots at the end of
  the inlanes (46 percent of the half width, rest 29 degrees down, flipped 26 degrees up), in
  both the mesh and the physics segment.
- **Jumpin' Jackpot** is now the real thing: a ring of 36 floor lights around each tower, one
  light chasing around the ring, and you stand on the ring and jump as it passes under you.
  Every clean jump lights one more lamp on the tower column and speeds the chase up; getting
  caught ends the round; 24 jumps fill the column for the jackpot. It is a free-roam machine
  like the Lava Room (kind `jackpot` in `ARC_FREE`). 50 a jump, 1000 for the jackpot, prize
  `min(60, floor(score / 40))`.

## Drop 3: multiplayer

### Shared Lava Room rounds

The round lives in the room state (`view.lava`) so everyone in the arcade sees the same floor.

- `{t:"lava", op:"start"}` (needs a coin for game `lava`) opens a round: `{by, phase:"count",
  wave:0, hot:"", tick, players:{id:{alive,waves,name}}}`. Only one round at a time; a round
  with no update for 300 ticks or in phase `over` can be replaced.
- The starter's client is the **host controller**: it runs the timeline (3 s countdown, then
  waves of warn 1.1 to 0.6 s, lava 1.0 s, rest 0.7 s, tile share 35 to 65 percent) and pushes
  every phase with `{op:"phase", phase, wave, hot}` where `hot` is the 144-tile set as a hex
  bitmask. The host keeps running the round after its own player is out, until nobody in
  `players` is alive or wave 30, then sends phase `over`.
- **Participants**: anyone standing on the tiles during the countdown with 20 $GBACK joins
  automatically (`arcade coin` + `{op:"join"}`). Each client judges its own burn against the
  shared tile set (standing on a red tile while not airborne) or leaving the grid for 5 s, then
  sends `{op:"out"}`; the server records the wave reached. Everyone settles through the normal
  `arcade prize` op with `waves * 100 + seconds * 10`.
- Spectators see the floor run in round colours and the gate sign shows who is in.

### Air hockey (Multiplayer Corner)

Two real tables. E at either end of a free table makes you the host and starts a game against
the house paddle straight away; E at the far end of a hosted table makes you the challenger,
and the house paddle hands over to you. First to 5. Both players pay 20 $GBACK; the winner claims
40 (30 against the house), the loser 0, and a challenger whose host walks away gets 20 back.

- Seats live in the room state: `{t:"hockey", table, op:"host"|"join"|"leave"|"ping", end}`
  → `view.hockey[table] = {host, hostEnd, guest, tick}`. The host pings every 4 s; a table with
  no ping for 300 ticks is free.
- The host simulates the puck (2D: walls, two goals, paddle hits with paddle velocity carried
  over, speed cap) and sends `{t:"ah"}` packets to the challenger through the existing `signal`
  relay at 15 Hz (puck, both paddles, score, state). The challenger sends its paddle position
  back the same way and extrapolates the puck between packets.
- Kind `airhockey` is a frozen-camera machine: the camera sits over your end of the table.
  W A S D or the mouse move your paddle; it stays in your half.

## Drop 4: more games (the back wall between the Lava Room and the claws)

- **Skee-Ball**, three lanes. A/D aims, hold SPACE for power, release to roll. The ball rolls
  up the lane, jumps the hump and lands in a ring: 10, 20, 30, 40, 50 by distance, 100 in the
  two corner holes. Nine balls a coin. Prize `min(60, floor(score / 8))`.
- **Hoops**, two units. Hold SPACE for power, A/D for aim, release to shoot. 45 seconds a coin,
  2 points a basket, 3 in the last 15 seconds. Backboard rebounds count. Prize
  `min(60, floor(score * 2))`.
- **Boxer**, one unit. A power meter sweeps up and down, faster each punch; SPACE at the peak.
  Three punches, up to 999 each. Prize `min(60, floor(score / 50))`.

All three are frozen-camera machines settled through the existing coin and prize ops (ids
`skee`, `hoops`, `boxer`), so `src/logic.js` gains only the lava and hockey actions.

## Architecture

- `public/arcade_room.js`: `Pinball3D` flipper fix; `JackpotMachine` rewritten around the ring;
  `LavaMachine` becomes the host controller plus a shared participant/watcher (`R.lavaTick`,
  run from `R.update`); `HockeyTable`, `SkeeBall`, `Hoops`, `Boxer`. Registration in `R.build`.
- `public/client.js`: `ARC_FREE.jackpot`; `onSignal` routes `t:"ah"` packets to
  `ARCADE_ROOM.hockeySignal`; `updateArcade` steps a machine shared by two pseudo-cabs once per
  frame.
- `src/logic.js`: `lava` and `hockey` actions, carried through `applyAction` and `viewFor`.
- `src/room.ts`: `lava` and `hockey` count as light writes (batched with movement).

## Status (22 Sep 2026)

Shipped and verified on a private local copy with two players (localhost and 127.0.0.1 tabs):

- Pinball: 36 flipper contacts over three balls in a scripted run (before the fix: none). Flippers
  are now 46 percent of the half width, rest 29 degrees down, flip to 26 degrees up.
- Jumpin' Jackpot: four clean jumps for four passes of the light, caught on the fifth, paid out.
- Shared lava: the second player standing on the tiles during the countdown auto-joined (20 in),
  burned on wave 1 and was paid; the host left the floor at wave 2; the round closed when nobody
  was alive; both are on the board.
- Air hockey: 5 to 1 against the house; a challenger joined at the far end, paddle packets flowed
  both ways at 15 Hz, the final packet settled the challenger's result, and a host walking away
  refunded the challenger 20.
- Skee-Ball 300 on nine balls, Hoops 3 baskets of 7, Boxer 1169 on three punches, all paid.
- Air hockey also resets to a faceoff after 1.6 s without motion and the house paddle backs out
  of corners, because the first test jammed the puck between the house paddle and a corner.
- The room's tab throttling matters: a hidden browser tab stops its frame loop, so a two-player
  test needs both tabs visible (or two browsers). Packets still arrive on the hidden side.
