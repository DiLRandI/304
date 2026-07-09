# Product-Grade Platform Decision Record: Next.js, Vercel, and pnpm

**Date:** 2026-07-09  
**Decision status:** Approved migration direction with explicit product-grade gates  
**Project posture:** production-oriented web game (not a Next.js application today)

## 1) Current stack reality

- Active runtime is still `server.js` plus static client assets.
- Gameplay state is currently in long-running Node process memory.
- This repository is **not** a Next.js application in production today.
- Next.js remains the approved phase-2 frontend modernization direction.

## 2) Framework decision: Next.js (approved for phase-2)

- Next.js remains the approved product direction for the frontend because it enables:
  - Component- and route-level composition.
  - Route Handlers/API-style endpoints in one app model.
  - Modern deployment and rendering capabilities for product UX work.
- Official Next.js support guidance is to run production on latest Active LTS or Maintenance LTS (not canary).
- Migration is only allowed once backend contracts are explicit and durable.

## 3) Hosting decision: Vercel (approved for frontend phase)

- Vercel is approved for the Next.js frontend once the above separation exists.
- Vercel on Next.js brings automatic build detection and deployment with preview + production flows.
- Vercel function execution is request-based and is documented as scaling to zero when not in use, then scaling with traffic.
- Vercel functions are also archived when inactive (for a bounded time by deployment type), which reinforces that process memory is not durable.
- Therefore, gameplay state ownership must move out of process memory before we move the active game loop to Vercel-only hosting.
- Required target architecture: durable state layer (Redis/PostgreSQL or similar) plus explicit API/service boundary.

## 4) Tooling and supply-chain security: pnpm (mandatory)

- `pnpm` is mandatory for dependency operations in this repository.
- `packageManager` is pinned in `package.json` (`pnpm@11.10.0+sha...`), and Corepack is used to enforce exact toolchain versions.
- `pnpm-workspace.yaml` currently sets:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Required security gates:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- Review incident mode:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`

## 5) Merge/release hardening sequence

1. `pnpm install --frozen-lockfile`
2. `pnpm audit --audit-level=high`
3. `pnpm audit signatures`
4. `pnpm security:check`
5. `pnpm security:check:all`

## 6) Official references

- Next.js support policy: https://nextjs.org/support-policy  
- Next.js on Vercel: https://vercel.com/docs/frameworks/full-stack/nextjs  
- Next.js + Vercel hosting and preview/production workflow: https://nextjs.org/learn/pages-router/deploying-nextjs-app-platform-details  
- Vercel Git deployment model: https://vercel.com/docs/git  
- Vercel deployment workflow: https://vercel.com/docs/deployments/overview  
- Vercel function duration/limits: https://vercel.com/docs/functions/configuring-functions/duration  
- Vercel function runtime model (archiving / scaling characteristics): https://vercel.com/docs/functions/runtimes  
- pnpm install: https://pnpm.io/cli/install  
- pnpm audit (`signatures`): https://pnpm.io/cli/audit  
- Node.js packageManager field: https://nodejs.org/download/release/v20.18.0/docs/api/packages.html  
- Corepack: https://nodejs.org/download/release/v20.18.0/docs/api/corepack.html

## 7) Canonical local follow-up

- This record is the current product-grade summary for architectural decisions in:
  - `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`
  - `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
  - `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
  - `docs/technical/19_NEXTJS_VERCEL_AND_PNPM_DECISION_RECORD.md`
  - `docs/technical/20_NEXTJS_VERCEL_PNPM_DECISION_ADDENDUM.md`
  - `docs/technical/21_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
  - `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
  - `docs/technical/23_PRODUCT_GRADE_PLATFORM_DECISION_RECORD.md`
  - `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
  - `docs/technical/25_PRODUCT_GRADE_NEXTJS_VERCEL_PNPM_DECISION_REFRESH_2026-07-09.md`
