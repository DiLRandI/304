# Production Spec Gap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the documented reconnect and abandoned-room lifecycle violations, then complete the public-casual table guidance required by the current product documents.

**Architecture:** The game service remains the sole authority for room state, including automation, reconnect, snapshots, and durable events. Automation may progress an active hand but must never acknowledge a result: a completed hand pauses for a human host, while bounded terminal-room maintenance eventually closes an idle result. The browser continues to render only server-projected data, adding explanatory, non-authoritative UI for legal cards, table state, and the rules users need during a hand.

**Tech Stack:** Node.js 24, pnpm workspaces, TypeScript, JavaScript game engine, Fastify, PostgreSQL 18, Redis 8, Next.js/React, Vitest, Playwright, Docker Compose.

## Global Constraints

- Preserve the public-casual release boundary: guest sessions, private Classic and six-seat tables, bot fill, reconnect, durable hand/match progression, and operations.
- Do not add accounts, rankings, public matchmaking, chat, payments, wagering, social features, spectator access, custom rules, or client-side game authority.
- Follow `docs/product/01_PRD.md` and `docs/features/04_ROOM_MATCHMAKING_AND_BOT_FILL.md`: reconnect returns human control immediately; all-human absence pauses rather than continuously playing the table.
- A human host is the only actor that can submit `ACK_RESULT`; no bot or autopilot may advance `hand_result` or `match_complete`.
- Retention may close stale `lobby` and `hand_result` rooms, but must never close or alter an `in_hand` room.
- Keep snapshots, events, and metrics private and bounded; do not expose another player's cards, shuffle data, IDs, or room data through UI or telemetry.
- Use the existing release design as the current acceptance contract. The broader feature list and unchecked roadmap are product planning inputs, not authorization to silently add public matchmaking or rule variants.
- Preserve user-owned changes in the root `master` worktree; work only in this isolated feature worktree until the final local merge.

## File Structure

- `apps/game-service/src/domain/room-coordinator.ts` gates automation by game phase and always restores a reconnecting human's control.
- `apps/game-service/src/domain/room-store.ts` no longer contains the one-way autopilot history query once reconnection is unconditional.
- `apps/game-service/test/room-automation.integration.test.ts` proves stale terminal automation cannot progress a result and a player regains a durable online seat after an automated action.
- `apps/web/src/components/card.tsx` exposes a non-authoritative explanation for disabled cards.
- `apps/web/src/components/game-table.tsx` renders the documented result, trump, scoring, and legality information from projected state only.
- `apps/web/src/components/rules-drawer.tsx` supplies the current rule-help sections for both supported profiles.
- `apps/web/test/game-table.test.tsx` tests the accessible table guidance without relying on client-side rule computation.
- `docs/superpowers/specs/2026-07-11-production-match-lifecycle-and-acceptance-design.md`, `docs/features/04_ROOM_MATCHMAKING_AND_BOT_FILL.md`, and `docs/product/02_FULL_FEATURE_LIST.md` record the resolved release behavior and scope hierarchy.

---

### Task 1: Pin the reconnect and terminal-automation regressions

**Files:**

- Modify: `apps/game-service/test/room-automation.integration.test.ts:390-540`

**Interfaces:**

- Consumes `RoomCoordinator.runAutomation(job)`, `markRealtimePresence(session, roomId)`, `PostgresRoomStore.scheduleAutomation(...)`, and durable room snapshots.
- Produces regression coverage for `BOT_ACTION` jobs whose engine state is `hand_result` and for reconnect after `AUTOPILOT_ACTION`.

- [x] **Step 1: Write the failing result-automation regression test**

Replace the completed-hand auto-acknowledgement test with a test that installs a valid completed snapshot, marks seat zero as autopilot in both snapshot and `room_seats`, schedules a due `BOT_ACTION`, and asserts it cannot advance the room:

```ts
const completed = completeClassicHandSnapshot();
const seats = completed.seats as Array<Record<string, unknown>>;
seats[0] = { ...seats[0], autopilot: true, connectionStatus: "autopilot" };
await database.query(
  "UPDATE rooms SET status = 'hand_result' WHERE id = $1",
  [created.roomId],
);
await database.query(
  "UPDATE game_snapshots SET state = $3::jsonb WHERE room_id = $1 AND event_version = $2",
  [created.roomId, started.eventVersion, JSON.stringify(completed)],
);
await database.query(
  "UPDATE room_seats SET connection_status = 'autopilot' WHERE room_id = $1 AND seat_index = 0",
  [created.roomId],
);
await store.transaction((transaction) =>
  store.scheduleAutomation(transaction, {
    id: randomUUID(),
    roomId: created.roomId,
    expectedEventVersion: started.eventVersion,
    kind: "BOT_ACTION",
    targetSeatIndex: 0,
    dueAt: new Date(),
  }),
);
```

Claim the job, expect `runAutomation()` to return `"stale"`, complete the claim, then assert the durable room stays `hand_result` at `started.eventVersion` and no `AUTOPILOT_ACTION` event appears.

- [x] **Step 2: Write the failing post-action reconnect regression test**

Rename `keeps autopilot enabled when the automated action has already committed` to `returns control when the automated action has already committed`. Keep its timeout and bot-job setup, then replace its final assertions with:

```ts
expect(events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ eventType: "AUTOPILOT_ACTION" }),
    expect.objectContaining({ eventType: "AUTOPILOT_CANCELLED" }),
  ]),
);
await expect(
  database.query<{ connection_status: string }>(
    "SELECT connection_status FROM room_seats WHERE room_id = $1 AND seat_index = $2",
    [created.roomId, timeoutJob.targetSeatIndex],
  ),
).resolves.toEqual({ rows: [{ connection_status: "online" }] });
const reconnected = await game.getSnapshot(automatedPlayer, created.roomId);
const state = reconnected.view as { publicState: { seats: Array<{ autopilot: boolean }> } };
expect(state.publicState.seats[timeoutJob.targetSeatIndex]?.autopilot).toBe(false);
```

- [x] **Step 3: Run the focused integration test to verify RED**

Run:

```bash
INTEGRATION_DATABASE_URL=postgres://game:g304-lifecycle-test@127.0.0.1:5432/game INTEGRATION_REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @three-zero-four/game-service exec vitest run test/room-automation.integration.test.ts
```

Expected: the stale result job currently completes an `ACK_RESULT`, and reconnect after an automated action currently leaves `connection_status = 'autopilot'`.

### Task 2: Make automation bounded and reconnect ownership unconditional

**Files:**

- Modify: `apps/game-service/src/domain/room-coordinator.ts:95-112, 735-825`
- Modify: `apps/game-service/src/domain/room-store.ts:929-947`
- Test: `apps/game-service/test/room-automation.integration.test.ts`

**Interfaces:**

- Produces `automationSeatIndex(engine): number | null`, which returns an active seat only for a non-terminal phase.
- Produces `RoomCoordinator.runAutomation(job)`, which returns `"stale"` for a `BOT_ACTION` recovered at `hand_result` or `match_complete`.
- Produces `markRealtimePresence(session, roomId)`, which emits `AUTOPILOT_CANCELLED` and marks a reconnecting human online regardless of a prior automated action.

- [x] **Step 1: Implement the terminal phase guard before action selection**

Add a local helper and use it as the first condition in `automationSeatIndex`:

```ts
function isResultPhase(engine: GameEngine): boolean {
  return (
    engine.state.phase === "hand_result" ||
    engine.state.phase === "match_complete"
  );
}

function automationSeatIndex(engine: GameEngine): number | null {
  if (isResultPhase(engine)) return null;
  return activeSeatIndex(engine);
}
```

Immediately before the existing `BOT_ACTION` seat validation in `runAutomation`, reject a reclaimed terminal job without applying an engine action:

```ts
if (job.kind !== "BOT_ACTION") return "stale";
if (isResultPhase(engine)) return "stale";
```

This both stops future result jobs and safely drains a previously scheduled/reclaimed result job after deployment.

- [x] **Step 2: Remove one-way autopilot recovery**

Delete the `hasAutopilotActionSinceLatestEnable(...)` early return from `markRealtimePresence`. Delete `PostgresRoomStore.hasAutopilotActionSinceLatestEnable(...)` entirely because it has no remaining caller. Keep the existing recovery, `applyConnectionState(engine, viewerSeatIndex, "online")`, `markSeatOnline`, append-event, and `scheduleNextAutomation` path so reconnect never rolls back the committed automation action but does return future control immediately.

- [x] **Step 3: Run the focused integration test to verify GREEN**

Run:

```bash
INTEGRATION_DATABASE_URL=postgres://game:g304-lifecycle-test@127.0.0.1:5432/game INTEGRATION_REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @three-zero-four/game-service exec vitest run test/room-automation.integration.test.ts
```

Expected: PASS; result automation returns stale, room version/status do not change, and reconnect emits `AUTOPILOT_CANCELLED` with an online durable seat.

- [x] **Step 4: Commit the durable lifecycle repair**

```bash
git add apps/game-service/src/domain/room-coordinator.ts apps/game-service/src/domain/room-store.ts apps/game-service/test/room-automation.integration.test.ts
git commit -m "fix: bound autonomous room lifecycle"
```

### Task 3: Complete the documented table guidance without expanding authority

**Files:**

- Modify: `apps/web/src/components/card.tsx`
- Modify: `apps/web/src/components/game-table.tsx`
- Modify: `apps/web/src/components/rules-drawer.tsx`
- Modify: `apps/web/test/game-table.test.tsx`

**Interfaces:**

- Extends `CardButton` with optional `unavailableReason?: string`; disabled cards refer to that existing explanatory text through `aria-describedby` and never receive a client-created game action.
- Extends `RulesDrawer` with `profileId: string` so its six-seat note is only displayed for `six_304_36`.
- Keeps `GameTable` actions as `submit(action: GameAction): void` using only `view.legalActions` supplied by the service.

- [x] **Step 1: Write failing browser-component tests**

In the existing legal-card test, assert the disabled card is described by an explanation and that the explanation explains it is not legal for this turn:

```ts
expect(illegal.getAttribute("aria-describedby")).toBe("card-legality-note");
expect(screen.getByText("This card is not legal for this turn.")).toBeTruthy();
```

In the projected-result test, assert the result includes `Bid met` or `Bid missed` and the current projected trump label. Add a user-event test that opens `Rules and card values` and verifies `How bidding works`, `Trump and cutting`, `Scoring tokens`, and, for a six-seat fixture, `Six-seat 304-36`.

- [x] **Step 2: Run the web component test to verify RED**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
```

Expected: FAIL because disabled cards have no description, result UI omits bid outcome/trump detail, and the rules drawer has only a card-value list.

- [x] **Step 3: Implement only explanatory presentation**

In `CardButton`, add `unavailableReason?: string` and set `aria-describedby={action || !unavailableReason ? undefined : "card-legality-note"}`. In `GameTable`, render one visible `id="card-legality-note"` message derived only from turn ownership and existing server legal actions:

```tsx
<p className="card-legality-note" id="card-legality-note">
  {isPlayersTurn
    ? "This card is not legal for this turn. Use the highlighted legal cards or action buttons."
    : "Wait for your turn. The table will highlight legal cards when you can act."}
</p>
```

Pass that message to every `CardButton` and do not infer or submit an alternative action. Add `Bid met`/`Bid missed`, the already projected trump state, and per-team trick points to the existing status/result `dl` elements.

Replace the rules popover body with clearly labelled sections: `Card values`, `How bidding works`, `Trump and cutting`, `Scoring tokens`, and a conditional `Six-seat 304-36` note. Describe only enabled casual-table behavior: server validation, follow-suit, legal actions, card values, winning the bid, and tokens. Do not claim Caps, timer speed, or custom rules are enabled.

- [x] **Step 4: Run the web component test to verify GREEN**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
```

Expected: PASS; disabled cards have a usable explanation, result data remains server-projected, and the rule drawer covers the documented beginner topics.

- [x] **Step 5: Commit the UI guidance**

```bash
git add apps/web/src/components/card.tsx apps/web/src/components/game-table.tsx apps/web/src/components/rules-drawer.tsx apps/web/test/game-table.test.tsx
git commit -m "feat: complete in-table rule guidance"
```

### Task 4: Align release documents and prove the whole release

**Files:**

- Modify: `docs/superpowers/specs/2026-07-11-production-match-lifecycle-and-acceptance-design.md`
- Modify: `docs/features/04_ROOM_MATCHMAKING_AND_BOT_FILL.md`
- Modify: `docs/product/02_FULL_FEATURE_LIST.md`
- Modify: `docs/superpowers/plans/2026-07-11-production-match-lifecycle.md`

**Interfaces:**

- Documents the production rule: terminal results pause for a human host; stale terminal maintenance is the bounded abandonment path.
- Documents the planning hierarchy: the dated release design controls current acceptance; broader prioritized feature tables remain the next-release backlog unless they are inside that boundary.

- [x] **Step 1: Update the conflicting lifecycle language**

Replace the statement that fully automated tables may advance a result with this exact behavior:

```md
The worker may progress legal automation only during an active hand. It never
acknowledges `hand_result` or `match_complete`; those terminal states pause for
a reconnecting human host and are later bounded by terminal-room retention.
```

Add the same rule to the all-humans-disconnect section of the room feature document. Change the older implementation-plan global constraint from worker-driven terminal advancement to host-only result acknowledgement.

- [x] **Step 2: Make the scope hierarchy explicit**

At the top of `docs/product/02_FULL_FEATURE_LIST.md`, state that its P0/P1/P2 rows are product prioritization. Link to the dated public-casual release design for the current acceptance boundary, and retain all excluded rows as backlog rather than falsely marking them implemented.

- [ ] **Step 3: Run documentation and release checks**

Run:

```bash
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
git diff --check master...HEAD
```

Expected: all quality checks pass, audits report no high vulnerabilities, package signatures verify, and the diff has no whitespace errors.

- [x] **Step 4: Build final images sequentially and run live acceptance**

Use this isolated Compose environment for every command in this step:

```bash
export POSTGRES_DB=game POSTGRES_USER=game POSTGRES_PASSWORD=g304-lifecycle-test
export DATABASE_URL=postgres://game:g304-lifecycle-test@postgres:5432/game
export REDIS_URL=redis://redis:6379
export SESSION_SECRET_PEPPER=development-only-session-pepper-change-before-production
export NEXT_PUBLIC_GAME_SERVICE_URL=http://127.0.0.1:4100
export MAINTENANCE_POLL_INTERVAL_MS=300000 MAINTENANCE_BATCH_SIZE=100
export ROOM_LOBBY_IDLE_HOURS=24 ROOM_TERMINAL_RETENTION_DAYS=14
export ROOM_CLOSED_RETENTION_DAYS=30 EXPIRED_SESSION_REVOKE_HOURS=24
```

Build targets one at a time so fresh package downloads do not compete for the registry:

```bash
docker compose --progress=plain --project-name g304-lifecycle --file infra/compose/compose.yaml build game-service
docker compose --progress=plain --project-name g304-lifecycle --file infra/compose/compose.yaml build worker
docker compose --progress=plain --project-name g304-lifecycle --file infra/compose/compose.yaml build web
docker compose --project-name g304-lifecycle --file infra/compose/compose.yaml up -d --no-deps --force-recreate --wait game-service worker web
```

Run the externally visible and operational gates against those final images:

```bash
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
curl --fail --silent --show-error http://127.0.0.1:4100/metrics
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
G304_RESTORE_REHEARSAL=1 scripts/backup-restore-rehearsal.sh
LOAD_BASE_URL=http://127.0.0.1:4100 LOAD_ORIGIN=http://127.0.0.1:3000 node infra/load/browser-api-smoke.js
docker compose --progress=plain --project-name g304-integration --file infra/compose/compose.yaml up --build --wait postgres redis
docker compose --project-name g304-integration --file infra/compose/compose.yaml run --rm --no-deps migrate
docker compose --progress=plain --project-name g304-integration --file infra/compose/compose.yaml --profile integration build integration
docker compose --project-name g304-integration --file infra/compose/compose.yaml --profile integration run --rm --no-deps integration
docker compose --project-name g304-integration --file infra/compose/compose.yaml down --volumes --remove-orphans
```

Expected: `/readyz` returns a ready status, metrics contain only bounded aggregate names, all seven browser flows pass, backup/restore and browser API smoke pass, and the integration profile exits zero. The dedicated integration project deliberately excludes the game service and worker so they cannot claim test bot jobs. Never touch `g304-m3-*` containers.

- [ ] **Step 5: Commit docs, merge locally, and preserve root changes**

```bash
git add docs/superpowers/specs/2026-07-11-production-match-lifecycle-and-acceptance-design.md docs/features/04_ROOM_MATCHMAKING_AND_BOT_FILL.md docs/product/02_FULL_FEATURE_LIST.md docs/superpowers/plans/2026-07-11-production-match-lifecycle.md docs/superpowers/plans/2026-07-11-production-spec-gap-remediation.md
git commit -m "docs: align production lifecycle scope"
git -C /home/deleema/learning/304-game merge --no-ff feature/production-game-lifecycle -m "merge: complete production game lifecycle"
```

Before the merge, confirm the feature worktree is clean. After the merge, confirm only the root worktree's pre-existing staged `.gitignore` and untracked `m4-*.png` files remain. Do not push.

## Plan Review

**Spec coverage:** Tasks 1 and 2 implement the explicit reconnect and all-human absence rules. Task 3 covers the documented P0 table guidance that fits the current release boundary: legal-action explanation, rule help, trump, scoring, and result clarity. Task 4 reconciles the older broad product catalog with the dated release acceptance design without discarding backlog requirements.

**Deferred product catalog entries:** Auto-size switching, seat selection, ready checks, public matchmaking, timer configuration, accounts, rankings, and custom rules require their own server contracts, room-state migrations, and acceptance design. They are not silently represented as shipped by this plan.

**Placeholder scan:** This plan names all production and test files, exact methods, expected assertions, commands, and behavior. It contains no unassigned implementation work.

**Type consistency:** `runAutomation` retains its existing `Promise<"completed" | "stale">` contract; `CardButton` receives only an optional string; `RulesDrawer` receives a profile string from existing `GameTable` projected state.
