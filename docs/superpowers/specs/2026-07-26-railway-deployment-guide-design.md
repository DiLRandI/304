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

## Required content

The guide must:

- describe the web, game API, automation worker, PostgreSQL, and Redis services;
- use Railway-generated HTTPS domains, without requiring a custom domain;
- set `RAILWAY_DOCKERFILE_PATH` to `/apps/web/Dockerfile` for the web image and
  `/apps/game-service/Dockerfile` for the API, migration, and worker processes;
- identify `node dist/scripts/migrate.js` as the pre-deploy migration command
  and `node dist/src/worker.js` as the worker start-command override;
- show which variables are build-time web configuration and which variables
  must be shared by the API and worker;
- explain that the worker must use the same PostgreSQL, Redis, and session
  secret as the API, and must not receive a public domain;
- verify the API live and ready endpoints and the worker's healthy polling;
- diagnose monorepo build failures, invalid service configuration, session
  `401` responses, origin rejection, and bidding that remains on a bot turn;
- avoid real credentials, project-specific service IDs, and claims that
  Railway itself supplies application-level CSRF protection.

## Validation

Review every command and variable against the checked-in Dockerfiles, runtime
configuration schema, Compose topology, and migration entry point. Run the
repository's Markdown/style checks through `pnpm check`, then inspect the final
diff for provider-specific secrets or unrelated changes.
