# 304 Online

304 Online is a server-authoritative implementation of Sri Lankan 304. The repository is migrating from a verified static Node.js prototype toward a durable game platform.

## Current architecture

- `packages/game-engine` contains deterministic game rules and bot decisions.
- `packages/contracts` validates versioned game commands and private views.
- `apps/game-service` is the Fastify boundary for the production game API.
- `apps/web` is a Next.js web shell with no game-state authority.
- PostgreSQL stores durable room/session/event primitives; Redis provides readiness and coordination infrastructure.
- The legacy static Node.js server remains the current playable compatibility baseline while durable room commands and realtime delivery are completed.

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

M1 establishes the production boundary and local release topology. Public player launch remains blocked on durable room command handling, realtime reconnection, and final release hardening described in the production platform plan.
