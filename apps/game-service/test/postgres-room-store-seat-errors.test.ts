import { describe, expect, it, vi } from "vitest";
import {
  PostgresRoomStore,
  type Queryable,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

function emptyTransaction(): Queryable {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as Queryable;
}

describe("PostgresRoomStore seat errors", () => {
  it("classifies a missing open seat as a room conflict", async () => {
    const store = new PostgresRoomStore({} as Database);

    await expect(
      store.assignHumanSeat(emptyTransaction(), "room-1", "player-1"),
    ).rejects.toMatchObject({
      code: "ROOM_FULL",
      kind: "conflict",
      name: "RoomApplicationError",
    });
  });

  it("classifies a missing human seat as forbidden", async () => {
    const store = new PostgresRoomStore({} as Database);

    await expect(
      store.requireHumanSeat(emptyTransaction(), "room-1", "player-1"),
    ).rejects.toMatchObject({
      code: "SEAT_REQUIRED",
      kind: "forbidden",
      name: "RoomApplicationError",
    });
  });
});
