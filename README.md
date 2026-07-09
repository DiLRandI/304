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

## Implementation status and migration decisions

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

This project is a **production-oriented custom Node.js + static client + API server** stack and is not a Next.js application.

Decision note (2026-07-08):

- Keep the custom Node server + static client as the current production baseline.
- Next.js remains the planned product UI direction for the next platform phase (component model, route composition, and accessibility-oriented rendering patterns).
- Vercel is approved for hosting that Next.js frontend only after game state and room lifecycle are moved off in-memory process state.
- Keep deployment boundaries explicit: frontend UI and room/action APIs must be separated before any Vercel migration.
- Toolchain for dependency safety is locked to `pnpm` with immutable installs and audit checks.

Decision snapshot:

- The current production baseline remains custom Node + static HTML/CSS/JS.
- A migration to Next.js is tracked as a **planned architecture upgrade** in `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`.
- The log captures why immediate migration was deferred and what conditions must be met first.
- Tooling decision is committed to **pnpm** across dev and CI for reproducibility and supply-chain controls.
- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md` is the canonical record for:
  - Next.js approval and migration trigger points
  - Vercel deployment readiness gates
  - pnpm + audit policy for supply-chain protection

### Why this is not Next.js yet

- Next.js is a solid full-stack option when you need React-based rendering, advanced routing, or server actions.
- Current architecture keeps the runtime lean: static web assets + explicit HTTP API for deterministic game control.
- The Next.js migration path is straightforward because the server endpoints are already modular and can be rehosted behind Route Handlers.

## Run the web app

```bash
corepack enable
corepack use pnpm@11.10.0
pnpm install --frozen-lockfile
pnpm start
```

- App URL: `http://localhost:4173`
- Optional env: `PORT=5000 pnpm start`
- Health endpoint: `http://localhost:4173/health`
- Session persistence: resume last room when returning with an existing session.

### Platform decision record (2026-07-08)

- This repository is **not** a Next.js application today. It is a production-oriented custom Node.js server plus static client implementation.
- Next.js is approved as the next frontend platform, but the migration is currently deferred.
- Vercel is approved only for the Next.js frontend in phase 2 of migration.
- For Vercel phase 2, the backend must be split to a long-lived stateful service (Redis/PostgreSQL + API) before moving room lifecycle/stateful gameplay there.
- pnpm is the required package manager for this repository, with immutable installs and signature/audit checks for release safety.

If pnpm is missing on your machine, install once with:

```bash
corepack enable
corepack use pnpm@11.10.0
```

Security checks:

```bash
pnpm security:check
```

For release gating, run:

```bash
corepack use pnpm@latest-11
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
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
- Security posture for deployment:
- Keep dependency installation deterministic with `pnpm install --frozen-lockfile`.
- Run `pnpm security:check` in CI before deployment.
- Keep `pnpm` version and lockfile policy consistent through `packageManager` metadata and reproducible installs.
- For stronger supply-chain protection, use `pnpm security:check:all` before release (`--frozen-lockfile`, `pnpm audit`, and `pnpm audit signatures`).
- For Vercel/Cloud deployments, follow `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`.

### Dependency manager baseline (pnpm)

- Manager requirement: `pnpm@11.10.0` (pinned in `package.json`).
- Keep `pnpm-lock.yaml` committed and reviewed on dependency changes.

```bash
corepack enable
corepack use pnpm@11.10.0
pnpm install --frozen-lockfile
pnpm security:check:all
```

### Hosting guidance

- Current runtime: long-lived Node process with in-memory game state.
- Vercel-hosted frontend + separate backend service (API/rooms) is the product rollout path when moving to Next.js.
- For a single-process Vercel deployment, implement external shared state first (Redis/postgres) and remove implicit process-local assumptions.
- Vercel functions execute per request and scale to zero when idle, so this process-local room model is not durable on a single Vercel function tier.

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
