# Product-Grade Decision Record: Next.js, Vercel, and pnpm

**Date:** 2026-07-09  
**Status:** approved for next product phase, not yet migrated

## Decision summary

- This repository is **not** a Next.js application in the current production baseline.
- The active runtime remains a custom Node.js static+API server (`server.js`, `index.html`, `src/ui`).
- For the next product phase, Next.js is the approved frontend platform.
- Vercel is approved as the hosting target for that Next.js frontend.
- `pnpm` is mandatory for dependency install, release preparation, and supply-chain checks.

## Why this matters for a product-grade web game

- Next.js gives a stronger route and component structure for lobby, table, and score screens as the game grows.
- It improves long-term accessibility and UI composition work with minimal breakage in gameplay contracts.
- The migration reduces future UI debt while preserving the current backend gameplay logic behind stable APIs.

## Hosting posture and guardrails

- Vercel is for **frontend deployment** in the migration phase, not for process-local authoritative gameplay state.
- Gameplay/session state must be durable and externalized before any Vercel-only gameplay hosting.
- Hard gates before Vercel front-end cutover:
  - No in-memory room/session authority in deployment-critical paths.
  - Long-lived backend service for actions, room lifecycle, presence, and reconnect.
  - Shared storage (e.g., Redis/Postgres) for any state that must survive instance rotation.
  - Verified frontend/backend API contract tests.

## Supply-chain and security posture with pnpm

- Repository is pinned to `pnpm@11.10.0` in `package.json`.
- `pnpm-lock.yaml` is required and reviewed on dependency updates.
- Workspace policy controls are enabled in `pnpm-workspace.yaml`:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Mandatory release chain for dependency safety:
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check:all`
- Incident or high-risk review mode:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`

## Operational install baseline

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
```

## Sources and current references

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/32_PRODUCT_DECISION_EXECUTIVE_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`
- Official references used:
  - Next.js support policy: <https://nextjs.org/support-policy>
  - Next.js docs (installation/version references): <https://nextjs.org/docs/app/getting-started/installation>
  - Vercel Functions lifecycle: <https://vercel.com/docs/functions>
  - pnpm audit/signatures: <https://pnpm.io/cli/audit>
