# Product Decision Refresh: Next.js, Vercel, and pnpm (Supply-Chain Protected)

**Date:** 2026-07-09  
**Type:** Platform decision update (authoritative for migration planning)

## 1) Decision

- This repository is **not** a Next.js application today. The active baseline is a production-oriented Node.js server (`server.js`) with a static client (`index.html`, `styles.css`, `src/ui`).
- **Next.js is approved** as the next frontend platform for this game product.
- **Vercel is approved** as the target host for the Next.js phase.
- **pnpm is mandatory** for all installs and release workflows to reduce supply-chain risk and preserve reproducibility.

## 2) Why this is a product direction (not a prototype choice)

- Next.js gives the team componentized UI boundaries for lobby, match, and scoring views.
- It improves route-level composition and accessibility growth without changing gameplay authority.
- The existing API endpoints and authoritative engine behavior in this repository make migration lower risk than a rewrite.

## 3) Vercel hosting posture and hard guardrails

- Vercel is approved as the Next.js frontend host once gameplay state is moved off process-local memory.
- This project currently keeps room/session/bot state in the Node process, which is not suitable as a single source of truth on serverless request instances.
- Migration can only proceed to a Vercel-first frontend when:
  1. room lifecycle, room sessions, and presence are externalized to durable storage/API services;
  2. API contracts are stable and versioned;
  3. stateful gameplay state is not owned by request-bound runtime memory.

## 4) pnpm and supply-chain attack protections (mandatory)

Repository-level controls already align with hardened installs:

- `packageManager` is pinned in `package.json` to:
  - `pnpm@11.10.0+sha512...`
- `pnpm-workspace.yaml` currently sets:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`

Required install and release commands:

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
pnpm security:check:all
```

Incident / review profile:

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

Threat mapping:

- Fresh dependency churn risk -> `minimumReleaseAge: 1440` and review cadence.
- Trust downgrades -> `trustPolicy: no-downgrade`.
- Exotic source-chain risk (`file:`, git URLs, tarballs) -> `blockExoticSubdeps: true`.
- Hidden tampering/reproducibility risk -> frozen lockfile + audit/signature checks.

## 5) Current status

- `pnpm` is installed and active in this environment (`pnpm --version` returns `11.10.0`).
- Product baseline is unchanged for now; migration is the planned phase-2 path.
- This document is the operational decision record for the stack, host, and dependency-security direction.

## 6) Source material

- Next.js support policy: https://nextjs.org/support-policy  
- Next.js installation requirements: https://nextjs.org/docs/app/getting-started/installation  
- Next.js version-16 migration guidance: https://nextjs.org/docs/app/guides/upgrading/version-16  
- Next.js/Node baseline references: https://nextjs.org/docs/pages/getting-started/installation  
- Vercel functions lifecycle: https://vercel.com/docs/functions  
- Vercel function model and runtimes: https://vercel.com/docs/functions/runtimes  
- Vercel framework integration for Next.js: https://vercel.com/docs/frameworks/full-stack/nextjs  
- pnpm commands and audit: https://pnpm.io/cli/install, https://pnpm.io/cli/audit  
- pnpm workspace settings: https://pnpm.io/settings
