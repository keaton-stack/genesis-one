# Sign-in and $GBACK balance

Solana wallet sign-in (SIWS), session, per-wallet profile, read-only $GBACK balance.

| File | Role |
| --- | --- |
| `app/src/auth.ts` | challenge, signature check, session token, cookie, player id |
| `app/src/auth-routes.ts` | `/api/auth/*`, `/api/gback/balance` |
| `app/src/auth-store.ts` | Durable Object `__auth`: used nonces, revoked sessions, rate limits, last balances |
| `app/src/gback.ts` | RPC balance read |
| `app/src/worker.ts`, `room.ts` | `/ws` needs a session; room takes the player id from the Worker |
| `app/public/web3.js` | wallets, sign-in screen, wallet switch, HUD balance |
| `app/public/boot.js` | game loads only after sign-in |
| `app/public/profile.js` | name, look, progress per wallet |

## Flow

1. `GET /api/auth/session`. No session → sign-in screen; game not loaded.
2. Wallet: any Wallet Standard wallet, or Coinbase via `window.coinbaseSolana`. `POST /api/auth/challenge` → message
   naming `APP_DOMAIN`, nonce valid 5 min.
3. Sign: `solana:signIn` if supported (one approval), else connect + `signMessage`. Free, moves no tokens.
4. `POST /api/auth/verify`: checks signature + message, consumes nonce, sets cookie, revokes any previous session.
5. Game loads; player id = HMAC of the address (server side).

**Wallet switch** in the extension shows a card. Continue = new signature as the new account, then reload. Switching
back closes the card. An account never connected here arrives without address → "Connect and continue".

## Session

- Cookie `gb1_session`: HS256 token, `HttpOnly`, `SameSite=Lax`, `Secure` (except http localhost), host only.
- Idle **10 h**, renewed by the page every 15 min (once past half). Hard cap **24 h** after signing.
- Sign out: token on revoke list until expiry, cookie cleared.
- Open socket: room closes it (4401) once the session it opened with expires; client reconnects or shows sign-in.

## Security

- Ed25519 signature checked server side.
- Nonce: HMAC-signed, issue time inside, bound to the address when known, 5 min, single use (atomic in the DO).
- Domain from `APP_DOMAIN`, never the request. Every field checked exactly; unknown fields refused.
- Worker strips client `X-GB-*` headers and sets its own; room ignores the client's player id.
- Auth routes JSON only (no cross-site form posts). Rate limits per IP: 100 challenges, 30 verifies / 5 min.
- RPC key stays server side; balance route answers only for the signed-in wallet.

Secrets (platform; locally `app/.dev.vars`, not committed — the deploy ignores `wrangler.jsonc`):

| Name | |
| --- | --- |
| `SIWS_JWT_SECRET` | signs nonces, sessions **and player ids**. Never change in production: all player ids would change |
| `APP_DOMAIN` | host only, e.g. `genesis-one.higgsfield.app` |
| `SOLANA_RPC_URL` | Helius URL incl. API key. Unset → balance route 503 (public mainnet RPC blocks Workers) |

## $GBACK balance

`GET /api/gback/balance` → `{ raw, decimals, ui, slot, at }`: sum of the wallet's token accounts for the $GBACK mint
(`getTokenAccountsByOwner`). Amount only, no price.

- Client reads at sign-in, on tab visible and on click (each max once per 30 s). No polling.
- Server: per wallet 1 RPC read / 30 s (else stored amount, kept 24 h); per IP 30 / 5 min; global 60 / min.
  Over a limit: stored amount, or 429 + `Retry-After`. Failed reads count too.
- Shown in the loading-screen wallet menu and in-game top right (`#wbal`). Top-left `BAL … $GBACK` = in-game coins.

## Profile per wallet

Keyed on player id. Room: name, look, coins, rank, homes (`players[id]`) and private profile (`progs[id].pf`,
`pref` action, `PREF_KEYS` in `logic.js`). Passport ledger per wallet, merged with the room copy. Device settings
stay in the browser. Pre-sign-in local data migrated once to the first wallet signing in here (`g1:local-owner`).

## Open points

- **`Origin` check on `/ws`**: sibling `*.higgsfield.app` subdomains are same-site for `SameSite`. Check against `APP_DOMAIN`.
- **`PLAYER_ID_SECRET`** separate from `SIWS_JWT_SECRET`, so sessions can rotate. Only before real players exist.
- **Seat cap**: `meta.maxPlayers = 500` counts every id ever joined; seats never released. Release on disconnect or raise.
- **Naming**: in-game coins also called $GBACK. Rename (A) or label both (B). $GBACK = utility token: no price, no USD.
- **Old coins/homes** under old browser ids: fresh start or one-time claim.
- **`reset`** disabled (wiped everyone); admin wallets later?
- **Mobile**: wallet in-app browser only for now.
- **Read only**: sending/spending $GBACK = separate design + review.

## Later

- **Balance-gated areas**: tiers in `logic.js`, enforced in server move/enter validation, mirrored client side. Room
  re-checks balances on a timer (`wakeIn`); "held at last check" — fine for access, not for payouts.
- **Guests**: only refusal is the `/ws` check in `worker.ts`. Guest id (`"g" + random`, own `HttpOnly` cookie) +
  per-action rules in `logic.js`. Fix seat cap first.
