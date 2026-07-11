# Realtime Game and Resilience (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver versioned private WebSocket delivery, durable automation, bot/autopilot execution, and both supported 304 rule profiles without making Redis a source of game truth.

**Architecture:** PostgreSQL records room events, snapshots, notification outbox rows, connection state, and scheduled automation jobs in the same transaction that changes a room. A game-service outbox publisher emits at-least-once room-version notices through Redis Pub/Sub; each local WebSocket hub fetches a fresh viewer-specific projection before sending it. A separately deployed worker process claims PostgreSQL jobs with leases and drives bot, timeout, and disconnected-human autopilot actions through `RoomCoordinator`, so every result is an event, snapshot, and notification.

**Tech Stack:** Node 24.17, TypeScript 5.9, Fastify 5, `@fastify/websocket` 11.3, PostgreSQL 18, Redis 8, Zod 4, Vitest, Docker Compose.

## Global Constraints

- PostgreSQL is authoritative for rooms, seats, events, snapshots, jobs, and notification intent. Redis may carry duplicate, transient Pub/Sub notices but never stores unrecoverable game state.
- The browser sends HTTP mutation commands only. WebSocket client messages are limited to heartbeats and explicit resynchronization requests; clients never supply an actor seat.
- Every outbound WebSocket game payload must validate against `RoomProjectionSchema`; never serialize `GameEngine#getSnapshot()` or a raw outbox/event payload to a client.
- All accepted human, bot, timeout, reconnect, and autopilot transitions append an immutable event, a complete snapshot, an outbox row, and a room-version change in one PostgreSQL transaction.
- A stale scheduled job must be a harmless no-op. Job ownership, expected event version, and a stable UUID command id make retries idempotent.
- WebSocket origin validation uses the same configured origin allowlist as cookie-authenticated HTTP mutations. The connection is accepted only after durable session and seat validation.
- Support exactly `classic_304_4p` (four seats) and `six_304_36` (six seats). Do not add custom profiles, ranked rules, chat, wagering, spectators, or client-selected bot authority.
- Presence is renewed only by authenticated HTTP reads/mutations and authenticated WebSocket heartbeats. A missing presence key starts a durable disconnect-grace job; it does not immediately remove a seat.
- Human reconnect cancels autopilot only before the automated action is applied. If a job has already committed, the reconnect receives the newly versioned private projection.
- Retain the current supply-chain controls, immutable installs, CORS/origin guard, 32 KiB HTTP body limit, secret redaction, and M2 Compose integration profile.

---

## File structure

```text
packages/contracts/src/game.ts                         Rule-profile and realtime wire schemas
packages/contracts/test/game.test.ts                   Contract and strict-envelope coverage
packages/game-engine/src/index.d.ts                    Public worker-facing bot method declaration
apps/game-service/src/config.ts                        Realtime, grace, and worker timing configuration
infra/postgres/migrations/0003_realtime_automation.sql Durable M3 database additions
apps/game-service/src/domain/room-store.ts             Outbox, job, seat-presence, dual-profile persistence
apps/game-service/src/domain/room-coordinator.ts       Profile-neutral commands and system automation path
apps/game-service/src/domain/room-projector.ts         Safe seat state and six-seat projections
apps/game-service/src/infra/redis-coordination.ts      Presence, leases, rate limiting, and cross-worker telemetry
apps/game-service/src/realtime/room-change-bus.ts      Redis Pub/Sub room-change transport
apps/game-service/src/realtime/outbox-publisher.ts     At-least-once PostgreSQL outbox publisher
apps/game-service/src/realtime/room-socket-hub.ts      Per-process authenticated private socket fanout
apps/game-service/src/routes/realtime.ts               Cookie/origin-protected WebSocket route
apps/game-service/src/worker/automation-worker.ts      Durable job claimer and executor loop
apps/game-service/src/worker.ts                        Independently deployed worker entrypoint
apps/game-service/src/server.ts                         Realtime lifecycle composition
apps/game-service/src/app.ts                            WebSocket plugin registration and lifecycle hook
apps/game-service/test/*.test.ts                        Realtime, worker, dual-profile, simulation, and fuzz coverage
infra/compose/compose.yaml                              Separate worker service and integration topology
docs/operations/production-foundation.md                WebSocket/worker operational runbook
README.md                                                Accurate production capability description
```

### Task 1: Version contracts, runtime configuration, and public engine typing

**Files:**

- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `packages/game-engine/src/index.d.ts`
- Modify: `apps/game-service/src/config.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Modify: `infra/compose/.env.example`

**Interfaces:**

- Produces `RuleProfileIdSchema`, `RealtimeClientMessageSchema`, and `RealtimeServerMessageSchema`.
- Produces `ServiceConfig.WS_HEARTBEAT_SECONDS`, `WS_MAX_PAYLOAD_BYTES`, `OUTBOX_POLL_INTERVAL_MS`, `AUTOMATION_POLL_INTERVAL_MS`, `DISCONNECT_GRACE_SECONDS`, and `BOT_ACTION_DELAY_MS`.
- Adds the already-implemented `GameEngine#getBotAction(seatIndex)` method to the engine type boundary.

- [x] **Step 1: Write the failing contract and configuration tests**

```ts
it("defines two profile ids without exposing an unfinished room mode", () => {
  expect(RuleProfileIdSchema.parse("six_304_36")).toBe("six_304_36");
  expect(() => CreateRoomRequestSchema.parse({
    commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
    ruleProfileId: "six_304_36",
  })).toThrow();

  expect(() => RealtimeClientMessageSchema.parse({
    type: "RESYNC",
    roomId: "not-a-uuid",
  })).toThrow();
  expect(() => RealtimeServerMessageSchema.parse({
    type: "SNAPSHOT",
    projection: { roomId: "bad" },
  })).toThrow();
});

expect(() => loadConfig({
  ...baseConfig,
  DISCONNECT_GRACE_SECONDS: "100",
  PRESENCE_TTL_SECONDS: "100",
})).toThrow("DISCONNECT_GRACE_SECONDS");
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts`

Expected: FAIL because the profile is a Classic-only literal and realtime schemas do not exist.

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts`

Expected: FAIL because M3 timing configuration is not validated.

- [x] **Step 3: Add strict wire schemas and bounded timing settings**

Define the shared profile vocabulary now, but retain the Classic-only public create-room literal until Task 3 has made every authoritative persistence, engine, recovery, and projection path six-seat-safe. This prevents clients from creating a room mode that the running service cannot fulfill:

```ts
export const RuleProfileIdSchema = z.enum(["classic_304_4p", "six_304_36"]);

export const CreateRoomRequestSchema = z.object({
  commandId: Uuid,
  ruleProfileId: z.literal("classic_304_4p").default("classic_304_4p"),
}).strict();

export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PING") }).strict(),
  z.object({ type: z.literal("RESYNC"), roomId: Uuid }).strict(),
]);

export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SNAPSHOT"), projection: RoomProjectionSchema }).strict(),
  z.object({ type: z.literal("RESYNC_REQUIRED"), roomId: Uuid, eventVersion: EventVersion }).strict(),
  z.object({ type: z.literal("ERROR"), code: z.string().min(1).max(64), message: z.string().min(1).max(160) }).strict(),
]);
```

Change `RoomProjectionSchema.viewerSeatIndex` to `.min(0).max(5)`, export inferred realtime and profile types, and add this public declaration:

```ts
getBotAction(seatIndex: number): Record<string, unknown> | null;
```

Extend `EnvironmentSchema` with values that preserve a meaningful disconnect window after presence expires:

```ts
WS_HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(60).default(20),
WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(32 * 1024).default(8 * 1024),
OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(5_000).default(250),
AUTOMATION_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(5_000).default(500),
DISCONNECT_GRACE_SECONDS: z.coerce.number().int().min(90).max(900).default(120),
BOT_ACTION_DELAY_MS: z.coerce.number().int().min(250).max(10_000).default(900),
```

After parsing, reject `DISCONNECT_GRACE_SECONDS <= PRESENCE_TTL_SECONDS` with a clear configuration error. Add development values to `.env.example`; no production secret or endpoint belongs there.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/contracts test -- game.test.ts`

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts`

Expected: the shared profile vocabulary validates both supported ids while public room creation remains Classic until Task 3, unknown realtime fields are rejected, and grace cannot expire before presence.

- [x] **Step 5: Commit the contract boundary**

```bash
git add packages/contracts packages/game-engine/src/index.d.ts apps/game-service/src/config.ts apps/game-service/test/app.test.ts infra/compose/.env.example
git commit -m "feat: define realtime game contracts"
```

### Task 2: Add durable outbox, automation jobs, and seat connection state

**Files:**

- Create: `infra/postgres/migrations/0003_realtime_automation.sql`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Modify: `apps/game-service/test/migrations.integration.test.ts`
- Create: `apps/game-service/test/realtime-store.integration.test.ts`

**Interfaces:**

- Produces durable seat connection metadata, `PendingRoomNotification`, `ClaimedAutomationJob`, and safe job/outbox store methods while retaining the Classic-only room mapping until Task 3 widens every authoritative path together.
- Adds `room_outbox` and `room_automation_jobs`; both are durable PostgreSQL data.
- Makes `appendEventAndSnapshot` insert its outbox row atomically.

- [x] **Step 1: Write failing migration/store integration tests**

```ts
it("writes an outbox row with each committed room version", async () => {
  const created = await store.createRoom(classicRoomInput);
  const outbox = await store.claimRoomNotifications(
    "a0f17a73-c12d-4cbf-9167-09e5a26e73a5", 10,
  );
  expect(outbox).toEqual([
    expect.objectContaining({ roomId: created.id, eventVersion: 1 }),
  ]);
});

it("claims a due job once and ignores it after its room version changes", async () => {
  await store.scheduleAutomation(transaction, dueBotJob);
  const [job] = await store.claimDueAutomationJobs(
    "5cd6e6bf-e763-4fdf-9a7e-54e0c97d8efa", now, 5,
  );
  expect(job).toMatchObject({ expectedEventVersion: 4, kind: "BOT_ACTION" });
  await store.completeAutomationJob(job.id, "5cd6e6bf-e763-4fdf-9a7e-54e0c97d8efa");
  expect(await store.claimDueAutomationJobs(
    "997b6fa8-39a2-44d2-8e3b-94d8cb7f7ddb", now, 5,
  )).toEqual([]);
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `INTEGRATION_DATABASE_URL=<postgres> pnpm --filter @three-zero-four/game-service test -- realtime-store.integration.test.ts`

Expected: FAIL because the M3 tables and store methods do not exist.

- [x] **Step 3: Add the append-only migration and store boundary**

Create the migration with explicit constraints and indexes:

```sql
ALTER TABLE rooms
  ADD CONSTRAINT rooms_rule_profile_check
  CHECK (rule_profile_id IN ('classic_304_4p', 'six_304_36'));

ALTER TABLE room_seats
  ADD COLUMN connection_status text NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('online', 'disconnected', 'autopilot')),
  ADD COLUMN last_presence_at timestamptz,
  ADD COLUMN disconnected_at timestamptz,
  ADD COLUMN autopilot_started_at timestamptz;

CREATE TABLE room_outbox (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publishing_owner uuid,
  publishing_until timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text,
  UNIQUE (room_id, event_version)
);
CREATE INDEX room_outbox_pending_idx ON room_outbox (id)
  WHERE published_at IS NULL;

CREATE TABLE room_automation_jobs (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  expected_event_version bigint NOT NULL CHECK (expected_event_version >= 0),
  kind text NOT NULL CHECK (kind IN ('BOT_ACTION', 'TURN_TIMEOUT', 'DISCONNECT_GRACE')),
  target_seat_index smallint NOT NULL CHECK (target_seat_index >= 0 AND target_seat_index < 6),
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed', 'completed', 'cancelled')),
  lease_owner uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (room_id, kind, expected_event_version, target_seat_index)
);
CREATE INDEX room_automation_jobs_due_idx
  ON room_automation_jobs (due_at, id) WHERE state = 'pending';
```

Add exact store types and methods:

```ts
export interface PendingRoomNotification {
  id: number;
  roomId: string;
  eventVersion: number;
}

export interface ClaimedAutomationJob {
  id: string;
  roomId: string;
  expectedEventVersion: number;
  kind: "BOT_ACTION" | "TURN_TIMEOUT" | "DISCONNECT_GRACE";
  targetSeatIndex: number;
  attempts: number;
}

claimRoomNotifications(owner: string, limit: number): Promise<PendingRoomNotification[]>;
markRoomNotificationPublished(id: number, owner: string): Promise<void>;
releaseRoomNotification(id: number, owner: string, error: string): Promise<void>;
scheduleAutomation(transaction: Queryable, input: NewAutomationJob): Promise<void>;
claimDueAutomationJobs(owner: string, now: Date, limit: number): Promise<ClaimedAutomationJob[]>;
completeAutomationJob(id: string, owner: string): Promise<void>;
releaseAutomationJob(id: string, owner: string, error: string): Promise<void>;
cancelAutomationForRoom(transaction: Queryable, roomId: string, kinds: readonly AutomationJobKind[]): Promise<void>;
markSeatOnline(transaction: Queryable, roomId: string, playerId: string): Promise<number | null>;
markSeatOffline(transaction: Queryable, roomId: string, playerId: string): Promise<void>;
```

`claimRoomNotifications` and `claimDueAutomationJobs` must use `FOR UPDATE SKIP LOCKED` within the existing transaction helper, atomically mark the selected rows claimed, and return only rows owned by the supplied UUID. `appendEventAndSnapshot` accepts an optional Classic profile bridge, writes it to `game_snapshots`, and inserts `room_outbox(room_id, event_version)` before the transaction commits; Task 3 makes the profile input fully required when it widens room creation atomically. `createRoom` must insert the version-one outbox row too.

- [x] **Step 4: Verify GREEN**

Run: `INTEGRATION_DATABASE_URL=<postgres> pnpm --filter @three-zero-four/game-service test -- migrations.integration.test.ts realtime-store.integration.test.ts`

Expected: the schema migrates from M2, outbox retries retain the version, and a second worker cannot steal an unexpired job lease.

- [x] **Step 5: Commit durable signaling state**

```bash
git add infra/postgres/migrations/0003_realtime_automation.sql apps/game-service/src/domain/room-store.ts apps/game-service/test/migrations.integration.test.ts apps/game-service/test/realtime-store.integration.test.ts
git commit -m "feat: persist realtime and automation jobs"
```

### Task 3: Generalize authoritative rooms and schedule every state transition

**Files:**

- Modify: `apps/game-service/src/domain/room-coordinator.ts`
- Modify: `apps/game-service/src/domain/room-projector.ts`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Modify: `apps/game-service/src/infra/redis-coordination.ts`
- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `packages/game-engine/src/engine.js`
- Modify: `packages/game-engine/src/index.d.ts`
- Modify: `test/engine-contract.test.mjs`
- Modify: `apps/game-service/test/room-coordinator.test.ts`
- Modify: `apps/game-service/test/realtime-store.integration.test.ts`
- Modify: `apps/game-service/test/redis-coordination.test.ts`
- Modify: `apps/game-service/test/room-store.integration.test.ts`
- Create: `apps/game-service/test/room-automation.integration.test.ts`

**Interfaces:**

- Produces `RoomCoordinator.runAutomation(job)`, `RoomCoordinator.markRealtimePresence(session, roomId)`, `RoomCoordinator.markRealtimeDisconnected(session, roomId)`, and profile-neutral create/start/recovery behavior.
- Schedules one version-bound next-action job after every committed room event.
- Guarantees all automation enters the server-only `GameEngine#applyAutomationAction` path with a server-derived seat, never a browser actor.

- [x] **Step 1: Write failing coordinator tests**

```ts
it("starts a six-seat room with six durable seats and a private four-card hand", async () => {
  const projection = await coordinator.createRoom(host, {
    commandId: randomUUID(), ruleProfileId: "six_304_36",
  });
  // join five guests, start as host, then assert seats and profile
  expect(started.view.publicState?.profileId).toBe("six_304_36");
  expect(started.view.privateSeat?.hand).toHaveLength(4);
});

it("applies one stale-safe bot job through an immutable system event", async () => {
  const job = await setupBotTurn();
  await coordinator.runAutomation(job);
  expect(await store.loadEventsAfter(job.roomId, job.expectedEventVersion)).toEqual([
    expect.objectContaining({ eventType: "BOT_ACTION", actorPlayerId: null }),
  ]);
  await coordinator.runAutomation(job);
  expect(await store.loadRoom(job.roomId)).toMatchObject({
    eventVersion: job.expectedEventVersion + 1,
  });
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- room-coordinator.test.ts room-automation.integration.test.ts`

Expected: FAIL because rooms are Classic-only and no worker-facing automation method exists.

- [x] **Step 3: Make room creation, recovery, and projections profile-neutral**

Use the engine profile as the only seat-count authority:

```ts
function seatCountForProfile(ruleProfileId: RuleProfileId): number {
  return ruleProfileId === "six_304_36" ? 6 : 4;
}

function tableModeForProfile(ruleProfileId: RuleProfileId): "classic_4" | "six_6" {
  return ruleProfileId === "six_304_36" ? "six_6" : "classic_4";
}
```

Build seats with `Array.from({ length: seatCountForProfile(...) })`, make `RoomSettings.botDifficulty` the enum `"easy" | "normal" | "strong"`, and pass the profile/table mode directly to `GameEngine`. Change every Classic-only storage and recovery type to `RuleProfileId`; reject a snapshot whose profile differs from its room.

Only after those in-memory and durable boundaries are profile-neutral, replace the public request field with `RuleProfileIdSchema.default("classic_304_4p")` and change the contract test so `CreateRoomRequestSchema` accepts `six_304_36`. The same commit must make a six-seat request create six persistent seats, a matching six-seat engine snapshot, and a six-seat private projection; never widen the endpoint in an earlier task.

After each `createRoom`, `joinRoom`, `startRoom`, human `submitCommand`, reconnect transition, or automated action, call a single `scheduleNextAutomation(transaction, room, engine)` helper. It must cancel pending turn jobs for the room first, then create exactly one of:

```ts
{ kind: "BOT_ACTION", targetSeatIndex: activeSeat, dueAt: nowPlus(config.BOT_ACTION_DELAY_MS) }
{ kind: "TURN_TIMEOUT", targetSeatIndex: activeSeat, dueAt: nowPlus(phaseTimeoutMs(engine.state.phase)) }
{ kind: "DISCONNECT_GRACE", targetSeatIndex: humanSeat, dueAt: nowPlus(config.DISCONNECT_GRACE_SECONDS * 1000) }
```

Use `30_000` ms for bidding, trump-selection, and card-play; `15_000` ms for trump choice; `20_000` ms for result acknowledgment. The helper must include the room's resulting event version in each job. `markRealtimeDisconnected` removes the expiring Redis presence key, writes the seat's durable `disconnected_at`, and schedules the version-bound `DISCONNECT_GRACE` job. `runAutomation` locks the room and treats a nonmatching `expectedEventVersion`, ended room, changed active seat, or restored online human as a completed no-op. For a `DISCONNECT_GRACE` or `TURN_TIMEOUT` job, it must append a dedicated `AUTOPILOT_ENABLED` event and snapshot first, then schedule a `BOT_ACTION` job at that new event version. For a `BOT_ACTION` job, it must:

1. obtain `engine.getBotAction(targetSeatIndex)` only after the seat is a bot or is durably marked autopilot;
2. apply it with `seatIndex` and `actorSeatIndex` set internally;
3. append `BOT_ACTION` or `AUTOPILOT_ACTION` with `actorPlayerId: null`, a deterministic job-derived UUID command id, a complete snapshot, and an outbox row;
4. complete the claimed job and schedule the next version's job in the same transaction.

Keep `projectRoomForPlayer` as the privacy boundary. It may expose `connectionStatus` and `autopilot` for every seat but must not expose another seat's cards, indicator, or legal actions. Use the existing engine private/public projection functions; never clone raw engine state into a room response.

- [x] **Step 4: Verify GREEN**

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- room-coordinator.test.ts room-automation.integration.test.ts`

Expected: both profiles start, automatic actions are durable and idempotent, stale jobs do not alter state, and private projections remain card-safe.

- [x] **Step 5: Commit profile and automation coordination**

```bash
git add apps/game-service/src/domain/room-coordinator.ts apps/game-service/src/domain/room-projector.ts apps/game-service/src/domain/room-store.ts packages/contracts/src/game.ts packages/contracts/src/index.ts packages/contracts/test/game.test.ts apps/game-service/test/room-coordinator.test.ts apps/game-service/test/room-automation.integration.test.ts
git commit -m "feat: automate durable room turns"
```

### Task 4: Publish durable room changes and deliver private realtime snapshots

**Files:**

- Create: `apps/game-service/src/realtime/outbox-publisher.ts`
- Create: `apps/game-service/src/realtime/room-socket-hub.ts`
- Create: `apps/game-service/src/routes/realtime.ts`
- Modify: `apps/game-service/src/infra/redis-coordination.ts`
- Create: `apps/game-service/src/realtime/room-change-bus.ts`
- Modify: `apps/game-service/src/app.ts`
- Modify: `apps/game-service/src/server.ts`
- Modify: `apps/game-service/package.json`
- Create: `apps/game-service/test/realtime.test.ts`
- Create: `apps/game-service/test/realtime-multiclient.integration.test.ts`
- Create: `apps/game-service/vitest.config.ts`

**Interfaces:**

- Produces `RedisRoomChangeBus`, `OutboxPublisher`, `RoomSocketHub`, and `registerRealtimeRoutes`.
- Sends a `RealtimeServerMessageSchema` `SNAPSHOT` only after server-side session, seat, and projection checks.
- Delivers at-least-once notices; the browser can ignore snapshots whose `eventVersion` is not newer.

- [x] **Step 1: Write failing real-time tests**

```ts
it("authenticates a room socket, sends a private snapshot, and never leaks the host hand", async () => {
  const socket = await app.injectWS(`/v1/realtime/rooms/${roomId}`, {
    headers: { cookie: guest.cookie, origin },
  });
  const message = RealtimeServerMessageSchema.parse(JSON.parse((await onceMessage(socket)).toString()));
  expect(message.type).toBe("SNAPSHOT");
  expect(JSON.stringify(message)).not.toContain(hostPrivateCardId);
});

it("resends a current snapshot after duplicate and gap notices", async () => {
  await bus.publish({ roomId, eventVersion: 5 });
  await bus.publish({ roomId, eventVersion: 7 });
  expect(await receivedVersions(socket)).toEqual([expect.any(Number), 7]);
});

it("delivers one post-command private update to two independent clients and resyncs a reconnect", async () => {
  const [hostSocket, guestSocket] = await openAuthenticatedSockets(roomId, host.cookie, guest.cookie);
  const applied = await submitActiveSeatCommand(roomId);
  await expectSnapshotsAtVersion([hostSocket, guestSocket], applied.eventVersion);
  await closeSocket(guestSocket);
  const reconnected = await openAuthenticatedSocket(roomId, guest.cookie);
  expect(await nextSnapshot(reconnected)).toMatchObject({
    projection: { eventVersion: applied.eventVersion },
  });
});
```

- [x] **Step 2: Run the realtime tests and verify RED**

Run: `pnpm --filter @three-zero-four/game-service test -- realtime.test.ts realtime-multiclient.integration.test.ts`

Expected: FAIL because WebSocket plugin registration, Pub/Sub, outbox delivery, and socket routes do not exist.

- [x] **Step 3: Implement the bus, at-least-once publisher, and socket hub**

Add `@types/ws` as a direct game-service dev dependency because the plugin's public TypeScript API imports it. Define the minimal durable notice:

```ts
export interface RoomChangedNotice {
  roomId: string;
  eventVersion: number;
}

export const ROOM_CHANGED_CHANNEL = "g304:room-changed";
```

`RedisRoomChangeBus` must create one duplicate Redis connection for subscriptions, validate JSON notice shape before fanout, and expose:

```ts
start(handler: (notice: RoomChangedNotice) => Promise<void>): Promise<void>;
publish(notice: RoomChangedNotice): Promise<void>;
close(): Promise<void>;
```

`OutboxPublisher` owns an interval, calls `store.claimRoomNotifications(owner, 32)`, publishes each `{ roomId, eventVersion }`, marks it published only after `publish` resolves, and calls `releaseRoomNotification` with the caught error message on failure. `start()` must run an immediate drain and `stop()` must clear the interval before returning.

`RoomSocketHub` stores connections by room id and carries the already-authenticated `AuthenticatedSession` with each socket. It sends a fresh `RoomProjection` through this sole helper:

```ts
private async sendSnapshot(connection: Connection): Promise<void> {
  const projection = await this.coordinator.getSnapshot(connection.session, connection.roomId);
  connection.socket.send(JSON.stringify(RealtimeServerMessageSchema.parse({
    type: "SNAPSHOT", projection,
  })));
  connection.lastSentEventVersion = projection.eventVersion;
}
```

On a notice, send a snapshot only to connections in the matching room whose `lastSentEventVersion < notice.eventVersion`; if projection fails because a seat no longer exists, send a bounded `ERROR` envelope and close with code `1008`. Handle `PING` by renewing `Presence` and returning the current snapshot only when an explicit `RESYNC` arrives. Reject malformed client frames with an `ERROR` envelope, then close with code `1008`.

Register `@fastify/websocket` before HTTP routes with `{ options: { maxPayload: config.WS_MAX_PAYLOAD_BYTES } }`. The `GET /v1/realtime/rooms/:roomId` pre-validation must require an allowed `Origin`, then `SessionService.require` and `RoomCoordinator.getSnapshot`. Attach `message`, `close`, and `error` listeners synchronously, exactly as the installed plugin requires. On close, remove the connection but do not delete durable session data; presence expires naturally unless the socket is the last local connection for the player/room, in which case call `Presence.remove`.

Start the bus, hub subscription, and outbox publisher in `server.ts`; stop them before Redis/database shutdown. Add a Fastify `onClose` hook in `buildApp` so test apps close the realtime components cleanly.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test -- realtime.test.ts realtime-multiclient.integration.test.ts`

Expected: valid cookies/origins receive current private snapshots, cross-seat cards never appear, malformed frames close safely, and duplicated notices do not cause stale views.

- [x] **Step 5: Commit realtime delivery**

```bash
git add apps/game-service/src/realtime apps/game-service/src/routes/realtime.ts apps/game-service/src/infra/redis-coordination.ts apps/game-service/src/app.ts apps/game-service/src/server.ts apps/game-service/package.json pnpm-lock.yaml apps/game-service/test/realtime.test.ts apps/game-service/test/realtime-multiclient.integration.test.ts
git commit -m "feat: deliver private room updates in realtime"
```

### Task 5: Run a durable worker as an independently deployable process

**Files:**

- Create: `apps/game-service/src/worker/automation-worker.ts`
- Create: `apps/game-service/src/worker.ts`
- Modify: `apps/game-service/src/app.ts`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Modify: `apps/game-service/src/infra/redis-coordination.ts`
- Modify: `apps/game-service/src/metrics.ts`
- Modify: `apps/game-service/src/realtime/outbox-publisher.ts`
- Modify: `apps/game-service/src/realtime/room-socket-hub.ts`
- Modify: `apps/game-service/src/server.ts`
- Modify: `infra/compose/compose.yaml`
- Create: `apps/game-service/test/automation-worker.test.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Modify: `apps/game-service/test/redis-coordination.test.ts`
- Modify: `apps/game-service/test/room-automation.integration.test.ts`

**Interfaces:**

- Produces `AutomationWorker.start()`, `AutomationWorker.runOnce()`, and `AutomationWorker.stop()`.
- Runs the same compiled, tested coordinator artifact in a separately scalable `worker` Compose service.
- Adds metrics for pending outbox rows, pending jobs, completed automation actions, stale job no-ops, and active WebSocket connections.

- [x] **Step 1: Write the failing worker integration test**

```ts
it("two workers claim one due bot job once and publish its new room version", async () => {
  const first = new AutomationWorker(dependenciesFor("worker-one"));
  const second = new AutomationWorker(dependenciesFor("worker-two"));
  await Promise.all([first.runOnce(), second.runOnce()]);
  expect(await countEvents(roomId, "BOT_ACTION")).toBe(1);
  expect(await waitForNotice(roomId)).toMatchObject({ eventVersion: 3 });
});
```

- [x] **Step 2: Run the worker test and verify RED**

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- room-automation.integration.test.ts`

Expected: FAIL because no worker loop claims durable jobs.

- [x] **Step 3: Implement bounded worker polling and graceful shutdown**

Implement this worker boundary:

```ts
export class AutomationWorker {
  constructor(private readonly dependencies: {
    store: PostgresRoomStore;
    coordinator: RoomCoordinator;
    pollIntervalMs: number;
    ownerId?: string;
    onJob?: (outcome: "completed" | "stale" | "failed") => void;
  }) {}

  async runOnce(now = new Date()): Promise<void> {
    const jobs = await this.dependencies.store.claimDueAutomationJobs(
      this.ownerId, now, 16,
    );
    for (const job of jobs) {
      try {
        const outcome = await this.dependencies.coordinator.runAutomation(job);
        await this.dependencies.store.completeAutomationJob(job.id, this.ownerId);
        this.dependencies.onJob?.(outcome);
      } catch (error) {
        await this.dependencies.store.releaseAutomationJob(job.id, this.ownerId, errorMessage(error));
        this.dependencies.onJob?.("failed");
      }
    }
  }
}
```

`start()` must execute `runOnce()` immediately, then schedule nonoverlapping polls. If a poll remains active, skip that tick rather than overlapping transactions. `stop()` must clear its timer and await the active poll. `worker.ts` builds the same database, Redis, store, lease, presence, and coordinator dependencies as `server.ts`; it installs SIGINT/SIGTERM handlers that stop the worker before `redis.quit()` and `database.close()`.

Add Compose service:

```yaml
  worker:
    build:
      context: ../..
      dockerfile: apps/game-service/Dockerfile
    command: ["node", "dist/src/worker.js"]
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CORS_ORIGINS: http://127.0.0.1:3000
      SESSION_COOKIE_NAME: g304_session
      SESSION_SECRET_PEPPER: ${SESSION_SECRET_PEPPER}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    restart: unless-stopped
```

Do not expose a worker port. Add an injected `health()` probe to `AutomationWorker` that checks PostgreSQL and Redis before recording `/tmp/g304-worker-heartbeat` after a successful poll. Compose must run a Node healthcheck that fails if this file is missing or older than three poll intervals. The healthcheck must not mutate rooms merely to report health.

Record completed, stale, and failed worker outcomes in a Redis telemetry hash. The HTTP service refreshes pending outbox/job gauges and those cross-worker outcome totals immediately before serving `/metrics`; this makes the public service metric surface meaningful even though workers do not expose an HTTP port.

- [x] **Step 4: Verify GREEN**

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- room-automation.integration.test.ts`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration build integration`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration`

Expected: exactly one worker claims each job, automation emits a durable room version, and the production topology reports the worker healthy.

- [x] **Step 5: Commit the worker process**

```bash
git add apps/game-service/src/{app.ts,server.ts,metrics.ts,worker,worker.ts,domain/room-store.ts,infra/redis-coordination.ts,realtime/outbox-publisher.ts,realtime/room-socket-hub.ts} infra/compose/compose.yaml apps/game-service/test/{app.test.ts,automation-worker.test.ts,redis-coordination.test.ts,room-automation.integration.test.ts}
git commit -m "feat: run durable room automation worker"
```

### Task 6: Prove profile, recovery, and privacy invariants with simulations

**Files:**

- Create: `apps/game-service/test/room-simulation.test.ts`
- Create: `apps/game-service/test/recovery-fuzz.integration.test.ts`
- Modify: `packages/game-engine/src/bot.js`
- Modify: `packages/game-engine/src/engine.js`

**Interfaces:**

- Produces deterministic test fixtures for full Classic and six-seat hands, private-view leak checks, and snapshot/event recovery variance.
- Covers both in-memory engine behavior and durable coordinator recovery without relying on browser state.

- [x] **Step 1: Write failing simulation and fuzz tests**

```ts
for (const ruleProfileId of ["classic_304_4p", "six_304_36"] as const) {
  it(`completes a ${ruleProfileId} hand using only server-selected legal actions`, () => {
    const engine = new GameEngine({ ruleProfile: ruleProfileId, tableMode: tableModeFor(ruleProfileId) });
    engine.startMatch();
    while (engine.state.phase !== "hand_result") {
      const seat = engine.state.activeSeat;
      if (seat == null) throw new Error("Missing active seat");
      const action = engine.getBotAction(seat);
      if (!action) throw new Error("Missing legal bot action");
      expect(engine.applyAction({ ...action, seatIndex: seat, actorSeatIndex: seat }).ok).toBe(true);
    }
  });
}

it("recovers equivalent private projections after deleting any noninitial snapshot", async () => {
  for (const eventVersion of acceptedEventVersions.slice(1)) {
    await deleteSnapshot(roomId, eventVersion);
    const recovered = await freshCoordinator.getSnapshot(host, roomId);
    expect(recovered).toEqual(expectedProjectionFor(host));
  }
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @three-zero-four/game-service test -- room-simulation.test.ts`

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- recovery-fuzz.integration.test.ts`

Expected: the full-hand simulation must fail if bots cannot open a bid or if a reserved trump card cannot re-enter play; the recovery variance tests prove the existing durable path before the engine fixes land.

- [x] **Step 3: Add deterministic test helpers and invariant assertions**

Use a fixed loop guard of `1_000` actions per hand and fail with the current phase/action count if a profile cannot reach a result. For every action, assert the engine's selected action is present in `engine.getLegalActions(seat)`. For every seat projection, assert JSON never contains a card id from another current hand or a hidden trump card unavailable to that viewer.

For durable recovery variance, create a room, advance it through human and worker commands, collect canonical projections for every human, then independently:

1. create a fresh `RoomCoordinator` against the same PostgreSQL/Redis data;
2. remove one later `game_snapshots` row while retaining its events;
3. fetch each human's snapshot and compare it to the canonical projection for the same event version;
4. verify an invalid event payload causes `ROOM_RECOVERY_FAILED` rather than a guessed state.

The test must restore the removed snapshot before its next variant or isolate each variant in a newly generated room id. Run at least twelve snapshot-position variants per profile; do not mutate production source data.

The deterministic full-hand simulation exposed two engine defects: a four-card bot threshold above the mathematical maximum caused perpetual no-bid redeals, and a reserved closed-trump indicator could be stranded when a rule opened trump. Lower the threshold to an attainable four-card score, force a final automated opening bid only after every other seat has passed, and return an unplayed reserved indicator to its maker when trump opens by rule.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test -- room-simulation.test.ts`

Run: `INTEGRATION_DATABASE_URL=<postgres> INTEGRATION_REDIS_URL=<redis> pnpm --filter @three-zero-four/game-service test -- recovery-fuzz.integration.test.ts durable-rooms.integration.test.ts`

Expected: both profiles complete, all bot actions are legal, recovery remains exact after snapshot loss, and every private projection passes leak assertions.

- [x] **Step 5: Commit invariant coverage**

```bash
git add packages/game-engine/src/{bot.js,engine.js} apps/game-service/test/{room-simulation.test.ts,recovery-fuzz.integration.test.ts}
git commit -m "fix: cover realtime room resilience"
```

### Task 7: Gate the M3 topology and document operation

**Files:**

- Modify: `infra/compose/compose.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/production-foundation-ci.test.mjs`
- Modify: `docs/operations/production-foundation.md`
- Modify: `README.md`

**Interfaces:**

- CI starts game-service, worker, PostgreSQL, Redis, and the integration profile.
- The runbook gives exact commands for socket/worker diagnosis and safe shutdown.

- [x] **Step 1: Write the failing release-gate test**

```js
assert.match(compose, /worker:[\s\S]*dist\/src\/worker\.js/);
assert.match(compose, /worker:[\s\S]*depends_on/);
assert.match(workflow, /--profile integration build integration/);
assert.match(workflow, /--profile integration run --rm --no-deps integration/);
assert.match(runbook, /WebSocket/);
assert.match(runbook, /automation worker/);
```

- [x] **Step 2: Run the release-gate test and verify RED**

Run: `node --test test/production-foundation-ci.test.mjs`

Expected: FAIL until the worker service and M3 operational guidance exist.

- [x] **Step 3: Add CI/runbook evidence and failure diagnostics**

Build the integration profile image separately, then run it with `--no-deps` against the already-healthy topology. This prevents Compose from recreating the completed migration service during the test run while ensuring the test image matches the checked-out source. The integration service executes all service tests, including `realtime.test.ts`, `realtime-multiclient.integration.test.ts`, `room-automation.integration.test.ts`, `room-simulation.test.ts`, and `recovery-fuzz.integration.test.ts` when its PostgreSQL/Redis environment is present. In the failure branch of CI, preserve `docker compose logs --no-color` and add `docker compose ps` so a failed worker healthcheck is visible.

Document these operator commands exactly:

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration build integration
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml logs --no-color game-service worker
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans
```

Explain that a duplicate socket snapshot is safe, a stale job is completed without a state change, and `ROOM_RECOVERY_FAILED` is an availability incident requiring operator investigation rather than manual event editing.

- [x] **Step 4: Verify the complete M3 gate**

Run: `pnpm check`

Run: `pnpm security:check:all`

Run: `GOCACHE=/tmp/304-game-gocache go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ci.yml`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait`

Run: `curl --fail --silent --show-error http://127.0.0.1:4100/readyz`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration build integration`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm --no-deps integration`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans`

Expected: the complete service/worker topology is healthy, all dual-profile/realtime/worker tests pass on real PostgreSQL and Redis, CI YAML lint is clean, and teardown removes every Compose container and volume.

- [x] **Step 5: Commit the M3 release gate**

```bash
git add infra/compose/compose.yaml .github/workflows/ci.yml test/production-foundation-ci.test.mjs docs/operations/production-foundation.md README.md
git commit -m "test: gate realtime game resilience"
```

## M3 completion checklist

- [x] Both Classic and six-seat rooms persist/recover through the same authoritative API and snapshot path.
- [x] Every committed room version creates a durable outbox notice and every live socket receives only a current private projection.
- [x] Socket reconnect, duplicate delivery, explicit resync, malformed frames, cookie auth, origin checks, and close cleanup have direct tests.
- [x] Bot, timeout, and disconnected-human autopilot actions are version-bound PostgreSQL jobs that can be retried without duplicate game actions.
- [x] The worker is independently deployable, observable, gracefully stoppable, and verified with competing-worker tests.
- [x] Classic and six-seat simulations complete legal hands; recovery fuzz tests prove exact replay or safe unavailability.
- [x] CI exercises the actual worker and real PostgreSQL/Redis Compose topology.
