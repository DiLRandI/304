# Public Release Product and Operations (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the browser-facing, accessible 304 product and the self-contained operational evidence needed for a public casual-release rehearsal.

**Architecture:** The Next.js browser client is a presentation and transport layer only: it creates a guest session, sends idempotent HTTP commands, and accepts only schema-validated private projections from the HTTP snapshot and WebSocket paths. A small client state controller owns reconnect/resync behavior; game tables render only projected fields and never import the engine or raw event payloads. The release stack keeps service/worker ownership separate and adds Prometheus-compatible worker-health telemetry, reproducible backup/restore rehearsal, browser acceptance, and non-vendor-specific consent/operations surfaces.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@three-zero-four/contracts`, browser WebSocket, Vitest, Playwright Chromium, Fastify, PostgreSQL 18, Redis 8, Prometheus rules, Docker Compose, pnpm 11.

## Global Constraints

- PostgreSQL remains authoritative; the browser never reads engine snapshots, event payloads, job rows, or another player’s private view.
- Browser mutations use only the documented `/v1` HTTP commands with a UUID command id and the projection’s event version; WebSocket messages are only `PING` and `RESYNC`.
- Use `credentials: "include"` for game-service HTTP requests and derive the WebSocket URL from the configured public game-service origin. Production deployment must put the two HTTPS origins under the same site and set `CORS_ORIGINS` to the exact web origin.
- Validate every inbound browser projection/message with the shared contracts before committing it to React state. Ignore stale versions and request an HTTP snapshot after a version gap.
- Do not add wagering, rankings, chat, public matchmaking, spectators, account linking, social graphs, or custom rule editing.
- Public pages must state data practices truthfully. Optional analytics are opt-in, collect only allowlisted event names/properties, and remain disabled unless a configured endpoint is present.
- Do not claim legal review, a live external monitoring vendor, or a public deployment without the required outside authority. Provide accurate routes, consent behavior, configuration, and rehearsal evidence instead.
- Preserve the supply-chain controls: immutable pnpm install, audit/signature verification, full-SHA GitHub Actions, no committed secrets, no generated browser artifacts, and no captured game state.
- The production release gate must include real browser interaction, mobile viewport coverage, keyboard behavior, service/worker health, a backup-restore rehearsal, static secret/container scans, and the existing PostgreSQL/Redis integration suite.

---

## File structure

```text
packages/contracts/src/game.ts                         Create-room and browser response contracts
apps/game-service/src/domain/room-coordinator.ts       Persist host-selected bot difficulty
apps/game-service/test/durable-rooms.integration.test.ts Service preference proof
apps/web/src/lib/game-client.ts                        Typed HTTP and WebSocket transport
apps/web/src/lib/room-state.ts                          Version-safe private projection reducer
apps/web/src/hooks/use-room-controller.ts               Guest/session/room lifecycle hook
apps/web/src/components/entry-flow.tsx                  Practice, create, and invite-join form
apps/web/src/components/room-lobby.tsx                  Private lobby and host start controls
apps/web/src/components/game-table.tsx                  Projected 4/6 seat table and legal controls
apps/web/src/components/card.tsx                        Accessible code-native card face/back controls
apps/web/src/components/rules-drawer.tsx                Contextual rules and card-value help
apps/web/src/components/consent-banner.tsx              Optional analytics consent control
apps/web/src/app/page.tsx                               Landing page
apps/web/src/app/play/page.tsx                          Entry flow route
apps/web/src/app/room/[roomRef]/page.tsx                Room shell route
apps/web/src/app/rules/page.tsx                         User-facing rules route
apps/web/src/app/privacy/page.tsx                       Data-use disclosure
apps/web/src/app/terms/page.tsx                         Terms/no-wagering disclosure
apps/web/src/app/globals.css                            Responsive design tokens and table layouts
apps/web/src/app/layout.tsx                             Navigation, metadata, and production indexing policy
apps/web/test/*.test.ts                                 Transport/reducer/component behavior tests
apps/web/e2e/*.spec.ts                                  Chromium desktop/mobile and keyboard acceptance
apps/game-service/src/infra/redis-coordination.ts       Durable worker heartbeat telemetry
apps/game-service/src/metrics.ts                        Worker-heartbeat metric surface
apps/game-service/src/server.ts                         Server-side metrics refresh
apps/game-service/src/worker.ts                         Redis heartbeat publication
infra/monitoring/prometheus.yml                         Scrape configuration
infra/monitoring/alerts.yml                             Bounded service/worker/backlog alerts
infra/compose/compose.monitoring.yaml                   Optional local monitoring profile
scripts/backup-restore-rehearsal.sh                     Disposable Compose backup/restore proof
infra/load/browser-api-smoke.js                         Bounded non-destructive HTTP load smoke
.github/workflows/ci.yml                                Browser, scan, load, and restore release gates
docs/operations/public-release.md                       Deployment, alerts, consent, backup, and incident runbook
README.md                                                Accurate public-release status and local acceptance commands
```

### Task 1: Expose the release-safe room preference boundary

**Files:**

- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `apps/game-service/src/domain/room-coordinator.ts`
- Modify: `apps/game-service/test/durable-rooms.integration.test.ts`
- Modify: `packages/game-engine/src/engine.js`

**Interfaces:**

- Produces `CreateRoomRequest.botDifficulty: "easy" | "normal" | "strong"` with `"easy"` as the compatibility default.
- Persists the selection in `RoomSettings`, applies it only when empty seats become bots, and projects it in the lobby through the existing `botDifficulty` seat property.
- Does not expose mid-hand settings mutation, custom rules, or client-selected bot actions.

- [x] **Step 1: Write the failing contract and integration assertions**

```ts
expect(CreateRoomRequestSchema.parse({
  commandId: randomUUID(),
  ruleProfileId: "six_304_36",
  botDifficulty: "strong",
})).toMatchObject({ botDifficulty: "strong" });

const started = await coordinator.startRoom(host, roomId, request);
expect(started.view.publicState?.seats).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: "bot", difficulty: "strong" }),
  ]),
);
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts`

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts`

Expected: the contract rejects `botDifficulty` as an unknown key and started rooms use the hard-coded easy bot setting.

- [x] **Step 3: Add the bounded preference field**

```ts
const BotDifficultySchema = z.enum(["easy", "normal", "strong"]);

export const CreateRoomRequestSchema = z.object({
  commandId: Uuid,
  ruleProfileId: RuleProfileIdSchema.default("classic_304_4p"),
  botDifficulty: BotDifficultySchema.default("easy"),
}).strict();
```

Replace the coordinator literal with `botDifficulty: request.botDifficulty`. Expose only bot difficulty in public seat projections so players can understand the table configuration; keep human difficulty private/null. Retain `enableSecondBidding: true` as a server-owned release rule. Do not create a lobby settings endpoint; the selection is immutable once the room is created.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts`

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts`

Expected: all three allowed values persist through a create/start/recovery cycle and malformed values remain rejected.

- [x] **Step 5: Commit the public preference boundary**

```bash
git add packages/contracts packages/game-engine/src/engine.js apps/game-service/src/domain/room-coordinator.ts apps/game-service/test/durable-rooms.integration.test.ts
git commit -m "feat: configure room bot difficulty"
```

### Task 2: Build a contract-validated browser transport and room reducer

**Files:**

- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/lib/game-client.ts`
- Create: `apps/web/src/lib/room-state.ts`
- Create: `apps/web/test/game-client.test.ts`
- Create: `apps/web/test/room-state.test.ts`

**Interfaces:**

- Produces `GameClient` with `createGuest`, `createRoom`, `getRoom`, `joinRoom`, `startRoom`, `getSnapshot`, and `submitCommand` methods.
- Produces `applyProjection(current, next): { projection; needsResync: boolean }` and `toRoomSocketUrl(serviceUrl, roomId)`.
- The transport validates every successful payload with `RoomProjectionSchema` or `RealtimeServerMessageSchema`, maps only known service error envelopes to user-safe errors, and does not log payloads containing card data.

- [x] **Step 1: Write failing reducer/transport tests**

```ts
expect(applyProjection(currentAt7, projectionAt6)).toEqual({
  projection: currentAt7,
  needsResync: false,
});
expect(applyProjection(currentAt7, projectionAt9)).toEqual({
  projection: projectionAt9,
  needsResync: true,
});

await expect(client.createRoom({ ruleProfileId: "classic_304_4p" }))
  .resolves.toMatchObject({ eventVersion: 1 });
expect(fetchMock).toHaveBeenCalledWith(
  "https://api.example.test/v1/rooms",
  expect.objectContaining({ credentials: "include" }),
);
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/web test -- game-client.test.ts room-state.test.ts`

Expected: FAIL because the shell has no browser transport or version reducer.

- [x] **Step 3: Implement the minimal safe client boundary**

```ts
export class GameClient {
  constructor(private readonly serviceUrl: URL, private readonly fetcher = fetch) {}

  async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const response = await this.fetcher(new URL(path, this.serviceUrl), {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw serviceError(body, response.status);
    return schema.parse(body);
  }
}

export function applyProjection(current: RoomProjection | null, next: RoomProjection) {
  if (!current || next.eventVersion > current.eventVersion) {
    return { projection: next, needsResync: Boolean(current && next.eventVersion > current.eventVersion + 1) };
  }
  return { projection: current, needsResync: false };
}
```

Use `crypto.randomUUID()` at the command call site; never allow a UI component to provide a player/seat id. Derive `wss:` from `https:` and `ws:` from `http:`. Send `PING` every 15 seconds only while the browser tab is visible; close the socket during hook cleanup.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/web test -- game-client.test.ts room-state.test.ts`

Expected: stale versions cannot regress state, gaps trigger a resync signal, commands use cookies/idempotency/versioning, and malformed payloads do not enter state.

- [ ] **Step 5: Commit the browser transport**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib apps/web/test
git commit -m "feat: add validated browser room transport"
```

### Task 3: Deliver the mobile-first landing, entry, lobby, and game-table client

**Files:**

- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/play/page.tsx`
- Create: `apps/web/src/app/room/[roomRef]/page.tsx`
- Create: `apps/web/src/components/entry-flow.tsx`
- Create: `apps/web/src/components/room-lobby.tsx`
- Create: `apps/web/src/components/game-table.tsx`
- Create: `apps/web/src/components/card.tsx`
- Create: `apps/web/src/hooks/use-room-controller.ts`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/test/entry-flow.test.tsx`
- Create: `apps/web/test/game-table.test.tsx`

**Interfaces:**

- `useRoomController(roomRef?)` owns guest bootstrap, lobby join, HTTP snapshot, socket lifecycle, command submission, reconnect/error state, and navigation-safe cleanup.
- `GameTable` accepts only `RoomProjection`, `submit(action)`, and transport status; it never accepts engine state or a seat index supplied by props.
- `CardButton` accepts a projected `GameAction` and uses a complete card label; legal actions are the only enabled controls.

- [ ] **Step 1: Produce the approved visual reference and write failing interaction tests**

Create one desktop and one narrow-mobile visual concept for the shared 304 design system before implementation: entry form, four-seat table, six-seat table, bidding/trump prompt, and hand-result state. Keep the approved dark table palette, readable card faces/backs, no casino imagery, and no wagering language.

```tsx
render(<EntryFlow client={client} />);
await user.type(screen.getByLabelText("Display name"), "Asha");
await user.click(screen.getByRole("button", { name: "Start practice" }));
expect(await screen.findByText("Start game")).toBeVisible();

render(<GameTable projection={projection} submit={submit} connection="live" />);
expect(screen.getByRole("button", { name: /Play Jack of Spades, 30 points/ })).toBeEnabled();
expect(screen.getByRole("button", { name: /Play Seven of Clubs/ })).toBeDisabled();
```

- [ ] **Step 2: Run the component tests and verify RED**

Run: `pnpm --filter @three-zero-four/web test -- entry-flow.test.tsx game-table.test.tsx`

Expected: FAIL because the Next.js shell has no playable routes/components.

- [ ] **Step 3: Implement the browser product flow**

Build these route-level flows without optimistic game state:

1. `/` explains private rooms/practice, links to `/play`, `/rules`, `/privacy`, and `/terms`, and renders a clear no-wagering statement.
2. `/play` creates a guest session from a validated display name, starts a one-human bot practice room, creates a private Classic/six-seat room with a selected difficulty, or joins an invite code.
3. `/room/[roomRef]` fetches a private snapshot, joins the room if the viewer is not seated and it is still a lobby, shows a lobby with invite code/copy action and host-only start button, then renders the table after start.
4. The table shows team/seat labels, connection/autopilot state, current trick, closed/open trump, current bid/tokens, prompt, legal bid/trump/card/result actions, and a private hand. It renders four and six seats with CSS grid areas rather than hard-coded absolute coordinates.
5. A failed command retains the last projection, announces a safe error, and immediately refreshes the snapshot for conflicts. A version gap performs `RESYNC` then an HTTP snapshot fallback.

Use semantic buttons and native suit symbols/cards so no game asset duplication is required. Add a compact mobile bottom action area; never hide the prompt or private hand behind a drawer.

- [ ] **Step 4: Verify GREEN in unit and browser contexts**

Run: `pnpm --filter @three-zero-four/web test`

Run: `pnpm --filter @three-zero-four/web build`

Run: `pnpm --filter @three-zero-four/web dev --hostname 127.0.0.1`

Expected: entry/lobby/table interactions are deterministic under mock transport, the production bundle builds, and the browser route has no console errors.

- [ ] **Step 5: Commit the player client**

```bash
git add apps/web
git commit -m "feat: deliver production 304 browser client"
```

### Task 4: Add rules, privacy/terms, consent, and accessibility preferences

**Files:**

- Create: `apps/web/src/app/rules/page.tsx`
- Create: `apps/web/src/app/privacy/page.tsx`
- Create: `apps/web/src/app/terms/page.tsx`
- Create: `apps/web/src/components/rules-drawer.tsx`
- Create: `apps/web/src/components/consent-banner.tsx`
- Create: `apps/web/src/lib/consent.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/test/consent.test.tsx`
- Create: `apps/web/test/accessibility.test.tsx`

**Interfaces:**

- `ConsentState` is `"unknown" | "essential_only" | "optional_analytics"` and is stored only in browser local storage after an explicit choice.
- `track(event, properties)` is a no-op unless consent is `optional_analytics`, an allowlisted endpoint exists, and every property passes a privacy allowlist.
- Rules pages document only the shipped Classic and six-seat profiles and say that six-seat 304-36 is a labeled variant.

- [ ] **Step 1: Write failing policy and accessibility tests**

```tsx
render(<ConsentBanner onChoice={onChoice} />);
await user.click(screen.getByRole("button", { name: "Essential only" }));
expect(onChoice).toHaveBeenCalledWith("essential_only");

render(<GameTable projection={projection} submit={submit} connection="live" />);
await user.tab();
expect(screen.getByRole("button", { name: /Play Jack of Spades/ })).toHaveFocus();
expect(screen.getByRole("status")).toHaveTextContent("Your turn");
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/web test -- consent.test.tsx accessibility.test.tsx`

Expected: FAIL because policy routes, preference storage, status announcements, and keyboard interaction are absent.

- [ ] **Step 3: Implement truthful public content and controls**

Document display names, session cookies, room/game events, optional anonymous analytics, and no payment/location/contact collection in the privacy route. Terms must state casual entertainment, no money/prizes/wagering, participant responsibility, and a configurable contact channel—not a fabricated company or legal assertion.

Implement card-size, high-contrast, and reduced-motion preferences as CSS data attributes. Add `aria-live="polite"` status announcements for turn/trump/trick/connection changes and visibly retain suit name/symbols even in high contrast. Ensure every icon-only/copy control has an accessible name and all actions are reachable with Tab/Enter/Space.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/web test -- consent.test.tsx accessibility.test.tsx`

Run: `pnpm --filter @three-zero-four/web build`

Expected: consent defaults to essential-only, optional beacons cannot include card/player/session fields, policy pages render, and keyboard/screen-reader controls remain available.

- [ ] **Step 5: Commit public product safeguards**

```bash
git add apps/web
git commit -m "feat: add accessible public release content"
```

### Task 5: Make worker health observable and add local monitoring artifacts

**Files:**

- Modify: `apps/game-service/src/infra/redis-coordination.ts`
- Modify: `apps/game-service/src/metrics.ts`
- Modify: `apps/game-service/src/server.ts`
- Modify: `apps/game-service/src/worker.ts`
- Modify: `apps/game-service/test/redis-coordination.test.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Create: `infra/monitoring/prometheus.yml`
- Create: `infra/monitoring/alerts.yml`
- Create: `infra/compose/compose.monitoring.yaml`
- Modify: `docs/operations/production-foundation.md`

**Interfaces:**

- `WorkerTelemetry.recordHeartbeat(timestampMs)` writes a short-lived Redis timestamp after a healthy worker poll.
- `WorkerTelemetry.ageSeconds(nowMs)` returns a bounded non-negative age or `Infinity` for no heartbeat.
- `/metrics` exposes `three_zero_four_worker_heartbeat_age_seconds`; alert rules cover no service scrape, stale worker heartbeat, persistent outbox backlog, and persistent automation backlog.

- [ ] **Step 1: Write failing telemetry and metric tests**

```ts
await telemetry.recordHeartbeat(1_700_000_000_000);
await expect(telemetry.ageSeconds(1_700_000_005_000)).resolves.toBe(5);

expect(metrics.payload).toContain("three_zero_four_worker_heartbeat_age_seconds");
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- redis-coordination.test.ts app.test.ts`

Expected: FAIL because no worker heartbeat is visible outside the worker container.

- [ ] **Step 3: Implement bounded telemetry and monitoring configuration**

Use a Redis key with a TTL of at least three worker poll intervals. The worker writes it only after its current DB/Redis health check succeeds. The server refreshes its gauge next to outbox/job/outcome metrics and treats absent telemetry as `Infinity` (Prometheus `+Inf`).

Configure an optional local Prometheus service that scrapes `/metrics` through the compose network and loads alert rules. Use warnings with conservative `for:` windows; alert descriptions must direct operators to the existing room/worker runbook and never include card or session data.

- [ ] **Step 4: Verify GREEN**

Run: `INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- redis-coordination.test.ts app.test.ts`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml -f infra/compose/compose.monitoring.yaml up --build --wait`

Expected: a healthy worker publishes a finite age, Prometheus loads all rules, and no production service exposes an unprotected admin mutator.

- [ ] **Step 5: Commit observable worker operations**

```bash
git add apps/game-service infra/monitoring infra/compose docs/operations/production-foundation.md
git commit -m "feat: add worker monitoring release gates"
```

### Task 6: Add browser, security, load, and backup-restore release evidence

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/e2e/practice-and-room.spec.ts`
- Create: `apps/web/e2e/accessibility-mobile.spec.ts`
- Create: `scripts/backup-restore-rehearsal.sh`
- Create: `infra/load/browser-api-smoke.js`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/production-foundation-ci.test.mjs`
- Create: `docs/operations/public-release.md`
- Modify: `README.md`

**Interfaces:**

- Browser tests use two independent browser contexts and only public web routes/controls; no test reads database state to advance a game.
- The restore script creates a disposable dump, restores it into a new disposable PostgreSQL database, runs migration/readiness verification, and removes all artifacts on exit.
- The load smoke uses bounded create/join/snapshot requests with generated guest data and explicitly excludes game commands, hidden data, and destructive database operations.

- [ ] **Step 1: Write failing static release-gate assertions**

```js
assert.match(workflow, /playwright install --with-deps chromium/);
assert.match(workflow, /gitleaks/);
assert.match(workflow, /trivy/);
assert.match(workflow, /backup-restore-rehearsal\.sh/);
assert.match(runbook, /Public-release rehearsal/);
```

- [ ] **Step 2: Run the release-gate test and verify RED**

Run: `node --test test/production-foundation-ci.test.mjs`

Expected: FAIL because the current CI validates services but has no browser, scan, load, or restore gate.

- [ ] **Step 3: Implement reproducible acceptance and release commands**

Add Playwright tests for:

1. a fresh guest starts Classic practice, reaches lobby, starts the game, and can submit the first visible legal action;
2. a second browser joins a private room by invite, receives a different private projection, and reconnects after a socket close;
3. six-seat layout at 390px and desktop width keeps prompt, private hand, and legal controls visible;
4. keyboard-only card/action control and reduced-motion/high-contrast preference behavior.

Add pinned scanner/container commands in CI, retain logs/screenshots/traces on failure, run the backup/restore rehearsal against the disposable Compose stack, then execute the bounded load smoke after readiness. The load command must have a fixed duration/concurrency and fail on non-2xx/latency thresholds; it must not turn into a destructive stress test.

- [ ] **Step 4: Verify the public-release rehearsal**

Run: `pnpm check`

Run: `pnpm security:check:all`

Run: `pnpm --filter @three-zero-four/web test`

Run: `pnpm --filter @three-zero-four/web exec playwright test`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait`

Run: `scripts/backup-restore-rehearsal.sh`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans`

Expected: desktop/mobile/keyboard flows pass in a real browser, scans are clean, an authoritative data dump restores into a clean database, and the release rehearsal has no P0/P1 failure.

- [ ] **Step 5: Commit the public-release evidence**

```bash
git add apps/web scripts infra/load .github/workflows/ci.yml test/production-foundation-ci.test.mjs docs/operations/public-release.md README.md
git commit -m "test: add public release rehearsal"
```

## M4 completion checklist

- [ ] A guest can use the Next.js client to start Classic or six-seat practice, create/invite/join a private room, start it, submit legal actions, and reconnect without a stale/private-view leak.
- [ ] The table is responsive at mobile/tablet/desktop widths, keyboard playable, screen-reader labeled, high-contrast/reduced-motion capable, and uses no casino/wagering presentation.
- [ ] Rules, privacy, terms, and consent pages accurately describe the shipped casual product and do not claim unconfigured external providers or legal approval.
- [ ] Worker health, outbox backlog, and automation backlog are observable through a Prometheus-compatible operational surface and documented alert responses.
- [ ] Browser E2E, supply-chain/secret/container scans, bounded load smoke, and an actual backup/restore rehearsal run in the release gate.
- [ ] Public deployment configuration, external legal review, configured alert delivery, and real production backup retention are explicitly documented as operator-owned prerequisites rather than being falsely represented as completed in source code.
