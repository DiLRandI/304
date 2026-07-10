import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("declares the pinned production workspace toolchain", () => {
  const packageJson = JSON.parse(read("package.json"));
  const workspace = read("pnpm-workspace.yaml");
  const biome = JSON.parse(read("biome.json"));

  assert.equal(read(".node-version").trim(), "24.17.0");
  assert.equal(packageJson.engines.node, "24.17.0");
  assert.match(packageJson.packageManager, /^pnpm@11\.10\.0/);
  assert.equal(packageJson.scripts.test, "node --test test/*.test.mjs");
  assert.equal(
    packageJson.scripts.lint,
    "biome check apps packages infra biome.json package.json pnpm-workspace.yaml test/production-foundation-*.test.mjs",
  );
  assert.equal(
    packageJson.scripts.check,
    "pnpm lint && pnpm typecheck && pnpm test:unit",
  );
  assert.match(workspace, /packages:\n\s+- apps\/\*/);
  assert.match(workspace, /\s+- packages\/\*/);
  assert.match(workspace, /minimumReleaseAge: 1440/);
  assert.match(workspace, /overrides:\n\s+postcss: 8\.5\.16/);
  assert.match(workspace, /allowBuilds:\n\s+esbuild: true/);
  assert.match(workspace, /\n\s+sharp: false\n/);
  assert.equal(biome.linter.rules.preset, "recommended");
  assert.equal(biome.assist.actions.source.organizeImports, "on");
  assert.deepEqual(biome.files.includes, [
    "**",
    "!**/node_modules",
    "!**/dist",
    "!**/.next",
    "!**/coverage",
  ]);
});

test("uses PostgreSQL 18's supported persistent volume target", () => {
  const compose = read("infra/compose/compose.yaml");

  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\n/);
  assert.doesNotMatch(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
});
