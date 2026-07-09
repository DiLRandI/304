# Next.js, Vercel, and pnpm Supply-Chain Decision Record

**Date:** 2026-07-09  
**Scope:** production web baseline for 304 Game

## 0) Current stack status

- This repository is **not** a Next.js app in the active production baseline.
- Production baseline remains custom Node.js + static HTML/CSS/JS client with `server.js` as authoritative backend.
- Decision documents that define this:  
  - `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`  
  - `docs/technical/18_PLATFORM_DECISION_BRIEF.md`

## 1) Next.js fit for this game

I agree with your direction: **Next.js is a good fit** for the next phase. Recommended reasons for this game:
- Better composability for reusable UI and accessibility-rich interfaces.
- Faster frontend iteration via React component architecture.
- Strong route composition and clearer frontend ownership boundaries.

Hold migration until:
1. Game core flows and room lifecycle are stable at the current backend baseline.
2. Backend service boundaries (API + room/state services) are explicit.
3. Durable state path is implemented outside process memory.

## 2) Vercel hosting direction

- Vercel Functions are request-invocation based and scale to zero when idle (with instance reuse when traffic is close together).
- This means process-local in-memory room/session state does **not** belong on Vercel Functions directly.
- Migration path:
  - Phase 1: keep current stack as production web baseline.
  - Phase 2: Next.js frontend hosted on Vercel, backend moved to long-lived service or durable shared store.

## 3) pnpm and supply-chain posture (mandatory)

- Package manager is pinned in `package.json`:
  - `packageManager: "pnpm@11.10.0+..."`
- Workspace policy file uses:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- These settings map to supply-chain hardening goals:
  - delay new package versions briefly,
  - enforce strict policy behavior,
  - fail on trust degradation,
  - block transitive git/tarball/direct URLs from exotic sources.

Install and release gates:

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check:all
```

Incident/forensic profile:

```bash
corepack prepare pnpm@11.10.0 --activate
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

## 4) Production-readiness confirmation

- Current baseline is product-oriented (not toy/prototype).
- Security and hosting decisions are documented as separate explicit gates before a frontend migration.
- No direct frontend rewrite happens without clearing these gates.
