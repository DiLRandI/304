# Product Decision Addendum (Latest): Next.js, Vercel, and pnpm Supply-Chain Security

**Date:** 2026-07-09  
**Status:** Active implementation posture  

## 0) Direct stack answer

- This repository is **not** a Next.js application today.
- Next.js is the approved frontend platform direction for phase 2.
- Vercel is approved as the host target for the Next.js frontend.
- `pnpm` is mandatory for dependency safety and supply-chain protection from dev through release.

## 1) Current architecture reality

- This repository is **not** a Next.js application today.
- The shipped runtime is a production-oriented custom Node.js server (`server.js`) that serves a static client (`index.html`, `styles.css`, `src/ui/app.js`) plus HTTP API endpoints.
- The project is already using `pnpm` as the package manager, with `packageManager` pinned in `package.json`.

## 2) Decision for this phase

- **Yes, Next.js is the approved frontend platform for phase 2.**  
  Current baseline remains Node.js + static client for phase-1, with a controlled migration path to Next.js.
- **Hosting is approved on Vercel for the Next.js frontend only.**
- For this move, stateful gameplay/session ownership must be shifted out of process memory and into durable services before Vercel-only hosting of live gameplay.

## 3) Why this is a product-grade fit

- **UI complexity is growing**: lobby/table lifecycle, turn-based flows, scoreboards, and accessibility behavior benefit from composable components and route-level layout control.
- **Clear separation of concerns** already exists: server-authoritative endpoints already own game rules and legality checks, which maps cleanly to Next.js route-based client-server interaction.
- **Operational posture**: Vercel gives production preview/branch visibility and rapid deployment workflows for frontend evolution while the backend contract remains explicit.

## 4) Why Vercel now (with guardrails)

- Vercel function execution is request-driven and instances are scale-to-zero when idle, which is good for frontend/API entrypoints but not for in-memory room/match state.
- Vercel deployments provide dedicated preview and production environments, which supports staged rollout and QA.
- Before moving active gameplay loops to Vercel-only execution, we must externalize:
  - room/session state
  - game action queue/locking
  - reconnect/autopilot lifecycle persistence
  - token/secret handling in separate services

## 5) Why `pnpm` for supply-chain security

- The repo already enforces:
  - immutable lockfile installs
  - audit/signature checks
  - strict install constraints in `pnpm-workspace.yaml`
- `pnpm-workspace.yaml` settings in this repo:
  - `minimumReleaseAge: 1440`
  - `minimumReleaseAgeStrict: true`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps: true`
- Mandatory security command set:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
  - `pnpm security:check`
  - `pnpm security:check:all`

## 6) Local install / setup confirmation

- `pnpm` is available and activated at version `11.10.0` in this environment.
- Use the above commands before release candidates and before any Vercel migration work.

## 7) Official references used

- Next.js support policy: https://nextjs.org/support-policy
- Next.js installation docs (current release and Node requirement): https://nextjs.org/docs/app/getting-started/installation
- Next.js on Vercel: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel Functions lifecycle (request-based execution and scale-to-zero): https://vercel.com/docs/functions
- Vercel function limits and duration behavior: https://vercel.com/docs/functions/limitations
- pnpm audit (including signatures): https://pnpm.io/cli/audit
- pnpm install/lockfile behavior: https://pnpm.io/cli/install
- pnpm workspace settings (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`): https://pnpm.io/settings

## 8) Documentation pointers

- Canonical decision references used in this repository are in:
  - `docs/technical/21_PRODUCT_READY_NEXTJS_VERCEL_PNPM_DECISION_RECORD.md`
  - `docs/technical/26_PRODUCT_GRADE_PLATFORM_DECISION_NEXTJS_VERCEL_PNPM.md`
- `docs/technical/35_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SECURITY_2026-07-09.md`
- `docs/technical/36_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_SUPPLY_CHAIN_SUMMARY_2026-07-09.md`
- `docs/technical/37_PRODUCT_DECISION_NEXTJS_VERCEL_PNPM_LATEST_2026-07-09.md` (this file)

## 9) Install + security baseline (mandatory)

- Standard setup per environment:

```bash
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
```

- Mandatory release gates before Vercel migration:

```bash
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
pnpm security:check:all
```

- Incident response profile:

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

- Hardening controls in this repository are configured in `pnpm-workspace.yaml`:
- `minimumReleaseAge: 1440`
- `minimumReleaseAgeStrict: true`
- `trustPolicy: no-downgrade`
- `blockExoticSubdeps: true`
