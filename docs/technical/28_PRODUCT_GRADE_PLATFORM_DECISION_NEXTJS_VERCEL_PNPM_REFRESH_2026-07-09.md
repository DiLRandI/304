# Product-Grade Platform Decision (Next.js + Vercel + pnpm)

**Date:** 2026-07-09  
**Status:** Decision approved; runtime is still Node.js + static client in active baseline

## 1) Is this a Next.js app today?

No. The active production stack is a custom Node.js server (`server.js`) with a static web client (`index.html`, `styles.css`, `src/`).

## 2) Platform decision

- Next.js is the approved next frontend platform for this game product.
- Vercel is the approved host target for the Next.js phase.
- pnpm is mandatory in development, CI, and release workflows.
- Full gameplay state and room/session ownership must move to durable backend services before gameplay host migration to Vercel.

## 3) Why Next.js is the right product direction

- Productized UI growth (reusable components, route-level composition, richer accessibility patterns) is a cleaner fit in Next.js than the current static client.
- The existing server-authoritative API contract reduces migration risk for a phased rewrite.
- Next.js official guidance recommends production deployments on active or maintenance LTS, which aligns with a managed upgrade lane.

## 4) Why Vercel is approved (with guardrails)

- Vercel is the native deployment platform for Next.js with first-class build/preview/deploy flow.
- Request model is request-invocation-driven with instance reuse where possible, and scaling toward zero when idle.
- Vercel can host API routes and frontend rendering well, but long-lived room/session memory state must stay in durable services during migration.
- Realtime gameplay behavior and matchmaking flow should be validated on load tests before full cutover.

## 5) pnpm and supply-chain protections (mandatory)

- `packageManager` is pinned in `package.json` to `pnpm@11.10.0+sha512...`.
- `pnpm-workspace.yaml` is configured with hardening controls:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Required install/release gates:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check:all`
- Incident/review mode:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`

## 6) Current status and next action

- This repository is **product-ready for this phase** as a Node.js + static service.
- Next major infrastructure decision now is to begin Next.js migration only after durable state services are in place, then execute staged Vercel cutover with preview-first release gates.

## 7) Reference documents

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`
- `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `SECURITY.md`
- `README.md`

## 8) Latest external references used

- Next.js support policy and LTS guidance: https://nextjs.org/support-policy
- Next.js 16 upgrade guidance (last updated May 13, 2026): https://nextjs.org/docs/app/guides/upgrading/version-16
- Vercel Functions lifecycle and scaling model: https://vercel.com/docs/functions
- pnpm audit + signatures and minimum-release-age behavior: https://pnpm.io/cli/audit
- pnpm install lockfile behavior: https://pnpm.io/cli/install
- pnpm workspace security settings: https://pnpm.io/settings
