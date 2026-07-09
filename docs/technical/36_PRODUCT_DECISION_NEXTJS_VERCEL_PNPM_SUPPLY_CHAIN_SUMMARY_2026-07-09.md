# Product Decision Summary: Next.js, Vercel, and pnpm Supply-Chain Protection (2026-07-09)

## Decision snapshot

- Current shipping runtime in this repository is a custom Node.js + static client (`server.js` + `index.html` + `src/ui/*`).
- Next.js is the approved next frontend platform for this product.
- Vercel is the approved hosting target for the Next.js phase.
- pnpm is mandatory for package-management and release security.

## Why Next.js is still the right move

- Production guidance for this game is now product-grade and front-end heavy (lobby, game-state views, audit/replay tooling, future analytics surfaces).
- Next.js provides:
  - stable App Router ergonomics,
  - route-level composition,
  - stronger long-term UI maintainability for accessibility and growth.
- Latest Next.js documentation explicitly recommends production traffic on the latest Active or Maintenance LTS releases.
  - Current policy page shows `16.x` as Active LTS and `15.x` as Maintenance LTS as of 2026-07-09.

## Vercel hosting posture

- Host Next.js frontend on Vercel once room/session/auth/game-state ownership is moved to durable services.
- This repo remains stateful in-process today, which is not a safe state model for Vercel request lifecycle semantics.
- Vercel function constraints to account for:
  - request invocation max duration limits,
  - body size limits for request/response,
  - function execution limits under Fluid compute.

## pnpm and supply-chain hardening policy

- `pnpm-workspace.yaml` is the control file for install policy:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- `packageManager` in `package.json` is pinned to `pnpm@11.10.0`.
- Mandatory pre-release checks:

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
pnpm security:check:all
```

## Evidence-backed source references (official docs)

- Next.js support policy: https://nextjs.org/support-policy
- Next.js installation docs: https://nextjs.org/docs/app/getting-started/installation
- Vercel Next.js hosting: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel function limits: https://vercel.com/docs/functions/limitations
- pnpm audit command family: https://pnpm.io/cli/audit
- pnpm workspace settings: https://pnpm.io/settings

## Canonical links for this decision lineage

- `docs/technical/35_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`
- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
- `README.md` (Product-ready platform decision section)
- `SECURITY.md`
