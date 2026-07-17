# Platform and Supply-Chain Decision

**Status:** Current
**Last reviewed:** 2026-07-16

## Decision

304 Online uses a split application architecture:

- `apps/web` is the release-facing Next.js player application.
- `apps/game-service` is the Fastify HTTP and WebSocket authority.
- The independently deployed worker runs durable bot, turn-timeout,
  disconnect-grace/autopilot, and room-maintenance jobs.
- PostgreSQL is the source of truth for sessions, rooms, events, snapshots,
  outbox rows, and automation jobs.
- Redis provides coordination, leases, presence, rate limits, Pub/Sub, and
  bounded operational telemetry. It is not a source of game history.
- `packages/gameplay` owns deterministic Gameplay rules, projections, and
  server-selected bot policy; `packages/room-domain` owns room lifecycle;
  `packages/contracts` owns validated wire schemas.
- Next.js and Fastify are the only supported application runtime.

The browser sends intents and renders private server projections. It never
owns authoritative room state, shuffle material, other players' cards, or
database credentials.

## Hosting posture

The Next.js client is designed for Vercel. Stateful game authority and the
worker remain separately deployed long-running services. The documented
cost-first production topology runs the API, worker, and Redis on AWS Mumbai
and uses PostgreSQL on Supabase Mumbai; alternative providers are acceptable
when they preserve the same trust and durability boundaries.

Preview and production browsers must use an explicitly configured public game
service URL. API origin allowlists are exact; wildcard preview origins are not
accepted for authenticated game tables. Database, Redis, session, and
migration credentials remain server-side.

See:

- [Architecture](09_ARCHITECTURE.md)
- [Vercel and Supabase development](../deployment/vercel-supabase-development.md)
- [Cost-first AWS production](../deployment/aws-mumbai-production-cost-first.md)
- [Production operations](../operations/production-foundation.md)
- [Public-release rehearsal](../operations/public-release.md)

## Toolchain decision

The repository uses pnpm only. The required versions are declared in
`package.json` and `.node-version`; the lockfile is committed. Dependency
operations use the pinned package manager and immutable installs:

```bash
corepack enable
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` enforces the repository's dependency-admission policy,
including release-age controls, trust-policy downgrade protection, and
blocking exotic transitive sources. Changes to those controls or to
`pnpm-lock.yaml` require review with the application change that needs them.

## Supply-chain release gates

Run the repository checks before a release candidate:

```bash
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
```

For suspicious dependency updates or incident response, install without
lifecycle scripts before auditing:

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

CI additionally validates immutable installation, migrations, integration
topology, browser acceptance, backup/restore behavior, bounded API smoke,
secret scanning, and container scanning. A generated report or passing unit
suite alone is not release evidence.

## Non-negotiable boundaries

- No browser or Vercel environment variable may contain database, Redis,
  migration, session, or cloud credentials.
- No client path may import an authoritative domain package or reconstruct hidden
  state.
- Every accepted room mutation is authenticated, validated, idempotent,
  versioned, and durably recorded before publication.
- Private projections remain viewer-specific over HTTP and WebSocket paths.
- Production migrations are append-only; rollback uses compatible application
  images or forward corrective migrations.
- Public deployment, legal approval, billing ownership, secret provisioning,
  alert delivery, and backup retention require an authorized operator and are
  not implied by repository checks.

## Reference material

- [Next.js support policy](https://nextjs.org/support-policy)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vercel Functions](https://vercel.com/docs/functions)
- [pnpm audit](https://pnpm.io/cli/audit)
- [pnpm install](https://pnpm.io/cli/install)
- [pnpm workspace settings](https://pnpm.io/settings)
