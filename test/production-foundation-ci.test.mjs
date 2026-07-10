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

  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /uses: actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm audit --audit-level=high/);
  assert.match(workflow, /pnpm audit signatures/);
  assert.match(workflow, /compose\.yaml up --build --wait/);
  assert.match(workflow, /127\.0\.0\.1:4100\/livez/);
  assert.match(workflow, /127\.0\.0\.1:4100\/readyz/);
  assert.match(runbook, /pg_dump/);
  assert.match(runbook, /pg_restore/);
  assert.match(runbook, /\/readyz/);
  assert.match(runbook, /Rollback/);
});
