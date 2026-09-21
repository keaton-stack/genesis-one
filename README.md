# Genesis One

The Giveback Ventures browser game (Douglas, Arizona, the former Douglas Municipal Airport), built on Higgsfield's multiplayer game template.

- Live: https://genesis-one.higgsfield.app (team copy: https://genesis-one-team.higgsfield.app)
- Everything is in `app/`: `app/src/logic.js` (game rules), `app/public/client.js` and `app/public/index.html` (the 3D client), `app/public/models`, `tex`, `audio`, `video` (assets).
- Read `app/AGENTS.md` before changing `src/room.ts` or `src/worker.ts`.

## How the team works on it

1. This GitHub repo is the source of truth. Clone it, branch off `main`, make your change, open a pull request (or push to `main` for small fixes if the team agrees).
2. Deploys to Higgsfield go through Keaton's Higgsfield account: once a change is on `main`, ping Keaton and the change is pushed to Higgsfield and deployed, usually within a few minutes. Every deploy goes straight to the live game, there is no staging site.
3. Do not commit `node_modules`, `dist`, or `.wrangler` (see `.gitignore`). Keep single files under 50 MB; GitHub rejects anything over 100 MB.

## Running locally

```bash
cd app
bun install
bun run build
npx wrangler dev
```

Open the printed localhost URL. Multiplayer rooms run in a Durable Object (`Room`), so `wrangler dev` is enough to test movement, rooms and minigames.

## Content rules (public-facing text and art)

- The three build areas are "stages", never "phases", in anything visible to players.
- No water features anywhere on the land.
- $GBACK is a utility token. Never describe it as an investment.
- Low-rise only, dirt roads except the runway, desert visible between buildings.
