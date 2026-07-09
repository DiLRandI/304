# Product Decision Addendum (Latest): Next.js, Vercel and pnpm Supply-Chain Security

**Date:** 2026-07-09  
**Status:** Active decision for this milestone  
**Decision owner:** product engineering

## 0) What this decision covers

- Confirmed that the active codebase is **not** a Next.js application.
- Confirmed Next.js as the next frontend platform for product growth.
- Confirmed Vercel as the approved host target for the Next.js phase.
- Confirmed pnpm as mandatory for dependency and release security.

## 1) Is this a Next.js app today?

- No, the repository is still a custom Node.js + static frontend product baseline:
  - `server.js`
  - `index.html`, `styles.css`
  - `src/engine/*`
  - `src/ui/*`
- The stack is production-oriented and stable, but not yet migrated to Next.js.

## 2) Why Next.js is a good fit for this product-grade web game

- It gives long-term UI maintainability via route boundaries and component composition.
- It improves onboarding for accessibility, testing, and UI evolution (game lobby, table, score, and analytics views).
- It fits the current API-first gameplay engine without forcing a gameplay rewrite.

## 3) Vercel hosting posture for migration

- Vercel is approved for **Next.js frontend hosting only** in phase-2.
- This project currently stores room/session/bot state in process memory, which is not a suitable single source of truth for request-based runtimes.
- Hard gate before Vercel gameplay or mixed hosting:
  - externalize game state ownership to durable backend storage/services;
  - make API contracts versioned and contract-first;
  - design realtime paths for instance migration.

## 4) pnpm and supply-chain attack protection (mandatory)

### Required repo policy

- `packageManager` in `package.json` is pinned to `pnpm@11.10.0+sha512...`.
- `pnpm-workspace.yaml` must keep:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
trustPolicy: no-downgrade
blockExoticSubdeps: true
```

### Mandatory security commands

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
pnpm security:check:all
```

### Incident/review profile

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

### Control mapping

- `minimumReleaseAge` + `minimumReleaseAgeStrict`: reduces risk from newly published packages.
- `trustPolicy: no-downgrade`: prevents trust regressions.
- `blockExoticSubdeps: true`: blocks risky non-standard subdependency resolution.
- `pnpm-lock.yaml` + frozen install: ensures reproducible resolution.
- `pnpm audit` + signatures: catches known vulnerabilities and checks package provenance where available.

## 5) Source references

- Next.js support policy: https://nextjs.org/support-policy
- Next.js installation docs: https://nextjs.org/docs/app/getting-started/installation
- Vercel functions model: https://vercel.com/docs/functions
- Vercel Next.js hosting: https://vercel.com/docs/frameworks/full-stack/nextjs
- pnpm command + workspace settings: https://pnpm.io/cli/install and https://pnpm.io/cli/audit

## 6) Related decision records

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
- `docs/technical/29_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_REFRESH_2026-07-09.md`

