# Vercel, Supabase, and Cost-First AWS Delivery Design

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Decision:** Deploy the Next.js player client on Vercel, retain PostgreSQL on
Supabase in Mumbai (`ap-south-1`), and run the existing Fastify API, durable
automation worker, and Redis on one small AWS Mumbai EC2 host for the initial
public launch.

## Goal

Provide repeatable local commands and two operator guides: one for Vercel and
Supabase development/preview delivery, and one for a cost-controlled Mumbai
production launch. The guides must keep game authority in the existing API and
must make cross-provider database traffic, egress, and scaling costs visible.

## Scope

The work adds a root `Makefile`, a production Compose overlay and example
environment file, deployment documentation, and regression checks for the
documented commands. It reuses the existing production Dockerfiles for
`apps/web` and `apps/game-service`; it does not replace the game service,
worker, room authority, or Postgres migrations.

It does not create Vercel, Supabase, AWS, DNS, billing, or secret-store
resources. Those actions require an authorized operator and credentials.

## Architecture

### Local development

Local development remains the full disposable Compose topology:

```text
browser -> web:3000 -> game-service:4100 -> Postgres + Redis
                                      -> worker
```

`make local-up` copies no secrets and starts the existing local Compose stack
only after an operator has copied `infra/compose/.env.example` to the ignored
`infra/compose/.env`. `make local-down`, `make check`, `make e2e`, and
`make integration` expose the existing release gates without hiding their
destructive or external effects.

### Vercel development and previews

Vercel is the deployment host for `apps/web`, which is the release-facing
Next.js application. Configure the Vercel project root as `apps/web` and use
the repository's pinned Node and pnpm toolchain. Preview deployments receive a
non-production `NEXT_PUBLIC_GAME_SERVICE_URL` that points to a reachable shared
development API; a Vercel browser deployment cannot reach a developer's
localhost Compose network.

The random `*.vercel.app` preview domain is useful for UI/build review but is
not an authenticated game-table origin. The API uses exact allowlisted origins
and same-site session cookies. A full shared development game must instead use
a stable Vercel alias below an operator-owned development domain (for example,
`preview.dev.example.com`) together with `api.dev.example.com`; both origins
are added exactly to the development API's `CORS_ORIGINS` list. Do not add a
wildcard Vercel suffix to the API allowlist.

A separate Supabase development project in Mumbai contains only development
data. Its database URL belongs exclusively in the development API/worker
environment. The browser receives only the public API origin; it never receives
a Supabase database URL, database password, service-role key, or migration
credential.

### Cost-first production launch

```text
Vercel app.example.com
       |
       +--> HTTPS / WebSocket --> EC2 Mumbai api.example.com
                                      |- Caddy: TLS + reverse proxy
                                      |- game-service container
                                      |- worker container
                                      `- Redis container with AOF volume
                                                     |
                                                     `--> TLS -> Supabase Postgres Mumbai
```

The initial AWS host is one small ARM EC2 instance in `ap-south-1`. Caddy is
the only process listening on ports 80 and 443; the game-service container is
not published directly to the internet. The worker has no public listener.
Redis remains an availability/coordination cache; Postgres remains the durable
source of truth. Use an Elastic IP so Supabase can restrict database and
pooler access to a stable AWS egress address. SSH is not a normal deployment
path: use AWS Systems Manager Session Manager or another approved operator
access path.

The persistent game service uses Supabase's session pooler connection string
on port 5432 when the EC2 network requires IPv4. Migrations and backup/restore
use the Supabase direct connection when available, as recommended by Supabase.
All database connections require TLS.

The launch deliberately excludes an Application Load Balancer, NAT Gateway,
ECS/Fargate, ElastiCache, multi-AZ service replicas, and Supabase PrivateLink.
Those services can be valuable later but add fixed or usage-based cost that is
not justified before real game traffic exists.

## Cross-provider traffic and cost controls

Mumbai placement reduces latency but does not make EC2-to-Supabase traffic
free. Supabase is a separate provider account and the initial connection uses
the public TLS endpoint. Cost accounting therefore includes both provider
views:

1. Supabase accounts for data that leaves its Database or Supavisor pooler as
   unified egress. Record the included plan quota and egress overage rate from
   the live Supabase billing page before launch.
2. AWS accounts for EC2 network transfer according to the actual source,
   destination, and network path. Inspect Cost Explorer or the Cost and Usage
   Report for Mumbai `DataTransfer` usage types; do not apply same-VPC or
   same-AWS-account assumptions to Supabase traffic.
3. The public IPv4/Elastic IP, EC2 instance, EBS volume, Route 53 hosted zone,
   backup storage, and outbound transfer are separate AWS budget lines.
4. The API returns only the projected room state required by each player;
   browser clients never query Supabase directly. This reduces egress and
   preserves server authority.

Before production traffic, configure an AWS Budget and Cost Anomaly Detection
alert for the production account and a Supabase spend cap/usage alert. Review
both at 50%, 80%, and 100% of the operator-approved monthly budget. Tag all AWS
resources with `application=304-online`, `environment=production`, and
`cost-center=game` so transfer and compute spend can be attributed correctly.

Supabase PrivateLink is an optional later upgrade for a Team or Enterprise
project when private database connectivity, compliance, or traffic volume
justifies its Supabase and AWS endpoint costs. It is not assumed to reduce
total bill without a new pricing calculation.

## Release and rollback flow

1. Run `make check`, the local Compose rehearsal, browser acceptance, and
   backup/restore rehearsal.
2. Apply append-only migrations to the production Supabase project from an
   approved migration environment; do not run them from the Vercel browser
   deployment.
3. Build the existing API and web images with the production API origin,
   deploy the API/worker to the AWS host, and verify `/livez`, `/readyz`, worker
   heartbeat, and a private WebSocket room.
4. Deploy a Vercel preview with the production candidate API origin, run the
   browser acceptance suite against it, and promote the verified preview to
   production.
5. Roll back the web by promoting the prior Vercel deployment. Roll back the
   API/worker to the prior image only when migrations remain compatible; use
   forward-only corrective migrations instead of destructive down migrations.

## Scaling triggers

The AWS guide must define the initial host as a launch baseline, not a permanent
high-availability topology. Reassess the design before either API/worker
resource use remains above 70% for 15 minutes, connection/room latency violates
the release SLO, a single-host failure is no longer acceptable, or observed
cross-provider egress materially changes the monthly budget. The next design
must compare ECS/Fargate, managed Redis, an ALB, NAT or PrivateLink, and a
Supabase compute/replica change using current Mumbai pricing.

## Documentation and workflow artifacts

- Create `Makefile` with transparent local, verification, image, and
  production-preflight targets.
- Create `infra/compose/compose.aws.yaml` that runs only the API, worker, and
  Redis behind an external reverse proxy, never a local Postgres service.
- Create `infra/compose/.env.aws.example` with names only, no real values.
- Create `docs/deployment/vercel-supabase-development.md` for local, Supabase
  development, and Vercel Preview/production release instructions.
- Create `docs/deployment/aws-mumbai-production-cost-first.md` for EC2,
  network, cross-provider traffic, cost controls, deployment, rollback, and
  scaling triggers.
- Update `README.md` and `docs/README.md` with concise links to the commands
  and operator guides.
- Extend the existing production-foundation static regression test so CI keeps
  the Make targets, AWS Compose overlay, and both deployment guides present.

## References

- Supabase supports the specific Mumbai AWS region `ap-south-1`:
  <https://supabase.com/docs/guides/platform/regions>
- Supabase connection modes and persistent/serverless guidance:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase unified egress accounting and current published overage rules:
  <https://supabase.com/docs/guides/platform/manage-your-usage/egress>
- Supabase database network restrictions:
  <https://supabase.com/docs/guides/platform/network-restrictions>
- Supabase PrivateLink scope and requirements:
  <https://supabase.com/docs/guides/platform/privatelink>
- AWS transfer charge attribution:
  <https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html>
