# Security Notes

## Applied controls

- Server headers set in `server.js`:
  - Content Security Policy (`Content-Security-Policy`)
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Origin-Agent-Cluster`
  - `Cross-Origin-Embedder-Policy`
  - `X-Permitted-Cross-Domain-Policies`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - Strict-Transport-Security
  - Cross-origin protections
- Game state mutations are server-side validated by `src/engine/engine.js`
  action handlers.
- Guest session token is persisted locally in a dedicated session key only for replaying
  player identity; gameplay state is server-sourced.
- Lobby readiness and host transfer checks are enforced on start and seat actions.
- Heartbeat/polling updates seat presence and marks disconnected seats for stale-room
  handling and cleanup.
- Request endpoints enforce JSON content-type and payload size caps, and request-level
  timeouts are enforced.
- Trust boundaries for forwarded IP are opt-in (`TRUST_PROXY`) to avoid spoofed client-IP
  abuse.
- In-memory room/session caps and periodic eviction are in place to constrain memory exposure
  under load.
- Graceful shutdown handling for SIGINT/SIGTERM and error hooks is implemented for safer restarts.

## Reporting

If you discover a security issue, use a private security disclosure channel and
include impact details, steps to reproduce, and affected game state (if any).

## Supply-chain policy (must-have for all environments)

- Package manager is **pnpm only** for this repository:
  - Do not install with `npm`/`yarn` for production or release work.
  - Keep `pnpm-lock.yaml` committed and review every lockfile diff.
- Baseline release checks (mandatory before publish):
  - `corepack use pnpm@latest-11`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
- For suspicious dependency updates or incident response, run:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`
- For Vercel-hosted frontends:
  - Keep all authoritative room/session logic on a durable backend service.
  - Never bundle stateful backend secrets in the frontend.
  - Keep frontend and API contracts versioned and reviewed together.

## Next hardening steps before commercial launch

- Add real auth and identity persistence for multiplayer sessions instead of
  guest tokens.
- Add server-side request logging, abuse detection, and seat-level anti-abuse controls.
- Add dependency and container hardening scans in CI (`pnpm audit`, container
  baseline checks, and image signing).
- Add deterministic install and supply-chain release gates in CI:
- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level=high`
- `pnpm audit signatures`
- Enforce optional origin checks for mutating API calls (`REQUIRE_ORIGIN_CHECK`/`ALLOWED_ORIGINS`) and add
  explicit API CORS preflight response path.
- Rate-limit anonymous guest-session creation (`guest_session` bucket) to reduce identity/spam abuse.
- `server.js` now enforces session token format/length checks and rate-limit keys
  are bound to both session token and source IP.
- Added periodic in-memory cleanup for stale sessions, rate-limit buckets, and orphaned
  closed/inactive rooms to reduce long-lived memory exposure in production.
