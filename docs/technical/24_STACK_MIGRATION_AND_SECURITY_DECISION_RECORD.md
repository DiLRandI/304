# Stack Migration & Security Decision Record

**Date:** 2026-07-09  
**Decision status:** approved for next product phase (not yet migrated in code)

## Decision summary

- Current production baseline remains `server.js` + static client and is **not** a Next.js application today.
- Next.js is approved as the next frontend platform for the 304 game.
- Vercel is approved as the target host for that Next.js frontend, with migration gated by backend state externalization.
- `pnpm` is mandatory for all environments and release workflows to support reproducible installs and supply-chain risk reduction.

## Why these choices were made

- Next.js was selected because this is a product-grade web game needing long-term UI maintainability: reusable components, route composition, and stronger accessibility patterns.
- Vercel is a good fit for a Next.js frontend deployment model once the gameplay authority is decoupled from request-local process memory.
- `pnpm` plus workspace policy checks reduce supply-chain exposure by enforcing:
  - reproducible dependency resolution (`pnpm-lock.yaml`),
  - lockfile review discipline,
  - package provenance and audit gates.

## Migration guardrails (required before Vercel-only gameplay hosting)

- Move room/session/bot state ownership to a durable backend service or shared store (`Redis`/`PostgreSQL` style durability).
- Keep frontend/backend APIs versioned and contract tested.
- Preserve authoritative engine logic outside any Vercel function-local process memory.
- Preserve WebSocket/realtime semantics for instance hopping when needed.

## Required package-manager/security posture

- Toolchain baseline:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
- Every release branch/build must run:
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
- Full pre-release hardening command:
  - `pnpm security:check:all`
- Incident/review install profile:
  - `pnpm install --ignore-scripts --frozen-lockfile`

## Source of record

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/19_NEXTJS_VERCEL_AND_PNPM_DECISION_RECORD.md`
- `docs/technical/20_NEXTJS_VERCEL_PNPM_DECISION_ADDENDUM.md`
- `docs/technical/21_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/23_PRODUCT_GRADE_PLATFORM_DECISION_RECORD.md`
