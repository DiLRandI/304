# Railway deployment

This guide deploys 304 Online to Railway using Railway-generated domains. A
custom domain is optional. The complete application needs five services:

| Service | Purpose | Public domain |
| --- | --- | --- |
| PostgreSQL | Sessions, rooms, snapshots, events, and automation jobs | No |
| Redis | Leases, presence, realtime notices, rate limits, and telemetry | No |
| Game API | HTTP and WebSocket authority | Yes |
| Worker | Bot bids, bot turns, timeouts, autopilot, and maintenance | No |
| Web | Next.js browser client | Yes |

The API and worker are separate processes built from the same game-service
image. Deploying only the web and API can render a room, but bot-controlled
gameplay will not advance.

The repository provides a Railway config-as-code file for each application
service:

| Service | Config path |
| --- | --- |
| Game API | `/railway/api.json` |
| Worker | `/railway/worker.json` |
| Web | `/railway/web.json` |

When creating each GitHub service, open its settings and set the absolute
config-file path shown above. Railway then reads the Dockerfile, start command,
pre-deploy command, restart policy, and HTTP healthcheck settings from the
repository. Variables, public domains, and cross-service references remain
environment-specific and are configured in the Railway project.

## 1. Provision PostgreSQL and Redis

Add Railway PostgreSQL and Redis services to the project. Keep them private.
The API, worker, and migration process must use Railway variable references to
these same instances.

Railway shows the available connection-variable names on each database
service. Reference the full connection URLs rather than copying credentials
into multiple services. For example, if the services are named `Postgres` and
`Redis`:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Use the exact names from your Railway project if they differ.

## 2. Deploy the game API

Create a service from this GitHub repository. Keep the service root at the
repository root because the Docker build needs the workspace packages and lock
file.

Set the service's config-as-code path:

```text
/railway/api.json
```

This config builds `apps/game-service/Dockerfile`, runs
`node dist/scripts/migrate.js` before deployment, checks `/readyz`, and uses
the Dockerfile's `dist/src/server.js` start command. Generate a Railway HTTPS
domain for this service and record its origin, for example:

```text
https://<game-api-service>.up.railway.app
```

Set these variables:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
CORS_ORIGINS=https://<web-service>.up.railway.app
SESSION_COOKIE_NAME=g304_session
SESSION_SECRET_PEPPER=<at-least-32-random-characters>
```

`CORS_ORIGINS` is the exact web origin: scheme and hostname only, with no path
or trailing slash. For more than one permitted web deployment, use a
comma-separated list of exact origins.

Generate `SESSION_SECRET_PEPPER` once with a cryptographically secure secret
generator. Store it as a Railway secret and reuse the exact value on the
worker. Changing it invalidates existing guest sessions.

Optional tuning variables have validated defaults:

```env
AUTOMATION_POLL_INTERVAL_MS=500
BOT_ACTION_DELAY_MS=900
MAINTENANCE_POLL_INTERVAL_MS=300000
```

The migration command is checksum-protected and uses a PostgreSQL advisory
lock. Never edit an already-applied SQL migration; add a new numbered migration
instead.

## 3. Deploy the automation worker

Create another service from the same repository and revision. Set its
config-as-code path:

```text
/railway/worker.json
```

This config builds the game-service Dockerfile and overrides its process with
`node dist/src/worker.js`. It deliberately defines no HTTP healthcheck. Do not
generate a domain for the worker; it is a long-running background process and
does not listen for HTTP traffic.

Give it the same runtime values as the API:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
CORS_ORIGINS=https://<web-service>.up.railway.app
SESSION_COOKIE_NAME=g304_session
SESSION_SECRET_PEPPER=<same-value-as-game-api>
AUTOMATION_POLL_INTERVAL_MS=500
BOT_ACTION_DELAY_MS=900
```

Although the worker does not serve browser requests, it loads the shared
service configuration and therefore requires `CORS_ORIGINS`,
`SESSION_COOKIE_NAME`, and `SESSION_SECRET_PEPPER`.

Run migrations from the API pre-deploy command rather than independently
starting an un-migrated worker. Deploy the API first when initially creating
the project, then start the worker after the migration succeeds.

## 4. Deploy the web client

Create a third GitHub service from the same repository and revision. Set its
config-as-code path:

```text
/railway/web.json
```

This config builds `apps/web/Dockerfile` and checks the deployed root page.
Set the public API origin before building:

```env
NEXT_PUBLIC_GAME_SERVICE_URL=https://<game-api-service>.up.railway.app
```

This is compiled into the Next.js browser bundle. Redeploy the web service
after changing it. Generate a Railway HTTPS domain for the web service, then
copy that exact origin into `CORS_ORIGINS` on both the API and worker and
redeploy them.

The final relationship is:

```text
Browser -> web Railway domain
Browser -> game API Railway domain (credentials included)
Game API + worker -> same PostgreSQL and Redis services
```

## 5. Preserve the browser security contract

Railway provides HTTPS transport, but the application owns its CORS, cookie,
and CSRF policy. In production, the API:

- permits credentialed requests only from exact `CORS_ORIGINS`;
- uses a `Secure`, `HttpOnly`, `SameSite=None` guest-session cookie;
- returns a session-bound token through the `X-CSRF-Token` response header;
- accepts authenticated mutations only when that token is returned in the
  `X-CSRF-Token` request header; and
- marks token-bearing responses `Cache-Control: private, no-store`.

The web client handles the CSRF token in memory. Deploy compatible web and API
revisions together; an older web bundle will not satisfy a newer API's mutation
contract. Do not store the token in Railway variables, expose the session
pepper to the web build, or weaken `CORS_ORIGINS` to work around a rejected
request.

## 6. Verify the deployment

Check the API process and its dependencies:

```bash
curl --fail --silent --show-error \
  https://<game-api-service>.up.railway.app/livez
curl --fail --silent --show-error \
  https://<game-api-service>.up.railway.app/readyz
```

Both responses should report a healthy status. A `503` from `/readyz` means
the API cannot reach PostgreSQL or Redis.

Open the web domain, create a practice table, and observe the first bidding
round. A bot should act after approximately `BOT_ACTION_DELAY_MS`, and bidding
controls appear when the human seat becomes the active bidder. The room should
update without a manual refresh.

Inspect the worker deployment logs separately. It must remain running and
complete healthy polls against the same PostgreSQL and Redis used by the API.
The API `/metrics` output exposes
`three_zero_four_worker_heartbeat_age_seconds` after a healthy worker poll.

## Troubleshooting

### Web build reports internal modules are missing

Use `apps/web/Dockerfile` from the repository root. Do not replace its build
with only `pnpm --filter @three-zero-four/web build`; the Dockerfile builds the
required workspace contracts package first.

Use `apps/game-service/Dockerfile` for the API and worker. It builds gameplay,
room-domain, contracts, and game-service packages in dependency order.

Confirm the affected service selects `/railway/web.json`,
`/railway/api.json`, or `/railway/worker.json` as appropriate. Railway
otherwise looks for its default config and Dockerfile at the source root.

### `Invalid service configuration`

The process names every missing or invalid field before exiting. At minimum,
the API and worker require valid `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`,
`SESSION_COOKIE_NAME`, and a `SESSION_SECRET_PEPPER` containing at least 32
characters. Check that the variables are attached to the failing service, not
only defined on another Railway service.

### Browser receives `401 SESSION_REQUIRED`

In browser developer tools:

1. Confirm `POST /v1/guest-sessions` succeeds and returns a `Set-Cookie`
   response header.
2. Confirm later API requests include credentials and send the session cookie.
3. Confirm both public services use HTTPS.
4. Confirm `NEXT_PUBLIC_GAME_SERVICE_URL` names the public game API origin.
5. Confirm the API and worker use the same stable
   `SESSION_SECRET_PEPPER`.

Do not put the API URL in `CORS_ORIGINS`; that variable contains the web origin
that initiates browser requests.

### Browser receives `403 ORIGIN_DENIED` or a CORS error

Set `CORS_ORIGINS` to the browser page's exact origin, such as
`https://<web-service>.up.railway.app`. Remove paths and trailing slashes, then
redeploy the API. The API uses credentialed CORS and exact origin checks for
mutating requests; a wildcard origin is neither needed nor appropriate.

### Browser receives `403 CSRF_TOKEN_INVALID`

Confirm the web and API services deploy compatible commits and that
`X-CSRF-Token` appears in the API response's exposed headers. The current web
client reads that token after guest-session creation or an authenticated room
read and returns it automatically on mutations.

Do not create a static CSRF value or add the token to Railway variables. A
token is bound to its guest-session cookie; creating a new guest session,
rotating `SESSION_SECRET_PEPPER`, or mixing different API and web revisions
requires the browser client to obtain a fresh token.

### Room loads but bidding stays on “Wait for your turn”

When a bot owns the current turn, the browser intentionally hides bid controls.
If the table never advances, verify that the separate worker service:

- is deployed and running `node dist/src/worker.js`;
- has no public domain or HTTP health probe;
- references the same PostgreSQL and Redis as the API;
- has all required shared configuration variables; and
- is not repeatedly crashing or reporting unhealthy dependency polls.

Starting or repairing the worker should allow it to claim an already-pending
bot action. The bid buttons appear automatically when the human seat's turn is
reached.
