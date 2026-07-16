import { describe, expect, it, vi } from "vitest";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

describe("PostgresRoomStore decoding", () => {
  it("raises a Rooms application error for corrupt persisted room data", async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [
          {
            event_version: 1,
            host_player_id: "player-1",
            id: "room-1",
            invite_code: "304-room",
            recovery_error: null,
            rule_profile_id: "classic_304_4p",
            settings: {
              botDifficulty: "easy",
              enableSecondBidding: true,
            },
            status: "corrupt",
            updated_at: new Date(0),
          },
        ],
      })),
    } as unknown as Database;
    const store = new PostgresRoomStore(database);

    await expect(store.loadRoom("room-1")).rejects.toMatchObject({
      code: "ROOM_DATA_INVALID",
      kind: "internal",
      message: "Invalid room status",
      name: "RoomApplicationError",
    });
  });
});
