# Product-Grade Migration Refresh: Next.js, Vercel, and pnpm

**Date:** 2026-07-09  
**Status:** Approved migration direction with production-readiness gates  
**Decision owner:** product engineering

## 1) Current stack check (direct)

- This repository is **not** a Next.js application today.
- The deployed runtime is a custom Node.js server (`server.js`) plus static client (`index.html`, `src/ui`, `src/engine`).
- Next.js is the selected front-end direction for the next platform phase, with Vercel as the target host and `pnpm` as the required package manager.

## 2) Is Next.js a good fit?

Yes. Next.js is a good fit for this product-grade web game because the next phase requires:

- Structured route boundaries for lobby, match, and scoring screens.
- Better long-term UI composition and accessibility evolution.
- Reduced coupling between frontend and gameplay/API contracts during migration.
- Better migration compatibility with a long-running API backend through typed, contract-first data fetching patterns.

## 3) Latest official platform posture and timing (as observed)

- Next.js Support Policy:
  - `16.x` is **Active LTS**.
  - `15.x` is **Maintenance LTS**.
  - Canary releases remain for experimentation; production guidance is to use latest Active or Maintenance LTS.
- Next.js installation requirements currently list **Node.js 20.9+** minimum.
- App Router installation guide (official docs, updated March 16, 2026) uses `pnpm create next-app@latest` and same Node.js baseline.
- Next.js deploying docs emphasize explicit build/start scripts and that all Next.js features are available on Node.js server deployment.

## 4) Vercel hosting decision for Next.js phase

- Vercel is approved for Next.js hosting.
- Rationale:
  - Next.js deploys are treated as first-class on Vercel with Git integration and preview URL workflows.
  - Vercel Functions are request-based and optimized for scale-to-zero, with warm instance reuse on burst traffic.
  - This project remains unsuitable for “Vercel-only gameplay hosting” until all authoritative room/session state is outside the in-memory process.
- Practical migration note: any realtime session/room state must be moved to durable storage before hosting frontend gameplay UI on request-based Vercel functions.

## 5) Supply-chain and hardening posture with `pnpm` (mandatory)

`pnpm` is mandatory for this project’s install and release flows.

- Mandatory lock/version controls already required in repository:
  - `pnpm-lock.yaml` is present and reviewed.
  - `pnpm-workspace.yaml`:
    - `minimumReleaseAge: 1440`
    - `minimumReleaseAgeStrict: true`
    - `trustPolicy: no-downgrade`
    - `blockExoticSubdeps: true`
- `packageManager` in `package.json` is pinned to `pnpm@11.10.0`.
- Toolchain command set (baseline):
  - `corepack enable` (if corepack not already active)
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm --version` (verifies runtime toolchain)
  - `pnpm install --frozen-lockfile` (required for reproducible builds)
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
- Higher bar for release branch/production:
  - `pnpm security:check`
  - `pnpm security:check:all`
- Incident-response install profile:
  - `pnpm install --ignore-scripts --frozen-lockfile`

## 6) Threat mapping and guardrails

- `minimumReleaseAge` + `minimumReleaseAgeStrict`: reduces blast radius of newly published suspicious releases.
- `trustPolicy: no-downgrade`: blocks trust regressions in package publish metadata.
- `blockExoticSubdeps`: prevents transitive dependencies from resolving from untrusted exotic sources.
- `pnpm audit signatures`: verifies registry signatures and exits non-zero for invalid/missing signatures when signatures are published.
- Audit + frozen lockfile checks enforce reproducibility and controlled upgrade behavior.

## 7) Migration gates for product rollout

1. Frontend migration to Next.js is implemented behind existing API contracts.
2. Durable backend state service is in place (no critical room/session state in request-scoped serverless instances).
3. CI/CD gates include reproducible installs and mandatory `pnpm` security checks.
4. Accessibility and gameplay parity are maintained during migration.
5. Vercel deployment configuration uses separate frontend/backend ownership and environment variable policy.

## 8) References

- Next.js support policy: https://nextjs.org/support-policy
- Next.js installation requirements: https://nextjs.org/docs/pages/getting-started/installation
- Next.js App Router installation (official): https://nextjs.org/docs/app/getting-started/installation
- Next.js upgrade and runtime docs:
  - https://nextjs.org/docs/app/guides/upgrading/version-16
  - https://nextjs.org/docs/app/guides/upgrading/version-15
- Next.js releases and deployment references:
  - https://nextjs.org/docs/app/getting-started/deploying
  - https://nextjs.org/docs/app/getting-started
- Next.js package versions:
  - https://www.npmjs.com/package/next?activeTab=versions
- Vercel + Next.js hosting:
  - https://vercel.com/docs/frameworks/full-stack/nextjs
  - https://vercel.com/frameworks/nextjs
  - https://vercel.com/docs/deployments
  - https://vercel.com/docs/cli/deploy
  - https://vercel.com/docs/services
- Vercel execution/runtime model:
  - https://vercel.com/docs/functions
- pnpm commands and supply-chain controls:
  - https://pnpm.io/cli/install
  - https://pnpm.io/cli/audit
  - https://pnpm.io/settings
  - https://pnpm.io/cli/install#--frozen-lockfile
