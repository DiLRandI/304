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
  const gameServiceDockerfile = read("apps/game-service/Dockerfile");
  const webDockerfile = read("apps/web/Dockerfile");

  assert.equal(read(".node-version").trim(), "24.18.0");
  assert.equal(packageJson.engines.node, "24.18.0");
  assert.match(
    gameServiceDockerfile,
    /FROM node:24\.18\.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build/,
  );
  assert.match(
    gameServiceDockerfile,
    /FROM debian:12\.14-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime/,
  );
  assert.match(
    webDockerfile,
    /FROM node:24\.18\.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build/,
  );
  assert.match(
    webDockerfile,
    /FROM debian:12\.14-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime/,
  );
  assert.match(
    gameServiceDockerfile,
    /COPY --from=build --chown=65532:65532 \/usr\/local\/bin\/node \/usr\/local\/bin\/node/,
  );
  assert.match(
    webDockerfile,
    /COPY --from=build --chown=65532:65532 \/usr\/local\/bin\/node \/usr\/local\/bin\/node/,
  );
  assert.match(gameServiceDockerfile, /USER 65532:65532/);
  assert.match(webDockerfile, /USER 65532:65532/);
  assert.match(
    gameServiceDockerfile,
    /CMD \["\/usr\/local\/bin\/node", "dist\/src\/server\.js"\]/,
  );
  assert.match(
    gameServiceDockerfile,
    /RUN pnpm --filter @three-zero-four\/gameplay build[\s\S]*RUN pnpm --filter @three-zero-four\/room-domain build[\s\S]*RUN pnpm --filter @three-zero-four\/contracts build[\s\S]*RUN pnpm --filter @three-zero-four\/game-service build/,
  );
  assert.match(
    webDockerfile,
    /CMD \["\/usr\/local\/bin\/node", "apps\/web\/server\.js"\]/,
  );
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
  assert.equal(
    packageJson.scripts.typecheck,
    "pnpm --filter @three-zero-four/gameplay build && pnpm --filter @three-zero-four/gameplay typecheck && pnpm --filter @three-zero-four/room-domain build && pnpm --filter @three-zero-four/room-domain typecheck && pnpm --filter @three-zero-four/contracts build && pnpm --filter @three-zero-four/contracts typecheck && pnpm --filter @three-zero-four/game-service typecheck && pnpm --filter @three-zero-four/web typecheck",
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
    "!**/test-results",
    "!**/playwright-report",
  ]);
});

test("uses PostgreSQL 18's supported persistent volume target", () => {
  const compose = read("infra/compose/compose.yaml");

  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\n/);
  assert.doesNotMatch(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
});
