import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { RoomMaintenance } from "../src/contexts/rooms/application/room-maintenance.js";
import { PostgresRoomStore } from "../src/domain/room-store.js";
import { createDatabase, type Database } from "../src/infra/database.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const describeIntegration = databaseUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

type SeededRoomStatus = "closed" | "hand_result" | "in_hand" | "lobby";

let database: Database | undefined;

async function seedRoom(
  status: SeededRoomStatus,
  updatedAt: Date,
): Promise<string> {
  if (!database) throw new Error("Database is unavailable");
  const roomId = randomUUID();
  const playerId = randomUUID();
  await database.query(
    "INSERT INTO players (id, display_name) VALUES ($1, $2)",
    [playerId, `Maintenance ${roomId.slice(0, 8)}`],
  );
  await database.query(
    "INSERT INTO rooms (id, invite_code, status, rule_profile_id, event_version, host_player_id, settings, updated_at) VALUES ($1, $2, $3, 'classic_304_4p', 1, $4, $5::jsonb, $6)",
    [
      roomId,
      `304-maintenance-${roomId}`,
      status,
      playerId,
      JSON.stringify({ botDifficulty: "easy", enableSecondBidding: true }),
      updatedAt,
    ],
  );
  await database.query(
    "INSERT INTO room_seats (room_id, seat_index, player_id, occupant_type, connection_status) VALUES ($1, 0, $2, 'human', 'disconnected')",
    [roomId, playerId],
  );
  await database.query(
    "INSERT INTO game_events (room_id, event_version, command_id, actor_player_id, event_type, payload) VALUES ($1, 1, $2, $3, 'ROOM_CREATED', $4::jsonb)",
    [
      roomId,
      randomUUID(),
      playerId,
      JSON.stringify({ ruleProfileId: "classic_304_4p" }),
    ],
  );
  await database.query(
    "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, 1, 1, 'classic_304_4p', $2::jsonb)",
    [roomId, JSON.stringify({ phase: "setup" })],
  );
  return roomId;
}

async function roomStatus(roomId: string): Promise<string | null> {
  if (!database) throw new Error("Database is unavailable");
  const result = await database.query<{ status: string }>(
    "SELECT status FROM rooms WHERE id = $1",
    [roomId],
  );
  return result.rows[0]?.status ?? null;
}

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describeIntegration("room maintenance", () => {
  it("closes only stale non-active rooms, revokes expired sessions, purges aged closures, and remains idempotent", async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    const store = new PostgresRoomStore(database);
    const now = new Date();
    const staleLobbyId = await seedRoom(
      "lobby",
      new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    );
    const staleTerminalId = await seedRoom(
      "hand_result",
      new Date(now.getTime() - 15 * 24 * 60 * 60 * 1_000),
    );
    const inHandId = await seedRoom(
      "in_hand",
      new Date(now.getTime() - 365 * 24 * 60 * 60 * 1_000),
    );
    const agedClosedId = await seedRoom(
      "closed",
      new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000),
    );
    const expiredPlayerId = randomUUID();
    await database.query(
      "INSERT INTO players (id, display_name) VALUES ($1, 'Expired maintenance guest')",
      [expiredPlayerId],
    );
    await database.query(
      "INSERT INTO sessions (id, player_id, secret_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [
        randomUUID(),
        expiredPlayerId,
        `maintenance-${randomUUID()}`,
        new Date(now.getTime() - 25 * 60 * 60 * 1_000),
      ],
    );
    await database.query(
      "INSERT INTO room_automation_jobs (id, room_id, expected_event_version, kind, target_seat_index, due_at) VALUES ($1, $2, 1, 'BOT_ACTION', 0, $3)",
      [randomUUID(), staleTerminalId, now],
    );

    const maintenance = new RoomMaintenance({
      batchSize: 100,
      closedRetentionDays: 30,
      commandIds: { next: randomUUID },
      expiredSessionRevokeHours: 24,
      lobbyIdleHours: 24,
      store,
      terminalRetentionDays: 14,
    });

    await expect(maintenance.runOnce(now)).resolves.toEqual({
      closedRooms: 2,
      purgedRooms: 1,
      revokedSessions: 1,
    });
    await expect(roomStatus(staleLobbyId)).resolves.toBe("closed");
    await expect(roomStatus(staleTerminalId)).resolves.toBe("closed");
    await expect(roomStatus(inHandId)).resolves.toBe("in_hand");
    await expect(roomStatus(agedClosedId)).resolves.toBeNull();
    await expect(
      database.query<{ payload: unknown }>(
        "SELECT payload FROM game_events WHERE room_id = $1 AND event_type = 'ROOM_CLOSED'",
        [staleLobbyId],
      ),
    ).resolves.toEqual({ rows: [{ payload: { reason: "LOBBY_IDLE" } }] });
    await expect(
      database.query<{ payload: unknown }>(
        "SELECT payload FROM game_events WHERE room_id = $1 AND event_type = 'ROOM_CLOSED'",
        [staleTerminalId],
      ),
    ).resolves.toEqual({
      rows: [{ payload: { reason: "TERMINAL_RETENTION" } }],
    });
    await expect(
      database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM room_automation_jobs WHERE room_id = $1 AND state IN ('pending', 'claimed')",
        [staleTerminalId],
      ),
    ).resolves.toEqual({ rows: [{ count: "0" }] });
    await expect(maintenance.runOnce(now)).resolves.toEqual({
      closedRooms: 0,
      purgedRooms: 0,
      revokedSessions: 0,
    });
  });
});
