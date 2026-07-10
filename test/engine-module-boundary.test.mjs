import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

test("engine modules load as ESM without typeless-package warnings", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "import('./src/engine/engine.js')"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /MODULE_TYPELESS_PACKAGE_JSON/);
});

test("ui modules load as ESM without typeless-package warnings", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "import('./src/ui/view.js')"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /MODULE_TYPELESS_PACKAGE_JSON/);
});
