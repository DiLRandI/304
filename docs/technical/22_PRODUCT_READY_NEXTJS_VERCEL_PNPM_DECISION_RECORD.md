# Product-Ready Stack Decision Record: Next.js, Vercel, and pnpm

**Date:** 2026-07-09  
**Status:** Approved direction, pre-migration

## 0) Verified external constraints used for this decision (as of 2026-07-09)

- Next.js support policy is currently:
  - `16.x` is Active LTS
  - `15.x` is Maintenance LTS
- Next.js install docs list minimum Node.js `20.9`.
- Vercel Functions documentation confirms request-based invocations and scale-to-zero when idle.
- pnpm docs (11.x) confirm `pnpm audit signatures` and `minimumReleaseAge`/`trustPolicy`/`blockExoticSubdeps` controls in workspace settings.
- Current lockfile policy in this repository already includes:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`

## 1) Scope

- Current production baseline remains a production-oriented custom Node.js server with a static client.
- The next platform phase for this project is a **Next.js** frontend track, hosted on **Vercel**.
- `pnpm` is mandatory for all installs, CI jobs, and release operations.

## 2) Decision summary

- **Framework decision:** Next.js is approved as the next frontend platform for this game.
- **Hosting decision:** Vercel is approved as the frontend host for the Next.js phase only.
- **Toolchain decision:** pnpm is mandatory for reproducible installs and supply-chain hardening.
- **Current state:** this repository is **not** a Next.js app today.
- Next.js is the right product direction because this is a **product-grade web game**, and React composition improves route clarity, lobby/game state UX, and accessibility for a longer maintenance horizon.

## 3) Why this decision is aligned to a product-ready rollout

- Keeps the active baseline stable while giving a clear migration path for componentized UI, route ownership, and accessibility.
- Preserves gameplay correctness by keeping authoritative room/session state out of a request-only runtime until externalized.
- Supports gradual migration through explicit API contracts between frontend and gameplay services.
- Enforces a staged rollout with minimal downtime risk:
  - keep live Node.js baseline stable,
  - move only UI surface to Next.js when backend boundaries are hardened,
  - keep gameplay authority in a durable API/service boundary for Vercel.

## 4) Vercel migration guardrails

Vercel is approved for frontend deployment only when these hard gates are met:

- No process-local authority for room lifecycle, active sessions, or live game state.
- Long-lived authoritative backend service in place for gameplay/state progression (e.g. Redis/PostgreSQL/API service).
- Frontend and backend API contracts are versioned and validated.
- WebSocket/Realtime behavior is designed for instance hopping or uses managed backend transport.

## 5) pnpm and supply-chain attack protection (mandatory)

- Keep `pnpm-lock.yaml` committed and reviewed for every dependency change.
- Pin toolchain via `corepack prepare pnpm@11.10.0 --activate`.
- Mandatory release checks:
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`
- Incident-review mode:
  - `pnpm install --ignore-scripts --frozen-lockfile`
  - `pnpm audit --audit-level=high`
- `pnpm-workspace.yaml` and repository policy must keep install and provenance checks enabled.

### 5.1) Threat-model mapping

- `pnpm-lock.yaml` diff review blocks hidden transitive supply-chain changes.
- `minimumReleaseAge` delays risky fresh packages on dependency refreshes.
- `minimumReleaseAgeStrict` prevents silent fallback to unvetted versions.
- `trustPolicy: no-downgrade` blocks trust-level regression in package publication history.
- `blockExoticSubdeps` reduces non-registry dependency injection paths.
- `pnpm audit signatures` verifies package signatures where available before release.

## 6) Cross-document references

- `README.md` (deployment and migration overview)
- `SECURITY.md` (supply-chain policy and CI hardening)
- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/18_PLATFORM_DECISION_BRIEF.md`
- `docs/technical/19_NEXTJS_VERCEL_AND_PNPM_DECISION_RECORD.md`
- `docs/technical/20_NEXTJS_VERCEL_PNPM_DECISION_ADDENDUM.md`
- `docs/technical/21_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
- `docs/technical/23_PRODUCT_GRADE_PLATFORM_DECISION_RECORD.md`

## 7) Official references used

- Next.js support policy: https://nextjs.org/support-policy
- Next.js installation requirements: https://nextjs.org/docs/pages/getting-started/installation
- Vercel Functions behavior: https://vercel.com/docs/functions
- pnpm audit: https://pnpm.io/cli/audit
- pnpm settings: https://pnpm.io/settings
