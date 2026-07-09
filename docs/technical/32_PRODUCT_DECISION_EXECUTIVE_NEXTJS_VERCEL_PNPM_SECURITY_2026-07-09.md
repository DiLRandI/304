# Executive Addendum: Next.js, Vercel, and pnpm Supply-Chain Security Decision

**Date:** 2026-07-09  
**Status:** Product-ready decision package aligned for phase-2 planning  
**Owner:** product + engineering  

## 1) Decision record (single source summary)

- This repository is **not** a Next.js application in its active runtime.
- The current runtime is a production-oriented Node.js server (`server.js`) + static web client.
- Next.js is approved for the next frontend platform phase (UI modernization and multi-screen expansion).
- Vercel is approved for hosting that Next.js frontend **after** durable gameplay state migration.
- `pnpm` is mandatory for dependency and release security across local, CI, and release flows.

## 2) Why this direction is product fit

- Next.js gives safer long-term UI growth for game surfaces (lobby/table/score/accessibility screens) through component composition and route/state boundaries.
- Vercel is the primary deployment target for this Next.js phase to leverage preview/build/prod delivery patterns.
- Keeping this as a two-stage migration protects current gameplay stability while improving maintainability and release quality later.

## 3) Security and supply-chain controls tied to this decision

- `pnpm-workspace.yaml` policy required in this migration track:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Release and deployment gates:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- Incident/review posture:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`
- Attack-surface mapping:
  - fast package replacement risk → `minimumReleaseAge` + `minimumReleaseAgeStrict`
  - trust rollback risk → `trustPolicy: no-downgrade`
  - non-registry/transitive source risk → `blockExoticSubdeps`
  - tampered dependency graph risk → lockfile review + frozen install + audit checks

## 4) Vercel migration guardrail

- Do not host live gameplay state on Vercel request functions unless all room/session/game actions are externalized to durable services.
- Keep authoritative room lifecycle, bot scheduling, and match progression in a long-lived backend service (e.g., Redis/PostgreSQL/API service) during transition.
- Preserve versioned contracts between frontend and backend before and during cutover.

## 5) Canonical references

- `README.md` (stakeholder and runbook alignment)
- `SECURITY.md`
- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`
- `docs/technical/31_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_2026-07-09.md`
