# Production Match Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private 304 tables safely complete, rematch, leave, retain, and prove those flows end-to-end in the browser.

**Architecture:** Keep the game engine authoritative for scoring and safe result projection; the Fastify service owns durable lifecycle transitions, versioning, host authorization, snapshots, and outbox notifications. A separate maintenance loop in the existing worker safely retires stale non-active rooms and reports aggregate-only counters; the Next.js client renders only validated server data and exits a room after a successful leave.

**Tech Stack:** Node.js 24, pnpm workspaces, JavaScript game engine, TypeScript, Zod, Fastify, PostgreSQL 18, Redis 8, Next.js/React, Vitest, Playwright, Docker Compose, Prometheus client.

## Global Constraints

- Preserve the public-casual release boundary: guest sessions, private Classic and six-seat tables, bot fill, reconnect, durable hand/match progression, and operations only.
- Do not add accounts, rankings, public matchmaking, chat, payments, wagering, social features, custom rules, spectator access, or client-side game authority.
- Never expose a shuffle seed, raw engine snapshot, another player's hand, closed trump card, private legal actions, player ID, invite code, or room ID through metrics labels, logs, result UI, or leave responses.
- All mutations use a UUID idempotency key and expected room event version; a duplicate leave returns its original safe `RoomExitResponse`.
- Only a human room host can submit `ACK_RESULT`; workers never advance a terminal hand or match result.
- A human may leave only in `lobby` or `hand_result`; an `in_hand` departure continues through the existing disconnect/grace/autopilot flow.
- The worker may close only stale `lobby` and `hand_result` rooms. It must never close or alter an `in_hand` room.
- Use append-only PostgreSQL migrations. Do not edit `0001_foundation.sql`, `0002_durable_rooms.sql`, or `0003_realtime_automation.sql`.
- Keep metrics bounded and aggregate-only. No metric label may contain a player, room, invite, card, session, or event payload value.
- Preserve the root `master` worktree's user-owned staged `.gitignore` entry and untracked `m4-*.png` files; implement only in this isolated worktree.

## File Structure

- `packages/game-engine/src/engine.js` becomes the canonical safe public hand-result projection boundary.
- `packages/contracts/src/game.ts` and `packages/contracts/src/index.ts` define the leave request/response wire contract shared by service and browser.
- `apps/game-service/src/domain/room-coordinator.ts` applies host-gated result acknowledgment and durable leave transitions.
- `apps/game-service/src/domain/room-store.ts` supplies atomic seat/host mutations, deduplication response storage, stale-room selection, session revocation, and closed-room purge primitives.
- `apps/game-service/src/domain/room-maintenance.ts` owns the safe, bounded retention pass independently of game command handling.
- `apps/game-service/src/worker/room-maintenance-worker.ts` schedules non-overlapping maintenance runs beside automation jobs.
- `apps/game-service/src/infra/redis-coordination.ts`, `apps/game-service/src/metrics.ts`, `apps/game-service/src/server.ts`, and `apps/game-service/src/worker.ts` surface aggregate maintenance counters without a worker HTTP port.
- `apps/web/src/lib/room-view.ts` validates the minimal safe result shape; `game-client.ts` and `use-room-controller.ts` call leave and clear departed state.
- `apps/web/src/components/game-table.tsx`, `room-lobby.tsx`, `room-client.tsx`, and `globals.css` make result, rematch, and leave controls accessible.
- `apps/web/e2e/practice-and-room.spec.ts` proves a real full hand in both profiles and a five-human six-seat start; service integration tests prove durable lifecycle and maintenance behavior.

---

### Task 1: Project a safe, complete hand-result contract from the engine

**Files:**

- Modify: `packages/game-engine/src/engine.js`
- Test: `packages/game-engine/test/public-api.test.mjs`

**Interfaces:**

- Produces the safe `publicState.handResult` shape consumed by the service and web client:

```js
// scored hand
{
  bidderTeam: "A" | "B",
  bidderTeamPoints: number,
  bid: number,
  handNumber: number,
  matchComplete: boolean,
  movement: number,
  otherTeamPoints: number,
  success: boolean,
  tokens: [number, number],
  trickCount: number,
  winningTeam: "A" | "B"
}

// all-pass hand
{
  handNumber: number,
  noScore: true,
  reason: string,
  tokens: [number, number]
}
```

- Consumed by `apps/game-service/src/domain/room-projector.ts` through `engine.getPublicState(viewerSeatIndex)` and validated in Task 5.

- [ ] **Step 1: Write failing engine public-API tests**

Add a scored-hand assertion that drives a deterministic engine hand through its legal bot actions, reads `engine.getPublicState(0).handResult`, and verifies the winner is server-calculated while private shuffle material is absent:

```js
assert.equal(result.winningTeam, result.success ? result.bidderTeam : result.bidderTeam === "A" ? "B" : "A");
assert.deepEqual(result.tokens, engine.state.tokens);
assert.equal(result.shuffleSeed, undefined);
assert.equal(result.seedCommit, undefined);
assert.equal(result.deckVersion, undefined);
assert.equal(JSON.stringify(publicState).includes(String(engine.state.handShuffle.seed)), false);
```

Add an all-pass assertion that verifies `noScore`, `reason`, `handNumber`, and `tokens` are projected while scored-only fields are absent.

- [ ] **Step 2: Run the engine test to verify RED**

Run: `pnpm --filter @three-zero-four/game-engine test -- public-api.test.mjs`

Expected: FAIL because `getPublicState()` currently returns raw `handResult` fields including `shuffleSeed`, and scored results have no `winningTeam`.

- [ ] **Step 3: Implement the minimal safe public projection**

In `_finishHand()`, calculate `winningTeam` from the already authoritative `success` and `trumpMakerTeam`. Add a local helper used only by `getPublicState()` that whitelists result fields instead of spreading internal state:

```js
function projectHandResultForPublic(result) {
  if (!result) return null;
  if (result.noScore === true) {
    return {
      handNumber: result.handNumber,
      noScore: true,
      reason: result.reason,
      tokens: [...result.tokens],
    };
  }
  return {
    bidderTeam: result.bidderTeam,
    bidderTeamPoints: result.bidderTeamPoints,
    bid: result.bid,
    handNumber: result.handNumber,
    matchComplete: result.matchComplete,
    movement: result.movement,
    otherTeamPoints: result.otherTeamPoints,
    success: result.success,
    tokens: [...result.tokens],
    trickCount: result.trickCount,
    winningTeam: result.winningTeam,
  };
}
```

Replace `handResult: this.state.handResult` in `getPublicState()` with `handResult: projectHandResultForPublic(this.state.handResult)`. Keep the raw snapshot unchanged so deterministic recovery retains its existing state.

- [ ] **Step 4: Run the engine test to verify GREEN**

Run: `pnpm --filter @three-zero-four/game-engine test -- public-api.test.mjs`

Expected: PASS with no raw seed, commit, deck metadata, or per-seat card summary in a public result.

- [ ] **Step 5: Commit the safe result projection**

```bash
git add packages/game-engine/src/engine.js packages/game-engine/test/public-api.test.mjs
git commit -m "fix: project safe hand results"
```

### Task 2: Define versioned leave contracts and validate them at both edges

**Files:**

- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `apps/web/src/lib/game-client.ts`
- Test: `apps/web/test/game-client.test.ts`

**Interfaces:**

- Produces:

```ts
export const LeaveRoomRequestSchema = z
  .object({ commandId: Uuid, expectedVersion: EventVersion })
  .strict();

export const RoomExitResponseSchema = z
  .object({
    roomId: Uuid,
    eventVersion: EventVersion,
    status: z.enum(["left", "closed"]),
  })
  .strict();

export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>;
export type RoomExitResponse = z.infer<typeof RoomExitResponseSchema>;
```

- Produces browser transport:

```ts
GameClient.leaveRoom(roomId: string, expectedVersion: number): Promise<RoomExitResponse>
```

- Consumed by the Fastify route in Task 3 and `useRoomController` in Task 5.

- [ ] **Step 1: Write failing contract and browser-client tests**

Add contract coverage that accepts only a UUID command id plus non-negative expected version and rejects injected actor/player fields. Add a `GameClient` test that calls `leaveRoom(ROOM_ID, 4)` and asserts the request is cookie-bearing, posts to `/v1/rooms/${ROOM_ID}/leave`, contains only `commandId` and `expectedVersion`, and rejects a successful malformed response.

```ts
expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
  commandId: expect.any(String),
  expectedVersion: 4,
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts && pnpm --filter @three-zero-four/web test -- game-client.test.ts`

Expected: FAIL because the leave schemas, exports, and client method do not exist.

- [ ] **Step 3: Implement the shared contracts and browser client method**

Add the two schemas/types and re-export them from `packages/contracts/src/index.ts`. In `GameClient`, generate the command id locally, validate through `LeaveRoomRequestSchema`, and parse successful response bodies through `RoomExitResponseSchema`:

```ts
async leaveRoom(roomId: string, expectedVersion: number): Promise<RoomExitResponse> {
  const input = LeaveRoomRequestSchema.parse({
    commandId: crypto.randomUUID(),
    expectedVersion,
  });
  return this.request(
    `/v1/rooms/${encodeURIComponent(roomId)}/leave`,
    "POST",
    input,
    RoomExitResponseSchema.parse,
  );
}
```

Do not return a `RoomProjection` from this method and do not add a leave action to `GameActionSchema`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts && pnpm --filter @three-zero-four/web test -- game-client.test.ts`

Expected: PASS; only safe room-exit metadata can cross the browser boundary.

- [ ] **Step 5: Commit contracts and client transport**

```bash
git add packages/contracts/src/game.ts packages/contracts/src/index.ts packages/contracts/test/game.test.ts apps/web/src/lib/game-client.ts apps/web/test/game-client.test.ts
git commit -m "feat: add versioned room leave contract"
```

### Task 3: Make result acknowledgment and voluntary leave durable room lifecycle transitions

**Files:**

- Modify: `apps/game-service/src/routes/v1.ts`
- Modify: `apps/game-service/src/domain/room-coordinator.ts`
- Modify: `apps/game-service/src/domain/room-projector.ts`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Create: `infra/postgres/migrations/0004_room_lifecycle_maintenance.sql`
- Modify: `apps/game-service/test/durable-rooms.integration.test.ts`
- Modify: `apps/game-service/test/room-coordinator.test.ts`
- Modify: `apps/game-service/test/recovery-fuzz.integration.test.ts`

**Interfaces:**

- Produces:

```ts
RoomCoordinator.leaveRoom(
  session: AuthenticatedSession,
  roomId: string,
  request: LeaveRoomRequest,
): Promise<RoomExitResponse>;
```

- Extends durable store operations:

```ts
clearHumanSeat(transaction, roomId, seatIndex): Promise<StoredSeat>;
replaceHumanSeatWithBot(transaction, roomId, seatIndex, difficulty): Promise<StoredSeat>;
transferHost(transaction, roomId, playerId): Promise<void>;
findLowestHumanPlayerId(transaction, roomId): Promise<string | null>;
```

- Extends `AppendEventInput` with `status: "closed"` and optional `deduplicationResponse`, and extends `findDuplicate()` to return its stored response object.

- [ ] **Step 1: Write failing lifecycle integration tests**

In `durable-rooms.integration.test.ts`, create a Classic lobby with a host and a guest, then assert all of the following against real PostgreSQL/Redis:

```ts
await expect(
  coordinator.submitCommand(guest, {
    action: { type: "ACK_RESULT" },
    commandId: randomUUID(),
    expectedVersion: resultProjection.eventVersion,
    roomId,
  }),
).rejects.toMatchObject({ code: "HOST_REQUIRED", statusCode: 403 });
```

Advance an all-bot-assisted hand to `hand_result`, verify the host's `ACK_RESULT` produces a new hand with incremented `handNumber`, a different `dealerSeat`, valid private hands, and a new event version. Add leave cases:

```ts
expect(await coordinator.leaveRoom(host, roomId, leaveRequest)).toMatchObject({
  roomId,
  status: "left",
});
expect(await store.loadRoom(roomId)).toMatchObject({ hostPlayerId: guest.playerId });
expect(await store.loadSeats(roomId)).toEqual(
  expect.arrayContaining([expect.objectContaining({ occupantType: "empty", seatIndex: 0 })]),
);
```

At `hand_result`, verify departing humans become bots at the configured difficulty, a departing host transfers to the lowest remaining human, the duplicate leave returns its original `RoomExitResponse`, and the last human produces status `closed`, a `ROOM_CLOSED` event, cancelled pending automation, and no private projection for that caller. Verify `in_hand` leave rejects with `ROOM_LEAVE_NOT_ALLOWED`.

Add a recovery variant that removes the latest snapshot after a leave and confirms a fresh coordinator replays the durable `PLAYER_LEFT` event without corrupting the current seats or a later result acknowledgment.

- [ ] **Step 2: Run lifecycle tests to verify RED**

Run: `INTEGRATION_DATABASE_URL="$INTEGRATION_DATABASE_URL" INTEGRATION_REDIS_URL="$INTEGRATION_REDIS_URL" pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts room-coordinator.test.ts recovery-fuzz.integration.test.ts`

Expected: FAIL because leave routing, storage operations, host gating, lifecycle events, and recovery handlers are absent.

- [ ] **Step 3: Implement the durable storage and migration primitives**

Add `0004_room_lifecycle_maintenance.sql` without altering earlier migrations:

```sql
CREATE INDEX IF NOT EXISTS rooms_status_updated_at_idx
  ON rooms (status, updated_at);

CREATE INDEX IF NOT EXISTS sessions_expired_unrevoked_idx
  ON sessions (expires_at)
  WHERE revoked_at IS NULL;
```

Update the store row mapping to include `updatedAt`. Make `clearHumanSeat` atomically set `player_id = NULL`, `occupant_type = 'empty'`, null bot/join/presence fields, and `connection_status = 'disconnected'`. Make `replaceHumanSeatWithBot` atomically set `occupant_type = 'bot'`, the configured difficulty, online connection status, and no player id. `transferHost` must update only a current human player. Store the full safe `RoomExitResponse` in `command_deduplications.response` through an optional `deduplicationResponse` input so a retry after later lifecycle changes returns the original response.

- [ ] **Step 4: Implement coordinator authorization, leave, projection, and replay behavior**

Before applying a human `ACK_RESULT`, reject any session whose `playerId !== room.hostPlayerId` with `HOST_REQUIRED`. In `projectRoomForPlayer`, filter `ACK_RESULT` from a non-host viewer's legal actions; worker automation continues to call `runAutomation()` and remains unaffected.

Register `POST /v1/rooms/:roomId/leave`, authenticate it, rate-limit it under `room-leave`, parse `LeaveRoomRequestSchema`, and delegate to `leaveRoom`.

Implement `leaveRoom` under the normal room lease and database transaction. Check a stored duplicate before checking the expected version or human seat, parse its stored `RoomExitResponse`, and return it. For a new command, require `lobby` or `hand_result`, mutate the seat according to the state, transfer host whenever the host leaves and at least one human remains, cancel all pending automation kinds, append one versioned event/snapshot/outbox row, and remove Redis presence only after the transaction commits:

```ts
const exitStatus = remainingHumanPlayerIds.length === 0 ? "closed" : "left";
const eventType = exitStatus === "closed" ? "ROOM_CLOSED" : "PLAYER_LEFT";
const exit = {
  eventVersion: room.eventVersion + 1,
  roomId: room.id,
  status: exitStatus,
} as const;
```

Use `PLAYER_LEFT` payload fields `{ seatIndex, replacement: "empty" | "bot", botDifficulty, hostPlayerId }` so snapshot replay can apply the same stored-seat state. Use `ROOM_CLOSED` payload `{ reason: "LAST_HUMAN_LEFT", seatIndex }` for the terminal exit. Extend recovery to apply `PLAYER_LEFT` payloads using the same stored-seat adapter and treat a terminal `ROOM_CLOSED` snapshot as closed rather than guessing a playable room.

- [ ] **Step 5: Run lifecycle tests to verify GREEN**

Run: `INTEGRATION_DATABASE_URL="$INTEGRATION_DATABASE_URL" INTEGRATION_REDIS_URL="$INTEGRATION_REDIS_URL" pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts room-coordinator.test.ts recovery-fuzz.integration.test.ts`

Expected: PASS with durable, idempotent leaves; host-only result advancement; bot replacement/host transfer; last-human closure; and recovery-safe event replay.

- [ ] **Step 6: Commit durable lifecycle behavior**

```bash
git add apps/game-service/src/routes/v1.ts apps/game-service/src/domain/room-coordinator.ts apps/game-service/src/domain/room-projector.ts apps/game-service/src/domain/room-store.ts infra/postgres/migrations/0004_room_lifecycle_maintenance.sql apps/game-service/test/durable-rooms.integration.test.ts apps/game-service/test/room-coordinator.test.ts apps/game-service/test/recovery-fuzz.integration.test.ts
git commit -m "feat: add durable room lifecycle controls"
```

### Task 4: Add bounded maintenance, aggregate telemetry, and operations configuration

**Files:**

- Create: `apps/game-service/src/domain/room-maintenance.ts`
- Create: `apps/game-service/src/worker/room-maintenance-worker.ts`
- Modify: `apps/game-service/src/config.ts`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Modify: `apps/game-service/src/infra/redis-coordination.ts`
- Modify: `apps/game-service/src/metrics.ts`
- Modify: `apps/game-service/src/server.ts`
- Modify: `apps/game-service/src/worker.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Modify: `apps/game-service/test/automation-worker.test.ts`
- Create: `apps/game-service/test/room-maintenance.integration.test.ts`
- Modify: `infra/compose/.env.example`
- Modify: `infra/compose/compose.yaml`
- Modify: `docs/operations/production-foundation.md`

**Interfaces:**

- Produces configuration with safe defaults and bounds:

```ts
MAINTENANCE_POLL_INTERVAL_MS: 300_000; // min 60_000, max 3_600_000
MAINTENANCE_BATCH_SIZE: 100; // min 1, max 500
ROOM_LOBBY_IDLE_HOURS: 24; // min 1, max 168
ROOM_TERMINAL_RETENTION_DAYS: 14; // min 1, max 90
ROOM_CLOSED_RETENTION_DAYS: 30; // min 1, max 365
EXPIRED_SESSION_REVOKE_HOURS: 24; // min 0, max 168
```

- Produces:

```ts
export interface MaintenanceResult {
  closedRooms: number;
  purgedRooms: number;
  revokedSessions: number;
}

RoomMaintenance.runOnce(now?: Date): Promise<MaintenanceResult>;
RoomMaintenanceWorker.start(): Promise<void>;
RoomMaintenanceWorker.runOnce(now?: Date): Promise<void>;
RoomMaintenanceWorker.stop(): Promise<void>;
```

- [ ] **Step 1: Write failing maintenance, configuration, and worker tests**

Add config tests for each lower/upper bound and for invalid retention values. Add a unit test showing `RoomMaintenanceWorker` performs an immediate run, does not overlap an active run, reports only the result object, and stops its timer.

In a PostgreSQL/Redis integration test, create one stale lobby, one stale terminal (`hand_result`) room, one in-hand room, and one aged closed room. Backdate only `rooms.updated_at` using test SQL. Execute one maintenance pass with deterministic `now` and assert:

```ts
expect(result).toEqual({ closedRooms: 2, purgedRooms: 1, revokedSessions: 1 });
expect(await roomStatus(inHandRoomId)).toBe("in_hand");
expect(await countEvents(staleLobbyId, "ROOM_CLOSED")).toBe(1);
expect(await pendingJobs(staleTerminalId)).toBe(0);
expect(await store.loadRoom(agedClosedRoomId)).toBeNull();
```

Confirm the close event payload includes only a bounded reason (`LOBBY_IDLE` or `TERMINAL_RETENTION`) and never a room, player, invite, card, or session value beyond the durable room id held by the database row itself.

- [ ] **Step 2: Run maintenance tests to verify RED**

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts automation-worker.test.ts && INTEGRATION_DATABASE_URL="$INTEGRATION_DATABASE_URL" INTEGRATION_REDIS_URL="$INTEGRATION_REDIS_URL" pnpm --filter @three-zero-four/game-service test -- room-maintenance.integration.test.ts`

Expected: FAIL because maintenance configuration, worker, store queries, telemetry, and lifecycle pass are absent.

- [ ] **Step 3: Implement safe maintenance storage and pass**

Add store methods that (a) revoke sessions only when `expires_at <= cutoff` and `revoked_at IS NULL`, (b) select at most `batchSize` stale room ids by allowed status and `updated_at`, (c) lock/recheck each candidate before closing it, and (d) delete only `status = 'closed'` rooms older than the closed-retention cutoff with `ON DELETE CASCADE` descendants.

Implement `RoomMaintenance` with a narrow store dependency. Its close transition loads the latest snapshot, cancels all pending automation kinds, appends a `ROOM_CLOSED` event/snapshot/outbox entry at the next version with status `closed`, and uses only these payloads:

```ts
{ reason: "LOBBY_IDLE" }
{ reason: "TERMINAL_RETENTION" }
```

Never select `in_hand` rooms, and recheck status and `updatedAt` under the same database transaction before closing a candidate.

- [ ] **Step 4: Schedule maintenance and expose aggregate metrics**

Add `RoomMaintenanceWorker` beside `AutomationWorker`, using the same non-overlapping `start/runOnce/stop` behavior but its own longer poll interval. In `worker.ts`, construct `RoomMaintenance`, start both workers, and stop both before closing Redis/PostgreSQL.

Add a `MaintenanceTelemetry` Redis hash with fixed keys `revoked_sessions`, `closed_rooms`, and `purged_rooms`; reject negative/non-safe values before writing. In `metrics.ts`, define three gauges named `three_zero_four_maintenance_sessions_revoked_total`, `three_zero_four_maintenance_rooms_closed_total`, and `three_zero_four_maintenance_rooms_purged_total`. `server.ts` reads the fixed telemetry snapshot during existing metrics refresh and sets those gauges. Do not use dynamic labels.

Pass every maintenance environment variable explicitly into the Compose worker, document the default values in `infra/compose/.env.example`, and update the operations runbook with the safe diagnostic command:

```bash
curl --fail --silent http://127.0.0.1:4100/metrics | rg 'three_zero_four_maintenance_(sessions_revoked|rooms_closed|rooms_purged)_total'
```

The runbook must state that a growing closure/purge counter is aggregate evidence only and must be investigated through approved database/incident procedures, not by manually editing events or jobs.

- [ ] **Step 5: Run maintenance tests to verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts automation-worker.test.ts && INTEGRATION_DATABASE_URL="$INTEGRATION_DATABASE_URL" INTEGRATION_REDIS_URL="$INTEGRATION_REDIS_URL" pnpm --filter @three-zero-four/game-service test -- room-maintenance.integration.test.ts`

Expected: PASS; stale lobby/result rooms close exactly once, in-hand rooms remain untouched, expired sessions revoke, aged closed rooms purge, and only aggregate counters surface.

- [ ] **Step 6: Commit maintenance and operations support**

```bash
git add apps/game-service/src/domain/room-maintenance.ts apps/game-service/src/worker/room-maintenance-worker.ts apps/game-service/src/config.ts apps/game-service/src/domain/room-store.ts apps/game-service/src/infra/redis-coordination.ts apps/game-service/src/metrics.ts apps/game-service/src/server.ts apps/game-service/src/worker.ts apps/game-service/test/app.test.ts apps/game-service/test/automation-worker.test.ts apps/game-service/test/room-maintenance.integration.test.ts infra/compose/.env.example infra/compose/compose.yaml docs/operations/production-foundation.md
git commit -m "feat: maintain retained game rooms safely"
```

### Task 5: Render validated results and exit rooms cleanly in the browser

**Files:**

- Modify: `apps/web/src/lib/room-view.ts`
- Modify: `apps/web/src/hooks/use-room-controller.ts`
- Modify: `apps/web/src/components/game-table.tsx`
- Modify: `apps/web/src/components/room-lobby.tsx`
- Modify: `apps/web/src/components/room-client.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/test/browser-fixtures.ts`
- Modify: `apps/web/test/game-table.test.tsx`
- Modify: `apps/web/test/room-lobby.test.tsx`
- Modify: `apps/web/test/room-controller.test.tsx`

**Interfaces:**

- Produces a validated display model:

```ts
export type ProjectedHandResult =
  | {
      handNumber: number;
      noScore: true;
      reason: string;
      tokens: [number, number];
    }
  | {
      bidderTeam: "A" | "B";
      bidderTeamPoints: number;
      bid: number;
      handNumber: number;
      matchComplete: boolean;
      movement: number;
      otherTeamPoints: number;
      success: boolean;
      tokens: [number, number];
      trickCount: number;
      winningTeam: "A" | "B";
    };
```

- Extends `RoomClient` with `leaveRoom(roomId, expectedVersion): Promise<RoomExitResponse>` and returns `leave(): Promise<RoomExitResponse | undefined>` from `useRoomController`.

- [ ] **Step 1: Write failing view, table, lobby, and controller tests**

Extend `activeProjection()` with a valid terminal `handResult` fixture and add a malformed variant containing `shuffleSeed`. Verify `readActiveRoomView()` rejects malformed or overbroad result payloads rather than rendering it.

Add table tests asserting the result region is announced and contains server-projected winner, bid, points, movement, and final tokens; assert the action label is **Next hand** for a non-terminal result and **Play another match** for `matchComplete: true`:

```tsx
expect(screen.getByRole("region", { name: "Hand result" })).toHaveTextContent("Winning team A");
expect(screen.getByRole("button", { name: "Next hand" })).toBeTruthy();
```

Add a lobby/table leave test that invokes `leave`, and controller coverage that confirms a successful leave closes the socket, cancels reconnect scheduling, clears `projection`, and does not request a new snapshot.

- [ ] **Step 2: Run browser unit tests to verify RED**

Run: `pnpm --filter @three-zero-four/web test -- game-table.test.tsx room-lobby.test.tsx room-controller.test.tsx`

Expected: FAIL because the browser model has no validated result, exit callback, leave buttons, or rematch labels.

- [ ] **Step 3: Implement validation, accessible result rendering, and leave flow**

In `room-view.ts`, add a strict `readHandResult()` that accepts only the exact whitelist from Task 1. Reject unknown result keys, non-integer points/tokens, mismatched two-token arrays, invalid teams, and any `shuffleSeed`, `seedCommit`, `deckVersion`, `firstSeatCards`, or raw state field.

In `GameTable`, display a `<section aria-label="Hand result" aria-live="polite">` only when the validated result exists. Render no-score results from their server message. Render scored results from `winningTeam`, `bid`, both point values, `movement`, and `tokens`; do not recompute success or winner in React. Map `ACK_RESULT` to `Play another match` only when `handResult.matchComplete` is true, otherwise `Next hand`. Add `data-seat-type` and `data-hand-size` to each seat panel for non-sensitive browser acceptance assertions.

In `RoomLobby` and `GameTable`, add a visible `Leave table` button. `useRoomController.leave()` must call `client.leaveRoom`, clear the socket/timer/projection only after a valid response, and return it. `RoomClient` uses `useRouter()` to navigate to `/play` after a successful exit. Do not display a room projection after a leave succeeds.

Add responsive styles that keep the result card, action controls, and leave control keyboard reachable at desktop and 390px mobile widths; preserve existing high-contrast and reduced-motion behavior.

- [ ] **Step 4: Run browser unit tests to verify GREEN**

Run: `pnpm --filter @three-zero-four/web test -- game-table.test.tsx room-lobby.test.tsx room-controller.test.tsx && pnpm --filter @three-zero-four/web typecheck`

Expected: PASS; only validated result fields render, rematch labels match the phase, and exit removes private table state.

- [ ] **Step 5: Commit the browser lifecycle experience**

```bash
git add apps/web/src/lib/room-view.ts apps/web/src/hooks/use-room-controller.ts apps/web/src/components/game-table.tsx apps/web/src/components/room-lobby.tsx apps/web/src/components/room-client.tsx apps/web/src/app/globals.css apps/web/test/browser-fixtures.ts apps/web/test/game-table.test.tsx apps/web/test/room-lobby.test.tsx apps/web/test/room-controller.test.tsx
git commit -m "feat: show match results and leave controls"
```

### Task 6: Prove full browser flows and document the release gate

**Files:**

- Modify: `apps/web/e2e/practice-and-room.spec.ts`
- Modify: `docs/operations/public-release.md`
- Modify: `README.md`

**Interfaces:**

- Adds Playwright helper:

```ts
async function playVisibleActionsToResult(page: Page): Promise<void>;
```

- It may click only enabled controls inside `[aria-label="Legal actions"]`, waits for server/WebSocket updates, and never calls service endpoints or database operations directly to advance a hand.

- [ ] **Step 1: Write failing Playwright acceptance tests**

Add one full-hand test per profile (`classic_304_4p`, `six_304_36`) that starts a practice table, repeatedly uses only visible legal controls until `[aria-label="Hand result"]` appears, then asserts the result has a winner/no-score message and the correct `Next hand` button. Click that button and assert the result disappears and the visible table advances to the next hand. Set a per-test timeout of 120 seconds to accommodate durable bot pacing.

Add a separate five-context test that creates a six-seat private room, joins four independent guest contexts using its visible invite form, starts the table from the host page, and proves:

```ts
await expect(host.locator('.seat-panel[data-seat-type="human"]')).toHaveCount(5);
await expect(host.locator('.seat-panel[data-seat-type="bot"]')).toHaveCount(1);
await expect(host.locator('.seat-panel[data-hand-size="6"]')).toHaveCount(6);
```

Close every created browser context in `finally` blocks.

- [ ] **Step 2: Run the browser suite to verify RED**

Run: `E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test practice-and-room.spec.ts`

Expected: FAIL until result UI, full-hand helper expectations, and five-human seat metadata are implemented.

- [ ] **Step 3: Implement only the acceptance helpers and release documentation**

Make the helper wait for either an enabled visible legal-action button or the result region, click at most one server-authorized action per loop, and fail with a readable page-state diagnostic after a finite action/time bound. It must not inspect application state through `page.evaluate`, invoke `fetch`, or intercept/alter game requests.

Update the public-release runbook and README to state that the Chromium gate now covers a full Classic practice hand, a full six-seat practice hand, result/rematch rendering, and a five-human/six-seat bot-fill start. Keep the operator-owned legal, alert delivery, and production backup prerequisites explicit.

- [ ] **Step 4: Run browser and release checks to verify GREEN**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
pnpm check
```

Expected: every browser test passes against the live Compose topology and all lint, types, unit tests, and static production checks remain green.

- [ ] **Step 5: Run the complete production-like rehearsal**

Run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level=high
pnpm audit signatures
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
curl --fail --silent --show-error http://127.0.0.1:4100/readyz
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
G304_RESTORE_REHEARSAL=1 scripts/backup-restore-rehearsal.sh
LOAD_BASE_URL=http://127.0.0.1:4100 LOAD_ORIGIN=http://127.0.0.1:3000 node infra/load/browser-api-smoke.js
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml up --build --wait postgres redis
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml run --rm --no-deps migrate
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration build integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration
docker compose --env-file infra/compose/.env --project-name g304-integration -f infra/compose/compose.yaml down --volumes --remove-orphans
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
```

Expected: no failing tests, no high-or-critical audit finding, healthy services, passed full browser flows, passed backup/restore, bounded load smoke, and real PostgreSQL/Redis integration evidence. If any command fails, preserve non-sensitive logs, leave the task incomplete, and diagnose before any merge.

- [ ] **Step 6: Commit browser acceptance and release documentation**

```bash
git add apps/web/e2e/practice-and-room.spec.ts docs/operations/public-release.md README.md
git commit -m "test: prove complete public game flows"
```

## Plan Self-Review

- Spec coverage: Task 1 removes raw result secrets and provides a server-calculated winner. Tasks 2–3 implement versioned leave, host-only advance, bot replacement, host transfer, idempotency, cancellation, events, snapshots, outbox, and recovery. Task 4 adds bounded session/room retention with aggregate metrics while excluding active games. Task 5 provides validated result/rematch/leave UI. Task 6 proves Classic, six-seat, and five-human browser paths and runs all release gates.
- Placeholder scan: every implementation step names its files, interfaces, test, command, and acceptance evidence.
- Type consistency: `LeaveRoomRequest`, `RoomExitResponse`, `RoomCoordinator.leaveRoom`, `RoomMaintenance.runOnce`, and `RoomMaintenanceWorker` are defined once above and consumed consistently by later tasks.
- Safety review: the plan preserves idempotency, authoritative state, private projection boundaries, append-only migrations, and the root worktree's unrelated user changes.
