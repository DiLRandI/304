# Product Decision Memo: Next.js, Vercel, and pnpm Guardrails

**Date:** 2026-07-09  
**Status:** Approved roadmap direction, not yet active runtime

## 1) Decision (product scope)

- This repository’s active production runtime is a Node.js + static client application (`server.js` + `index.html` + `src/ui`).
- We **do not** have Next.js runtime today.
- Next.js is approved as the next frontend platform for this project line.
- Vercel is approved as the host for that Next.js frontend, with backend state externalization as a gate.
- pnpm is mandatory for dependency operations and release security controls.

## 2) Why Next.js is a good fit

- Next.js is the right next phase because the game is becoming a productized web app with:
  - higher-complexity UI state,
  - reusable component architecture needs,
  - stronger route-level composition and accessibility polish.
- It is preferred for this project once long-lived game services are separated and consumed via clean API contracts.

## 3) Vercel hosting condition

- Vercel Functions are invoked per request and can scale to zero when idle, so stateful gameplay logic cannot live in invocation-local memory.
- For this game architecture, Next.js on Vercel is approved only after:
  - room/session/bot/game state is moved to durable services (Redis/Postgres/API),
  - frontend and backend contract versioning is enforced,
  - state continuity and replay handling are covered by storage-driven flow.

Required migration shape:

1. Frontend (`apps/web`): Next.js, Vercel deployment.
2. Backend (`apps/server`): authoritative room/actions/bots.
3. Shared contracts: API schema between frontend and backend.

## 4) pnpm supply-chain hardening baseline

- This repo uses pnpm in `packageManager` and `pnpm-lock.yaml`.
- Required install/release controls:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- Required workspace policy (already set):
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`

## 5) Current status and sources

- Current baseline: not on Next.js, Vercel migration deferred until durable state boundary is in place.
- Decision references:
  - `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
  - `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
  - `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
- Latest platform references used to validate this memo:
  - Next.js support policy and LTS guidance: https://nextjs.org/support-policy
  - Vercel Functions lifecycle and scale behavior: https://vercel.com/docs/functions
  - Next.js deployment and hosting details: https://nextjs.org/docs/app/getting-started/deploying
  - pnpm supply-chain command docs: https://pnpm.io/cli/audit and https://pnpm.io/cli/install
  - pnpm workspace hardening keys: https://pnpm.io/settings
