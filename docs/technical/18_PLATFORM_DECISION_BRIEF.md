# Platform and Supply-Chain Decision Brief

**Date:** 2026-07-08  
**Status:** approved for next product phase (not yet active in production architecture)

## 0) Decision snapshot (as of 2026-07-08)

- **Current production baseline:** custom Node.js server + static client + HTTP API.
- **Next.js decision:** approved as the target frontend stack for the next phase.
- **Vercel decision:** approved as the frontend host for that Next.js phase only after stateful logic is externalized.
- **pnpm decision:** mandatory package manager for reproducible installs and release-time integrity checks.

Latest reference points:

- Next.js 16.2 was published on **2026-03-18** (official Next.js blog). The active LTS line is 16.x as of this brief date.
- Vercel Functions documentation confirms request-by-request invocations, instance reuse under load, and scale-to-zero when idle.
- pnpm v11 documents `pnpm audit signatures`, `minimumReleaseAge`, `minimumReleaseAgeStrict`, `blockExoticSubdeps`, and `trustPolicy` for supply-chain hardening.

## 1) Framework direction

- Keep the current production baseline as the operational baseline today.
- Approve **Next.js** as the next frontend platform for component composition, route structure, and accessibility polish.
- Keep decisions explicit:
  - when this move happens,
  - what migration slice is in scope,
  - which state services are out of browser/runtime scope.

### Why not migrate immediately

- Current architecture is server-authoritative and intentionally simple for game-state determinism.
- In-memory room/session lifecycles and direct state projection are coupled to the existing single-process HTTP server model.
- Next.js migration now would add substantial replatforming overhead without first de-risking backend boundaries.
- Next.js is approved as a target, but the stateful services boundary must be explicit first.

## 2) Hosting direction

- Keep this repository as the single Node process baseline while using in-memory room/state lifecycle as-is.
- Approve Vercel for the future Next.js frontend once room and session state are moved into durable services.
- For Vercel-only deployment, split:
  - frontend rendering and browser assets (`apps/web`),
  - game authority, bot action orchestration, and session state (`apps/server` + Redis/PostgreSQL event/state layer).

### Vercel constraints that apply to this game

- Vercel states that request handling is function-invocation based.
- Functions can reuse instances but still require durable storage to preserve continuity across invocations.
- State should not rely on process memory, temporary globals, or request-local state for gameplay.
- Realtime behavior that requires sticky state must route through a durable layer and durable transport.

## 3) Package manager and supply-chain protection requirements

- Use **pnpm** for all local and release install flows.
- Required install baseline:
  - `corepack enable`
  - `corepack use pnpm@11.10.0`
  - `pnpm install --frozen-lockfile`
- Required release/security checks:
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check` (repo-level scripted alias)
  - `pnpm security:check:all` (freeze lockfile + full release gate)
- Incident and risk-acceptance install profile:
  - `pnpm install --ignore-scripts --frozen-lockfile`
- Keep `packageManager`, `pnpm-lock.yaml`, and lockfile diffs under review for every dependency change.
- Keep `pnpm audit signatures` and audit output in release artifacts for traceability.
- Recommended `pnpm-workspace.yaml` controls:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
blockExoticSubdeps: true
trustPolicy: no-downgrade
```

  - `minimumReleaseAge: 1440` delays installs of very new package versions by 1 day.
  - `minimumReleaseAgeStrict: true` keeps the delay rule strict on releases.
  - `blockExoticSubdeps: true` prevents non-registry or tarball/git-based transitive resolution paths.
  - `trustPolicy: no-downgrade` blocks trust-level regressions in package provenance and rejects weaker trust evidence on newer package versions.

## 4) Documentation and release alignment

- Canonical implementation references:
  - `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
  - `docs/technical/11_SECURITY_PRIVACY_AND_FAIR_PLAY.md`
  - `docs/planning/14_RELEASE_PLAN_AND_ANALYTICS.md`
- Update this brief when:
  - Next.js migration starts,
  - Vercel frontend cutover begins,
  - pnpm policy or lockfile policy changes.

### Security posture for rollout

- Treat lockfile drift and audit failures as release-blocking until reviewed.
- Keep any dependency changes on a documented change request with reproducibility commands and audit command output attached.
