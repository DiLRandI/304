# Production Foundation (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible, observable, durable-service foundation for 304 Online while preserving the verified playable engine and legacy client until the new client reaches parity.

**Architecture:** Convert the repository into a pnpm workspace with a pure shared game-engine package, versioned contracts package, Next.js web application, and Fastify game-service application. PostgreSQL 18.4 is introduced as durable storage and Redis as coordination infrastructure; M1 only lays the schema and infrastructure boundary, while M2 implements durable room commands and recovery.

**Tech Stack:** Node.js 24.17.0, pnpm 11.10.0, TypeScript 7.0.2, Vitest 4.1.10, Biome 2.5.3, Fastify 5.10.0, Next.js 16.2.10, React 19.2.7, Zod 4.4.3, node-postgres 8.22.0, node-redis 6.1.0, prom-client 15.1.3, PostgreSQL 18.4, Redis Open Source in Docker Compose.

## Global Constraints

- Keep the current `GameEngine` behavior, private projections, and Classic/Six-seat rule profiles intact during this milestone.
- Pin Node.js to `24.17.0`; use pnpm `11.10.0` with the existing minimum-release-age and trust policy.
- PostgreSQL is the only durable authority for game history; Redis is never the only source of a room or player state.
- Browser and worker code may consume only `@three-zero-four/contracts`; they must not read server-side snapshots or unprojected engine state.
- Never commit secrets, connection strings, generated `node_modules`, build artifacts, database volumes, or captured game state.
- Maintain the existing root static server and browser client until M3 parity tests prove the replacement path.
- Every behavior change starts with a failing executable test and concludes with the narrow test plus the relevant workspace check passing.
- No real-money, wagering, ranked, chat, spectator, or custom-rule behavior is introduced.

---

## File structure

- `package.json` — root workspace scripts, package-manager pin, Node runtime constraint, and shared development tools.
- `pnpm-workspace.yaml` — workspace package globs plus existing supply-chain controls.
- `.node-version` — exact supported runtime for local work and CI.
- `tsconfig.base.json` — strict NodeNext TypeScript defaults used by TypeScript packages.
- `biome.json` — repository-wide formatting and lint configuration.
- `packages/game-engine/` — extracted existing ESM engine, profiles, card data, and bot policy.
- `packages/contracts/` — Zod schemas and inferred types for commands, versions, and private-view envelopes.
- `apps/game-service/` — Fastify process, typed config, structured logs, metrics, readiness, database and Redis adapters.
- `apps/web/` — Next.js App Router shell with a CSP-safe, accessible production entry point.
- `infra/postgres/migrations/` — ordered SQL migrations for foundational durable entities.
- `infra/compose/compose.yaml` — local production-like PostgreSQL, Redis, migration, service, and web topology.
- `.github/workflows/ci.yml` — immutable-install, checks, migration, and Compose smoke gates.
- `docs/operations/production-foundation.md` — local operation, readiness, migration, backup, and rollback instructions.

## Task 1: Convert the repository into a reproducible workspace

**Files:**

- Create: `.node-version`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `test/production-foundation-workspace.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `.gitignore`

**Interfaces:**

- Produces `pnpm check`, `pnpm test:unit`, `pnpm build`, and `pnpm compose:up` as stable root commands.
- Produces strict compiler defaults consumed by `apps/*` and `packages/contracts`.
- Preserves the root `start`, `start:prod`, and `health` commands for the legacy verified application.

- [ ] **Step 1: Write the failing workspace-contract test**

```js
// test/production-foundation-workspace.test.mjs
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

  assert.equal(read(".node-version").trim(), "24.17.0");
  assert.equal(packageJson.engines.node, "24.17.0");
  assert.match(packageJson.packageManager, /^pnpm@11\.10\.0/);
  assert.equal(packageJson.scripts.check, "pnpm lint && pnpm typecheck && pnpm test:unit");
  assert.match(workspace, /packages:\n\s+- apps\/\*/);
  assert.match(workspace, /\s+- packages\/\*/);
  assert.match(workspace, /minimumReleaseAge: 1440/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/production-foundation-workspace.test.mjs`

Expected: FAIL because `.node-version` and the root workspace scripts do not exist yet.

- [ ] **Step 3: Add the workspace configuration**

Create `.node-version` with exactly:

```text
24.17.0
```

Replace the root package manifest with this shape, retaining every legacy start and security script shown below:

```json
{
  "name": "304-online",
  "private": true,
  "version": "1.0.0",
  "packageManager": "pnpm@11.10.0+sha512.0b7f8b98060031904c017e3a41eb187a16d40eeb829b95c4f8cb03681761fc4ab53dd219115b9b447f4dce1a05a214764461e7d3703392a9f32f9511ce8c86c8",
  "engines": { "node": "24.17.0" },
  "scripts": {
    "start": "node server.js",
    "start:prod": "NODE_ENV=production node server.js",
    "start:dev": "NODE_ENV=development PORT=4173 node server.js",
    "serve": "node server.js",
    "dev": "NODE_ENV=development PORT=4173 node server.js",
    "health": "node -e \"const http=require('node:http');const port=process.env.PORT||4173;http.get(`http://localhost:${port}/health`,res=>{console.log(res.statusCode);process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))\"",
    "test": "node --test test",
    "test:legacy": "node --test test",
    "test:unit": "pnpm test && pnpm --filter @three-zero-four/game-engine test && pnpm --filter @three-zero-four/contracts test && pnpm --filter @three-zero-four/game-service test && pnpm --filter @three-zero-four/web test",
    "typecheck": "pnpm --filter @three-zero-four/game-engine typecheck && pnpm --filter @three-zero-four/contracts typecheck && pnpm --filter @three-zero-four/game-service typecheck && pnpm --filter @three-zero-four/web typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "build": "pnpm --filter @three-zero-four/contracts build && pnpm --filter @three-zero-four/game-service build && pnpm --filter @three-zero-four/web build",
    "check": "pnpm lint && pnpm typecheck && pnpm test:unit",
    "compose:up": "docker compose -f infra/compose/compose.yaml up --build --wait",
    "compose:down": "docker compose -f infra/compose/compose.yaml down --volumes --remove-orphans",
    "db:migrate": "pnpm --filter @three-zero-four/game-service migrate",
    "security:check": "pnpm audit --audit-level=high",
    "security:check:all": "pnpm install --frozen-lockfile && pnpm audit --audit-level=high && pnpm audit signatures"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.3",
    "@types/node": "^24.0.0",
    "tsx": "4.23.0",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - apps/*
  - packages/*

minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
trustPolicy: no-downgrade
blockExoticSubdeps: true
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.3/schema.json",
  "files": {
    "includes": ["**", "!**/node_modules/**", "!**/dist/**", "!**/.next/**", "!**/coverage/**"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "organizeImports": { "enabled": true }
}
```

Append these entries to `.gitignore` if absent:

```gitignore
node_modules/
dist/
.next/
.turbo/
.env
.env.*
!.env.example
postgres-data/
redis-data/
```

- [ ] **Step 4: Install and verify GREEN**

Run: `corepack enable && pnpm install`

Run: `node --test test/production-foundation-workspace.test.mjs`

Expected: install updates `pnpm-lock.yaml`; the test passes.

- [ ] **Step 5: Commit the workspace boundary**

```bash
git add .node-version .gitignore biome.json package.json pnpm-lock.yaml pnpm-workspace.yaml test/production-foundation-workspace.test.mjs tsconfig.base.json
git commit -m "build: establish production workspace tooling"
```

## Task 2: Extract the existing game engine into a package without changing behavior

**Files:**

- Create: `packages/game-engine/package.json`
- Create: `packages/game-engine/src/index.js`
- Create: `packages/game-engine/test/public-api.test.mjs`
- Modify: `src/engine/cardData.js`
- Modify: `src/engine/profiles.js`
- Modify: `src/engine/bot.js`
- Modify: `src/engine/engine.js`
- Move: `src/engine/cardData.js` to `packages/game-engine/src/cardData.js`
- Move: `src/engine/profiles.js` to `packages/game-engine/src/profiles.js`
- Move: `src/engine/bot.js` to `packages/game-engine/src/bot.js`
- Move: `src/engine/engine.js` to `packages/game-engine/src/engine.js`

**Interfaces:**

- Produces `@three-zero-four/game-engine` with `GameEngine`, `GAME_PROFILES`, `getProfile`, `chooseTableSeatCount`, `pickBotAction`, and card helpers.
- Produces legacy ESM shim modules under `src/engine/` so the verified root server and static client continue to load unchanged.
- Consumes no database, Redis, HTTP, DOM, or browser storage state.

- [ ] **Step 1: Write the failing public-API test**

```js
// packages/game-engine/test/public-api.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine, GAME_PROFILES, getProfile } from "../src/index.js";

test("exports the established 304 engine through one package boundary", () => {
  assert.equal(getProfile("classic_304_4p").seatCount, 4);
  assert.equal(GAME_PROFILES.six_304_36.seatCount, 6);

  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();
  assert.equal(engine.getSnapshot().phase, "four_bidding");
  assert.equal(engine.getSnapshot().seats[0].hand.length, 4);
});
```

- [ ] **Step 2: Run the package test and verify RED**

Run: `node --test packages/game-engine/test/public-api.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/game-engine/src/index.js`.

- [ ] **Step 3: Move the engine files and add stable exports**

Run these exact moves to preserve history:

```bash
mkdir -p packages/game-engine/src
git mv src/engine/cardData.js packages/game-engine/src/cardData.js
git mv src/engine/profiles.js packages/game-engine/src/profiles.js
git mv src/engine/bot.js packages/game-engine/src/bot.js
git mv src/engine/engine.js packages/game-engine/src/engine.js
```

Create `packages/game-engine/package.json`:

```json
{
  "name": "@three-zero-four/game-engine",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.js",
    "./card-data": "./src/cardData.js",
    "./profiles": "./src/profiles.js"
  },
  "scripts": {
    "test": "node --test test",
    "typecheck": "node --check src/index.js && node --check src/engine.js"
  }
}
```

Create `packages/game-engine/src/index.js`:

```js
export { GameEngine } from "./engine.js";
export { pickBotAction } from "./bot.js";
export { BOT_NAMES, GAME_PROFILES, PROFILE_DEFAULTS, chooseTableSeatCount, getProfile } from "./profiles.js";
export {
  CLASSIC_CARD_POINTS,
  CLASSIC_DECK_RANKS,
  SUITS,
  buildDeck,
  cardId,
  cloneCard,
  compareCardsForTrick,
  compareRank,
  formatCard,
  generateShuffleSeed,
  makeShuffleCommit,
  shuffleDeck
} from "./cardData.js";
```

Replace the four legacy source files with these ESM shims:

```js
// src/engine/engine.js
export { GameEngine } from "../../packages/game-engine/src/engine.js";
```

```js
// src/engine/bot.js
export { pickBotAction } from "../../packages/game-engine/src/bot.js";
```

```js
// src/engine/profiles.js
export * from "../../packages/game-engine/src/profiles.js";
```

```js
// src/engine/cardData.js
export * from "../../packages/game-engine/src/cardData.js";
```

- [ ] **Step 4: Verify package and legacy behavior GREEN**

Run: `node --test packages/game-engine/test/public-api.test.mjs test/engine-contract.test.mjs test/engine-module-boundary.test.mjs`

Run: `node --check server.js`

Expected: all engine assertions pass and the legacy server syntax check exits zero.

- [ ] **Step 5: Commit the engine boundary**

```bash
git add packages/game-engine src/engine test/engine-contract.test.mjs test/engine-module-boundary.test.mjs
git commit -m "refactor: extract shared game engine package"
```

## Task 3: Define validated command and state-update contracts

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/game.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/game.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `GameCommandSchema`, `GameCommand`, `GameAction`, `VersionedPrivateViewSchema`, and `VersionedPrivateView`.
- `GameCommand` is `{ commandId, roomId, expectedVersion, action }`; the service adds the authenticated actor seat and never accepts it from the browser.
- A versioned update is `{ roomId, eventVersion, view }`, where `view` remains an explicitly private projection owned by the game service.

- [ ] **Step 1: Write failing schema tests**

```ts
// packages/contracts/test/game.test.ts
import { describe, expect, it } from "vitest";
import { GameCommandSchema, VersionedPrivateViewSchema } from "../src/index.js";

describe("GameCommandSchema", () => {
  it("accepts a versioned card-play command", () => {
    expect(
      GameCommandSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        expectedVersion: 14,
        action: { type: "PLAY_CARD", cardId: "spades-J", faceDown: false, fromIndicator: false }
      })
    ).toMatchObject({ expectedVersion: 14, action: { type: "PLAY_CARD" } });
  });

  it("rejects a client-supplied actor seat and malformed command ids", () => {
    expect(() =>
      GameCommandSchema.parse({
        commandId: "not-a-uuid",
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        expectedVersion: 0,
        actorSeatIndex: 3,
        action: { type: "PASS_BID" }
      })
    ).toThrow();
  });
});

describe("VersionedPrivateViewSchema", () => {
  it("requires a monotonic non-negative event version", () => {
    expect(() => VersionedPrivateViewSchema.parse({ roomId: "bad", eventVersion: -1, view: {} })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @three-zero-four/contracts test`

Expected: FAIL because the workspace package and schemas do not exist.

- [ ] **Step 3: Implement the contracts package**

Create `packages/contracts/package.json`:

```json
{
  "name": "@three-zero-four/contracts",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "zod": "4.4.3" }
}
```

Create `packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Create `packages/contracts/src/game.ts`:

```ts
import { z } from "zod";

const Uuid = z.string().uuid();
const EventVersion = z.number().int().nonnegative();

export const GameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BID"), amount: z.number().int().min(160).max(304) }),
  z.object({ type: z.literal("PASS_BID") }),
  z.object({ type: z.literal("SELECT_TRUMP"), cardId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("TRUMP_OPEN") }),
  z.object({ type: z.literal("TRUMP_CLOSE") }),
  z.object({
    type: z.literal("PLAY_CARD"),
    cardId: z.string().min(1).max(64),
    faceDown: z.boolean(),
    fromIndicator: z.boolean()
  }),
  z.object({ type: z.literal("ACK_RESULT") })
]);

export const GameCommandSchema = z
  .object({
    commandId: Uuid,
    roomId: Uuid,
    expectedVersion: EventVersion,
    action: GameActionSchema
  })
  .strict();

export const VersionedPrivateViewSchema = z
  .object({ roomId: Uuid, eventVersion: EventVersion, view: z.record(z.string(), z.unknown()) })
  .strict();

export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommand = z.infer<typeof GameCommandSchema>;
export type VersionedPrivateView = z.infer<typeof VersionedPrivateViewSchema>;
```

Create `packages/contracts/src/index.ts`:

```ts
export {
  GameActionSchema,
  GameCommandSchema,
  VersionedPrivateViewSchema,
  type GameAction,
  type GameCommand,
  type VersionedPrivateView
} from "./game.js";
```

Add `"@three-zero-four/contracts": "workspace:*"` to the root `devDependencies` so the root workspace can resolve and build it.

- [ ] **Step 4: Verify schema behavior and types GREEN**

Run: `pnpm --filter @three-zero-four/contracts test`

Run: `pnpm --filter @three-zero-four/contracts typecheck`

Expected: both commands exit zero; malformed commands are rejected before any game logic runs.

- [ ] **Step 5: Commit the versioned contracts**

```bash
git add package.json packages/contracts pnpm-lock.yaml
git commit -m "feat: add validated game service contracts"
```

## Task 4: Build the Fastify service shell with safe configuration, health, and metrics

**Files:**

- Create: `apps/game-service/package.json`
- Create: `apps/game-service/tsconfig.json`
- Create: `apps/game-service/src/config.ts`
- Create: `apps/game-service/src/metrics.ts`
- Create: `apps/game-service/src/app.ts`
- Create: `apps/game-service/src/server.ts`
- Create: `apps/game-service/test/app.test.ts`

**Interfaces:**

- Produces `loadConfig(source): ServiceConfig` and `buildApp({ config, readiness }): Promise<FastifyInstance>`.
- `readiness` exposes `database(): Promise<boolean>` and `redis(): Promise<boolean>`; adapters in Task 5 satisfy it.
- `/livez` is process-only, `/readyz` requires both infrastructure checks, `/metrics` returns Prometheus text, and every unknown route returns a stable JSON error envelope.

- [ ] **Step 1: Write failing service tests**

```ts
// apps/game-service/test/app.test.ts
import { describe, expect, it } from "vitest";
import { buildApp, loadConfig } from "../src/app.js";

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "4100",
  DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGINS: "http://127.0.0.1:3000",
  SESSION_COOKIE_NAME: "g304_session"
});

describe("game service health surface", () => {
  it("reports live while a dependency is unavailable and becomes ready only when all are ready", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => false }
    });
    const live = await app.inject("/livez");
    const ready = await app.inject("/readyz");
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not_ready", dependencies: { database: true, redis: false } });
    await app.close();
  });

  it("emits a request id and rejects unrecognized routes as JSON", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true }
    });
    const response = await app.inject("/unknown");
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
    expect(response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @three-zero-four/game-service test`

Expected: FAIL because the game-service workspace package does not exist.

- [ ] **Step 3: Implement the service boundary**

Create `apps/game-service/package.json`:

```json
{
  "name": "@three-zero-four/game-service",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "migrate": "node dist/scripts/migrate.js",
    "migrate:dev": "tsx scripts/migrate.ts"
  },
  "dependencies": {
    "@fastify/cookie": "11.1.1",
    "@fastify/cors": "11.3.0",
    "@fastify/helmet": "13.1.0",
    "@fastify/websocket": "11.3.0",
    "@three-zero-four/contracts": "workspace:*",
    "@three-zero-four/game-engine": "workspace:*",
    "fastify": "5.10.0",
    "pg": "8.22.0",
    "prom-client": "15.1.3",
    "redis": "6.1.0",
    "zod": "4.4.3"
  }
}
```

Create `apps/game-service/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist" },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

Create `apps/game-service/src/config.ts`:

```ts
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/)
});

export type ServiceConfig = z.infer<typeof EnvironmentSchema> & { corsOrigins: ReadonlySet<string> };

export function loadConfig(source: Record<string, string | undefined> = process.env): ServiceConfig {
  const parsed = EnvironmentSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid service configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  const corsOrigins = new Set(parsed.data.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean));
  return { ...parsed.data, corsOrigins };
}
```

Create `apps/game-service/src/metrics.ts`:

```ts
import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "three_zero_four_" });
  const requests = new Counter({
    name: "three_zero_four_http_requests_total",
    help: "Completed HTTP requests by route and status code",
    labelNames: ["route", "status_code"] as const,
    registers: [registry]
  });
  return { registry, requests };
}
```

Create `apps/game-service/src/app.ts`:

```ts
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { createMetrics } from "./metrics.js";
import type { ServiceConfig } from "./config.js";

export { loadConfig } from "./config.js";

export interface ReadinessChecks {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
}

export async function buildApp({ config, readiness }: { config: ServiceConfig; readiness: ReadinessChecks }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.NODE_ENV === "production" ? "info" : "warn", redact: ["req.headers.cookie", "req.headers.authorization"] },
    requestIdHeader: "x-request-id",
    bodyLimit: 32 * 1024,
    trustProxy: false,
    disableRequestLogging: (request) => request.url === "/livez" || request.url === "/readyz" || request.url === "/metrics"
  });
  const metrics = createMetrics();
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: (origin, done) => done(null, !origin || config.corsOrigins.has(origin))
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    metrics.requests.inc({ route: request.routeOptions.url ?? "unmatched", status_code: String(reply.statusCode) });
  });
  app.get("/livez", async () => ({ status: "live" }));
  app.get("/readyz", async (_request, reply) => {
    const [database, redis] = await Promise.all([readiness.database(), readiness.redis()]);
    if (!database || !redis) return reply.code(503).send({ status: "not_ready", dependencies: { database, redis } });
    return { status: "ready", dependencies: { database, redis } };
  });
  app.get("/metrics", async (_request, reply) => reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  return app;
}
```

Create `apps/game-service/src/server.ts`:

```ts
import { buildApp, loadConfig } from "./app.js";

const config = loadConfig();
const app = await buildApp({ config, readiness: { database: async () => false, redis: async () => false } });
await app.listen({ host: config.HOST, port: config.PORT });
```

The temporary `false` readiness implementation is replaced in Task 5; it deliberately makes a process live but not ready if infrastructure wiring is absent.

- [ ] **Step 4: Verify the service shell GREEN**

Run: `pnpm --filter @three-zero-four/game-service test`

Run: `pnpm --filter @three-zero-four/game-service typecheck`

Expected: the two health tests pass, the test process uses no network services, and TypeScript exits zero.

- [ ] **Step 5: Commit the observable service shell**

```bash
git add apps/game-service package.json pnpm-lock.yaml
git commit -m "feat: add observable game service shell"
```

## Task 5: Add PostgreSQL migrations, Redis adapters, and real readiness checks

**Files:**

- Create: `apps/game-service/src/infra/database.ts`
- Create: `apps/game-service/src/infra/redis.ts`
- Create: `apps/game-service/src/infra/readiness.ts`
- Create: `apps/game-service/scripts/migrate.ts`
- Create: `apps/game-service/test/migrations.integration.test.ts`
- Create: `infra/postgres/migrations/0001_foundation.sql`
- Modify: `apps/game-service/src/server.ts`
- Modify: `apps/game-service/package.json`

**Interfaces:**

- Produces `createDatabase(url): Database` with `query`, transaction-scoped `transaction`, `close`, and `health` methods.
- Produces `createRedis(url): RedisClientType` and `createReadiness(database, redis)`.
- Migration runner reads ordered `infra/postgres/migrations/*.sql`, records each filename and SHA-256 digest in `schema_migrations`, and refuses a changed previously-applied file.

- [ ] **Step 1: Write failing database integration tests**

```ts
// apps/game-service/test/migrations.integration.test.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/infra/database.js";
import { runMigrations } from "../scripts/migrate.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/postgres/migrations");
const describeIntegration = databaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase>;

describeIntegration("foundation migrations", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl!);
    await runMigrations(database, migrationsDir);
  });
  afterAll(async () => database.close());

  it("records the exact digest for the foundational schema", async () => {
    const sql = await readFile(path.join(migrationsDir, "0001_foundation.sql"));
    const expected = createHash("sha256").update(sql).digest("hex");
    const result = await database.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE filename = $1", ["0001_foundation.sql"]);
    expect(result.rows).toEqual([{ checksum: expected }]);
  });

  it("creates durable identities, rooms, seats, events, snapshots, and command records", async () => {
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "command_deduplications", "game_events", "game_snapshots", "players", "room_seats", "rooms", "schema_migrations", "sessions"
    ]));
  });
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `INTEGRATION_DATABASE_URL=postgres://game:game@127.0.0.1:5432/game pnpm --filter @three-zero-four/game-service test -- migrations.integration.test.ts`

Expected: FAIL because database adapters and migrations are absent. This command is run after the PostgreSQL service from Task 6 becomes healthy.

- [ ] **Step 3: Implement migrations and adapters**

Create `apps/game-service/src/infra/database.ts`:

```ts
import { Pool, type QueryResultRow } from "pg";

export interface Database {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
  transaction<T>(callback: (transaction: Pick<Database, "query">) => Promise<T>): Promise<T>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000 });
  return {
    async query(text, values = []) {
      const result = await pool.query(text, values as unknown[]);
      return { rows: result.rows };
    },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback({
          async query(text, values = []) {
            const queryResult = await client.query(text, values as unknown[]);
            return { rows: queryResult.rows };
          }
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async health() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async close() { await pool.end(); }
  };
}
```

Create `apps/game-service/src/infra/redis.ts`:

```ts
import { createClient, type RedisClientType } from "redis";

export async function createRedis(url: string): Promise<RedisClientType> {
  const client = createClient({ url, socket: { reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000) } });
  client.on("error", () => undefined);
  await client.connect();
  return client;
}
```

Create `apps/game-service/src/infra/readiness.ts`:

```ts
import type { RedisClientType } from "redis";
import type { Database } from "./database.js";

export function createReadiness(database: Database, redis: RedisClientType) {
  return {
    database: () => database.health(),
    async redis() {
      try { return (await redis.ping()) === "PONG"; } catch { return false; }
    }
  };
}
```

Create `infra/postgres/migrations/0001_foundation.sql`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  secret_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  invite_code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('lobby', 'in_hand', 'hand_result', 'closed')),
  rule_profile_id text NOT NULL,
  event_version bigint NOT NULL DEFAULT 0 CHECK (event_version >= 0),
  host_player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_seats (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_index smallint NOT NULL CHECK (seat_index >= 0 AND seat_index < 6),
  player_id uuid REFERENCES players(id),
  occupant_type text NOT NULL CHECK (occupant_type IN ('human', 'bot', 'empty')),
  bot_difficulty text,
  joined_at timestamptz,
  PRIMARY KEY (room_id, seat_index),
  CHECK ((occupant_type = 'human' AND player_id IS NOT NULL) OR (occupant_type <> 'human' AND player_id IS NULL))
);

CREATE TABLE IF NOT EXISTS game_snapshots (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version >= 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  rule_profile_id text NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, event_version)
);

CREATE TABLE IF NOT EXISTS game_events (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  command_id uuid NOT NULL UNIQUE,
  actor_player_id uuid REFERENCES players(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, event_version)
);

CREATE TABLE IF NOT EXISTS command_deduplications (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, command_id)
);

CREATE INDEX IF NOT EXISTS sessions_player_active_idx ON sessions(player_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS game_events_room_version_idx ON game_events(room_id, event_version);
CREATE INDEX IF NOT EXISTS game_snapshots_room_version_idx ON game_snapshots(room_id, event_version DESC);
```

Create `apps/game-service/scripts/migrate.ts` with an advisory transaction lock, digest check, and per-file transaction:

```ts
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "../src/infra/database.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/postgres/migrations");

export async function runMigrations(database: Database, directory = migrationsDir) {
  const files = (await readdir(directory)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const filename of files) {
    const source = await readFile(path.join(directory, filename));
    const checksum = createHash("sha256").update(source).digest("hex");
    await database.transaction(async (transaction) => {
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext('three-zero-four:migrations'))");
      await transaction.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
      const applied = await transaction.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE filename = $1", [filename]);
      if (applied.rows[0] && applied.rows[0].checksum !== checksum) throw new Error(`Migration checksum changed: ${filename}`);
      if (!applied.rows[0]) {
        await transaction.query(source.toString());
        await transaction.query("INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)", [filename, checksum]);
      }
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for migrations");
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    await runMigrations(database);
  } finally { await database.close(); }
}
```

Replace `apps/game-service/src/server.ts` with:

```ts
import { buildApp, loadConfig } from "./app.js";
import { createDatabase } from "./infra/database.js";
import { createReadiness } from "./infra/readiness.js";
import { createRedis } from "./infra/redis.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const app = await buildApp({ config, readiness: createReadiness(database, redis) });
const close = async () => { await app.close(); await redis.quit(); await database.close(); };
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
await app.listen({ host: config.HOST, port: config.PORT });
```

- [ ] **Step 4: Run integrations and readiness checks GREEN**

Run: `INTEGRATION_DATABASE_URL=postgres://game:game@127.0.0.1:5432/game pnpm --filter @three-zero-four/game-service test -- migrations.integration.test.ts`

Run: `pnpm --filter @three-zero-four/game-service typecheck`

Expected: migrations are recorded exactly once, all named tables exist, and production service type checks pass.

- [ ] **Step 5: Commit durable infrastructure primitives**

```bash
git add apps/game-service infra/postgres pnpm-lock.yaml
git commit -m "feat: add durable game service infrastructure"
```

## Task 6: Create the web shell and production-like Compose topology

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/public/.gitkeep`
- Create: `apps/web/Dockerfile`
- Create: `apps/game-service/Dockerfile`
- Create: `.dockerignore`
- Create: `infra/compose/compose.yaml`
- Create: `infra/compose/.env.example`

**Interfaces:**

- Produces a Next.js app that has no server authority and points users only to explicitly configured public game-service URLs.
- Produces a Compose stack whose game service starts only after PostgreSQL, Redis, and migrations are healthy/successful.
- Produces the local endpoints `http://127.0.0.1:3000` and `http://127.0.0.1:4100/livez`.

- [ ] **Step 1: Write the failing web build check**

Create `apps/web/test/build-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("web shell declares an explicitly configured game API origin", () => {
  const page = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /NEXT_PUBLIC_GAME_SERVICE_URL/);
  assert.doesNotMatch(page, /localhost:4100/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test apps/web/test/build-contract.test.mjs`

Expected: FAIL because the web package does not yet exist.

- [ ] **Step 3: Implement the web shell and Compose files**

Create `apps/web/package.json`:

```json
{
  "name": "@three-zero-four/web",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --test test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "16.2.10",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "devDependencies": { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve", "plugins": [{ "name": "next" }], "noEmit": true },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"]
}
```

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  experimental: { typedRoutes: true }
};

export default nextConfig;
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "304 Online",
  description: "A server-authoritative Sri Lankan 304 card game."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
```

Create `apps/web/src/app/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

const gameServiceUrl = process.env.NEXT_PUBLIC_GAME_SERVICE_URL;

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">304 Online</p>
      <h1>Play Sri Lankan 304 with a server that protects every hand.</h1>
      <p>Private rooms, fair server-authoritative games, and bot practice are being connected to the production game service.</p>
      <dl>
        <div><dt>Game service</dt><dd>{gameServiceUrl ? "Configured" : "Not configured"}</dd></div>
        <div><dt>Modes</dt><dd>Classic four-seat and six-seat 304</dd></div>
      </dl>
    </main>
  );
}
```

Create `apps/web/src/app/globals.css`:

```css
:root { color-scheme: dark; font-family: Arial, sans-serif; background: #071a12; color: #f6fbf8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
main { width: min(100% - 2rem, 62rem); margin: 0 auto; padding: clamp(3rem, 10vw, 8rem) 0; }
.eyebrow { color: #a8e6b4; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { max-width: 15ch; font-size: clamp(2.25rem, 7vw, 5rem); line-height: 1; }
dl { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
dl div { padding: 1rem; border: 1px solid #397a50; border-radius: .75rem; }
dt { color: #a8e6b4; font-weight: 700; }
dd { margin: .5rem 0 0; }
```

Create an empty `apps/web/public/.gitkeep` so the runtime image can always copy the public directory.

Create `.dockerignore`:

```text
.git
.worktrees
node_modules
**/node_modules
**/dist
**/.next
coverage
.env
```

Create `apps/game-service/Dockerfile`:

```dockerfile
FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/contracts build && pnpm --filter @three-zero-four/game-service build
RUN pnpm --filter @three-zero-four/game-service --prod deploy /opt/game-service

FROM node:24.17.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /opt/game-service ./
USER node
EXPOSE 4100
CMD ["node", "dist/src/server.js"]
```

Create `apps/web/Dockerfile`:

```dockerfile
FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/web build

FROM node:24.17.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

Create `infra/compose/.env.example`:

```dotenv
POSTGRES_DB=game
POSTGRES_USER=game
POSTGRES_PASSWORD=change-me-for-local-only
DATABASE_URL=postgres://game:change-me-for-local-only@postgres:5432/game
REDIS_URL=redis://redis:6379
NEXT_PUBLIC_GAME_SERVICE_URL=http://127.0.0.1:4100
```

Create `infra/compose/compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:18.4-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    volumes: ["postgres-data:/var/lib/postgresql/data"]

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
    volumes: ["redis-data:/data"]

  migrate:
    build:
      context: ../..
      dockerfile: apps/game-service/Dockerfile
    command: ["node", "dist/scripts/migrate.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres: { condition: service_healthy }

  game-service:
    build:
      context: ../..
      dockerfile: apps/game-service/Dockerfile
    environment:
      NODE_ENV: production
      PORT: 4100
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CORS_ORIGINS: http://127.0.0.1:3000
      SESSION_COOKIE_NAME: g304_session
    ports: ["4100:4100"]
    depends_on:
      postgres: { condition: service_healthy, restart: true }
      redis: { condition: service_healthy, restart: true }
      migrate: { condition: service_completed_successfully }

  web:
    build:
      context: ../..
      dockerfile: apps/web/Dockerfile
    environment:
      NEXT_PUBLIC_GAME_SERVICE_URL: ${NEXT_PUBLIC_GAME_SERVICE_URL}
    ports: ["3000:3000"]
    depends_on:
      game-service: { condition: service_started }

volumes:
  postgres-data:
  redis-data:
```

- [ ] **Step 4: Verify web and container interfaces GREEN**

Run: `node --test apps/web/test/build-contract.test.mjs`

Run: `pnpm --filter @three-zero-four/web build`

Run: `cp infra/compose/.env.example infra/compose/.env && docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait`

Run: `curl --fail --silent http://127.0.0.1:4100/livez`

Expected: the web build succeeds, Compose marks PostgreSQL and Redis healthy, migration exits successfully, and `/livez` returns `{"status":"live"}`.

- [ ] **Step 5: Tear down and commit the local release topology**

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans`

```bash
git add .dockerignore apps/web apps/game-service/Dockerfile infra/compose package.json pnpm-lock.yaml
git commit -m "feat: add production web and compose topology"
```

## Task 7: Add CI gates and an operations runbook

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `docs/operations/production-foundation.md`
- Modify: `README.md`

**Interfaces:**

- Produces a pull-request CI job that uses immutable installs, static checks, tests, dependency audit, migration validation, and Compose smoke checks.
- Produces documented commands for startup, migrations, readiness diagnosis, data backup, restore rehearsal, and safe rollback.

- [ ] **Step 1: Write the failing CI/runbook contract test**

```js
// test/production-foundation-ci.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("production CI and runbook cover immutable install, migrations, readiness, backup, and rollback", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const runbook = fs.readFileSync("docs/operations/production-foundation.md", "utf8");
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm audit --audit-level=high/);
  assert.match(workflow, /compose\.yaml up --build --wait/);
  assert.match(runbook, /pg_dump/);
  assert.match(runbook, /pg_restore/);
  assert.match(runbook, /\/readyz/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/production-foundation-ci.test.mjs`

Expected: FAIL because the workflow and runbook do not exist.

- [ ] **Step 3: Implement the CI workflow and runbook**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm audit --audit-level=high
      - run: pnpm audit signatures
      - run: cp infra/compose/.env.example infra/compose/.env
      - run: docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
      - run: curl --fail --silent http://127.0.0.1:4100/livez
      - run: docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
        if: always()
```

Create `docs/operations/production-foundation.md` with these executable procedures:

````markdown
# Production Foundation Operations

## Local production-like startup

```bash
cp infra/compose/.env.example infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
curl --fail http://127.0.0.1:4100/livez
curl --fail http://127.0.0.1:4100/readyz
```

`/livez` proves the process is running. `/readyz` proves PostgreSQL and Redis are reachable; do not direct player traffic to an instance that returns `503` from `/readyz`.

## Migrations

```bash
DATABASE_URL='postgres://game:password@host:5432/game' pnpm db:migrate
```

Migration files are append-only. A checksum mismatch for an already applied filename is a stop condition: restore the original migration file and create a new ordered migration instead.

## Backup and restore rehearsal

```bash
pg_dump --format=custom --no-owner --file=304-online-$(date +%F).dump "$DATABASE_URL"
createdb 304_online_restore_check
pg_restore --clean --if-exists --no-owner --dbname=304_online_restore_check 304-online-YYYY-MM-DD.dump
psql 304_online_restore_check -c 'SELECT count(*) FROM schema_migrations;'
```

Run a restore rehearsal before every production schema release. Keep backups encrypted in the production provider's backup system; never commit dumps to this repository.

## Rollback

Stop traffic to the new service, retain the database, and redeploy the previous verified service image. Do not run destructive down migrations against an active room database. If a migration blocks service startup, restore from the most recent verified backup into a new database, validate `/readyz`, then switch traffic only after validation succeeds.
````

Add a `Production foundation` section near the README run instructions linking to the runbook and showing `pnpm check` and `pnpm compose:up`.

- [ ] **Step 4: Verify gates GREEN**

Run: `node --test test/production-foundation-ci.test.mjs`

Run: `pnpm check`

Run: `pnpm security:check:all`

Expected: CI/runbook contract passes, all lint/type/unit checks pass, and pnpm reports no high-severity dependency finding or signature error.

- [ ] **Step 5: Commit the production gates**

```bash
git add .github/workflows/ci.yml README.md docs/operations/production-foundation.md test/production-foundation-ci.test.mjs
git commit -m "ci: add production foundation release gates"
```

## M1 completion checklist

- [ ] Existing engine tests and root server tests still pass through their legacy paths.
- [ ] `@three-zero-four/game-engine` exposes the current rules engine without HTTP or storage dependencies.
- [ ] Commands and versioned private updates are runtime-validated at one shared contract boundary.
- [ ] The Fastify process exposes live, readiness, metrics, request IDs, security headers, and JSON errors.
- [ ] PostgreSQL migration records are checksum-protected and schema creates the durable entities needed by M2.
- [ ] Redis and PostgreSQL run in a health-gated local topology.
- [ ] Next.js builds from a separate web package without claiming server authority.
- [ ] CI executes immutable install, checks, audit/signatures, migrations, and a Compose smoke test.
- [ ] The operations runbook includes readiness, migration, backup, restore, and rollback procedures.

## Follow-on implementation plans

M2 converts the existing room APIs into PostgreSQL event/snapshot transactions with Redis room leases and durable guest sessions. M3 adds versioned WebSocket delivery, timer-worker execution, bot autopilot, recovery fault injection, and complete multi-browser game paths. M4 completes the player-facing public launch flows, legal pages, analytics consent, production monitoring, performance/security/accessibility testing, and release rehearsal.
