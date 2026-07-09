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

- Package manager is **pnpm only** for this repository.
- `pnpm` is already installed here at version `11.10.0`.
- Keep `pnpm-lock.yaml` committed and review every lockfile diff.
- Decision context for Vercel-fronted migration, lockfile controls, and supply-chain hardening is documented in:
  - `docs/technical/31_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_2026-07-09.md`
  - `docs/technical/32_PRODUCT_DECISION_EXECUTIVE_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`
  - `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
  - `docs/technical/23_PRODUCT_GRADE_PLATFORM_DECISION_RECORD.md`
  - `docs/technical/26_PRODUCT_GRADE_PLATFORM_DECISION_NEXTJS_VERCEL_PNPM.md`
  - `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`
  - `docs/technical/35_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`
  - `docs/technical/36_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SUPPLY_CHAIN_SUMMARY_2026-07-09.md`
- Supply-chain attack protections mapped to controls:
  - Baseline controls are now documented in `docs/technical/35_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`.
  - High-speed dependency churn and zero-day exposure are reduced by `minimumReleaseAge: 1440` and `minimumReleaseAgeStrict: true`.
  - Trust regressions are blocked by `trustPolicy: no-downgrade`.
  - Unknown transitive package sources are blocked by `blockExoticSubdeps: true`.
  - Release tampering is blocked by immutable lockfiles and audit/signature checks.
- Use the pinned toolchain before dependency operations:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
- Baseline release checks (mandatory before publish):
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- For suspicious dependency updates or incident response, run:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
- For Vercel-hosted frontends:
  - Keep all authoritative room/session logic on a durable backend service.
  - Never bundle stateful backend secrets in the frontend.
  - Keep frontend and API contracts versioned and reviewed together.

### Migration security posture for Vercel frontend cutover

- Do not treat request-based function instances as the game session source-of-truth.
- Before frontend cutover to Vercel, ensure room/session state is persisted and recoverable in durable services.
- Require immutable install flow and provenance checks for every release candidate:
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check:all`

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
