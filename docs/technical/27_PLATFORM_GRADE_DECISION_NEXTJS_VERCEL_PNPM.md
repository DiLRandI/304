# Platform Decision Record: Next.js Frontend Track, Vercel Hosting, and pnpm Supply-Chain Controls

**Date:** 2026-07-09  
**Project status:** production-ready web game, custom Node.js runtime in active baseline

## 1) Decision summary

- This repository is **not** a Next.js application today.
- The active runtime is a production-oriented Node.js server (`server.js`) with a static client (`index.html`, `styles.css`, `src/ui/`).
- Next.js is the approved frontend direction for the next platform phase (Phase 2).
- Vercel is the approved host target for that Next.js frontend phase only.
- `pnpm` is mandatory for dependency installation and release hardening in all environments.
- Vercel rollout for active gameplay is deferred until stateful gameplay, room/session ownership, and bot orchestration are moved to durable backend services.

## 2) Why Next.js is the right next framework

- Product-grade UI growth needs component structure, route-level composition, and stronger accessibility patterns than the current static surface can scale to safely.
- The existing API-first design of this repository (server-authoritative room actions + deterministic game engine) maps naturally to a Next.js frontend that consumes documented contracts.
- Migrating in stages preserves active game stability while enabling a cleaner, maintainable UI stack.

## 3) Vercel hosting condition

- Vercel is approved for the Next.js frontend, with these hard guardrails:
  - Keep long-lived room and session state out of request-local process memory.
  - Backend gameplay authority stays in a durable service layer (PostgreSQL/Redis/API service) before full Vercel gameplay hosting.
  - Frontend and backend contracts stay versioned and backward-safe across migrations.
  - Realtime design accounts for request-based scaling and potential instance migration.

## 4) pnpm and supply-chain attack protection (mandatory)

- Toolchain is pinned by `packageManager` in `package.json` (`pnpm@11.10.0+...` hash form).
- `pnpm-workspace.yaml` hardening controls remain enabled:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Required baseline for release and deployment safety:
  1. `corepack prepare pnpm@11.10.0 --activate`
  2. `pnpm install --frozen-lockfile`
  3. `pnpm audit --audit-level=high`
  4. `pnpm audit signatures`
  5. `pnpm security:check`
  6. `pnpm security:check:all`
- Incident/review mode:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`

## 5) Operational references

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `README.md`
- `SECURITY.md`

## 6) 2026-07-09 decision checkpoint

- `Next.js` is a good long-term fit for the productized frontend because it gives stronger maintainability for route composition, reusable UI, and accessibility structure than the current static client.
- This repository is still **not** a Next.js app in the active runtime; it remains `server.js` + static assets.
- Vercel is approved for the Next.js frontend only, after durable backend/state services are in place.
- `pnpm` is mandatory for all environments, with required hardening gates:
  1. `corepack enable`
  2. `corepack prepare pnpm@11.10.0 --activate`
  3. `pnpm install --frozen-lockfile`
  4. `pnpm audit --audit-level=high`
  5. `pnpm audit signatures`
  6. `pnpm security:check:all`
- Source alignment used for this checkpoint:
  - Next.js support and supported versions: https://nextjs.org/support-policy
  - Next.js installation (last updated March 3, 2026; latest version listed as 16.2.10): https://nextjs.org/docs/app/getting-started/installation
  - Vercel function lifecycle (new invocation per request, reuse instance, scale down to zero): https://vercel.com/docs/functions
  - pnpm audit and signatures + install freeze: https://pnpm.io/cli/audit, https://pnpm.io/cli/install
  - pnpm workspace controls (`minimumReleaseAge`, `minimumReleaseAgeStrict`, `trustPolicy`, `blockExoticSubdeps`): https://pnpm.io/settings
