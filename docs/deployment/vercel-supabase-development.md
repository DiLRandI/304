# Development delivery: Vercel and Supabase

This guide creates a safe development and preview environment for the Next.js
player client. It does not provision accounts, projects, or secrets. Keep
development data in a separate Supabase project from production.

## Architecture and ownership

| Component | Development responsibility |
| --- | --- |
| `apps/web` | Vercel-hosted Next.js player UI |
| `apps/game-service` and worker | Local Compose by default; a separately operated shared API only when needed |
| PostgreSQL | Supabase development project in Mumbai (`ap-south-1`) |
| Redis | Local Compose for local development; not a Vercel service |

Vercel hosts only the browser application. Set only the public API base URL in
Vercel:

```text
NEXT_PUBLIC_GAME_SERVICE_URL=https://api.dev.example.com
```

Never place `DATABASE_URL`, Supabase database passwords, a Supabase service
role key, Redis URLs, or session secrets in Vercel browser environment
variables. The game service and worker own those server-only values.

## Local development

Use the full local topology for feature development, migrations, browser tests,
and release rehearsal:

```bash
corepack enable
pnpm install --frozen-lockfile
cp infra/compose/.env.example infra/compose/.env
make local-up
make check
make e2e
make local-down
```

`make local-down` intentionally removes disposable local database and Redis
volumes. Use `make integration` for the isolated service integration rehearsal;
it starts its own Compose project and removes that project when it finishes.

## Supabase development project

1. Create a dedicated Supabase **development** project in Mumbai
   (`ap-south-1`). Do not reuse production credentials or data.
2. Use the Supabase connection string appropriate to the caller. For a
   persistent external API/worker, use the Session Pooler endpoint on port
   `5432` with TLS required. Use a direct connection for migrations and backup
   tooling only when the network path supports it.
3. Put the development connection string only in a server-side environment
   file or secret manager. Start from `infra/compose/.env.aws.example` when
   running the API and worker against a managed database.
4. Run migrations once per deployment with `make aws-migrate`; it is named for
   the production-shaped Compose topology but is safe to use with a
   development Supabase connection string.

The configuration uses a standard PostgreSQL `DATABASE_URL`; no Supabase SDK
or browser database access is required for this application.

## Configure the Vercel project

Run Vercel CLI commands from the monorepo root, not from `apps/web`:

```bash
pnpm dlx vercel link --repo
pnpm dlx vercel pull --yes --environment=preview
```

In the Vercel project settings:

1. Set **Root Directory** to `apps/web`.
2. Enable **Include files outside the Root Directory** because the web app
   imports `packages/contracts` from the workspace.
3. Use pnpm with this install command:

   ```bash
   pnpm install --frozen-lockfile
   ```

4. Set the build command to build the shared contracts before the web app:

   ```bash
   pnpm --filter @three-zero-four/contracts build && pnpm --filter @three-zero-four/web build
   ```

5. Configure `NEXT_PUBLIC_GAME_SERVICE_URL` separately for Preview and
   Production. It must be an HTTPS API URL, never a database URL.
6. Restrict environment-variable editing to the deployment operators and keep
   production values separate from Preview values.

## Preview, shared development, and CORS

Random `*.vercel.app` preview URLs are suitable for UI and build checks. They
are not authenticated playable-table origins: the game uses strict allowed
origins and same-site session cookies.

For a shared playable development environment, configure stable HTTPS aliases
such as:

```text
https://preview.dev.example.com
https://api.dev.example.com
```

Set the game-service values for that environment to:

```text
CORS_ORIGINS=https://preview.dev.example.com
```

`CORS_ORIGINS` is a comma-separated exact allowlist. Do not use wildcard
origins, reflect arbitrary `Origin` headers, or put the API URL in that list.
Use a separate `https://app.example.com` entry in production.

## Release and rollback

Build an immutable preview locally or in CI, then deploy it:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm dlx vercel pull --yes --environment=preview
pnpm dlx vercel build
pnpm dlx vercel deploy --prebuilt
```

After smoke-testing the stable preview alias against its matching API, promote
the verified deployment:

```bash
pnpm dlx vercel promote <deployment-url>
```

If the web release fails, promote the previously known-good Vercel deployment.
If an API or schema release is involved, use the production rollback procedure
in the AWS guide; do not assume a Vercel rollback changes server behavior.

## Pre-release checklist

- `pnpm check`, browser E2E, and the local release rehearsal are green.
- Preview and production have separate public API URLs.
- Stable shared-development aliases and exact CORS values are configured.
- No server secret is exposed in `NEXT_PUBLIC_*` variables or client bundles.
- The linked Vercel project is the intended environment before running
  `vercel deploy` or `vercel promote`.
