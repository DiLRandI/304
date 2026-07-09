# Product-Ready Stack Decision Record: Next.js, Vercel, and pnpm

**Date:** 2026-07-09  
**Status:** approved direction, not yet migrated

## 1) Current production posture

- This repository is currently a production-oriented custom Node.js server with a static client (`server.js` + `index.html` + `src/ui`).
- The game is **not** a Next.js app in the active production baseline.
- Next.js migration is approved as the next platform phase for product growth, not a prototype refactor.
- The current frontend runtime is production-oriented and intentionally retained for this baseline until migration gates are met.

## 2) Decision summary

- **Framework:** Next.js is approved as the frontend platform for the next major track.
- **Hosting:** Vercel is approved as the frontend host once stateful gameplay is moved to durable services.
- **Toolchain:** pnpm is mandatory for all install and release operations.
- **Reasoning:** Next.js improves componentized UI, route structure, and accessibility polish; Vercel is the intended frontend target for this Next.js track; pnpm adds reproducibility plus supply-chain controls.

## 3) Why Next.js is a good fit for this game

- Better decomposition for lobby + table + score components.
- Cleaner handling of accessibility and future interactive UI states.
- Strong path for separating API client and UI state from gameplay authority.
- Easy future split into `apps/web` and `apps/server` with shared contracts.

## 4) Why Vercel is approved for frontend hosting

- Vercel Functions are request-invocation based and scale to zero when idle, then reuse instances under load for subsequent requests.
- That model is good for stateless frontend/API surfaces, but does not replace durable, in-memory room state for live rooms.
- Migration to Vercel must happen only when:
  - room lifecycle and session state are externalized,
  - game authority and bot execution are in a long-lived backend service,
  - room presence and progress are persisted in shared storage.

## 5) Why pnpm for supply-chain security

- `package.json` already pins:
  - `packageManager: "pnpm@11.10.0+..."`
- `pnpm-workspace.yaml` already includes:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Required install/release sequence:
  1. `corepack enable`
  2. `corepack prepare pnpm@11.10.0 --activate`
  3. `pnpm install --frozen-lockfile`
  4. `pnpm audit --audit-level=high`
  5. `pnpm audit signatures`
- Full hardening profile before release:
  - `pnpm security:check:all`
- Minimum required dependency hygiene checks:
  - `pnpm audit`
  - `pnpm audit signatures`
- Incident/review install profile:
  - `pnpm install --ignore-scripts --frozen-lockfile`

## 6) Release gates for migration phase

1. Keep current Node.js baseline stable at feature parity for:
   - create/join flow, seat replacement, bot fill, bidding/trump/trick/scoring, reconnect.
2. Split backend so no gameplay state depends on a single request lifecycle.
3. Cut over Next.js UI on Vercel behind:
   - API compatibility tests,
   - audit/signature success,
   - lockfile review approval.

## 7) Canonical references

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/19_NEXTJS_VERCEL_AND_PNPM_DECISION_RECORD.md`
- `docs/technical/20_NEXTJS_VERCEL_PNPM_DECISION_ADDENDUM.md`

## 8) Latest official references used for this decision

- Next.js support policy and LTS guidance: https://nextjs.org/support-policy (checked 2026-07-09)
- Next.js installation requirements (minimum Node.js for current line): https://nextjs.org/docs/app/getting-started/installation
- Vercel Functions lifecycle and scaling model: https://vercel.com/docs/functions
- pnpm workspace settings: https://pnpm.io/settings
- pnpm audit and signatures: https://pnpm.io/cli/audit
