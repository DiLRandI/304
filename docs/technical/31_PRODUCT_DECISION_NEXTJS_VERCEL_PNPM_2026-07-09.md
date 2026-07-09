# Product Decision Record: Next.js Frontend Track, Vercel Hosting, and pnpm Supply-Chain Controls

**Date:** 2026-07-09  
**Decision owner:** product + engineering  
**Current runtime:** production-oriented Node.js + static client (`server.js`, `index.html`, `src/ui`)  
**Decision status:** approved for product phase 2; current release remains non-Next.js

## 1) Current stack position

- This repository is **not yet a Next.js application** in production runtime.
- The active baseline is a custom long-running Node.js server (`server.js`) with a static web client.
- This is intended as a **product-ready baseline**, not a toy or prototype.
- Next.js is the approved next frontend platform track for phase 2.

## 2) Next.js decision (approved)

- We will migrate the frontend to Next.js in the next product phase.
- Rationale:
  - stronger composition model for reusable game UI surfaces,
  - cleaner route/state boundaries,
  - better long-term accessibility and growth for multi-screen product features.
- The migration is planned only after feature parity is stable and state boundaries are explicit.

## 3) Vercel hosting decision (approved for Next.js phase)

- Vercel is approved as the target host for the Next.js frontend.
- Vercel Functions create a function invocation per request, reuse instances when possible, and scale down when idle; this is **not compatible with in-memory room/state authority** for multiplayer sessions.
- Before direct Vercel gameplay hosting:
  - move room/session/action ownership to durable storage/services (Redis/PostgreSQL + API layer),
  - keep authoritative state external to individual function invocations,
  - preserve contract-driven frontend/backend ownership and API versioning.
- Backend state move is mandatory before cutover.

## 4) `pnpm` decision and supply-chain security posture (mandatory)

- `pnpm` is mandatory for install/release workflows.
- `package.json` pins `packageManager` to:
  - `pnpm@11.10.0+sha512...`
- `pnpm-workspace.yaml` policy controls:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- This minimizes exposure to rushed dependency compromises by delaying installs and blocking trust regressions.

## 5) Required local/release commands

- `corepack enable`
- `corepack prepare pnpm@11.10.0 --activate`
- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level=high`
- `pnpm audit signatures`
- `pnpm security:check`
- `pnpm security:check:all`

Incident/review path:
- `pnpm install --ignore-scripts --frozen-lockfile`
- `pnpm audit --audit-level=high`

## 6) Decision references

- `README.md`
- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/23_PRODUCT_GRADE_PLATFORM_DECISION_RECORD.md`
- `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
- `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`
- `SECURITY.md`

## 7) Current official references used

- Next.js support policy: https://nextjs.org/support-policy  
- Next.js installation requirements: https://nextjs.org/docs/pages/getting-started/installation  
- Vercel Functions lifecycle: https://vercel.com/docs/functions  
- Next.js on Vercel: https://vercel.com/docs/frameworks/full-stack/nextjs  
- pnpm settings: https://pnpm.io/settings  
- pnpm install: https://pnpm.io/cli/install  
- pnpm audit: https://pnpm.io/cli/audit
