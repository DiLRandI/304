# Railway Deployment Guide Design

## Goal

Add a provider-specific runbook that lets an operator deploy the complete 304
Online topology to Railway and diagnose the failures already observed during
the first deployment.

## Documentation structure

Create `docs/deployment/railway.md` as the single Railway entry point. Keep the
existing AWS and Vercel/Supabase guides unchanged because they describe
different provider topologies. Link the new guide from both documentation
indexes so it is discoverable from the repository root and `docs/`.

Keep per-service build and deployment settings in `railway/web.json`,
`railway/api.json`, and `railway/worker.json`. Each service selects its own
absolute config path in Railway, while variables, service references, secrets,
and generated domains remain environment-owned settings.

## Required content

The guide must:

- describe the web, game API, automation worker, PostgreSQL, and Redis services;
- use Railway-generated HTTPS domains, without requiring a custom domain;
- use `/apps/web/Dockerfile` for the web image and
  `/apps/game-service/Dockerfile` for the API, migration, and worker processes;
- supply service-specific Railway config-as-code files with exact build,
  process, pre-deploy, restart, and healthcheck settings;
- identify `node dist/scripts/migrate.js` as the pre-deploy migration command
  and `node dist/src/worker.js` as the worker start-command override;
- show which variables are build-time web configuration and which variables
  must be shared by the API and worker;
- explain that the worker must use the same PostgreSQL, Redis, and session
  secret as the API, and must not receive a public domain;
- verify the API live and ready endpoints and the worker's healthy polling;
- explain the application-owned exact-origin, credentialed-cookie, and
  session-bound CSRF contract without treating its token as deployment
  configuration;
- diagnose monorepo build failures, invalid service configuration, session
  `401` responses, origin or CSRF rejection, and bidding that remains on a bot
  turn;
- avoid real credentials, project-specific service IDs, and claims that
  Railway itself supplies application-level CSRF protection.

## Validation

Review every command and variable against the checked-in Dockerfiles, runtime
configuration schema, Compose topology, and migration entry point. Run the
config contract test through a red-green cycle and the repository's full
checks through `pnpm check`, then inspect the final diff for provider-specific
secrets or unrelated changes.
