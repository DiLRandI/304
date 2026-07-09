# Framework, Hosting, and Supply-Chain Decision Log

## 0. Decision summary and current status (2026-07-09)

- Current production baseline: custom Node.js + static web client in this repository.
- Next.js decision: approved for the next frontend generation and product phase.
- Vercel decision: approved as the host target for that Next.js frontend only after state is externalized.
- pnpm decision: approved for supply-chain security, reproducibility, and release gating.
- Canonical phase-2 migration record: `docs/technical/27_PLATFORM_GRADE_DECISION_NEXTJS_VERCEL_PNPM.md`.
- Executive summary for stakeholders: `docs/technical/18_PLATFORM_DECISION_BRIEF.md`.
- Official status: this repo is **not** a Next.js application today.

Current runtime confirmation:

- This is not a Next.js app in the active product baseline.
- The shipped stack remains: Node.js `server.js` + static HTML/CSS/JS UI.
- Migration to Next.js remains the product modernization track after stateful API boundaries are in place.
- Product decision lock-in for this track is: Next.js for the next platform generation, Vercel for frontend hosting, pnpm for all installs.

## 1. Framework decision (2026-07-09)

### Decision

- Keep the **current custom Node.js server + static client** stack as the production baseline for now.
- Defer full Next.js migration until feature and architecture milestones are met.
- Keep this as a **production-ready baseline**, not a prototype baseline.
- Track Next.js as the planned long-term UI framework once milestones are verified.

### Why not migrate immediately

- The current runtime is already server-authoritative and optimized for game-state determinism.
- Hidden-state projection, in-memory room lifecycle, and bot action orchestration are already coupled to a stable HTTP polling contract.
- A direct jump to Next.js now would add migration complexity with no immediate feature benefit for MVP priorities.
- Next.js still remains the product target for frontend modernization because it simplifies route/state composition and accessibility polish once deployment boundaries are split.

### Recommendation now

- Approve Next.js as the target frontend stack for the next platform phase.
- Do not migrate until a stateful backend boundary is explicit and externally durable; this avoids hidden state loss in serverless request boundaries.
- Keep this implementation path and document readiness gates in one ADR update so product, ops, and security teams can align on launch criteria.

### Migration trigger points

Move to Next.js when all of the following are true:

1. Feature parity is proven across classic flow (create, join, bot fill, bidding, trump, trick play, scoring, reconnect).
2. Client UX requires deeper composition and reusable component architecture than the current static SPA can sustain.
3. We are ready to separate frontend and backend services cleanly for deployment scalability.

### Vercel runtime constraints for current architecture

- Vercel documents that Functions handle each request as a new invocation and scale to zero when traffic drops.
- Reuse of instances can happen across adjacent requests, but each invocation lifecycle remains request-based and ephemeral.
- Vercel isolates function instances and uses a mostly read-only filesystem for runtime safety.
- This means process-local in-memory room/session state is not a safe single-source-of-truth model for direct Vercel deployment.

### Migration target shape

- Frontend: Next.js app (`apps/web`) with routing, component composition, and richer accessibility polish.
- Backend: Node API service (`apps/server`) for room state, authoritative actions, bots, and storage adapters.
- Shared game interfaces between them (`packages/game-engine`, `packages/shared`), reusing current rule-profile and engine contracts.

## 2. Hosting decision and Vercel path

### Current deployment posture

- The current repository is a single Node process (`server.js`) and expects process-local memory for active rooms.
- Vercel **serverless functions** handle each request as a new invocation, reuse instances opportunistically, and scale down to zero under idle conditions; this is not suitable for in-memory room state without a durable backing store.
- Official Vercel behavior notes confirm that function isolation applies to mutable shared state, so Vercel-hosted stateful logic needs external storage (cache/db/event bus) to preserve continuity.
- For a Vercel-ready launch, this makes frontend/backend split explicit: stateful game services must stay out of request-by-request runtimes unless external durable storage replaces in-memory room state.
- This means game sessions cannot rely on memory-local arrays when deployed on Vercel Functions.

### Recommended Vercel strategy (post-migration)

1. Host Next.js frontend on Vercel.
2. Host backend as a separate long-running service (Render/Fly/VM/container) that owns room state, bots, and polling/API endpoints.
3. If keeping a single deploy on Vercel:
   - move rooms/events to Redis or another durable store,
   - use an API layer that is stateless between invocations,
   - route realtime needs to a managed transport with shared state (for example Redis-backed pub/sub/WebSocket architecture).

### Vercel + gameplay state hard constraints

- Any realtime transport must handle instance hopping. Even with Vercel WebSocket support, future connections may not land on the same function instance.
- Durable room state and presence must therefore be in Redis/postgres/shared store, not function memory.
- For long sessions, evaluate whether function max-duration limits still fit your polling/action profile.

### Security and reliability notes for Vercel launch

- Keep `/health` and readiness endpoints reachable for deployment probes.
- Keep session creation and action endpoints behind request validation and rate limits.
- Keep audit logging and hand audit info on server side, never in client payloads.
- Keep frontend/backend ownership boundaries explicit: UI reads/writes only through documented API contracts.
- If realtime transport remains on Vercel, use managed state or connection-aware infrastructure (e.g., Redis) because future connections may not be routed to the same function instance.

## 3. pnpm and supply-chain protection requirements

### Dependency install requirements

- Use **pnpm** for all installs to enforce lockfile integrity.
- In every CI run and local release branch:
  - `pnpm install --frozen-lockfile`
  - `pnpm audit --audit-level=high`
  - `pnpm audit signatures`
- Use `corepack` to pin toolchain and avoid global manager drift:
  - `corepack enable`
  - `corepack prepare pnpm@11.10.0 --activate`
- Keep `packageManager` in `package.json` aligned to the chosen pnpm major.

### Runtime hardening baseline

- Keep `pnpm-lock.yaml` committed and unchanged until dependency review.
- Prefer `pnpm audit --audit-level=high` as the minimum threshold for dependency regression checks.
- Use `pnpm audit signatures` in pre-release checks to validate package provenance.
- For every release branch, execute all three before promotion:
- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level=high`
- `pnpm audit signatures`
- Add `pnpm-workspace.yaml` controls so audit and provenance are enforced at install time:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
blockExoticSubdeps: true
trustPolicy: no-downgrade
```

- Add `pnpm security:check:all` for full pre-release hardening.
- Add periodic dependency refresh cadence and review of new transitive dependencies before release.
- Use `pnpm install --frozen-lockfile` for every release branch build.
- When reviewing incidents, use `pnpm install --ignore-scripts --frozen-lockfile` to prevent unexpected lifecycle execution.

### Future hardening

- Add lockfile policy checks and build reproducibility checks in CI (optional once CI is connected).
- Add source provenance checks where toolchain allows.
- Keep `.npmrc`/pnpm configuration scoped and reviewed for production images.
- Add package source allowlist and registry policy checks for release dependency updates.

### Supply-chain attack protection summary

- Require lockfile review before release for `pnpm-lock.yaml`, transitive update deltas, and major dependency jumps.
- Block release on high/critical audit findings until reviewed and remediated.
- Add a signing check step (`pnpm audit signatures`) for all dependency changes on release branches.
- Preserve build reproducibility artifacts (lockfile + `pnpm` command log) for each production cut.

## 4. Decision addendum: migration readout for product stakeholders

- This repository is intentionally **not** currently a Next.js app.
- The approved route is:
  - Next.js for frontend modernization.
  - Vercel as frontend host after durable state separation.
  - pnpm as the mandatory package manager and supply-chain policy control.

## 5. Owner and next review

- Owner: product/engineering lead for stack decisions.
- Review frequency: every release milestone.
- Next review trigger: when Next.js migration work is started or a Vercel production migration is approved.
