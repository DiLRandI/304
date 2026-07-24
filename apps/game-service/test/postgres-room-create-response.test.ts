import { describe, expect, it } from "vitest";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function databaseHarness() {
  const calls: QueryCall[] = [];
  let duplicateRows: readonly Record<string, unknown>[] = [];
  const query = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    if (text.startsWith("SELECT id FROM sessions")) {
      return { rows: [{ id: values[0] }] };
    }
    if (text.startsWith("SELECT response->>")) {
      return { rows: [...duplicateRows] };
    }
    return { rows: [] };
  };
  const database = {
    query,
    transaction: async <T>(
      callback: (transaction: Pick<Database, "query">) => Promise<T>,
    ) => callback({ query } as Pick<Database, "query">),
  } as Database;
  return {
    calls,
    database,
    setDuplicateRows(rows: readonly Record<string, unknown>[]) {
      duplicateRows = rows;
    },
  };
}

const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";
const commandId = "d7c60215-243f-4599-80cb-e8ad78c6ae1f";
const roomId = "12f8e3e8-6729-4c46-b78a-d1a0e804c55a";
const creationResponse = {
  eventVersion: 1,
  id: roomId,
  status: "lobby",
};

describe("PostgresRoomStore create response replay", () => {
  it("stores and reloads the optional creation response with session deduplication", async () => {
    const harness = databaseHarness();
    const store = new PostgresRoomStore(harness.database);

    await store.createRoom({
      commandId,
      deduplicationResponse: creationResponse,
      hostPlayerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
      id: roomId,
      inviteCode: "304-AbCdEfGhIjKl_123",
      ruleProfileId: "classic_304_4p",
      seats: [
        {
          botDifficulty: null,
          connectionStatus: "online",
          displayName: "Asha",
          occupantType: "human",
          playerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
          seatIndex: 0,
        },
        ...[1, 2, 3].map((seatIndex) => ({
          botDifficulty: null,
          connectionStatus: "disconnected" as const,
          displayName: null,
          occupantType: "empty" as const,
          playerId: null,
          seatIndex,
        })),
      ],
      sessionId,
      settings: {
        botDifficulty: "easy",
        enableSecondBidding: true,
        endHandWhenOutcomeCertain: true,
      },
    });

    const insert = harness.calls.find((call) =>
      call.text.startsWith("INSERT INTO session_command_deduplications"),
    );
    expect(JSON.parse(String(insert?.values[2]))).toEqual({
      deduplicationResponse: creationResponse,
      roomId,
    });

    harness.setDuplicateRows([
      {
        deduplication_response: creationResponse,
        room_id: roomId,
      },
    ]);
    await expect(
      store.findSessionDuplicate(sessionId, commandId),
    ).resolves.toEqual({
      deduplicationResponse: creationResponse,
      roomId,
    });
  });
});
