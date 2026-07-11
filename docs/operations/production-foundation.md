# Production Foundation Operations

This runbook covers the M3 production-like topology: a Next.js web shell, the Fastify game service, the independent automation worker, PostgreSQL, Redis, durable room events/snapshots, WebSocket projection delivery, and append-only migrations. It does not authorize public player traffic until the final release-hardening milestone is complete.

## Local production-like startup

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
curl --fail --silent --show-error http://127.0.0.1:4100/livez
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
```

`/livez` proves that the process is running. `/readyz` proves that PostgreSQL and Redis are reachable. Do not direct traffic to a game-service instance that returns `503` from `/readyz`. The Compose health gate also requires the automation worker heartbeat to be fresh.

Before using this topology outside local development, replace every local-only password and URL in `infra/compose/.env` with values supplied by the deployment secret store. Never commit `.env` files or database dumps.

## Readiness diagnosis

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml ps
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml logs --no-color game-service worker
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml exec -T worker sh -lc 'cat /tmp/g304-worker-heartbeat'
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
```

If readiness fails, diagnose PostgreSQL and Redis before restarting the game service. The migration job must exit successfully before the game service and automation worker start. A missing or stale heartbeat means the worker has not completed a healthy PostgreSQL/Redis polling cycle; inspect worker logs and dependency health before replacing the process.

## WebSocket and worker diagnosis

The WebSocket route delivers only fresh, viewer-specific room projections. A duplicate socket snapshot is safe: clients replace their local room projection when its event version is equal to or newer than the one they already display. Clients send only authenticated `PING` and `RESYNC` messages; gameplay mutations remain authenticated HTTP commands.

The automation worker claims version-bound PostgreSQL jobs for bots, turn timeouts, and disconnected-player autopilot. A stale job is completed without a room state change. Do not manually change job rows or replay an action from a log line; use the worker's durable job and event trail to diagnose the condition.

The same worker process runs a separate, non-overlapping maintenance pass every
five minutes by default. It revokes long-expired guest sessions, closes only
stale `lobby` and `hand_result` rooms, and purges retained `closed` rooms in
bounded batches. It never selects or changes an `in_hand` room. The defaults
are `MAINTENANCE_BATCH_SIZE=100`, `ROOM_LOBBY_IDLE_HOURS=24`,
`ROOM_TERMINAL_RETENTION_DAYS=14`, `ROOM_CLOSED_RETENTION_DAYS=30`, and
`EXPIRED_SESSION_REVOKE_HOURS=24`; change them only through the deployment
configuration and within the validated bounds.

If a request returns `ROOM_RECOVERY_FAILED`, treat it as an availability incident. Preserve the database, worker/game-service logs, and room id; do not hand-edit `game_events` or `game_snapshots`. Investigate the failing replay against a restored copy, then recover using the approved release or backup process.

## Metrics and monitoring

The game service exposes Prometheus-compatible metrics at `/metrics`. The
metrics surface contains service request and WebSocket counts, durable outbox and
automation queue counts, automation outcomes, and
`three_zero_four_worker_heartbeat_age_seconds`. The last metric is finite only
after the independent worker completes a healthy PostgreSQL/Redis poll; an
absent heartbeat is represented as `+Inf`.

Maintenance exports only these aggregate counters, with no room, player,
session, invite, card, or event labels:

```bash
curl --fail --silent http://127.0.0.1:4100/metrics | rg 'three_zero_four_maintenance_(sessions_revoked|rooms_closed|rooms_purged)_total'
```

A growing closure or purge counter is aggregate evidence only. Investigate it
through approved database and incident procedures; do not manually edit room
events, snapshots, or automation jobs.

Start the optional local Prometheus profile only alongside the local Compose
stack:

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.monitoring.yaml up --build --wait
curl --fail --silent --show-error http://127.0.0.1:9090/-/ready
```

The shipped alerts are conservative warnings for a missing scrape, stale worker
heartbeat, persistent outbox backlog, and persistent automation backlog. They
are local rule definitions, not configured alert delivery. An operator must
connect them to an approved notification channel before public use.

When an alert fires, first inspect `/readyz`, `/metrics`, and the game-service
and worker logs. Do not put room views, card data, player identifiers, session
cookies, invite codes, or raw events into alert labels or annotations.

## Durable room integration rehearsal

Execute the same database/Redis-backed service test used by CI in a separate,
disposable Compose project:

```bash
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml up --build --wait postgres redis
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml run --rm --no-deps migrate
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration build integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml down --volumes --remove-orphans
```

The runner executes the full service suite, including `durable-rooms.integration.test.ts`, `realtime.test.ts`, `realtime-multiclient.integration.test.ts`, `room-automation.integration.test.ts`, `room-simulation.test.ts`, and `recovery-fuzz.integration.test.ts`, against disposable PostgreSQL and Redis services. It creates test guests and rooms only; it does not contact external systems or authorize public traffic. The isolated project starts no game service or worker, so a live worker cannot claim test jobs; building the profile first ensures the test image matches the checked-out service source.

## Migrations

```bash
DATABASE_URL='postgres://game:password@host:5432/game' pnpm db:migrate
```

Migration files are append-only. A checksum mismatch for an already applied filename is a stop condition: restore the original migration source, investigate the discrepancy, and add a new ordered migration for the correction. Do not edit or delete an applied migration.

## Backup and restore rehearsal

Take a custom-format dump from a trusted operator environment:

```bash
pg_dump --format=custom --no-owner --file=304-online-$(date +%F).dump "$DATABASE_URL"
```

Rehearse restores in an isolated database before every production schema release:

```bash
createdb 304_online_restore_check
pg_restore --clean --if-exists --no-owner --dbname=304_online_restore_check 304-online-YYYY-MM-DD.dump
psql 304_online_restore_check -c 'SELECT filename, checksum FROM schema_migrations ORDER BY filename;'
dropdb 304_online_restore_check
```

Keep encrypted backups in the production provider's approved backup system. Store the restore-rehearsal result with the release record, not in this repository.

## Rollback

1. Stop new player traffic to the unhealthy release.
2. Preserve the database and running evidence; do not run destructive down migrations.
3. Redeploy the previous verified service and web images.
4. Confirm `/livez`, `/readyz`, the worker heartbeat, and the durable room integration rehearsal on the restored service before reopening traffic.
5. If the schema blocks recovery, restore the latest verified backup into a new database, validate it, and switch traffic only after the checks pass.

## Local teardown

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
```

This removes the local Compose volumes. Do not use it against a production database.
