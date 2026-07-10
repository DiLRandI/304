# 304 Online

304 Online is a server-authoritative implementation of Sri Lankan 304. The repository is migrating from a verified static Node.js prototype toward a durable game platform.

## Current architecture

- `packages/game-engine` contains deterministic game rules and server-selected bot decisions for Classic and six-seat 304.
- `packages/contracts` validates versioned game commands and private views.
- `apps/game-service` is the Fastify boundary for the production game API.
- `apps/web` is a Next.js web shell with no game-state authority.
- PostgreSQL stores durable guest sessions, rooms, seats, accepted events, private snapshots, room outbox rows, and automation jobs; Redis provides leases, presence, Pub/Sub notices, rate limits, and cross-worker telemetry.
- The game service exposes authenticated `/v1` HTTP commands plus private WebSocket room projections. A separately deployed worker runs bot, timeout, and disconnected-player automation from durable jobs.
- The legacy static Node.js server remains a compatibility baseline while the production player UI and final public-release hardening are completed.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The legacy playable baseline runs with:

```bash
pnpm start
```

It listens on `http://127.0.0.1:4173` by default.

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
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration build integration
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration
```

## Security and release checks

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
```

For startup, readiness, migrations, backup rehearsals, and rollback, follow [the production foundation runbook](docs/operations/production-foundation.md).

## Documentation

- [Product documentation](docs/README.md)
- [Production platform design](docs/superpowers/specs/2026-07-10-production-game-platform-design.md)
- [Production foundation plan](docs/superpowers/plans/2026-07-10-production-foundation.md)

## Release scope

M3 establishes durable Classic and six-seat rooms, private realtime resync, worker-driven bot/timeout/autopilot execution, exact snapshot replay, and CI coverage against real PostgreSQL and Redis. Public player launch remains blocked on the production player UI and final release hardening described in the production platform plan.
