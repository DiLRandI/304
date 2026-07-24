import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("production CI and runbook cover immutable install, verification, recovery, and rollback", () => {
  const workflow = read(".github/workflows/ci.yml");
  const runbook = read("docs/operations/production-foundation.md");
  const compose = read("infra/compose/compose.yaml");
  const gameServiceDockerfile = read("apps/game-service/Dockerfile");

  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+fetch-depth: 0/,
  );
  assert.match(workflow, /uses: actions\/setup-node@[0-9a-f]{40}/);
  const checkoutIndex = workflow.indexOf("uses: actions/checkout@");
  const composeEnvironmentIndex = workflow.indexOf(
    "name: Prepare Compose environment",
  );
  const setupNodeIndex = workflow.indexOf("uses: actions/setup-node@");
  assert.ok(checkoutIndex < composeEnvironmentIndex);
  assert.ok(composeEnvironmentIndex < setupNodeIndex);
  assert.match(
    workflow,
    /name: Prepare Compose environment\n\s+run: cp infra\/compose\/\.env\.example infra\/compose\/\.env/,
  );
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm audit --audit-level=high/);
  assert.match(workflow, /pnpm audit signatures/);
  assert.match(workflow, /compose\.yaml up --build --wait/);
  assert.match(workflow, /127\.0\.0\.1:4100\/livez/);
  assert.match(workflow, /127\.0\.0\.1:4100\/readyz/);
  assert.match(
    workflow,
    /--project-name g304-integration -f infra\/compose\/compose\.yaml up --build --wait postgres redis/,
  );
  assert.match(
    workflow,
    /--project-name g304-integration -f infra\/compose\/compose\.yaml run --rm --no-deps migrate/,
  );
  assert.match(
    workflow,
    /--project-name g304-integration -f infra\/compose\/compose\.yaml --profile integration build integration/,
  );
  assert.match(
    workflow,
    /--project-name g304-integration -f infra\/compose\/compose\.yaml --profile integration run --rm --no-deps integration/,
  );
  assert.match(workflow, /if: failure\(\)[\s\S]*compose\.yaml ps/);
  assert.match(compose, /integration:[\s\S]*target: test/);
  assert.match(compose, /integration:[\s\S]*profiles: \["integration"\]/);
  assert.match(compose, /worker:[\s\S]*dist\/src\/worker\.js/);
  assert.match(compose, /worker:[\s\S]*healthcheck/);
  assert.match(gameServiceDockerfile, /FROM build AS test/);
  assert.match(
    gameServiceDockerfile,
    /FROM build AS production-deps[\s\S]*pnpm --filter @three-zero-four\/game-service --prod deploy/,
  );
  assert.match(
    gameServiceDockerfile,
    /COPY --from=build --chown=65532:65532 \/app\/infra\/postgres\/migrations \/infra\/postgres\/migrations/,
  );
  assert.match(runbook, /durable-rooms\.integration\.test\.ts/);
  assert.match(runbook, /--project-name g304-integration/);
  assert.match(runbook, /pg_dump/);
  assert.match(runbook, /pg_restore/);
  assert.match(runbook, /\/readyz/);
  assert.match(runbook, /WebSocket/);
  assert.match(runbook, /automation worker/);
  assert.match(runbook, /ROOM_RECOVERY_FAILED/);
  assert.match(runbook, /duplicate socket snapshot/);
  assert.match(runbook, /Rollback/);
});

test("public-release CI includes browser, scanner, load, and restore gates", () => {
  const workflow = read(".github/workflows/ci.yml");
  const readme = read("README.md");
  const webPackage = read("apps/web/package.json");
  const restoreScript = read("scripts/backup-restore-rehearsal.sh");
  const loadSmoke = read("infra/load/browser-api-smoke.js");
  const releaseRunbook = read("docs/operations/public-release.md");

  assert.match(webPackage, /"e2e": "playwright test"/);
  assert.match(webPackage, /"@playwright\/test"/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /playwright test/);
  assert.match(workflow, /gitleaks/);
  assert.match(workflow, /trivy/);
  assert.match(workflow, /name: Scan release game-service image/);
  assert.match(workflow, /image-ref: three-zero-four-game-service:latest/);
  assert.match(workflow, /name: Scan release web image/);
  assert.match(workflow, /image-ref: three-zero-four-web:latest/);
  assert.match(workflow, /backup-restore-rehearsal\.sh/);
  assert.match(
    workflow,
    /G304_RESTORE_REHEARSAL=1 scripts\/backup-restore-rehearsal\.sh/,
  );
  assert.match(workflow, /browser-api-smoke\.js/);
  assert.match(
    workflow,
    /Reset disposable rate-limit windows before load smoke[\s\S]*g304:rate:\*[\s\S]*browser-api-smoke\.js/,
  );
  assert.match(workflow, /upload-artifact@[0-9a-f]{40}/);
  assert.match(restoreScript, /trap cleanup EXIT/);
  assert.match(restoreScript, /G304_RESTORE_REHEARSAL/);
  assert.match(restoreScript, /pg_restore/);
  assert.match(restoreScript, /schema_migrations/);
  assert.match(loadSmoke, /MAX_CONCURRENCY/);
  assert.match(loadSmoke, /MAX_DURATION_MS/);
  assert.match(loadSmoke, /guest-sessions/);
  assert.match(releaseRunbook, /Public-release rehearsal/);
  assert.match(releaseRunbook, /G304_RESTORE_REHEARSAL=1/);
  assert.match(readme, /Public-release rehearsal/);
});

test("integration fixtures make forced-due jobs tolerant of container clock skew", () => {
  const automation = read(
    "apps/game-service/test/room-automation.integration.test.ts",
  );
  const recovery = read(
    "apps/game-service/test/recovery-fuzz.integration.test.ts",
  );

  for (const fixture of [automation, recovery]) {
    assert.doesNotMatch(fixture, /SET due_at = now\(\) WHERE/);
    assert.match(fixture, /SET due_at = now\(\) - interval '1 second'/);
  }
});

test("delivery workflow keeps local and external-Postgres AWS contracts visible", () => {
  const makefile = read("Makefile");
  const awsCompose = read("infra/compose/compose.aws.yaml");
  const awsEnv = read("infra/compose/.env.aws.example");
  const vercelGuide = read("docs/deployment/vercel-supabase-development.md");
  const awsGuide = read("docs/deployment/aws-mumbai-production-cost-first.md");

  assert.match(makefile, /^local-up:/m);
  assert.match(makefile, /^aws-config:/m);
  assert.match(makefile, /^aws-migrate:/m);
  assert.match(makefile, /^aws-up:/m);
  assert.match(awsCompose, /services:[\s\S]*game-service:/);
  assert.match(awsCompose, /services:[\s\S]*worker:/);
  assert.match(awsCompose, /services:[\s\S]*redis:/);
  assert.doesNotMatch(awsCompose, /^ {2}postgres:/m);
  assert.doesNotMatch(awsCompose, /postgres-data/);
  const redis =
    awsCompose.match(
      /^ {2}redis:\n([\s\S]*?)(?=^ {2}[a-z-]+:|^volumes:)/m,
    )?.[0] ?? "";
  const gameService =
    awsCompose.match(
      /^ {2}game-service:\n([\s\S]*?)(?=^ {2}[a-z-]+:|^volumes:)/m,
    )?.[0] ?? "";
  assert.doesNotMatch(redis, /ports:/);
  assert.match(gameService, /127\.0\.0\.1:4100:4100/);
  assert.match(awsEnv, /DATABASE_URL=/);
  assert.match(awsEnv, /TRUSTED_PROXY_IPS=172\.31\.240\.1/);
  assert.match(vercelGuide, /NEXT_PUBLIC_GAME_SERVICE_URL/);
  assert.match(awsGuide, /ap-south-1/);
  assert.match(awsGuide, /DataTransfer/);
});

test("AWS Make targets migrate before readiness and retain Redis data on shutdown", () => {
  const makefile = read("Makefile");
  const awsConfig = makefile.match(/^aws-config:\n(?:\t.*\n)*/m)?.[0] ?? "";
  const awsMigrate = makefile.match(/^aws-migrate:\n(?:\t.*\n)*/m)?.[0] ?? "";
  const awsDown = makefile.match(/^aws-down:\n(?:\t.*\n)*/m)?.[0] ?? "";

  assert.match(makefile, /^aws-up: aws-migrate$/m);
  assert.match(awsConfig, /\$\(AWS_COMPOSE\) config --quiet/);
  assert.match(
    awsMigrate,
    /\$\(AWS_COMPOSE\) --profile migration build migrate game-service worker/,
  );
  assert.match(
    awsMigrate,
    /\$\(AWS_COMPOSE\) --profile migration run --rm --no-deps migrate/,
  );
  assert.match(
    makefile,
    /\$\(AWS_COMPOSE\) up --detach --wait redis game-service worker/,
  );
  assert.match(awsDown, /\$\(AWS_COMPOSE\) down --remove-orphans/);
  assert.doesNotMatch(awsDown, /--volumes/);
});
