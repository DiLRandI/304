import { describe, expect, it, vi } from "vitest";
import {
  type NewRoomInput,
  PostgresRoomStore,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

function roomInput(): NewRoomInput {
  return {
    commandId: "command-1",
    hostPlayerId: "player-1",
    id: "room-1",
    inviteCode: "304-room",
    ruleProfileId: "classic_304_4p",
    seats: Array.from({ length: 4 }, (_, seatIndex) => ({
      botDifficulty: null,
      displayName: seatIndex === 0 ? "Asha" : null,
      occupantType: seatIndex === 0 ? ("human" as const) : ("empty" as const),
      playerId: seatIndex === 0 ? "player-1" : null,
      seatIndex,
    })),
    settings: { botDifficulty: "easy", enableSecondBidding: true },
    snapshot: { phase: "lobby" },
  };
}

describe("PostgresRoomStore creation errors", () => {
  it("classifies an invalid seat count as corrupt room data", async () => {
    const store = new PostgresRoomStore({} as Database);

    await expect(
      store.createRoom({ ...roomInput(), seats: [] }),
    ).rejects.toMatchObject({
      code: "ROOM_DATA_INVALID",
      kind: "internal",
      name: "RoomApplicationError",
    });
  });

  it("classifies a missing locked session as unauthorized", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const database = {
      transaction: async <Result>(
        work: (transaction: { query: typeof query }) => Promise<Result>,
      ): Promise<Result> => work({ query }),
    } as unknown as Database;
    const store = new PostgresRoomStore(database);

    await expect(
      store.createRoom({ ...roomInput(), sessionId: "session-1" }),
    ).rejects.toMatchObject({
      code: "SESSION_REQUIRED",
      kind: "unauthorized",
      name: "RoomApplicationError",
    });
  });
});
