# 304 Online

304 Online is a server-authoritative implementation of Sri Lankan 304. It now
includes a browser-facing private-table client and a reproducible local
public-release rehearsal; it is not itself a public deployment or a claim of
legal approval.

## Current architecture

- `packages/gameplay` contains the authoritative Gameplay domain, deterministic rules, scoring, and server-selected bot policy for Classic and six-seat 304.
- `packages/contracts` validates versioned game commands and private views.
- `apps/game-service` is the Fastify boundary for the production game API.
- `apps/web` is a Next.js player client with no game-state authority.
- PostgreSQL stores durable guest sessions, rooms, seats, accepted events, private snapshots, room outbox rows, and automation jobs; Redis provides leases, presence, Pub/Sub notices, rate limits, and cross-worker telemetry.
- The game service exposes authenticated `/v1` HTTP commands plus private WebSocket room projections. A separately deployed worker runs bot, timeout, and disconnected-player automation from durable jobs.
- The Next.js client and Fastify service are the only supported application
  runtime.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Use the production-like Compose topology below for local application runtime.

## Local and cloud delivery

Run the production-like local stack with the Make targets:

```bash
cp infra/compose/.env.example infra/compose/.env
make local-up
make check
make local-down
```

For Vercel previews, Supabase development Postgres, and the cost-first Mumbai
production topology, follow the [development delivery guide](docs/deployment/vercel-supabase-development.md)
and [production delivery guide](docs/deployment/aws-mumbai-production-cost-first.md).

## Production-like local topology

```bash
cp infra/compose/.env.example infra/compose/.env
pnpm compose:up
curl --fail --silent --show-error http://127.0.0.1:4100/livez
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
```

The web shell is available at `http://127.0.0.1:3000`. The game service is available at `http://127.0.0.1:4100`. Stop the disposable local topology with `pnpm compose:down`.

Run the durable service integration rehearsal against the Compose PostgreSQL and Redis services with:

```bash
make integration
```

## Security and release checks

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
```

For startup, readiness, migrations, backup rehearsals, and rollback, follow [the production foundation runbook](docs/operations/production-foundation.md).

## Public-release rehearsal

The release rehearsal exercises real Chromium browser flows, a disposable
backup/restore, and a bounded non-destructive API smoke against the local
Compose topology. Chromium proves a full Classic practice hand, a full
six-seat practice hand, server-projected result and next-hand rendering, and a
five-human six-seat private start with one bot and a complete six-card
allocation per seat:

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
pnpm --filter @three-zero-four/web exec playwright install chromium
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
G304_RESTORE_REHEARSAL=1 scripts/backup-restore-rehearsal.sh
LOAD_BASE_URL=http://127.0.0.1:4100 LOAD_ORIGIN=http://127.0.0.1:3000 node infra/load/browser-api-smoke.js
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
```

See the [public-release operations runbook](docs/operations/public-release.md)
for prerequisites, release stop conditions, and the boundaries between this
local rehearsal and operator-owned production work.

## Documentation

- [Product documentation](docs/README.md)
- [Current architecture](docs/technical/09_ARCHITECTURE.md)
- [Platform and supply-chain decision](docs/technical/13_PLATFORM_AND_SUPPLY_CHAIN.md)
- [Production operations](docs/operations/production-foundation.md)

## Release scope

M3 establishes durable Classic and six-seat rooms, private realtime resync,
worker-driven bot/timeout/autopilot execution, exact snapshot replay, and CI
coverage against real PostgreSQL and Redis. M4 adds the browser player flow,
accessibility and consent controls, worker monitoring, and a local
public-release rehearsal. Public deployment, legal approval, alert delivery,
and production backup retention remain operator-owned prerequisites.
