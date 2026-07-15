import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GameAction,
  RoomProjection,
  RuleProfileId,
} from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { createPlayerAccessService } from "../src/bootstrap/player-access.js";
import type { PlayerAccess } from "../src/contexts/player-access/application/player-access.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import { createDatabase, type Database } from "../src/infra/database.js";
import { AutomationWorker } from "../src/worker/automation-worker.js";
import { RoomTestRuntime } from "./support/room-test-runtime.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
const describeIntegration = databaseUrl && redisUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

interface GameView {
  legalActions?: GameAction[];
  publicState?: { activeSeat: number | null };
}

interface SnapshotState {
  seats: Array<{ hand: Array<{ cardId: string }> }>;
  trump: {
    card: { cardId: string } | null;
    isOpen: boolean;
    maker: number | null;
  };
}

interface StoredSnapshotRow {
  event_version: string | number;
  rule_profile_id: RuleProfileId;
  schema_version: number;
  state: SnapshotState;
}

let database: Database;
let redis: RedisClientType;
let sessions: PlayerAccess;
let store: PostgresRoomStore;

function createRuntime(): RoomTestRuntime {
  return new RoomTestRuntime(database, redis, {
    automation: {
      botActionDelayMs: 250,
      disconnectGraceSeconds: 90,
    },
  });
}

function viewOf(projection: RoomProjection): GameView {
  return projection.view as GameView;
}

async function createStartedHumanRoom(ruleProfileId: RuleProfileId): Promise<{
  created: RoomProjection;
  game: RoomTestRuntime;
  players: AuthenticatedSession[];
}> {
  const game = createRuntime();
  const seatCount = ruleProfileId === "six_304_36" ? 6 : 4;
  const host = await sessions.create(`Host ${randomUUID().slice(0, 8)}`);
  const created = await game.createRoom(host, {
    commandId: randomUUID(),
    ruleProfileId,
  });
  const guests = await Promise.all(
    Array.from({ length: seatCount - 1 }, (_, index) =>
      sessions.create(`Guest ${index + 1} ${randomUUID().slice(0, 8)}`),
    ),
  );
  let eventVersion = created.eventVersion;
  for (const guest of guests) {
    const joined = await game.joinRoom(guest, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    eventVersion = joined.eventVersion;
  }
  await game.startRoom(host, created.roomId, {
    commandId: randomUUID(),
    expectedVersion: eventVersion,
  });
  return { created, game, players: [host, ...guests] };
}

async function activePlayer(
  game: RoomTestRuntime,
  players: readonly AuthenticatedSession[],
  roomId: string,
): Promise<{
  player: AuthenticatedSession;
  projection: RoomProjection;
}> {
  for (const player of players) {
    const projection = await game.getSnapshot(player, roomId);
    const view = viewOf(projection);
    if (projection.viewerSeatIndex === view.publicState?.activeSeat) {
      return { player, projection };
    }
  }
  throw new Error("No seated human owns the active turn");
}

async function applyHumanCommands(
  game: RoomTestRuntime,
  players: readonly AuthenticatedSession[],
  roomId: string,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const active = await activePlayer(game, players, roomId);
    const action = viewOf(active.projection).legalActions?.[0];
    if (!action) throw new Error("Expected a legal human action");
    await game.gameplayCommands.submitCommand(active.player, {
      action,
      commandId: randomUUID(),
      expectedVersion: active.projection.eventVersion,
      roomId,
    });
  }
}

async function applyWorkerAction(
  game: RoomTestRuntime,
  players: readonly AuthenticatedSession[],
  roomId: string,
): Promise<void> {
  const active = await activePlayer(game, players, roomId);
  await game.connections.markRealtimeDisconnected(active.player, roomId);
  await database.query(
    "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'DISCONNECT_GRACE' AND state = 'pending'",
    [roomId],
  );
  const worker = new AutomationWorker({
    executor: game.automation,
    ownerId: randomUUID(),
    pollIntervalMs: 500,
    roomId,
    store,
  });
  await worker.runOnce();
  await database.query(
    "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
    [roomId],
  );
  await worker.runOnce();
}

async function currentSnapshots(
  game: RoomTestRuntime,
  players: readonly AuthenticatedSession[],
  roomId: string,
): Promise<Map<string, RoomProjection>> {
  for (const player of players) {
    await game.connections.markRealtimePresence(player, roomId);
  }
  const snapshots = new Map<string, RoomProjection>();
  for (const player of players) {
    snapshots.set(player.playerId, await game.getSnapshot(player, roomId));
  }
  return snapshots;
}

function assertNoPrivateCardsLeak(
  projections: Map<string, RoomProjection>,
  players: readonly AuthenticatedSession[],
  state: SnapshotState,
): void {
  for (const player of players) {
    const projection = projections.get(player.playerId);
    if (!projection || projection.viewerSeatIndex == null) {
      throw new Error("Expected a seated private projection");
    }
    const payload = JSON.stringify(projection);
    for (let seatIndex = 0; seatIndex < state.seats.length; seatIndex += 1) {
      if (seatIndex === projection.viewerSeatIndex) continue;
      for (const card of state.seats[seatIndex]?.hand ?? []) {
        expect(payload).not.toContain(card.cardId);
      }
    }
    const hiddenTrump = state.trump.card;
    if (
      hiddenTrump &&
      !state.trump.isOpen &&
      state.trump.maker !== projection.viewerSeatIndex
    ) {
      expect(payload).not.toContain(hiddenTrump.cardId);
    }
  }
}

async function snapshotsForVariants(
  roomId: string,
): Promise<StoredSnapshotRow[]> {
  const result = await database.query<StoredSnapshotRow>(
    "SELECT event_version, schema_version, rule_profile_id, state FROM game_snapshots WHERE room_id = $1 AND event_version > 1 ORDER BY event_version DESC LIMIT 12",
    [roomId],
  );
  return result.rows;
}

async function restoreSnapshot(
  roomId: string,
  snapshot: StoredSnapshotRow,
): Promise<void> {
  await database.query(
    "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [
      roomId,
      snapshot.event_version,
      snapshot.schema_version,
      snapshot.rule_profile_id,
      JSON.stringify(snapshot.state),
    ],
  );
}

describeIntegration("durable room recovery variance", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    redis = createClient({ url: redisUrl });
    await redis.connect();
    store = new PostgresRoomStore(database);
    sessions = createPlayerAccessService(database, {
      pepper: "test-only-session-pepper-must-be-at-least-32-characters",
      ttlDays: 30,
    });
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  for (const ruleProfileId of ["classic_304_4p", "six_304_36"] as const) {
    it(`replays exact private ${ruleProfileId} projections after each of twelve snapshot-loss variants`, async () => {
      const { created, game, players } =
        await createStartedHumanRoom(ruleProfileId);
      await applyHumanCommands(game, players, created.roomId, 5);
      await applyWorkerAction(game, players, created.roomId);

      const canonical = await currentSnapshots(game, players, created.roomId);
      const room = await store.loadRoom(created.roomId);
      if (!room) throw new Error("Expected a durable room");
      const latest = await database.query<StoredSnapshotRow>(
        "SELECT event_version, schema_version, rule_profile_id, state FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
        [created.roomId, room.eventVersion],
      );
      const currentState = latest.rows[0]?.state;
      if (!currentState) throw new Error("Expected the current room snapshot");
      assertNoPrivateCardsLeak(canonical, players, currentState);

      const variants = await snapshotsForVariants(created.roomId);
      expect(variants).toHaveLength(12);
      for (const snapshot of variants) {
        await database.query(
          "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
          [created.roomId, snapshot.event_version],
        );
        try {
          const restarted = createRuntime();
          for (const player of players) {
            await expect(
              restarted.getSnapshot(player, created.roomId),
            ).resolves.toEqual(canonical.get(player.playerId));
          }
        } finally {
          await restoreSnapshot(created.roomId, snapshot);
        }
      }
    }, 30_000);
  }

  it("marks a room unavailable rather than guessing after an invalid replay event", async () => {
    const { created, game, players } =
      await createStartedHumanRoom("classic_304_4p");
    await applyHumanCommands(game, players, created.roomId, 5);
    await applyWorkerAction(game, players, created.roomId);
    const room = await store.loadRoom(created.roomId);
    if (!room) throw new Error("Expected a durable room");

    await database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [created.roomId, room.eventVersion],
    );
    await database.query(
      "UPDATE game_events SET payload = '{\"seatIndex\":0}'::jsonb WHERE room_id = $1 AND event_version = $2",
      [created.roomId, room.eventVersion],
    );

    const firstPlayer = players[0];
    if (!firstPlayer) throw new Error("Expected a room host");
    await expect(
      createRuntime().getSnapshot(firstPlayer, created.roomId),
    ).rejects.toMatchObject({
      code: "ROOM_RECOVERY_FAILED",
      statusCode: 503,
    });
    await expect(store.loadRoom(created.roomId)).resolves.toMatchObject({
      status: "recovery_failed",
    });
  }, 30_000);
});
