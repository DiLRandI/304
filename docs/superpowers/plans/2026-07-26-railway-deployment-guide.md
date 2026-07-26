# Railway Deployment Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a discoverable, source-verified Railway deployment and troubleshooting guide for the complete 304 Online service topology.

**Architecture:** Keep Railway instructions in a dedicated provider guide and link it from the existing documentation indexes. Derive commands, paths, variables, and health checks from the checked-in Dockerfiles, configuration schema, migration script, and Compose topology.

**Tech Stack:** Markdown, Railway, Docker, Next.js, Fastify, Node.js, PostgreSQL, Redis

## Global Constraints

- Railway-generated HTTPS domains are sufficient; do not require a custom domain.
- Never include real credentials, Railway project IDs, or deployed service IDs.
- The API and worker share PostgreSQL, Redis, session-secret, and origin configuration.
- The worker is private and receives no public domain.
- Commands and paths must match the checked-in source.

---

### Task 1: Add the Railway deployment guide

**Files:**
- Create: `docs/deployment/railway.md`

**Interfaces:**
- Consumes: `apps/web/Dockerfile`, `apps/game-service/Dockerfile`, `apps/game-service/src/platform/config/service-config.ts`, `apps/game-service/scripts/migrate.ts`, and `infra/compose/compose.yaml`
- Produces: the operator-facing Railway setup, verification, and troubleshooting procedure

- [ ] **Step 1: Write the topology and deployment-order sections**

Document PostgreSQL and Redis provisioning followed by the game API, worker,
and web services. State that the worker has no public domain.

- [ ] **Step 2: Write exact build, start, migration, and variable settings**

Use `RAILWAY_DOCKERFILE_PATH=/apps/web/Dockerfile`,
`RAILWAY_DOCKERFILE_PATH=/apps/game-service/Dockerfile`,
`node dist/scripts/migrate.js`, and `node dist/src/worker.js`. Separate
build-time web variables from API/worker runtime variables and use placeholders
for generated Railway domains and the session secret.

- [ ] **Step 3: Write verification and troubleshooting**

Cover `/livez`, `/readyz`, worker startup/polling, missing internal package
builds, invalid runtime configuration, CORS/origin mistakes, `401` session
failures, and bot bidding that does not advance.

### Task 2: Link and verify the guide

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: `docs/deployment/railway.md`
- Produces: discoverable links from both repository documentation indexes

- [ ] **Step 1: Add both navigation links**

Add Railway beside the existing provider-specific deployment guides without
changing their documented scope.

- [ ] **Step 2: Validate the documentation**

Run:

```bash
pnpm check
git diff --check
rg -n "railway|Railway" README.md docs/README.md docs/deployment/railway.md
```

Expected: all checks pass, both indexes link the guide, and the guide contains
no real credentials or project/service identifiers.

- [ ] **Step 3: Commit the documentation**

```bash
git add README.md docs/README.md docs/deployment/railway.md \
  docs/superpowers/specs/2026-07-26-railway-deployment-guide-design.md \
  docs/superpowers/plans/2026-07-26-railway-deployment-guide.md
git commit -m "docs: add Railway deployment guide"
```
