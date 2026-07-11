# Production delivery: Mumbai AWS with Supabase Postgres

This is the cost-first production topology for the initial public launch. It
keeps PostgreSQL in Supabase Mumbai and runs the game API, worker, and Redis on
one small AWS ARM instance in Mumbai (`ap-south-1`). It deliberately avoids
managed AWS components until measured demand justifies them.

## Initial topology

```text
Players
  -> Vercel: https://app.example.com (Next.js)
  -> AWS Elastic IP + Caddy: https://api.example.com
       -> loopback Fastify game service
       -> worker + local Redis (AOF enabled)
       -> Supabase Postgres, Mumbai, TLS session pooler
```

Use one small Graviton EC2 instance after load testing (start with a
`t4g.small`-class size unless the test result requires more), a small gp3 EBS
volume, an Elastic IP, Route 53 DNS, and AWS Systems Manager Session Manager.
The instance is intentionally a single availability-zone failure domain for
launch. Redis is non-authoritative; PostgreSQL remains the durable source of
truth.

Do **not** add an ALB, NAT Gateway, ECS/Fargate, ElastiCache, multi-AZ
replicas, or Supabase PrivateLink for the initial launch. Those are scaling
decisions, not defaults.

## Network and host baseline

1. Create the EC2 instance in `ap-south-1` with the SSM managed-instance role.
   Use Session Manager for administration instead of opening SSH to the
   Internet.
2. Attach an Elastic IP. Record it as the fixed outbound address for Supabase
   network allowlisting, if allowlisting is enabled.
3. Restrict the security group to inbound TCP 80 and 443. Do not publish the
   Docker API or Redis. The Compose file binds the game API only to
   `127.0.0.1:4100`.
4. Install Docker, the Compose plugin, and Caddy. Configure Caddy to terminate
   TLS and proxy the public API to loopback:

   ```caddy
   api.example.com {
     reverse_proxy 127.0.0.1:4100
   }
   ```

5. Point `api.example.com` to the Elastic IP. Point `app.example.com` to the
   promoted Vercel deployment. Keep those hostnames stable before enabling
   cookie-authenticated play.

## Supabase production database

Create a distinct Supabase production project in Mumbai (`ap-south-1`). Store
its credentials in the host secret-management process; do not place them in
Vercel or the repository.

For the persistent API and worker, use the Supabase Session Pooler endpoint on
port `5432` with TLS required. Use the direct database endpoint for migrations,
`pg_dump`, and restore tooling only where the host has IPv6 or a supported
network path. Keep `DATABASE_URL` server-side and set `sslmode=require`.

Before launch, set database connection limits based on the API and worker pool
sizes. Connection pooling limits reduce both operational risk and unexpected
compute pressure.

## Deploy API, worker, and Redis

On the host, clone the approved revision and create the production-shaped
environment file:

```bash
cp infra/compose/.env.aws.example infra/compose/.env.aws
chmod 600 infra/compose/.env.aws
```

Set at least these values in `infra/compose/.env.aws`:

```text
DATABASE_URL=postgres://...@aws-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
REDIS_URL=redis://redis:6379
CORS_ORIGINS=https://app.example.com
TRUSTED_PROXY_IPS=172.31.240.1
SESSION_COOKIE_NAME=g304_session
SESSION_SECRET_PEPPER=<at-least-32-random-characters>
```

Deploy in this order:

```bash
make aws-config
make aws-migrate
make aws-up
make aws-logs
```

`make aws-migrate` builds the migration, API, and worker images before running
the migration. `make aws-up` then starts those same images and waits for Redis,
the API, and the worker. `make aws-down` stops containers without deleting the
Redis AOF volume. It is for controlled maintenance, not a data-reset command.

The AWS Compose network reserves `172.31.240.1` as the Docker bridge gateway,
which is the host-level Caddy source address inside the API container. Keep
`TRUSTED_PROXY_IPS` set only to that gateway: it allows Fastify to use Caddy's
`X-Forwarded-For` client IP for rate limiting without trusting headers from any
other source. Do not expose port 4100 beyond loopback or add another proxy
without updating and testing this allowlist.

Confirm `/livez` and `/readyz` through the API hostname before promoting the
matching Vercel web deployment. Caddy—not Docker port publishing—is the public
edge for the API.

## Release, rollback, and recovery

1. Build and verify the Vercel web deployment using the development guide.
2. Apply the backward-compatible database migration once with `make aws-migrate`.
3. Start the compatible API and worker with `make aws-up`.
4. Smoke-test `https://api.example.com/livez`, `https://api.example.com/readyz`,
   sign-in, a playable table, and reconnect behavior.
5. Promote the already-tested Vercel deployment.

For a web-only failure, promote the previous Vercel deployment. For an API
failure, return to the previously verified application image or Git revision,
then run `make aws-up`; do not roll back a destructive schema migration by
guesswork. Restore Supabase only through the established backup/restore
rehearsal and operator runbook.

## External traffic and cost controls

AWS and Supabase are separate providers. Matching the Mumbai region name does
not make cross-provider traffic free. Budget it on both sides:

```text
monthly platform cost = Vercel plan and usage
                      + Supabase plan, compute, disk, backup, and egress
                      + EC2 instance, EBS, public IPv4 or Elastic IP, and DNS
                      + AWS DataTransfer usage and backup storage
```

Supabase meters database and Shared Pooler egress. On AWS, review Cost Explorer
and the Cost and Usage Report grouped by `DataTransfer`; include internet-facing
API traffic as well as traffic between EC2 and Supabase. Use the current AWS
Pricing Calculator and Supabase dashboard for estimates instead of committing
time-sensitive dollar figures to this repository.

At launch, configure these guardrails:

- AWS Budget alerts at 50%, 80%, and 100% of the approved monthly limit.
- AWS Cost Anomaly Detection for unexpected `DataTransfer`, EC2, and public
  IPv4 charges.
- Supabase spend, compute, disk, and egress alerts at equivalent thresholds.
- A weekly review of Vercel usage, Supabase egress, and AWS Cost Explorer.
- Application metrics for database connections, Redis memory, request latency,
  error rate, room count, and worker backlog.

## When to scale beyond one host

Revisit the topology when any threshold persists for 15 minutes, a game SLO is
missed, or a launch budget alert fires:

- Sustained CPU above 70%, memory pressure, or disk growth beyond the planned
  headroom.
- Database pool saturation, queue backlog, reconnect failures, or Redis memory
  exhaustion.
- A single-host availability risk no longer matches the product commitment.
- Cross-provider egress is a material share of the monthly cost.

Scale from evidence: increase the EC2 size first, then consider separate Redis,
multiple API instances behind an ALB, ECS/Fargate, or a private connectivity
option only after comparing the added availability benefit with its recurring
cost.
