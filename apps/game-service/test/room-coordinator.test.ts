import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { createPlayerAccessService } from "../src/bootstrap/player-access.js";
import type { PlayerAccess } from "../src/contexts/player-access/application/player-access.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import {
  createDatabase,
  type Database,
} from "../src/platform/postgres/database.js";
import { RoomTestRuntime } from "./support/room-test-runtime.js";

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
let sessions: PlayerAccess;

function gameView(projection: { view: Record<string, unknown> }): GameView {
  return projection.view as unknown as GameView;
}

async function createClassicRoom() {
  const game = new RoomTestRuntime(database, redis);
  const host = await sessions.create("Asha");
  const request = {
    commandId: randomUUID(),
    ruleProfileId: "classic_304_4p" as const,
  };
  const created = await game.createRoom(host, request);
  const duplicate = await game.createRoom(host, request);
  expect(duplicate.roomId).toBe(created.roomId);

  const guests = await Promise.all(
    ["Bimal", "Chitra", "Dilan"].map((displayName) =>
      sessions.create(displayName),
    ),
  );
  let eventVersion = created.eventVersion;
  for (const guest of guests) {
    const joined = await game.joinRoom(guest, created.inviteCode, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    eventVersion = joined.eventVersion;
  }
  const started = await game.startRoom(host, created.roomId, {
    commandId: randomUUID(),
    expectedVersion: eventVersion,
  });
  return { game, host, guests, created, started };
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
    const view = gameView(projection);
    if (projection.viewerSeatIndex === view.publicState.activeSeat) {
      return { player, projection };
    }
  }
  throw new Error("No player owns the active seat");
}

describeIntegration("durable room application", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    redis = createClient({ url: redisUrl });
    await redis.connect();
    sessions = createPlayerAccessService(database, {
      pepper: "test-only-session-pepper-must-be-at-least-32-characters",
      ttlDays: 30,
    });
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  it("serializes simultaneous duplicate room-creation commands for one session", async () => {
    const game = new RoomTestRuntime(database, redis);
    const host = await sessions.create("Esha");
    const request = {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p" as const,
    };

    const [first, duplicate] = await Promise.all([
      game.createRoom(host, request),
      game.createRoom(host, request),
    ]);

    expect(duplicate.roomId).toBe(first.roomId);
    await expect(
      database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM rooms WHERE host_player_id = $1",
        [host.playerId],
      ),
    ).resolves.toEqual({ rows: [{ count: "1" }] });
  });

  it("defaults direct room creation to easy bots", async () => {
    const game = new RoomTestRuntime(database, redis);
    const host = await sessions.create("Ishani");
    const created = await game.createRoom(host, {
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

  it("replays accepted actions from the latest earlier snapshot after a fresh runtime is created", async () => {
    const { game, host, guests, created, started } = await createClassicRoom();
    const hostBefore = gameView(started).privateSeat?.hand;
    const active = await activePlayer(game, [host, ...guests], created.roomId);
    const action = gameView(active.projection).legalActions[0];
    expect(action).toBeDefined();
    if (!action) throw new Error("Active player has no legal action");
    const command = {
      commandId: randomUUID(),
      roomId: created.roomId,
      expectedVersion: active.projection.eventVersion,
      action,
    };
    const gameplayCommands = game.gameplayCommands;

    const applied = await gameplayCommands.submitCommand(
      active.player,
      command,
    );
    const duplicate = await gameplayCommands.submitCommand(
      active.player,
      command,
    );
    expect(duplicate.eventVersion).toBe(applied.eventVersion);

    await expect(
      gameplayCommands.submitCommand(active.player, {
        ...command,
        commandId: randomUUID(),
        expectedVersion: started.eventVersion,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    await database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [created.roomId, applied.eventVersion],
    );
    const restarted = new RoomTestRuntime(database, redis);
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
