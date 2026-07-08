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

## Next hardening steps before commercial launch

- Add real auth and identity persistence for multiplayer sessions instead of
  guest tokens.
- Add server-side request logging, abuse detection, and seat-level anti-abuse controls.
- Add dependency and container hardening scans in CI (`pnpm audit`, container
  baseline checks, and image signing).
- `server.js` now enforces session token format/length checks and rate-limit keys
  are bound to both session token and source IP.
- Added periodic in-memory cleanup for stale sessions, rate-limit buckets, and orphaned
  closed/inactive rooms to reduce long-lived memory exposure in production.
