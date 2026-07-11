# Security

## Reporting

Report suspected vulnerabilities through a private disclosure channel. Include
the affected version, impact, and minimal reproduction steps. Do not include
session cookies, invite codes, private hands, hidden cards, database contents,
or other players' data in a public issue.

## Release-facing trust boundaries

- The browser sends intents only. `apps/game-service` validates identity,
  command schema, expected room version, actor permissions, and game legality.
- `packages/game-engine` is authoritative for rules and scoring.
- HTTP and WebSocket responses use viewer-specific projections. Other hands,
  closed trump information, shuffle material, and internal snapshots are not
  public client state.
- PostgreSQL stores durable session, room, event, snapshot, outbox, and
  automation state. Redis provides leases, presence, rate limits, Pub/Sub, and
  telemetry; it is not trusted as game history.
- Every accepted mutation is idempotent and versioned. It is recorded in the
  same transaction as its derived snapshot and publication/automation work.
- Automated bot, timeout, and disconnected-player actions use the same
  coordinator validation path as human commands.

## HTTP, session, and realtime controls

- Guest sessions use a high-entropy cookie whose secret is stored as a
  peppered digest. The cookie is HTTP-only, SameSite=Lax, and Secure in
  production.
- Mutating `/v1` requests and WebSocket upgrades require an exact configured
  origin. The service does not accept wildcard preview origins.
- Guest creation and authenticated actions are rate-limited by scoped identity
  and network keys.
- Request bodies and WebSocket frames have bounded sizes. Configuration,
  trusted-proxy addresses, allowed origins, timing values, and retention
  windows are validated during startup.
- Fastify security headers are enabled. Cookie and authorization headers are
  redacted from structured request logs.
- Private WebSocket updates carry room versions. Clients discard stale data and
  fetch a private snapshot after a version gap or reconnect.

## Secret and data handling

- Database, Redis, migration, session-pepper, cloud, and operator credentials
  stay in server/worker environments or an approved secret manager.
- Browser-visible environment variables contain public origins and optional
  public support/analytics configuration only.
- Logs, metrics, alerts, screenshots, traces, and tickets must not contain
  credentials, session cookies, invite codes, private hands, hidden cards, or
  raw room snapshots.
- The public release contains no wallet, wager, prize, cash-out, or real-money
  mechanic.
- Analytics is optional, consent-gated, and allowlisted. Essential session
  behavior does not depend on analytics consent.

## Supply-chain policy

- pnpm is the only package manager for this repository.
- `package.json`, `.node-version`, `pnpm-lock.yaml`, and
  `pnpm-workspace.yaml` define the toolchain and dependency-admission policy.
- Keep the lockfile committed and review every dependency and lockfile diff.
- Use immutable installs:

```bash
corepack enable
pnpm install --frozen-lockfile
```

- Run release checks:

```bash
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
```

- For a suspicious dependency update or incident-response inspection:

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm audit --audit-level=high
```

The canonical hosting and dependency-security decision is
[Platform and Supply-Chain Decision](docs/technical/13_PLATFORM_AND_SUPPLY_CHAIN.md).

## Deployment and release gates

- The Next.js frontend is a presentation/transport boundary. Stateful game
  authority and the worker remain separately deployed services.
- Production migrations are append-only. Roll back to a schema-compatible
  application image or apply a forward corrective migration.
- Readiness requires both PostgreSQL and Redis; liveness alone is not a release
  signal.
- CI and the local release rehearsal cover immutable installation, lint,
  types, unit/contract/integration tests, migrations, browser acceptance,
  secret/container scanning, bounded API smoke, and backup/restore behavior.
- Public deployment, DNS, billing, secret provisioning, legal approval, alert
  delivery, and production backup retention require an authorized operator.

See [Production Foundation](docs/operations/production-foundation.md) and
[Public Release](docs/operations/public-release.md) for response and release
stop conditions.

## Legacy compatibility server

`server.js` remains a compatibility baseline and is not the release-facing
durable architecture. It still applies a public-file allowlist, request and
payload limits, server-side action validation, origin controls, rate limits,
security headers, and graceful shutdown. Do not use its in-memory rooms or
browser-held legacy session token as evidence for production durability.
