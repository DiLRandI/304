# Product Decision & Security Addendum (2026-07-09)

## Question asked by the team

- Is this a Next.js app today?
- Is Next.js still the right fit for the next phase?
- Can we host the frontend on Vercel?
- Should pnpm be mandatory for supply-chain protection?

## Findings and decision (confirmed as of 2026-07-09)

- Current shipping runtime in this repository remains a custom Node.js + static client (`server.js` + `index.html` + `src/ui`), not a Next.js app.
- Next.js is the right next-phase frontend platform for this productization:
  - longer-lived component architecture needs,
  - stronger route and rendering composability,
  - better accessibility and maintainability for public gameplay surfaces.
- Vercel is approved as the frontend host for that Next.js phase once state ownership is moved out of process memory.
- pnpm is mandatory for installs and release security gates.

## Live validation references (web-search latest)

- Next.js support policy: `16.x` is Active LTS and `15.x` is Maintenance LTS with explicit dates:
  - `16.x` release date: Oct. 21, 2025
  - `15.x` release date: Oct. 21, 2024
- Next.js platform guidance:
  - Next.js deploy-to-platforms docs describe adapter model and no private framework hooks.
  - Vercel publishes first-class Next.js guidance and middleware/analytics/tooling integration for deployed apps.
- Vercel runtime constraints for this architecture:
  - Vercel Function duration uses plan-aware defaults and maximums (not indefinite request loops).
  - Current documented maxima show 300s defaults with higher maxima in fluid compute paths, and request payload limits (4.5 MB max body).
- pnpm supply-chain controls used in this repo:
  - `minimumReleaseAge` + strict mode can enforce install age gating.
  - `trustPolicy: no-downgrade` blocks trust regression.
  - `blockExoticSubdeps` blocks transitive dependencies from untrusted exotic sources.
  - `pnpm audit signatures` verifies install provenance.

## Enforceable command baseline (required)

```bash
# Toolchain pin
corepack enable
corepack prepare pnpm@11.10.0 --activate

# Install and security checks
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
pnpm security:check:all
```

## Gate before Vercel Next.js migration

- Split game authority into durable services (room/session/bot state in Redis/PostgreSQL/API layer).
- Keep client/server contracts versioned.
- Deploy Next.js frontend on Vercel after durable API and storage boundaries are in place.
- Keep gameplay state writes in authoritative backend, not Vercel function-local memory.

## Canonical record links

- `docs/technical/17_FRAMEWORK_AND_HOSTING_DECISION_LOG.md`
- `docs/technical/24_STACK_MIGRATION_AND_SECURITY_DECISION_RECORD.md`
- `docs/technical/34_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_2026-07-09.md`
- `README.md` (implementation section)
- `SECURITY.md` (supply-chain policy section)
