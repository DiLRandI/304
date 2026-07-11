# Playable 304 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing 304 game boot safely, prove its core server/engine contracts with automated tests, and verify the quick-practice journey in a real browser.

**Architecture:** Preserve the current Node.js static server, server-authoritative `GameEngine`, and DOM client. Add a dependency-free Node test harness that starts the real server on an ephemeral port. Restrict static file delivery to the intended browser surface, rather than treating the repository as a public file tree.

**Tech Stack:** Node.js 24 built-in test runner, native `fetch`, static HTML/CSS/JavaScript, ES modules for game-engine code, and Playwright MCP for browser acceptance.

## Global Constraints

- Keep the current custom Node.js + static client architecture; do not migrate to Next.js, Phaser, or a database.
- Preserve server-authoritative game state and per-seat hidden-information projections.
- Do not add runtime dependencies for tests; use `node --test` and Node built-ins only.
- Static files exposed to browsers are only `/`, `/index.html`, `/styles.css`, `/src/ui/`, and `/assets/`.
- Preserve existing API routes, CSP headers, rate limits, and card asset paths.
- Every production behavior change begins with a test that fails for the intended reason.

---

## File structure

- `package.json` — exposes the built-in test runner through `pnpm test` when pnpm is installed.
- `test/helpers/server.mjs` — starts and stops the real HTTP server against an unused port.
- `test/server-static.test.mjs` — regression coverage for root boot, public static files, and private server files.
- `test/engine-contract.test.mjs` — characterization coverage for deck, deals, projections, and bot legal actions.
- `test/room-flow.test.mjs` — integration coverage for guest session, room creation, bot fill, and a server-projected started hand.
- `server.js` — canonicalizes URL paths and allowlists browser-facing static paths.
- `docs/superpowers/specs/2026-07-10-304-game-build-design.md` — records the static allowlist as the final serving boundary.

## Task 1: Add a dependency-free server test harness and failing root-route regression

**Files:**

- Create: `test/helpers/server.mjs`
- Create: `test/server-static.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `startServer(): Promise<{ baseUrl: string, close(): Promise<void> }>`.
- Consumes: the real `server.js` entrypoint through a child Node process.
- Produces: a single `pnpm test` command with no third-party framework.

- [ ] **Step 1: Create the server lifecycle helper**

```js
// test/helpers/server.mjs
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

async function reservePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealthy(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) return;
    } catch {
      // The process has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not become healthy within 10 seconds");
}

export async function startServer() {
  const port = await reservePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealthy(baseUrl, child);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n${output.join("")}`);
  }
  return {
    baseUrl,
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}
```

- [ ] **Step 2: Add the failing static-root regression test**

```js
// test/server-static.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/server.mjs";

test("serves the game shell and its public static entrypoints", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const root = await fetch(`${app.baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") || "", /^text\/html/);
  assert.match(await root.text(), /src="\.\/src\/ui\/app\.js"/);

  const stylesheet = await fetch(`${app.baseUrl}/styles.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") || "", /^text\/css/);

  const client = await fetch(`${app.baseUrl}/src/ui/app.js`);
  assert.equal(client.status, 200);
  assert.match(client.headers.get("content-type") || "", /^application\/javascript/);
});

test("does not expose private server source as a static asset", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/server.js`);
  assert.equal(response.status, 404);
});
```

- [ ] **Step 3: Add the test script without changing runtime dependencies**

```json
{
  "scripts": {
    "test": "node --test"
  }
}
```

Insert the `test` property alongside the existing `start` and `health` scripts; leave all existing scripts unchanged.

- [ ] **Step 4: Run the new regression test and verify RED**

Run: `node --test test/server-static.test.mjs`

Expected: the first test fails with `404 !== 200` for `/`. The second test may already pass because the current path guard incorrectly blocks all absolute URL paths.

- [ ] **Step 5: Commit the red test harness**

```bash
git add package.json test/helpers/server.mjs test/server-static.test.mjs
git commit -m "test: cover public static server routes"
```

## Task 2: Safely serve the browser application and nothing else

**Files:**

- Modify: `server.js:141-184`
- Modify: `docs/superpowers/specs/2026-07-10-304-game-build-design.md`
- Test: `test/server-static.test.mjs`

**Interfaces:**

- Consumes: request URL path strings such as `/`, `/styles.css`, `/src/ui/app.js`, and `/assets/cards/...`.
- Produces: a canonical public path or `null`; `resolveFile()` returns a file only when it is explicitly browser-facing.

- [ ] **Step 1: Implement a URL path canonicalizer and public allowlist**

Replace `safePath()` and the first part of `resolveFile()` with:

```js
const PUBLIC_STATIC_FILES = new Set(["/", "/index.html", "/styles.css"]);
const PUBLIC_STATIC_PREFIXES = ["/src/ui/", "/assets/"];

function safePath(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath);
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    if (decoded.split("/").includes("..")) return null;
    const normalized = path.posix.normalize(`/${decoded.replace(/^\/+/, "")}`);
    const relativePath = normalized.replace(/^\/+/, "");
    return relativePath ? `/${relativePath}` : "/";
  } catch {
    return null;
  }
}

function isPublicStaticPath(cleanPath) {
  return (
    PUBLIC_STATIC_FILES.has(cleanPath) ||
    PUBLIC_STATIC_PREFIXES.some((prefix) => cleanPath.startsWith(prefix))
  );
}

function resolveFile(requested) {
  const cleanPath = safePath(requested);
  if (!cleanPath || !isPublicStaticPath(cleanPath)) return null;
  const candidate =
    cleanPath === "/"
      ? path.join(ROOT_DIR, "index.html")
      : path.resolve(ROOT_DIR, `.${cleanPath}`);
  if (!candidate.startsWith(`${ROOT_DIR}${path.sep}`)) return null;
  try {
    const stat = fs.statSync(candidate);
    return stat.isDirectory() ? null : candidate;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Explain the allowlist in the design artifact**

Replace the last static-serving sentence in the design spec with:

```markdown
The public static surface is intentionally limited to the HTML shell, stylesheet, browser UI modules, and `assets/`. API/server code, documentation, package metadata, and repository configuration are never static files. All public paths are decoded, reject traversal/backslashes/NUL bytes, normalized as POSIX URL paths, then resolved under the repository root.
```

- [ ] **Step 3: Run the static test and verify GREEN**

Run: `node --test test/server-static.test.mjs`

Expected: two passing tests; `/`, `/styles.css`, and `/src/ui/app.js` return `200`, while `/server.js` remains `404`.

- [ ] **Step 4: Run direct syntax and health checks**

Run: `node --check server.js && node --check src/ui/app.js && node --check src/engine/engine.js`

Expected: exit `0` for each command.

- [ ] **Step 5: Commit the secure boot fix**

```bash
git add server.js docs/superpowers/specs/2026-07-10-304-game-build-design.md
git commit -m "fix: serve the 304 game shell safely"
```

## Task 3: Define the engine module boundary without warnings

**Files:**

- Create: `src/engine/package.json`
- Create: `test/engine-module-boundary.test.mjs`

**Interfaces:**

- Consumes: Node's nearest-package module type resolution for `src/engine/*.js`.
- Produces: ES module parsing for engine files without changing the CommonJS `server.js` entrypoint.

- [ ] **Step 1: Write the failing import-warning regression**

```js
// test/engine-module-boundary.test.mjs
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
```

- [ ] **Step 2: Run the regression and verify RED**

Run: `node --test test/engine-module-boundary.test.mjs`

Expected: the test fails because Node emits `MODULE_TYPELESS_PACKAGE_JSON` while dynamically reparsing `src/engine/engine.js`.

- [ ] **Step 3: Add the scoped ESM package declaration**

```json
// src/engine/package.json
{
  "type": "module"
}
```

This nested package boundary leaves root-level `server.js` in CommonJS mode while declaring the files that use `import`/`export` syntax as ESM.

- [ ] **Step 4: Run the regression and engine suite to verify GREEN**

Run: `node --test test/engine-module-boundary.test.mjs test/engine-contract.test.mjs`

Expected: five passing tests and no `MODULE_TYPELESS_PACKAGE_JSON` output.

- [ ] **Step 5: Commit the module-boundary fix**

```bash
git add src/engine/package.json test/engine-module-boundary.test.mjs
git commit -m "fix: declare engine modules as esm"
```

## Task 4: Characterize the engine's playable contracts

**Files:**

- Create: `test/engine-contract.test.mjs`
- Test: `src/engine/cardData.js`, `src/engine/engine.js`, `src/engine/bot.js`

**Interfaces:**

- Consumes: `getProfile()`, `buildDeck()`, `GameEngine`, `getSeatView()`, `getPublicState()`, `getLegalActions()`, and `getBotAction()`.
- Produces: regression coverage for the deck, first deal, hidden-card projection, and bot legal-action invariant.

- [ ] **Step 1: Write the engine contract tests**

```js
// test/engine-contract.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { buildDeck } from "../src/engine/cardData.js";
import { GameEngine } from "../src/engine/engine.js";
import { getProfile } from "../src/engine/profiles.js";

test("classic deck has 32 unique cards worth 304 points", () => {
  const deck = buildDeck(getProfile("classic_304_4p"));
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map((card) => card.cardId)).size, 32);
  assert.equal(deck.reduce((total, card) => total + card.points, 0), 304);
});

test("starting a classic hand deals four private cards per seat", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  assert.equal(engine.state.phase, "four_bidding");
  assert.ok(Number.isInteger(engine.state.activeSeat));
  for (const seat of engine.state.seats) {
    assert.equal(seat.hand.length, 4);
    assert.equal(seat.firstHand.length, 4);
  }
});

test("a viewer receives only their own card identities", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  const self = engine.getSeatView(0, 0);
  const opponent = engine.getSeatView(0, 1);
  const publicState = engine.getPublicState(0);
  const publicPayload = JSON.stringify(publicState);

  assert.equal(self.hand.some((card) => card.hidden), false);
  assert.equal(opponent.hand.every((card) => card.hidden === true), true);
  assert.equal(publicPayload.includes(self.hand[0].cardId), false);
  assert.equal(publicPayload.includes(opponent.hand[0].cardId), false);
});

test("a bot action is always one of its server-provided legal actions", () => {
  const engine = new GameEngine({
    ruleProfile: "classic_304_4p",
    initialSeats: Array.from({ length: 4 }, (_, index) => ({
      index,
      type: "bot",
      displayName: `Bot ${index + 1}`,
    })),
  });
  engine.startMatch();

  const seatIndex = engine.state.activeSeat;
  const action = engine.getBotAction(seatIndex);
  const legal = engine.getLegalActions(seatIndex);

  assert.ok(action);
  assert.ok(legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)));
});
```

- [ ] **Step 2: Run the characterization suite**

Run: `node --test test/engine-contract.test.mjs`

Expected: all four tests pass. If a test exposes a behavior mismatch, leave production code unchanged, report the exact mismatch, and start a separate red-green task for the documented rule.

- [ ] **Step 3: Commit engine contract coverage**

```bash
git add test/engine-contract.test.mjs
git commit -m "test: characterize 304 engine contracts"
```

## Task 5: Prove the room-to-engine quick-practice path

**Files:**

- Create: `test/room-flow.test.mjs`
- Test: `server.js`, `src/engine/engine.js`

**Interfaces:**

- Consumes: `POST /api/guest-session`, `POST /api/rooms`, and `POST /api/rooms/:roomId/start`.
- Produces: a real room response containing one human, three bots, a private seat view, public state, and legal actions.

- [ ] **Step 1: Write the integration test**

```js
// test/room-flow.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/server.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("quick-practice room starts with one person, three bots, and a private hand", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Practice Player" }),
  });
  assert.equal(guest.response.status, 201);

  const sessionHeaders = { "x-session-token": guest.body.sessionToken };
  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 1,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const started = await requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/start`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.status, "in_hand");
  assert.equal(started.body.seats.filter((seat) => seat.type === "human").length, 1);
  assert.equal(started.body.seats.filter((seat) => seat.type === "bot").length, 3);
  assert.equal(started.body.seatView.hand.length, 4);
  assert.equal(started.body.publicState.seats[1].handSize, 4);
  assert.equal(started.body.publicState.seats[1].hand, undefined);
  assert.ok(Array.isArray(started.body.legalActions));
});
```

- [ ] **Step 2: Run the integration test**

Run: `node --test test/room-flow.test.mjs`

Expected: one passing test. If the returned public state leaks `hand` identity for another seat, stop and create a dedicated projection red-green fix before continuing.

- [ ] **Step 3: Run the whole automated suite**

Run: `node --test`

Expected: all server-static, engine-contract, and room-flow tests pass without warnings.

- [ ] **Step 4: Commit the room-flow regression**

```bash
git add test/room-flow.test.mjs
git commit -m "test: cover 304 quick practice room flow"
```

## Task 6: Run browser acceptance on desktop and mobile

**Files:**

- Modify only if an observed browser failure has a corresponding failing automated regression.
- Evidence: Playwright snapshots and screenshots generated outside tracked source paths.

**Interfaces:**

- Consumes: the real local Node server and browser-facing routes.
- Produces: visual evidence for setup, lobby, first actionable hand, and a 390px-wide mobile view.

- [ ] **Step 1: Start the app on an unused local port**

Run: `PORT=4173 node server.js`

Expected: one `listening` log line and `GET /health` returns `200`.

- [ ] **Step 2: Verify setup and static assets through Playwright MCP**

Navigate to `http://localhost:4173`, take a screenshot, and capture an accessibility snapshot.

Expected: the page title is `304 Online`; setup controls include `Play now (quick practice)`, `Create room`, and `Join room`; there is no 404 response for the document, stylesheet, or client module.

- [ ] **Step 3: Exercise quick practice**

Click `Play now (quick practice)`, verify the lobby shows one human seat and three bot seats, then click `Start match`.

Expected: the game surface displays a phase prompt and either the human's legal bidding controls or a waiting-for-bot state. The accessibility snapshot contains a live status region and visible team/seat information.

- [ ] **Step 4: Verify responsive behavior**

Resize the browser to `390x844`, capture a screenshot and accessibility snapshot, then verify the phase prompt and player-action region remain visible without horizontal page overflow.

Expected: setup, lobby, and game controls remain operable; cards/buttons remain keyboard focusable.

- [ ] **Step 5: Record only evidence-backed follow-up work**

If an observed browser defect is found, stop this acceptance task and create a separate exact test-first task for that defect. Do not make speculative styling or gameplay changes during this acceptance pass.

## Plan self-review

- Spec coverage: Tasks 1-2 cover boot and secure static serving; Task 3 removes the engine module-format warning; Task 4 covers deck/deal/projection/bot legality; Task 5 covers room/bot-fill/private hand flow; Task 6 covers the browser acceptance journey and mobile usability.
- Placeholder scan: no TODO, TBD, placeholder file names, or unspecified commits are present. A browser-discovered defect is deliberately routed to a fresh exact test-first task instead of an unspecified code change.
- Type consistency: the test helper exports `startServer`; all server tests import that exact name. Room API assertions use the current response names (`roomId`, `seatView`, `publicState`, `legalActions`).
