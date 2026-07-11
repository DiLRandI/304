# Vercel, Supabase, and Cost-First AWS Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Dockerized game easy to run locally, document Vercel/Supabase development delivery, and provide a cost-controlled AWS Mumbai launch path without deploying cloud resources.

**Architecture:** Keep the existing full Compose topology for local development. Add a separate AWS Compose file that runs only Redis, the Fastify API, a migration command, and the automation worker against externally managed Supabase Postgres. Vercel hosts the Next.js client; an EC2 host in Mumbai runs the stateful backend and Caddy is configured by the operator as the external TLS proxy.

**Tech Stack:** pnpm 11.10.0, Node 24.18.0, Docker Compose, Next.js 16, Fastify, Redis 8, Supabase Postgres, Vercel, AWS EC2 Mumbai.

## Global Constraints

- Keep `apps/web/Dockerfile` and `apps/game-service/Dockerfile`; they already build the release images.
- Never put real cloud credentials, database URLs, Vercel tokens, Supabase service keys, domains, or passwords in tracked files.
- `apps/web` receives only `NEXT_PUBLIC_GAME_SERVICE_URL`; it never receives a Supabase database URL or service-role key.
- Production remains server-authoritative: only the Fastify API and worker connect to Postgres/Redis.
- Use `ap-south-1` for AWS and Supabase Mumbai; document cross-provider traffic as external cost, not free in-region traffic.
- Do not introduce ALB, NAT Gateway, ECS/Fargate, ElastiCache, or PrivateLink into the initial launch topology.
- Random `*.vercel.app` previews are not authenticated game origins; stable same-site aliases require exact `CORS_ORIGINS` entries.

---

### Task 1: Lock the delivery contract into CI-visible regression coverage

**Files:**
- Modify: `test/production-foundation-ci.test.mjs`
- Test: `test/production-foundation-ci.test.mjs`

**Interfaces:**
- Consumes: root `read(relative)` test helper.
- Produces: a static release-contract assertion for the Makefile, AWS Compose overlay, and deployment guides.

- [ ] **Step 1: Write the failing regression test**

Add a third test that reads `Makefile`, `infra/compose/compose.aws.yaml`,
`infra/compose/.env.aws.example`, and both new guide paths. Require these
strings:

```js
assert.match(makefile, /^local-up:/m);
assert.match(makefile, /^aws-config:/m);
assert.match(makefile, /^aws-migrate:/m);
assert.match(makefile, /^aws-up:/m);
assert.match(awsCompose, /services:[\s\S]*game-service:/);
assert.match(awsCompose, /services:[\s\S]*worker:/);
assert.match(awsCompose, /services:[\s\S]*redis:/);
assert.doesNotMatch(awsCompose, /^  postgres:/m);
assert.match(awsEnv, /DATABASE_URL=/);
assert.match(vercelGuide, /NEXT_PUBLIC_GAME_SERVICE_URL/);
assert.match(awsGuide, /ap-south-1/);
assert.match(awsGuide, /DataTransfer/);
```

- [ ] **Step 2: Run the regression test to verify RED**

Run:

```bash
node --test test/production-foundation-ci.test.mjs
```

Expected: FAIL with `ENOENT` for `Makefile` because the workflow artifacts do
not exist yet.

- [ ] **Step 3: Keep the assertion focused**

Do not assert a price, a real hostname, or a cloud credential. The test guards
the repo-owned delivery boundary, while cloud resources remain operator-owned.

### Task 2: Add local and external-Postgres Compose workflows

**Files:**
- Create: `Makefile`
- Create: `infra/compose/compose.aws.yaml`
- Create: `infra/compose/.env.aws.example`
- Test: `test/production-foundation-ci.test.mjs`

**Interfaces:**
- Consumes: existing `infra/compose/compose.yaml`, `apps/game-service/Dockerfile`, `apps/web/Dockerfile`, and ignored `infra/compose/.env` behavior.
- Produces: `make local-up`, `make local-down`, `make check`, `make e2e`, `make integration`, `make images`, `make aws-config`, `make aws-migrate`, `make aws-up`, `make aws-down`, and `make aws-logs`.

- [ ] **Step 1: Implement a transparent root Makefile**

Define these variables and phony targets:

```make
PNPM ?= pnpm
LOCAL_ENV ?= infra/compose/.env
LOCAL_COMPOSE = docker compose --env-file $(LOCAL_ENV) -f infra/compose/compose.yaml
AWS_ENV ?= infra/compose/.env.aws
AWS_COMPOSE = docker compose --env-file $(AWS_ENV) -f infra/compose/compose.aws.yaml

.PHONY: check local-up local-down e2e integration images aws-config aws-migrate aws-up aws-down aws-logs

check:
	$(PNPM) check

local-up:
	@test -f $(LOCAL_ENV) || (echo "Copy infra/compose/.env.example to $(LOCAL_ENV) first." >&2; exit 1)
	$(LOCAL_COMPOSE) up --build --wait
```

`integration` must use the isolated `g304-integration` project and its explicit
Postgres/Redis, migrate, build, test, and cleanup sequence. `aws-*` targets
must require the ignored `infra/compose/.env.aws`; `aws-migrate` must run the
profiled migration service before `aws-up` starts the API and worker.

- [ ] **Step 2: Create the AWS Compose overlay**

Create a standalone `compose.aws.yaml` with these services:

```yaml
services:
  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redis-data:/data"]
  migrate:
    profiles: ["migration"]
    command: ["node", "dist/scripts/migrate.js"]
  game-service:
    ports: ["127.0.0.1:4100:4100"]
  worker:
    command: ["node", "dist/src/worker.js"]
volumes:
  redis-data:
```

All application services use the existing game-service Dockerfile, external
`DATABASE_URL`, local Compose `REDIS_URL`, `CORS_ORIGINS`, session settings,
and maintenance settings. `game-service` and `worker` depend only on healthy
Redis. Do not declare Postgres, a Postgres volume, or a public Redis port.

- [ ] **Step 3: Create a safe AWS environment example**

Create `.env.aws.example` with syntactically valid placeholders, including:

```dotenv
DATABASE_URL=postgres://postgres.project:replace-with-supabase-password@aws-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
REDIS_URL=redis://redis:6379
CORS_ORIGINS=https://app.example.com
SESSION_COOKIE_NAME=g304_session
SESSION_SECRET_PEPPER=replace-with-at-least-32-random-characters-before-production
```

Include the current safe worker/maintenance defaults. Do not include Vercel,
Supabase, AWS, or real secret values.

- [ ] **Step 4: Verify the Compose contracts**

Run:

```bash
docker compose --env-file infra/compose/.env.aws.example -f infra/compose/compose.aws.yaml config --quiet
make -n local-up aws-config aws-migrate aws-up aws-down aws-logs
node --test test/production-foundation-ci.test.mjs
```

Expected: rendered Compose configuration exits zero, dry-runs expose only the
documented commands, and the new regression test passes.

- [ ] **Step 5: Commit the workflow**

```bash
git add Makefile infra/compose/compose.aws.yaml infra/compose/.env.aws.example test/production-foundation-ci.test.mjs
git commit -m "build: add local and aws compose workflows"
```

### Task 3: Write the Vercel and Supabase development guide

**Files:**
- Create: `docs/deployment/vercel-supabase-development.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Test: `test/production-foundation-ci.test.mjs`

**Interfaces:**
- Consumes: Make targets from Task 2, `apps/web` as the Vercel root, and the exact CORS behavior in `apps/game-service/src/config.ts`.
- Produces: safe local setup, Vercel preview/release steps, development Supabase posture, environment-variable map, and browser/API verification sequence.

- [ ] **Step 1: Write the guide with separate local and hosted paths**

Document these non-negotiable sections:

1. Local prerequisites and `cp infra/compose/.env.example infra/compose/.env`,
   `make local-up`, `make check`, and `make local-down`.
2. Supabase development project creation in Mumbai, append-only migrations,
   session-pooler `DATABASE_URL`, TLS, and no browser database credentials.
3. Vercel project configuration: repository root, root directory `apps/web`,
   pinned pnpm install command, build command, and `NEXT_PUBLIC_GAME_SERVICE_URL`.
4. Preview policy: random `*.vercel.app` deployments are UI/build previews;
   playable previews need a stable same-site Vercel alias and exact matching
   development API CORS origin. Never use `*.vercel.app` wildcard CORS.
5. Preview promotion/release verification using `vercel pull`, `vercel build`,
   `vercel deploy --prebuilt`, and `vercel promote` with token values stored
   only in Vercel or CI secrets.

- [ ] **Step 2: Link the guide from maintained entrypoints**

Add a short `Local and cloud delivery` section to `README.md` and a
`Deployment guides` section to `docs/README.md`. Both links must distinguish
local Compose from operator-owned cloud deployment.

- [ ] **Step 3: Verify documentation contract**

Run:

```bash
node --test test/production-foundation-ci.test.mjs
git diff --check
```

Expected: PASS with no whitespace errors.

- [ ] **Step 4: Commit the development guide**

```bash
git add README.md docs/README.md docs/deployment/vercel-supabase-development.md
git commit -m "docs: add vercel and supabase development guide"
```

### Task 4: Write the AWS Mumbai cost-first production guide

**Files:**
- Create: `docs/deployment/aws-mumbai-production-cost-first.md`
- Test: `test/production-foundation-ci.test.mjs`

**Interfaces:**
- Consumes: Task 2 AWS Compose commands, production environment example, and Vercel release process from Task 3.
- Produces: an operator-only, reversible AWS/Supabase/Vercel release runbook with cost attribution and scaling triggers.

- [ ] **Step 1: Describe the launch topology and security boundary**

Document Mumbai `ap-south-1`, one ARM EC2 host, EBS-backed Redis AOF, Caddy on
80/443, loopback API port, no public Redis, Elastic IP, TLS to Supabase, exact
`CORS_ORIGINS`, security groups, and AWS Systems Manager access. State that
this is a cost-first single-host topology, not high availability.

- [ ] **Step 2: Make cross-provider cost accounting actionable**

Add this formula and operational checks:

```text
monthly platform cost = Vercel plan/usage
                      + Supabase plan/compute/storage/egress
                      + EC2 + EBS + public IPv4/Elastic IP + Route 53
                      + AWS DataTransfer usage + backup storage
```

Explain that EC2-to-Supabase uses an external public TLS path at launch and is
not assumed free merely because both use Mumbai. Require Cost Explorer/CUR
checks for `DataTransfer` usage types and Supabase Billing checks for Database
or Shared Pooler Egress. Require budgets/anomaly alerts and 50/80/100 percent
notifications before enabling public traffic.

- [ ] **Step 3: Document deploy, test, rollback, and upgrade triggers**

Show exact use of `make aws-config`, `make aws-migrate`, `make aws-up`,
`make aws-logs`, and `make aws-down`; then configure the Vercel production
origin and promote a verified preview. Require `/livez`, `/readyz`, browser
acceptance, WebSocket room confirmation, backup/restore, and post-deploy cost
review. Require forward-only migration rollback. Define the 70 percent
resource/15 minute, SLO, single-host-risk, and egress-budget triggers from the
design as mandatory architecture-review conditions.

- [ ] **Step 4: Verify and commit the production guide**

Run:

```bash
node --test test/production-foundation-ci.test.mjs
git diff --check
git add docs/deployment/aws-mumbai-production-cost-first.md
git commit -m "docs: add aws mumbai cost-first launch guide"
```

### Task 5: Final verification and local merge

**Files:**
- Verify: `Makefile`
- Verify: `infra/compose/compose.aws.yaml`
- Verify: `docs/deployment/vercel-supabase-development.md`
- Verify: `docs/deployment/aws-mumbai-production-cost-first.md`

- [ ] **Step 1: Run all repository checks**

```bash
pnpm check
node --test test/production-foundation-ci.test.mjs
docker compose --env-file infra/compose/.env.aws.example -f infra/compose/compose.aws.yaml config --quiet
git diff --check master...HEAD
```

Expected: all commands exit zero. The host Node patch-level warning is not a
product failure because the Dockerfiles pin Node 24.18.0; report it accurately.

- [ ] **Step 2: Confirm merge safety**

```bash
git status --short
git -C /home/deleema/learning/304-game status --short
```

Expected: feature worktree is clean and the root worktree has no unrelated
changes to overwrite.

- [ ] **Step 3: Merge locally without pushing**

```bash
git -C /home/deleema/learning/304-game merge --no-ff feature/vercel-supabase-aws-launch-docs -m "merge: add cloud delivery workflows"
```

Do not push, deploy Vercel, create cloud resources, or add any external secret.
