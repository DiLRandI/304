import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAction } from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { PlayerAccessService } from "../src/contexts/player-access/adapters/delivery/player-access-service.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import { NodeRoomIdentityProvider } from "../src/contexts/rooms/adapters/security/node-room-identity-provider.js";
import { NodeRoomInviteCodeProvider } from "../src/contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { RoomCoordinator } from "../src/domain/room-coordinator.js";
import { createDatabase, type Database } from "../src/infra/database.js";
import { Presence, RoomLease } from "../src/infra/redis-coordination.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
const describeIntegration = databaseUrl && redisUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

interface GameView {
  publicState: { activeSeat: number | null };
  privateSeat: { hand: Array<{ cardId: string }> } | null;
  legalActions: GameAction[];
}

let database: Database;
let redis: RedisClientType;
let sessions: PlayerAccessService;

function createCoordinator(): RoomCoordinator {
  return new RoomCoordinator({
    identities: new NodeRoomIdentityProvider(),
    inviteCodes: new NodeRoomInviteCodeProvider(),
    store: new PostgresRoomStore(database),
    lease: new RoomLease(redis, 5_000),
    presence: new Presence(redis, 60),
  });
}

function gameView(projection: { view: Record<string, unknown> }): GameView {
  return projection.view as unknown as GameView;
}

async function createClassicRoom() {
  const coordinator = createCoordinator();
  const host = await sessions.create("Asha");
  const request = {
    commandId: randomUUID(),
    ruleProfileId: "classic_304_4p" as const,
  };
  const created = await coordinator.createRoom(host, request);
  const duplicate = await coordinator.createRoom(host, request);
  expect(duplicate.roomId).toBe(created.roomId);

  const guests = await Promise.all(
    ["Bimal", "Chitra", "Dilan"].map((displayName) =>
      sessions.create(displayName),
    ),
  );
  let eventVersion = created.eventVersion;
  for (const guest of guests) {
    const joined = await coordinator.joinRoom(guest, created.inviteCode, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    eventVersion = joined.eventVersion;
  }
  const started = await coordinator.startRoom(host, created.roomId, {
    commandId: randomUUID(),
    expectedVersion: eventVersion,
  });
  return { coordinator, host, guests, created, started };
}

async function activePlayer(
  coordinator: RoomCoordinator,
  players: readonly AuthenticatedSession[],
  roomId: string,
): Promise<{
  player: AuthenticatedSession;
  projection: Awaited<ReturnType<RoomCoordinator["getSnapshot"]>>;
}> {
  for (const player of players) {
    const projection = await coordinator.getSnapshot(player, roomId);
    const view = gameView(projection);
    if (projection.viewerSeatIndex === view.publicState.activeSeat) {
      return { player, projection };
    }
  }
  throw new Error("No player owns the active seat");
}

describeIntegration("durable room coordinator", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    redis = createClient({ url: redisUrl });
    await redis.connect();
    sessions = new PlayerAccessService(database, {
      pepper: "test-only-session-pepper-must-be-at-least-32-characters",
      ttlDays: 30,
    });
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  it("serializes simultaneous duplicate room-creation commands for one session", async () => {
    const coordinator = createCoordinator();
    const host = await sessions.create("Esha");
    const request = {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p" as const,
    };

    const [first, duplicate] = await Promise.all([
      coordinator.createRoom(host, request),
      coordinator.createRoom(host, request),
    ]);

    expect(duplicate.roomId).toBe(first.roomId);
    await expect(
      database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM rooms WHERE host_player_id = $1",
        [host.playerId],
      ),
    ).resolves.toEqual({ rows: [{ count: "1" }] });
  });

  it("defaults direct coordinator room creation to easy bots", async () => {
    const coordinator = createCoordinator();
    const host = await sessions.create("Ishani");
    const created = await coordinator.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });

    await expect(
      database.query<{ bot_difficulty: string }>(
        "SELECT settings->>'botDifficulty' AS bot_difficulty FROM rooms WHERE id = $1",
        [created.roomId],
      ),
    ).resolves.toEqual({ rows: [{ bot_difficulty: "easy" }] });
  });

  it("replays accepted actions from the latest earlier snapshot after a fresh coordinator is created", async () => {
    const { coordinator, host, guests, created, started } =
      await createClassicRoom();
    const hostBefore = gameView(started).privateSeat?.hand;
    const active = await activePlayer(
      coordinator,
      [host, ...guests],
      created.roomId,
    );
    const action = gameView(active.projection).legalActions[0];
    expect(action).toBeDefined();
    if (!action) throw new Error("Active player has no legal action");
    const command = {
      commandId: randomUUID(),
      roomId: created.roomId,
      expectedVersion: active.projection.eventVersion,
      action,
    };

    const applied = await coordinator.submitCommand(active.player, command);
    const duplicate = await coordinator.submitCommand(active.player, command);
    expect(duplicate.eventVersion).toBe(applied.eventVersion);

    await expect(
      coordinator.submitCommand(active.player, {
        ...command,
        commandId: randomUUID(),
        expectedVersion: started.eventVersion,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", statusCode: 409 });

    await database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [created.roomId, applied.eventVersion],
    );
    const restarted = createCoordinator();
    const recovered = await restarted.getSnapshot(host, created.roomId);
    expect(recovered.eventVersion).toBe(applied.eventVersion);
    expect(gameView(recovered).privateSeat?.hand).toEqual(hostBefore);

    const firstGuest = guests[0];
    if (!firstGuest) throw new Error("Classic room is missing its first guest");
    const guestView = await restarted.getSnapshot(firstGuest, created.roomId);
    expect(JSON.stringify(guestView)).not.toContain(
      hostBefore?.[0]?.cardId ?? "",
    );
  });
});
