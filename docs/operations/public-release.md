# Public-release operations

This runbook is a local, reproducible public-release rehearsal for 304 Online.
It verifies the shipped browser flow, durable service topology, worker health,
backup/restore procedure, and bounded HTTP load behavior. It is not a public
deployment, legal review, configured alert delivery, or a substitute for the
operator-owned production prerequisites below.

## Operator-owned prerequisites

Before accepting public traffic, an authorized operator must:

- deploy the web and game-service origins over HTTPS under the same site and
  set `CORS_ORIGINS` to the exact web origin;
- supply production secrets from an approved secret store, rather than any
  values in `infra/compose/.env.example`;
- obtain applicable legal/privacy review, define a real support contact, and
  publish the resulting approved policy text;
- connect the shipped Prometheus rules to an approved alert channel, restrict
  metrics access, and define on-call ownership; and
- configure encrypted backup retention and test restores against the actual
  production database provider.

Do not enable `NEXT_PUBLIC_ANALYTICS_ENDPOINT` until an operator has selected
an approved analytics service and verified that optional analytics consent is
being collected. Without explicit opt-in and a configured endpoint, the web
client emits no optional analytics request.

If browser storage is unavailable, consent and display controls remain usable
for the current page lifecycle and optional analytics remains disabled.

## Public-release rehearsal

From a clean checkout, run the following only against disposable local Compose
volumes:

```bash
corepack enable
pnpm install --frozen-lockfile
cp infra/compose/.env.example infra/compose/.env
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
pnpm --filter @three-zero-four/web exec playwright install chromium
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
G304_RESTORE_REHEARSAL=1 scripts/backup-restore-rehearsal.sh
LOAD_BASE_URL=http://127.0.0.1:4100 LOAD_ORIGIN=http://127.0.0.1:3000 node infra/load/browser-api-smoke.js
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml up --build --wait postgres redis
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml run --rm --no-deps migrate
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration build integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml down --volumes --remove-orphans
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
```

The Playwright suite uses separate browser contexts and only public browser
routes and API commands. It covers a complete Classic practice hand, a complete
six-seat practice hand, server-projected result/rematch rendering, a
five-human/six-seat private start with exactly one bot and six cards allocated
per seat (a closed trump maker shows five normal-hand cards plus the reserved
face-down indicator),
plus a two-person private room, private-hand separation, socket recovery, a
transient initial room-load retry, WebSocket-constructor recovery, a six-seat
mobile layout, keyboard actions, 320px lobby containment, the active-hand exit
boundary, invite-copy fallback feedback, one-based player-facing seat prompts,
viewer-correct turn prompts, changed-winner second-bidding integrity, and
display preferences, including storage read/write denial fallbacks. The mobile
join flow also verifies that its required display name stays with the join form
and that blank or whitespace-only join fields receive focus; Start and Create
return focus to their required name on short mobile viewports as well. Component
coverage verifies that alternate face-down plays and the reserved closed-trump
indicator remain reachable without revealing the indicator card. It does not
inspect PostgreSQL to advance a game.

The Gameplay domain suite separately verifies that a viewerless projection
marks no seat as the viewer, never inherits seat 0's closed-trump visibility,
gives a non-maker bot no hidden trump data that can influence its choice, and
keeps captured or historical face-down non-trump identities private while a
hand is active.

The bounded load smoke creates at most six temporary Classic lobbies with two
guests each. It performs only guest creation, room creation, invite join, and
private snapshot requests—never game commands, raw database operations, or
destructive mutations. It fails on any non-2xx response, a five-second request
timeout, or a request exceeding its configured safe latency threshold.

The database/Redis integration runner uses the separate `g304-integration`
Compose project. It starts only PostgreSQL, Redis, and migrations before the
test container, so the live automation worker cannot claim a test bot job.
The project has no host ports and is removed after the test.

## Restore rehearsal safeguards

`scripts/backup-restore-rehearsal.sh` requires the local Compose PostgreSQL
service to already be running and an explicit `G304_RESTORE_REHEARSAL=1`
acknowledgement. It creates a custom-format dump, restores it to
a uniquely named disposable database in that same local container, reruns the
append-only migrations, checks PostgreSQL readiness and `schema_migrations`,
and removes the dump and restore database in its exit trap.

The script intentionally does not accept a remote database URL or persist a
dump. If it cannot see the local Compose PostgreSQL service, it exits before
creating an artifact. Treat a restore failure as a release stop condition and
retain only approved operator evidence outside this repository.

## Alert response and release stop conditions

Use [the production foundation runbook](production-foundation.md) for
`/readyz`, worker heartbeat, outbox, automation backlog, WebSocket, migration,
and rollback diagnosis. Stop the release if any of these occurs:

- a browser acceptance assertion, service readiness check, scanner, or
  integration test fails;
- the restored database is not ready or its migration history is incomplete;
- the bounded smoke returns a non-2xx result or exceeds its latency limit;
- Prometheus reports a missing scrape, stale worker heartbeat, or a persistent
  durable queue backlog; or
- a policy, contact channel, deployment secret, alert-delivery, or backup
  prerequisite remains unapproved or unconfigured.

No card, player, session, invite, or event payload belongs in public release
logs, alert labels, screenshots, or tickets.
