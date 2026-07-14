import {
  commandId,
  createLobby,
  eventVersion,
  executeRoomCommand,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import {
  PostgresRoomCommandWriter,
  RoomCommandPersistenceError,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-command-writer.js";
import type { RoomCommandCommit } from "../src/contexts/rooms/application/execute-room-command.js";
import type { Database } from "../src/infra/database.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");
const aggregateId = roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a");
const aggregateCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");

function lobby() {
  return createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: aggregateId,
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: { botDifficulty: "easy", enableSecondBidding: true },
  });
}

function joinCommit(): RoomCommandCommit {
  const original = lobby();
  const result = executeRoomCommand(original, {
    actor: { displayName: "Bimal", playerId: guestId },
    expectedVersion: eventVersion(1),
    type: "JOIN_ROOM",
  });
  if (!result.ok) throw new Error("Expected join command to succeed");
  return {
    actorPlayerId: guestId,
    commandId: aggregateCommandId,
    events: result.events,
    expectedVersion: original.eventVersion,
    response: projectRoom(result.room, guestId),
    room: result.room,
  };
}

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class TransactionDatabase implements Pick<Database, "transaction"> {
  readonly calls: QueryCall[] = [];
  currentVersion = 1;
  duplicate: { actor_player_id: string; response: unknown } | null = null;

  async transaction<T>(
    callback: (transaction: Pick<Database, "query">) => Promise<T>,
  ): Promise<T> {
    return callback({
      query: async <Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        this.calls.push({ text, values });
        let rows: QueryResultRow[] = [];
        if (text.includes("FOR UPDATE")) {
          rows = [{ event_version: this.currentVersion }];
        } else if (text.includes("FROM command_deduplications")) {
          rows = this.duplicate ? [this.duplicate] : [];
        } else if (text.startsWith("UPDATE rooms")) {
          rows = [{ id: aggregateId }];
        } else if (text.startsWith("UPDATE room_seats")) {
          rows = [{ seat_index: values[1] }];
        }
        return { rows: rows as Row[] };
      },
    });
  }
}

describe("PostgresRoomCommandWriter", () => {
  it("atomically writes aggregate state, an event, outbox, and response", async () => {
    const database = new TransactionDatabase();
    const writer = new PostgresRoomCommandWriter(database);
    const commit = joinCommit();

    await writer.commit(commit);

    expect(
      database.calls.some((call) => call.text.startsWith("UPDATE rooms")),
    ).toBe(true);
    expect(
      database.calls.filter((call) =>
        call.text.startsWith("UPDATE room_seats"),
      ),
    ).toHaveLength(4);
    const eventInsert = database.calls.find((call) =>
      call.text.startsWith("INSERT INTO game_events"),
    );
    expect(eventInsert?.values.slice(0, 5)).toEqual([
      aggregateId,
      2,
      aggregateCommandId,
      guestId,
      "PLAYER_JOINED",
    ]);
    expect(
      database.calls.some((call) =>
        call.text.startsWith("INSERT INTO room_outbox"),
      ),
    ).toBe(true);
    const deduplicationInsert = database.calls.find((call) =>
      call.text.startsWith("INSERT INTO command_deduplications"),
    );
    expect(JSON.parse(String(deduplicationInsert?.values[3]))).toEqual(
      commit.response,
    );
    expect(
      database.calls.some((call) => call.text.includes("game_snapshots")),
    ).toBe(false);
  });

  it("deduplicates a successful no-change command without writing an event", async () => {
    const room = lobby();
    const result = executeRoomCommand(room, {
      actor: hostId,
      connectionStatus: "online",
      expectedVersion: room.eventVersion,
      type: "SET_CONNECTION",
    });
    if (!result.ok) throw new Error("Expected connection command to succeed");
    const database = new TransactionDatabase();
    const writer = new PostgresRoomCommandWriter(database);

    await writer.commit({
      actorPlayerId: hostId,
      commandId: aggregateCommandId,
      events: result.events,
      expectedVersion: room.eventVersion,
      response: projectRoom(result.room, hostId),
      room: result.room,
    });

    expect(result.events).toEqual([]);
    expect(
      database.calls.some(
        (call) =>
          call.text.startsWith("UPDATE rooms") ||
          call.text.startsWith("INSERT INTO game_events") ||
          call.text.startsWith("INSERT INTO room_outbox"),
      ),
    ).toBe(false);
    expect(
      database.calls.some((call) =>
        call.text.startsWith("INSERT INTO command_deduplications"),
      ),
    ).toBe(true);
  });

  it("rejects an optimistic version conflict before writing", async () => {
    const database = new TransactionDatabase();
    database.currentVersion = 2;
    const writer = new PostgresRoomCommandWriter(database);

    await expect(writer.commit(joinCommit())).rejects.toEqual(
      new RoomCommandPersistenceError(
        "VERSION_CONFLICT",
        "Room state changed; refresh and retry",
      ),
    );
    expect(database.calls.some((call) => call.text.startsWith("UPDATE"))).toBe(
      false,
    );
  });

  it("treats a concurrently persisted command by the same actor as complete", async () => {
    const database = new TransactionDatabase();
    database.duplicate = { actor_player_id: guestId, response: {} };
    const writer = new PostgresRoomCommandWriter(database);

    await expect(writer.commit(joinCommit())).resolves.toBeUndefined();
    expect(
      database.calls.some(
        (call) =>
          call.text.startsWith("UPDATE") || call.text.startsWith("INSERT"),
      ),
    ).toBe(false);
  });
});
