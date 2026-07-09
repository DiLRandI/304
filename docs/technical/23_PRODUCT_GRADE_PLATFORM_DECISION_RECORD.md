# Product-Grade Platform Decision Record: Next.js + Vercel + pnpm

**Date:** 2026-07-09  
**Status:** Approved direction (phase-gated)

## 1) Current stack reality

- This repository is currently a **production-grade custom Node.js + static client** implementation (`server.js` + `index.html`/`src/ui`).
- The active deployment posture is a **single process web service** with server-authoritative gameplay/state endpoints.
- The codebase is not a Next.js app today. Next.js is the planned frontend modernization phase for this game.

## 2) Framework decision

- Next.js is approved as the next frontend platform.
- Rationale for this game:
  - Better route/state composition for lobby, table, score, and accessibility surfaces.
  - Easier component-driven UX for longer-term product evolution.
  - Clearer API contract boundaries between UI and authoritative gameplay services.
- Decision class: **not a prototype or toy approach**; this is the chosen productization track.

## 3) Hosting decision

- Vercel is approved as the frontend host for the Next.js phase.
- Why Vercel now:
  - Strong Next.js deployment ergonomics.
  - PR preview and global delivery model suitable for SPA/SSR frontend rollout.
- Hard gate:
  - Room/session/gameplay state must be moved to durable services before any Vercel-only direct game hosting.
  - State must not depend on request-local process memory.

## 4) Supply-chain security and `pnpm` decision

- `pnpm` is mandatory for all installs, CI, and release workflows.
- Security posture is based on reproducibility and provenance checks:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- Mandatory workspace controls in `pnpm-workspace.yaml`:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Supply-chain attack protection mapping:
  - Fresh package risk → `minimumReleaseAge` + review workflow.
  - Trust rollback risk → `trustPolicy: no-downgrade`.
  - Unknown transitive source risk → `blockExoticSubdeps`.
  - Malicious dependency updates → audit + signatures + frozen lockfile gates.

## 5) Migration condition set (go-live criteria for phase-2)

1. Baseline game parity is stable in the current Node stack:
   - room create/join
   - seating + bot fill
   - bidding/trump
   - trick play and hidden information projection
   - scoring and match end
   - reconnect/autopilot behavior
2. Durable backend services are explicit for room/session state.
3. Security gates remain green:
   - dependency checks passing
   - no high-risk unresolved audit findings
   - lockfile review complete
4. Frontend/backend contracts are versioned and migration-tested.

## 6) Canonical references

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/19_NEXTJS_VERCEL_AND_PNPM_DECISION_RECORD.md`
- `docs/technical/20_NEXTJS_VERCEL_PNPM_DECISION_ADDENDUM.md`
- `docs/technical/21_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/22_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/25_PRODUCT_GRADE_NEXTJS_VERCEL_PNPM_DECISION_REFRESH_2026-07-09.md`
