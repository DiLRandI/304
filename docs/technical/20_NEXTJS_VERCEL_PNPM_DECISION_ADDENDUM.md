# Decision Addendum: Next.js Frontend, Vercel Hosting, and pnpm Supply-Chain Protection

**Date:** 2026-07-09  
**State:** Approved path for phase-2, not yet live  
**Current production baseline:** custom Node.js + static client (`server.js`)

## 1) Decision summary

- **Next.js is approved** as the next frontend platform for this game.
- **Vercel is approved** as the hosted frontend target once session and room state are externalized.
- **pnpm is mandatory** for all local installs, CI jobs, and release pipelines for reproducibility and supply-chain integrity.
- This repository is **not** currently a Next.js application in active production; current release remains a production-oriented Node.js web service.

## 2) Why Next.js for this game now

- Next.js supports strong UI composition and accessibility-oriented component patterns.
- It aligns with a future where the frontend and game backend are separated by clear API contracts.
- The current architecture already has server-authoritative action endpoints, which makes migration to an API-consumed Next.js frontend straightforward.
- Decision remains to defer migration until feature parity and stable state boundaries are validated in the current stack.

## 3) Why Vercel for hosting (and why not directly today)

- Vercel provides strong Next.js hosting support and release workflows, including git-driven PR previews and global deployment behavior for Next.js apps.
- Vercel's function model scales by request and is optimized for stateless request handling; this does not support process-local in-memory gameplay rooms as a single source of truth.
- We therefore keep Vercel as the **phase-2 frontend host**, with backend state moved to a durable service (Redis/Postgres/API service) before cutover.

## 4) Why pnpm for security and supply-chain defense

- Project is already pinned via `packageManager` in `package.json` to `pnpm@11.10.0`.
- `pnpm-workspace.yaml` is configured with:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
trustPolicy: no-downgrade
blockExoticSubdeps: true
```

- Required integrity/reproducibility checks are now explicit and version controlled:

```bash
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit signatures
pnpm security:check
```

- For forensic/release-hardening runs, also use:

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm security:check:all
```

## 5) Approval and rollout conditions

- **Phase-1 (current):** keep custom Node.js + static client while feature parity and game-state reliability harden.
- **Phase-2 (migration):** implement frontend/backend split, then deploy Next.js UI on Vercel against durable services.
- **Phase-3 (production):** enforce release gates above on every release branch; release is blocked on high-severity vulnerabilities or signature failures.

