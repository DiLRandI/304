# Production Foundation Operations

This runbook covers the production-like M1 topology: a Next.js web shell, the Fastify game service, PostgreSQL, Redis, and append-only migrations. It does not authorize public player traffic until the durable command and realtime milestones are complete.

## Local production-like startup

```bash
cp infra/compose/.env.example infra/compose/.env
pnpm compose:up
curl --fail --silent --show-error http://127.0.0.1:4100/livez
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
```

`/livez` proves that the process is running. `/readyz` proves that PostgreSQL and Redis are reachable. Do not direct traffic to a game-service instance that returns `503` from `/readyz`.

Before using this topology outside local development, replace every local-only password and URL in `infra/compose/.env` with values supplied by the deployment secret store. Never commit `.env` files or database dumps.

## Readiness diagnosis

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml ps
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml logs --no-color game-service
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
```

If readiness fails, diagnose PostgreSQL and Redis before restarting the game service. The migration job must exit successfully before the game service starts.

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
4. Confirm `/livez` and `/readyz` on the restored service before reopening traffic.
5. If the schema blocks recovery, restore the latest verified backup into a new database, validate it, and switch traffic only after the checks pass.

## Local teardown

```bash
pnpm compose:down
```

This removes the local Compose volumes. Do not use it against a production database.
