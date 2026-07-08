# 304 Game Project

This repository is arranged for rapid development with documentation and art assets separated.

## Development layout

- `docs/` — project documentation.
  - `docs/product/` — product requirements, feature list, rules, glossary, references.
  - `docs/features/` — implementation feature docs.
  - `docs/technical/` — architecture, data model, security, QA.
  - `docs/planning/` — roadmap and release plan.
  - `docs/resources/` — generated data resources.
- `assets/` — all game assets.
  - `assets/cards/` — `standard_304` and `variant_extras` PNG/SVG packs.
  - `assets/backs/` — card back artwork.
  - `assets/spritesheets/` — sprite-sheet image + frame JSON.
  - `assets/previews/` — preview contact sheets.
  - `assets/card_manifest.json` — source metadata for all card assets.
- `docs/README.md` — quick document map and onboarding reference.

## Source references

- For standard deck card metadata: `assets/card_manifest.json`
- For CSV export of card IDs and values: `docs/resources/card_list.csv`
- For rule/spec baseline: `docs/product/01_PRD.md`

## Usage notes

- `standard_304` and `variant_extras` are separated intentionally to keep normal 304 flow isolated.
- 3s/2s/6s are optional extras and can be enabled per table rule logic.
- Generated assets are intended for game-project use and can be modified for your implementation.

## Implemented game web stack

- Rule profiles: `classic_304_4p` and `six_304_36`
- Auto seat sizing and bot fill
- Four-card bidding and second-bidding support
- Trump selection and open/closed control
- Trick-play legality and scoring
- Hand-by-hand token movement and match end
- Server-authoritative room/match flow with guest sessions
- Secure server headers for browser delivery
- API-driven client sync (no local game state snapshots)
- Lobby seat controls and quick practice/reconnect flow
- Lobby readiness flow and host-gated start
- Presence heartbeats from polling and stale-seat handling

This project is a **production-oriented custom Node web stack** using a static client and API server, not Next.js.

### Why this is not Next.js yet

- Next.js is a solid full-stack option when you need React-based rendering, advanced routing, or server actions.
- Current architecture keeps the runtime lean: static web assets + explicit HTTP API for deterministic game control.
- The Next.js migration path is straightforward because the server endpoints are already modular and can be rehosted behind Route Handlers.

## Run the web app

```bash
pnpm install
pnpm start
```

- App URL: `http://localhost:4173`
- Optional env: `PORT=5000 pnpm start`
- Health endpoint: `http://localhost:4173/health`
- Session persistence: resume last room when returning with an existing session.

Security checks:

```bash
pnpm security:check
```

## Stack

- Frontend: static HTML/CSS/JS
- Runtime: Node.js static server with security headers
- Architecture: production web gameplay runtime (not Next.js framework)

## Deployment posture

- This is production-targeted as a single Node web service, not a Next.js app.
- Env-driven tuning is in `.env.example` (copy to `.env` for override).
- Keep-alive, request timeout, and graceful shutdown are implemented in `server.js`.
- Session and room limits are enforced in-memory for this deployment shape:
  - `MAX_SESSIONS_IN_MEMORY`
  - `MAX_ROOMS_IN_MEMORY`
- Use `/health`, `/healthz`, `/ready`, and `/readyz` for load balancer probes.

### Start commands

- `pnpm start:prod` for production startup.
- `pnpm start` and `pnpm start:dev` for local runs.

## Files

- `index.html`
- `styles.css`
- `src/engine/*`
- `src/ui/app.js`
- `server.js`

## Reference docs

- `docs/product/01_PRD.md`
- `docs/product/02_FULL_FEATURE_LIST.md`
- `docs/features/05_GAMEPLAY_ENGINE.md`
- `docs/features/04_ROOM_MATCHMAKING_AND_BOT_FILL.md`
- `docs/features/06_BIDDING_TRUMP_AND_SCORING.md`
- `docs/features/07_BOT_AI.md`
- `docs/features/08_UI_UX_ACCESSIBILITY.md`
