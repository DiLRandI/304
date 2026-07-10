# Durable Authoritative Rooms (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a server-authoritative Classic 304 room API whose guest identities, seats, commands, snapshots, and recovery state survive a service restart.

**Architecture:** PostgreSQL remains the sole source of durable room history. Each mutation first obtains a short Redis room lease, then locks the room row, deduplicates the client command, validates the actor from the HTTP-only session cookie, updates the engine, and commits an immutable event plus a full snapshot in one transaction. The HTTP API returns a viewer-specific projection only; browser code never receives the engine snapshot or another seat's cards.

**Tech Stack:** Node 24.17, TypeScript 5.9, Fastify 5, Zod 4, PostgreSQL 18, Redis 8, Vitest, Docker Compose.

## Global Constraints

- Implement only `classic_304_4p` in the durable HTTP flow. The existing legacy six-seat compatibility path remains untouched; durable six-seat play, bot action execution, and WebSockets belong to M3.
- Use `/v1` as the new API namespace. Do not add new behavior to `server.js` or depend on its in-memory maps.
- Every room mutation carries a UUID `commandId`; the actor seat comes only from the durable session and is never accepted from the browser.
- Treat PostgreSQL as the durable source of truth. Redis may provide leases, presence, and rate limits only.
- Store a snapshot at every accepted M2 event. This is the explicit M2 bounded snapshot interval of one event and guarantees an exact duplicate-command result can be re-projected safely.
- Persist only accepted actions. Rejected, stale, unauthorized, malformed, or rate-limited requests must not create an event, snapshot, or version increment.
- Set an HTTP-only, same-site, path-wide guest cookie. It is `secure` in production and contains a random session id plus secret; PostgreSQL stores only the peppered HMAC of that secret.
- Require an allowed `Origin` header for every cookie-authenticated `POST /v1/*` mutation. Test requests must supply `Origin: http://127.0.0.1:3000`.
- Never serialize `GameEngine#getSnapshot()` directly to an HTTP response or log a session cookie, session secret, raw database URL, or cards outside the requesting player's private seat.

---

## File structure

```text
packages/contracts/src/game.ts                  Request/response schemas shared by API and web
packages/contracts/test/game.test.ts            Contract regression coverage
infra/postgres/migrations/0002_durable_rooms.sql Durable M2 additions to the M1 schema
apps/game-service/src/config.ts                 Session, lease, and rate-limit configuration
apps/game-service/src/domain/errors.ts          Typed safe HTTP/domain errors
apps/game-service/src/domain/session-service.ts Cookie token creation and durable lookup
apps/game-service/src/domain/room-store.ts      PostgreSQL persistence and locked room queries
apps/game-service/src/domain/room-projector.ts  Private/lobby projection boundary
apps/game-service/src/domain/room-coordinator.ts Durable lifecycle, command, replay, and dedupe logic
apps/game-service/src/infra/redis-coordination.ts Redis lease, presence, and fixed-window limit adapters
apps/game-service/src/routes/v1.ts              Authenticated HTTP endpoints and origin guard
apps/game-service/src/app.ts                    Composition, safe errors, and route registration
apps/game-service/src/server.ts                 Production dependency construction
apps/game-service/test/*.test.ts                Unit and real PostgreSQL/Redis integration tests
infra/compose/compose.yaml                      Profiled integration-test runner
.github/workflows/ci.yml                        Runs the profile after stack readiness
docs/operations/production-foundation.md        Documents the M2 endpoint and integration gate
```

### Task 1: Expand the versioned contracts and service configuration

**Files:**

- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/game.test.ts`
- Modify: `apps/game-service/src/config.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Modify: `infra/compose/.env.example`
- Modify: `infra/compose/compose.yaml`

**Interfaces:**

- Produces `CreateRoomRequestSchema`, `JoinRoomRequestSchema`, `StartRoomRequestSchema`, `GuestSessionRequestSchema`, and `RoomProjectionSchema`.
- Produces `ServiceConfig.SESSION_SECRET_PEPPER`, `SESSION_TTL_DAYS`, `ROOM_LEASE_TTL_MS`, and `PRESENCE_TTL_SECONDS`.
- All durable room routes consume an allowed `Origin` and a `commandId` UUID.

- [x] **Step 1: Write the failing contract and configuration tests**

```ts
// packages/contracts/test/game.test.ts
import {
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  RoomProjectionSchema,
} from "../src/index.js";

it("accepts only a versioned Classic-room mutation surface", () => {
  expect(
    CreateRoomRequestSchema.parse({
      commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      ruleProfileId: "classic_304_4p",
    }),
  ).toMatchObject({ ruleProfileId: "classic_304_4p" });
  expect(() =>
    JoinRoomRequestSchema.parse({
      commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      expectedVersion: 1,
      actorSeatIndex: 0,
    }),
  ).toThrow();
  expect(() =>
    RoomProjectionSchema.parse({ roomId: "bad", eventVersion: -1 }),
  ).toThrow();
});
```

```ts
// apps/game-service/test/app.test.ts
expect(() =>
  loadConfig({
    ...baseConfig,
    SESSION_SECRET_PEPPER: "short",
  }),
).toThrow("Invalid service configuration: SESSION_SECRET_PEPPER");
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/contracts test`

Expected: FAIL because the M2 schemas do not exist.

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts`

Expected: FAIL because session and coordination config is not validated.

- [x] **Step 3: Add schemas and config with no client-supplied actor identity**

Add these contract definitions to `packages/contracts/src/game.ts` and re-export them from `src/index.ts`:

```ts
const DisplayName = z.string().trim().min(1).max(48);
const InviteCode = z.string().regex(/^304-[A-Za-z0-9_-]{12,32}$/);

export const GuestSessionRequestSchema = z
  .object({ displayName: DisplayName })
  .strict();

export const CreateRoomRequestSchema = z
  .object({
    commandId: Uuid,
    ruleProfileId: z.literal("classic_304_4p").default("classic_304_4p"),
  })
  .strict();

export const JoinRoomRequestSchema = z
  .object({ commandId: Uuid, expectedVersion: EventVersion })
  .strict();

export const StartRoomRequestSchema = JoinRoomRequestSchema;

export const RoomProjectionSchema = z
  .object({
    roomId: Uuid,
    inviteCode: InviteCode,
    eventVersion: EventVersion,
    status: z.enum(["lobby", "in_hand", "hand_result"]),
    viewerSeatIndex: z.number().int().min(0).max(3).nullable(),
    view: z.record(z.string(), z.unknown()),
  })
  .strict();
```

Extend `EnvironmentSchema` in `apps/game-service/src/config.ts`:

```ts
SESSION_SECRET_PEPPER: z.string().min(32),
SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
ROOM_LEASE_TTL_MS: z.coerce.number().int().min(1_000).max(30_000).default(5_000),
PRESENCE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(75),
```

Set a clearly development-only 32+ character `SESSION_SECRET_PEPPER` in the Compose example and pass it into `game-service`. Production deployment must replace it through its secret manager.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/contracts test`

Run: `pnpm --filter @three-zero-four/game-service test -- app.test.ts`

Expected: schemas reject an actor-seat field, all required M2 secrets/config validate, and the existing service tests still pass.

- [x] **Step 5: Commit the contracts and config**

```bash
git add packages/contracts apps/game-service/src/config.ts apps/game-service/test/app.test.ts infra/compose/.env.example infra/compose/compose.yaml
git commit -m "feat: define durable room contracts"
```

### Task 2: Extend the durable schema and introduce the PostgreSQL room store

**Files:**

- Create: `infra/postgres/migrations/0002_durable_rooms.sql`
- Create: `apps/game-service/src/domain/errors.ts`
- Create: `apps/game-service/src/domain/room-store.ts`
- Create: `apps/game-service/test/room-store.integration.test.ts`
- Modify: `apps/game-service/test/migrations.integration.test.ts`

**Interfaces:**

- Produces `DomainError(code, statusCode, message)` and `PostgresRoomStore` with `transaction`, `createRoom`, `loadRoomForUpdate`, `loadSnapshot`, `loadSnapshotAt`, `loadEventsAfter`, `appendEventAndSnapshot`, `findDuplicate`, `requireHumanSeat`, and `markRecoveryFailed`.
- Adds room settings, durable global/session create dedupe, and command actor ownership without changing the M1 migration.
- `appendEventAndSnapshot` inserts exactly one event, one snapshot, and increments `rooms.event_version` in the caller's transaction.

- [x] **Step 1: Write migration and store integration tests**

```ts
it("stores an immutable event, exact snapshot, and command result atomically", async () => {
  const created = await store.createRoom({ host, commandId, inviteCode });
  await database.transaction((transaction) =>
    store.appendEventAndSnapshot(transaction, {
      roomId: created.id,
      expectedVersion: created.eventVersion,
      commandId: startCommandId,
      actorPlayerId: host.playerId,
      eventType: "ROOM_STARTED",
      payload: { ruleProfileId: "classic_304_4p" },
      snapshot: startedEngine.getSnapshot(),
      status: "in_hand",
    }),
  );
  expect(await store.loadEventsAfter(created.id, 0)).toHaveLength(1);
  expect(await store.loadSnapshot(created.id)).toMatchObject({ eventVersion: 2 });
});
```

- [x] **Step 2: Run the integration test and verify RED**

Run: `INTEGRATION_DATABASE_URL=<reachable PostgreSQL URL> pnpm --filter @three-zero-four/game-service test -- room-store.integration.test.ts`

Expected: FAIL because the M2 migration and room store do not exist. Run this after the Compose PostgreSQL service is healthy.

- [x] **Step 3: Add the append-only migration and focused store**

Create `0002_durable_rooms.sql`:

```sql
ALTER TABLE rooms
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{"botDifficulty":"easy","enableSecondBidding":true}'::jsonb,
  ADD COLUMN recovery_error text;

ALTER TABLE rooms DROP CONSTRAINT rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('lobby', 'in_hand', 'hand_result', 'closed', 'recovery_failed'));

ALTER TABLE command_deduplications
  ADD COLUMN actor_player_id uuid REFERENCES players(id);

CREATE TABLE IF NOT EXISTS session_command_deduplications (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, command_id)
);

CREATE INDEX IF NOT EXISTS game_events_room_actor_idx
  ON game_events(room_id, actor_player_id, event_version);
```

Create `apps/game-service/src/domain/errors.ts` before the store:

```ts
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
```

Define the persistence boundary in `apps/game-service/src/domain/room-store.ts`:

```ts
export interface StoredRoom {
  id: string;
  inviteCode: string;
  status: "lobby" | "in_hand" | "hand_result" | "closed" | "recovery_failed";
  eventVersion: number;
  hostPlayerId: string;
  ruleProfileId: "classic_304_4p";
  settings: { botDifficulty: "easy"; enableSecondBidding: boolean };
}

export interface StoredSeat {
  seatIndex: number;
  playerId: string | null;
  occupantType: "human" | "bot" | "empty";
  botDifficulty: string | null;
  displayName: string | null;
}

export class PostgresRoomStore {
  constructor(private readonly database: Database) {}

  async loadRoomForUpdate(transaction: Queryable, roomId: string): Promise<StoredRoom | null> {
    const result = await transaction.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings FROM rooms WHERE id = $1 FOR UPDATE",
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async appendEventAndSnapshot(transaction: Queryable, input: AppendEventInput): Promise<number> {
    const nextVersion = input.expectedVersion + 1;
    const updated = await transaction.query<{ event_version: string }>(
      "UPDATE rooms SET event_version = $2, status = $3, updated_at = now() WHERE id = $1 AND event_version = $4 RETURNING event_version",
      [input.roomId, nextVersion, input.status, input.expectedVersion],
    );
    if (updated.rows.length !== 1) throw new DomainError("VERSION_CONFLICT", 409, "Room state changed; refresh and retry");
    await transaction.query(
      "INSERT INTO game_events (room_id, event_version, command_id, actor_player_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [input.roomId, nextVersion, input.commandId, input.actorPlayerId, input.eventType, JSON.stringify(input.payload)],
    );
    await transaction.query(
      "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, $2, 1, $3, $4::jsonb)",
      [input.roomId, nextVersion, "classic_304_4p", JSON.stringify(input.snapshot)],
    );
    await transaction.query(
      "INSERT INTO command_deduplications (room_id, command_id, actor_player_id, response) VALUES ($1, $2, $3, $4::jsonb)",
      [input.roomId, input.commandId, input.actorPlayerId, JSON.stringify({ eventVersion: nextVersion })],
    );
    return nextVersion;
  }
}
```

Use parameterized SQL exclusively. The store must map `bigint` values with `Number`, reject values outside `Number.MAX_SAFE_INTEGER`, and join `players` only to obtain human display names.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service typecheck`

Run: `INTEGRATION_DATABASE_URL=<reachable PostgreSQL URL> pnpm --filter @three-zero-four/game-service test -- migrations.integration.test.ts room-store.integration.test.ts`

Expected: both migrations apply exactly once; a room event, snapshot, and dedupe record commit atomically.

- [x] **Step 5: Commit the durable store**

```bash
git add infra/postgres/migrations/0002_durable_rooms.sql apps/game-service/src/domain/errors.ts apps/game-service/src/domain/room-store.ts apps/game-service/test/room-store.integration.test.ts apps/game-service/test/migrations.integration.test.ts
git commit -m "feat: persist durable room events"
```

### Task 3: Implement session, Redis coordination, and safe domain errors

**Files:**

- Create: `apps/game-service/src/domain/session-service.ts`
- Create: `apps/game-service/src/infra/redis-coordination.ts`
- Create: `apps/game-service/test/session-service.test.ts`
- Create: `apps/game-service/test/redis-coordination.test.ts`

**Interfaces:**

- Produces `SessionService.create`, `SessionService.require`, and `SessionService.setCookie`.
- Produces `RoomLease.withLease`, `Presence.touch`, `Presence.onlinePlayerIds`, and `RateLimiter.consume`.

- [x] **Step 1: Write failing isolated tests**

```ts
it("stores only a peppered session-secret digest and emits a secure production cookie", async () => {
  const created = await sessions.create("Asha");
  expect(created.cookieValue).not.toContain(created.secretHash);
  expect(created.secretHash).toHaveLength(64);
  expect(await sessions.require(created.cookieValue)).toMatchObject({ displayName: "Asha" });
});

it("does not execute a room mutation when another owner holds its lease", async () => {
  await redis.set("g304:lease:room-1", "other-owner", { PX: 5_000 });
  await expect(lease.withLease("room-1", async () => "accepted")).rejects.toMatchObject({
    code: "ROOM_BUSY",
    statusCode: 503,
  });
});
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @three-zero-four/game-service test -- session-service.test.ts redis-coordination.test.ts`

Expected: FAIL because no session or coordination services exist.

- [x] **Step 3: Implement the security and coordination boundaries**

Use random opaque credentials and a constant-time digest comparison:

```ts
const secret = randomBytes(32).toString("base64url");
const secretHash = createHmac("sha256", this.pepper).update(secret).digest("hex");
const cookieValue = `${sessionId}.${secret}`;

async require(cookieValue: string | undefined): Promise<AuthenticatedSession> {
  const [sessionId, secret] = cookieValue?.split(".") ?? [];
  if (!sessionId || !secret || !isUuid(sessionId)) {
    throw new DomainError("SESSION_REQUIRED", 401, "A guest session is required");
  }
  const session = await this.store.findActiveSession(sessionId);
  const candidate = createHmac("sha256", this.pepper).update(secret).digest();
  const recorded = Buffer.from(session?.secretHash ?? "", "hex");
  if (!session || recorded.length !== candidate.length || !timingSafeEqual(recorded, candidate)) {
    throw new DomainError("SESSION_REQUIRED", 401, "A guest session is required");
  }
  return session;
}
```

Use Redis primitives with unique owner tokens:

```ts
async withLease<T>(roomId: string, work: () => Promise<T>): Promise<T> {
  const key = `g304:lease:${roomId}`;
  const owner = randomUUID();
  const acquired = await this.redis.set(key, owner, { NX: true, PX: this.ttlMs });
  if (acquired !== "OK") throw new DomainError("ROOM_BUSY", 503, "Room is busy; retry shortly");
  try {
    return await work();
  } finally {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      { keys: [key], arguments: [owner] },
    );
  }
}
```

`RateLimiter.consume(scope, subject, limit, windowSeconds)` must use `INCR` followed by an expiry on its first increment and throw `RATE_LIMITED` with status `429` when the count exceeds its bound. `Presence.touch(roomId, playerId)` writes a TTL-only key; it never writes durable room state.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test -- session-service.test.ts redis-coordination.test.ts`

Expected: credential secrets are not persisted or logged, lease ownership is compared before release, and limit/presence keys expire.

- [x] **Step 5: Commit identity and coordination**

```bash
git add apps/game-service/src/domain/session-service.ts apps/game-service/src/infra/redis-coordination.ts apps/game-service/test/session-service.test.ts apps/game-service/test/redis-coordination.test.ts
git commit -m "feat: secure durable game sessions"
```

### Task 4: Build the room coordinator, recovery reducer, and private projection

**Files:**

- Create: `apps/game-service/src/domain/room-projector.ts`
- Create: `apps/game-service/src/domain/room-coordinator.ts`
- Create: `apps/game-service/test/room-coordinator.test.ts`

**Interfaces:**

- Produces `RoomCoordinator.createRoom`, `joinRoom`, `startRoom`, `getSnapshot`, and `submitCommand`.
- Produces `projectRoomForPlayer(room, engine, viewer)` and `projectLobbyForViewer(room, viewer)`.
- A duplicate command returns the snapshot at the event version stored in `command_deduplications`; a stale non-duplicate command returns `VERSION_CONFLICT`.

- [x] **Step 1: Write failing coordinator tests**

```ts
it("replays accepted actions from the latest earlier snapshot after a fresh coordinator is created", async () => {
  const first = makeCoordinator({ store, lease, presence });
  const created = await first.createRoom(host, createRequest);
  const players = await joinRemainingHumanSeats(first, created, ["Bimal", "Chitra", "Dilan"]);
  const started = await first.startRoom(host, created.roomId, {
    ...startRequest,
    expectedVersion: players.at(-1)!.eventVersion,
  });
  const actor = await sessionForActiveSeat(first, [host, ...players], started.roomId);
  const command = legalBidFor(await first.getSnapshot(actor, started.roomId));
  await first.submitCommand(actor, { ...command, expectedVersion: started.eventVersion });

  await store.deleteSnapshotAt(created.roomId, started.eventVersion + 1);
  const restarted = makeCoordinator({ store, lease, presence });
  const recovered = await restarted.getSnapshot(host, created.roomId);
  expect(recovered.eventVersion).toBe(started.eventVersion + 1);
  expect(recovered.view.privateSeat.hand).toHaveLength(4);
});

it("returns the original command outcome for a duplicate before checking a now-stale expected version", async () => {
  const first = await coordinator.submitCommand(host, command);
  const duplicate = await coordinator.submitCommand(host, command);
  expect(duplicate.eventVersion).toBe(first.eventVersion);
});
```

- [x] **Step 2: Run the unit tests and verify RED**

Run: `pnpm --filter @three-zero-four/game-service test -- room-coordinator.test.ts`

Expected: FAIL because room lifecycle, recovery, and projection services do not exist.

- [x] **Step 3: Implement the coordinator without leaking engine state**

Create new engines only at the locked `ROOM_STARTED` transition. Empty lobby seats become deterministic bot records at that point; M2 does not schedule bot moves. Build the engine from durable seat records:

```ts
const engine = new GameEngine({
  playerName: seats[0]?.displayName ?? "Host",
  humanCount: seats.filter((seat) => seat.occupantType === "human").length,
  tableMode: "classic_4",
  ruleProfile: "classic_304_4p",
  botDifficulty: "easy",
  enableSecondBidding: room.settings.enableSecondBidding,
  initialSeats: seats.map((seat) => ({
    index: seat.seatIndex,
    type: seat.occupantType,
    displayName: seat.displayName ?? undefined,
    userId: seat.playerId ?? undefined,
    difficulty: seat.botDifficulty ?? undefined,
    connectionStatus: seat.occupantType === "human" ? "online" : "online",
  })),
});
engine.startMatch();
```

Recovery loads the latest snapshot and replays later `GAME_ACTION` events through the same engine method. It must never pass `expectedVersion`, `clientVersion`, `seatIndex`, or `actorSeatIndex` from persisted browser input into the engine:

```ts
for (const event of await this.store.loadEventsAfter(room.id, snapshot.eventVersion)) {
  if (event.eventType !== "GAME_ACTION") continue;
  const seatIndex = await this.store.findSeatIndex(room.id, event.actorPlayerId);
  const result = engine.applyAction({ ...event.payload.action, seatIndex, actorSeatIndex: seatIndex });
  if (!result.ok) throw new RecoveryError(room.id, event.eventVersion, result.reason ?? "replay rejected");
}
```

If hydration or replay fails, persist `status = 'recovery_failed'` and a redacted diagnostic in `rooms.recovery_error`, log the room id/event version, and throw `ROOM_RECOVERY_FAILED` with a 503 status. The request must never substitute a new engine or silently discard events.

Project a player view from the engine's safe methods only:

```ts
export function projectRoomForPlayer(input: ProjectInput): RoomProjection {
  const publicState = input.engine.getPublicState(input.viewerSeatIndex);
  const privateSeat = input.engine.getSeatView(input.viewerSeatIndex);
  return {
    roomId: input.room.id,
    inviteCode: input.room.inviteCode,
    eventVersion: input.eventVersion,
    status: input.room.status,
    viewerSeatIndex: input.viewerSeatIndex,
    view: {
      publicState,
      privateSeat,
      legalActions: input.engine.getLegalActions(input.viewerSeatIndex).map(toWireAction),
      prompt: input.engine.getPrompt(),
      presence: input.presence,
    },
  };
}
```

`toWireAction` may return only `type`, `amount`, `cardId`, `faceDown`, and `fromIndicator`; it must not include an engine `seatIndex` field. A lobby response exposes room metadata and seats but no `privateSeat`, `legalActions`, engine snapshot, or cards.

For any coordinator mutation, follow this order exactly:

```ts
return this.lease.withLease(roomId, () =>
  this.store.transaction(async (transaction) => {
    const room = await this.store.loadRoomForUpdate(transaction, roomId);
    const duplicate = await this.store.findDuplicate(transaction, roomId, commandId, actor.playerId);
    if (duplicate) return this.projectVersion(transaction, room, actor, duplicate.eventVersion);
    if (room.eventVersion !== expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", 409, "Room state changed; refresh and retry");
    }
    const seatIndex = await this.store.requireHumanSeat(transaction, room.id, actor.playerId);
    const engine = await this.recoverLockedRoom(transaction, room);
    const result = engine.applyAction({ ...command.action, seatIndex, actorSeatIndex: seatIndex });
    if (!result.ok) throw new DomainError("ACTION_REJECTED", 409, result.reason ?? "Action was rejected");
    const eventVersion = await this.store.appendEventAndSnapshot(transaction, {
      roomId: room.id, expectedVersion, commandId, actorPlayerId: actor.playerId,
      eventType: "GAME_ACTION", payload: { action: command.action }, snapshot: engine.getSnapshot(),
      status: engine.state.phase === "hand_result" ? "hand_result" : "in_hand",
    });
    return projectRoomForPlayer({ room: { ...room, eventVersion }, engine, viewerSeatIndex: seatIndex, presence: "online" });
  }),
);
```

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test -- room-coordinator.test.ts`

Expected: a restart reconstructs the same private hand, a duplicate cannot produce a second event, a stale unique command is rejected, and another player's cards are absent from every projection.

- [x] **Step 5: Commit the durable coordinator**

```bash
git add apps/game-service/src/domain/room-projector.ts apps/game-service/src/domain/room-coordinator.ts apps/game-service/test/room-coordinator.test.ts
git commit -m "feat: coordinate durable room commands"
```

### Task 5: Expose authenticated HTTP routes and real service integration coverage

**Files:**

- Create: `apps/game-service/src/routes/v1.ts`
- Modify: `apps/game-service/src/app.ts`
- Modify: `apps/game-service/src/server.ts`
- Modify: `apps/game-service/test/app.test.ts`
- Create: `apps/game-service/test/durable-rooms.integration.test.ts`

**Interfaces:**

- `POST /v1/guest-sessions` creates an HTTP-only cookie and returns the guest's public identity.
- `POST /v1/rooms`, `GET /v1/rooms/:roomRef`, `POST /v1/rooms/:roomRef/join`, `POST /v1/rooms/:roomId/start`, `GET /v1/rooms/:roomId/snapshot`, and `POST /v1/rooms/:roomId/commands` delegate exclusively to `RoomCoordinator`.
- All error responses use `{ error: { code, message } }`; unknown exceptions become a redacted `INTERNAL_ERROR`.

- [ ] **Step 1: Write failing HTTP and integration tests**

```ts
it("creates, joins, starts, plays, reconnects, and protects private cards", async () => {
  const host = await createGuest(app, "Asha");
  const room = await createRoom(app, host.cookie);
  const guests = await Promise.all(["Bimal", "Chitra", "Dilan"].map((name) => createGuest(app, name)));
  let version = room.eventVersion;
  for (const guest of guests) {
    const joined = await joinRoom(app, guest.cookie, room.inviteCode, version);
    expect(joined.viewerSeatIndex).not.toBeNull();
    version = joined.eventVersion;
  }

  const started = await startRoom(app, host.cookie, room.roomId, version);
  const hostCards = started.view.privateSeat.hand.map((card: { cardId: string }) => card.cardId);
  const activeGuest = await sessionForActiveSeat(app, [host, ...guests], room.roomId);
  await submitFirstLegalAction(app, activeGuest.cookie, room.roomId, started.eventVersion);
  const guestView = await getSnapshot(app, guests[0].cookie, room.roomId);
  expect(JSON.stringify(guestView)).not.toContain(hostCards[0]);

  const reconnectedApp = await buildRealApp();
  const resumed = await getSnapshot(reconnectedApp, host.cookie, room.roomId);
  expect(resumed.view.privateSeat.hand).toEqual(started.view.privateSeat.hand);
});

it("rejects a missing origin, a seat forgery, and a stale unique command without writing another event", async () => {
  await expect(postWithoutOrigin()).resolves.toMatchObject({ statusCode: 403 });
  await expect(postCommand({ actorSeatIndex: 3 })).resolves.toMatchObject({ statusCode: 400 });
  await expect(postCommand({ commandId: randomUUID(), expectedVersion: 0 })).resolves.toMatchObject({ statusCode: 409 });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `INTEGRATION_DATABASE_URL=postgres://game:game@127.0.0.1:5432/game INTEGRATION_REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts`

Expected: FAIL because `/v1` routes and real dependency composition are absent.

- [ ] **Step 3: Register strict routes, origin checks, and a safe error handler**

Use one parser for every JSON request and a route boundary that never accepts a player/seat id:

```ts
app.addHook("onRequest", async (request) => {
  if (request.method !== "POST" || !request.url.startsWith("/v1/")) return;
  const origin = request.headers.origin;
  if (!origin || !config.corsOrigins.has(origin)) {
    throw new DomainError("ORIGIN_DENIED", 403, "Request origin is not allowed");
  }
});

app.post("/v1/rooms/:roomId/commands", async (request, reply) => {
  const session = await sessions.require(request.cookies[config.SESSION_COOKIE_NAME]);
  await rateLimiter.consume("command", session.playerId, 30, 10);
  const command = GameCommandSchema.parse(request.body);
  if (command.roomId !== request.params.roomId) {
    throw new DomainError("ROOM_ID_MISMATCH", 400, "Room id does not match request path");
  }
  return reply.send(await coordinator.submitCommand(session, command));
});
```

Set the cookie only from the guest-session route:

```ts
reply.setCookie(config.SESSION_COOKIE_NAME, created.cookieValue, {
  httpOnly: true,
  sameSite: "lax",
  secure: config.NODE_ENV === "production",
  path: "/",
  maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60,
});
```

The Fastify error handler must map `ZodError` to `INVALID_REQUEST` (400), preserve `DomainError` status/code/message, log other errors with the request id, and return only `INTERNAL_ERROR` with a 500 status. It must not expose SQL error text.

Production `server.ts` creates one database, one Redis client, a `PostgresRoomStore`, `SessionService`, `RoomCoordinator`, `Presence`, and `RateLimiter`, then passes them into `buildApp`. Existing health-only tests may pass a lightweight fake runtime; all `/v1` tests use the real coordinator.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @three-zero-four/game-service test`

Run: `INTEGRATION_DATABASE_URL=postgres://game:game@127.0.0.1:5432/game INTEGRATION_REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @three-zero-four/game-service test -- durable-rooms.integration.test.ts`

Expected: authenticated users can create/join/start/reconnect; a valid command advances once; stale/forged/no-origin requests do not mutate state; private-card assertions pass across two cookie jars.

- [ ] **Step 5: Commit the HTTP API**

```bash
git add apps/game-service/src/routes/v1.ts apps/game-service/src/app.ts apps/game-service/src/server.ts apps/game-service/test/app.test.ts apps/game-service/test/durable-rooms.integration.test.ts
git commit -m "feat: expose durable room HTTP API"
```

### Task 6: Run durable integration tests in Compose and CI

**Files:**

- Modify: `infra/compose/compose.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/operations/production-foundation.md`
- Modify: `README.md`

**Interfaces:**

- Adds a non-production `integration` Compose profile that uses the existing `build` Docker stage and can reach `postgres` and `redis` on the private Compose network.
- CI runs the profile after its normal `up --build --wait` health gate.

- [ ] **Step 1: Write the failing release-gate contract**

```js
// test/production-foundation-ci.test.mjs
const compose = read("infra/compose/compose.yaml");
assert.match(workflow, /compose\.yaml --profile integration run --rm integration/);
assert.match(compose, /integration:[\s\S]*profiles: \["integration"\]/);
assert.match(runbook, /durable-rooms\.integration\.test\.ts/);
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node --test test/production-foundation-ci.test.mjs`

Expected: FAIL because CI does not yet execute a PostgreSQL/Redis room flow.

- [ ] **Step 3: Add the Compose integration runner and documentation**

Use the existing full-workspace build stage in the service Dockerfile and define this Compose service:

```yaml
  integration:
    build:
      context: ../..
      dockerfile: apps/game-service/Dockerfile
      target: build
    profiles: ["integration"]
    command:
      ["pnpm", "--filter", "@three-zero-four/game-service", "test", "--", "durable-rooms.integration.test.ts"]
    environment:
      NODE_ENV: test
      INTEGRATION_DATABASE_URL: postgres://game:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      INTEGRATION_REDIS_URL: redis://redis:6379
      CORS_ORIGINS: http://127.0.0.1:3000
      SESSION_COOKIE_NAME: g304_session
      SESSION_SECRET_PEPPER: ${SESSION_SECRET_PEPPER}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
```

Append this CI step immediately after readiness checks:

```yaml
- run: docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm integration
```

Document the local equivalent and state clearly that it exercises a disposable database only. Keep the `down --volumes --remove-orphans` `always()` cleanup unchanged.

- [ ] **Step 4: Verify GREEN with the actual topology**

Run: `pnpm check`

Run: `pnpm security:check:all`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up --build --wait`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml --profile integration run --rm integration`

Run: `docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml down --volumes --remove-orphans`

Expected: all unit/contract tests pass; the isolated integration container creates, joins, starts, commands, recovers, and privacy-checks a room against real PostgreSQL and Redis; teardown leaves no containers or volumes.

- [ ] **Step 5: Commit the M2 verification gate**

```bash
git add infra/compose/compose.yaml .github/workflows/ci.yml docs/operations/production-foundation.md README.md test/production-foundation-ci.test.mjs
git commit -m "test: gate durable room integration"
```

## M2 completion checklist

- [ ] Guest sessions use high-entropy HTTP-only cookies backed by durable, peppered secret digests.
- [ ] Classic rooms, seats, lifecycle events, and game snapshots persist in PostgreSQL.
- [ ] Every accepted room action is locked, idempotent, versioned, evented, and snapshot-backed.
- [ ] Every `GET`/command response is a private projection with no cross-seat card leak.
- [ ] Fresh coordinator instances recover rooms from snapshots plus later events.
- [ ] Redis coordinates leases, presence, and per-subject rate limits without becoming a system of record.
- [ ] CI exercises the M2 flow against real PostgreSQL and Redis in Compose.
