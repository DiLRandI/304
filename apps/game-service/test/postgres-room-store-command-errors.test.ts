import { describe, expect, it, vi } from "vitest";
import {
  PostgresRoomStore,
  type Queryable,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

describe("PostgresRoomStore command errors", () => {
  it("persists an explicitly versioned gameplay snapshot", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return text.startsWith("UPDATE rooms")
        ? { rows: [{ event_version: 3 }] }
        : { rows: [] };
    });
    const transaction = { query } as unknown as Queryable;
    const store = new PostgresRoomStore({} as Database);

    await store.appendEventAndSnapshot(transaction, {
      actorPlayerId: "player-1",
      commandId: "command-1",
      eventType: "GAME_ACTION",
      expectedVersion: 2,
      payload: {},
      roomId: "room-1",
      ruleProfileId: "classic_304_4p",
      snapshot: { phase: "four-bidding" },
      snapshotSchemaVersion: 2,
      status: "in_hand",
    });

    expect(
      calls.find((call) => call.text.startsWith("INSERT INTO game_snapshots"))
        ?.values,
    ).toEqual([
      "room-1",
      3,
      2,
      "classic_304_4p",
      JSON.stringify({ phase: "four-bidding" }),
    ]);
  });

  it("classifies command id reuse by another actor as a conflict", async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [
          {
            actor_player_id: "player-2",
            event_type: "GAME_ACTION",
            event_version: 2,
            response: {},
          },
        ],
      })),
    } as unknown as Database;
    const store = new PostgresRoomStore(database);

    await expect(
      store.findDuplicate("room-1", "command-1", "player-1"),
    ).rejects.toMatchObject({
      code: "COMMAND_ID_CONFLICT",
      kind: "conflict",
      name: "RoomApplicationError",
    });
  });

  it("classifies an optimistic update miss as a version conflict", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const transaction = { query } as unknown as Queryable;
    const store = new PostgresRoomStore({} as Database);

    await expect(
      store.appendEventAndSnapshot(transaction, {
        actorPlayerId: "player-1",
        commandId: "command-1",
        eventType: "GAME_ACTION",
        expectedVersion: 2,
        payload: {},
        roomId: "room-1",
        ruleProfileId: "classic_304_4p",
        snapshot: {},
        status: "in_hand",
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      kind: "conflict",
      name: "RoomApplicationError",
    });
    expect(query).toHaveBeenCalledOnce();
  });
});
