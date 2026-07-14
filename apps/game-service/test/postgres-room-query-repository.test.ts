import { commandId, playerId, roomId } from "@three-zero-four/room-domain";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import {
  PostgresRoomQueryRepository,
  RoomQueryRepositoryError,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-query-repository.js";
import type { Database } from "../src/infra/database.js";

const hostId = "9c9c7530-224f-4d5e-b354-1c78df2f063b";
const guestId = "28fc47b6-e8ef-4de7-8c43-7e027a41d70f";
const persistedRoom = {
  event_version: "2",
  host_player_id: hostId,
  id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
  invite_code: "304-AbCdEfGhIjKl_123",
  rule_profile_id: "classic_304_4p",
  settings: { botDifficulty: "normal", enableSecondBidding: true },
  status: "lobby",
};
const persistedSeats = [
  {
    bot_difficulty: null,
    connection_status: "online",
    display_name: "Asha",
    occupant_type: "human",
    player_id: hostId,
    seat_index: 0,
  },
  ...[1, 2, 3].map((seat_index) => ({
    bot_difficulty: null,
    connection_status: "disconnected",
    display_name: null,
    occupant_type: "empty",
    player_id: null,
    seat_index,
  })),
];
const persistedRoomRows = persistedSeats.map((seat) => ({
  ...persistedRoom,
  ...seat,
}));
const projection = {
  eventVersion: 2,
  id: persistedRoom.id,
  inviteCode: persistedRoom.invite_code,
  profileId: "classic_304_4p",
  seats: persistedSeats.map((seat) => ({
    connectionStatus: seat.connection_status,
    displayName: seat.display_name,
    isHost: seat.seat_index === 0,
    isViewer: seat.seat_index === 0,
    occupantType: seat.occupant_type,
    position: seat.seat_index,
  })),
  settings: persistedRoom.settings,
  status: "lobby",
  viewerSeatPosition: 0,
};
const request = {
  actor: hostId,
  expectedVersion: 2,
  type: "START_ROOM",
} as const;

class QueryQueue implements Pick<Database, "query"> {
  readonly calls: { text: string; values: readonly unknown[] }[] = [];

  constructor(private readonly rows: QueryResultRow[][]) {}

  async query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    return { rows: (this.rows.shift() ?? []) as Row[] };
  }
}

describe("PostgresRoomQueryRepository", () => {
  it("reconstructs a room aggregate from normalized room and seat records", async () => {
    const database = new QueryQueue([persistedRoomRows]);
    const repository = new PostgresRoomQueryRepository(database);

    const room = await repository.findByReference("304-AbCdEfGhIjKl_123");

    expect(room).toMatchObject({
      eventVersion: 2,
      hostPlayerId: hostId,
      id: persistedRoom.id,
      status: "lobby",
    });
    expect(database.calls[0]).toMatchObject({
      values: ["304-AbCdEfGhIjKl_123", null],
    });
    expect(database.calls[0]?.text).toContain("rooms.id = $2");
    expect(database.calls).toHaveLength(1);
  });

  it("returns the exact validated projection stored for a duplicate command", async () => {
    const database = new QueryQueue([
      [{ actor_player_id: hostId, request, response: projection }],
    ]);
    const repository = new PostgresRoomQueryRepository(database);

    await expect(
      repository.findDuplicate(
        roomId(persistedRoom.id),
        commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f"),
        playerId(hostId),
        request,
      ),
    ).resolves.toEqual(projection);
  });

  it("rejects reuse of a command id by another player", async () => {
    const repository = new PostgresRoomQueryRepository(
      new QueryQueue([
        [{ actor_player_id: hostId, request, response: projection }],
      ]),
    );

    await expect(
      repository.findDuplicate(
        roomId(persistedRoom.id),
        commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f"),
        playerId(guestId),
        request,
      ),
    ).rejects.toEqual(
      new RoomQueryRepositoryError(
        "COMMAND_ID_CONFLICT",
        "Command id belongs to another player",
      ),
    );
  });

  it("rejects reuse of a command id for another command", async () => {
    const repository = new PostgresRoomQueryRepository(
      new QueryQueue([
        [{ actor_player_id: hostId, request, response: projection }],
      ]),
    );

    await expect(
      repository.findDuplicate(
        roomId(persistedRoom.id),
        commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f"),
        playerId(hostId),
        { ...request, type: "LEAVE_ROOM" },
      ),
    ).rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
  });

  it("rejects an invalid persisted duplicate response", async () => {
    const repository = new PostgresRoomQueryRepository(
      new QueryQueue([
        [
          {
            actor_player_id: hostId,
            request,
            response: { ...projection, seats: [] },
          },
        ],
      ]),
    );

    await expect(
      repository.findDuplicate(
        roomId(persistedRoom.id),
        commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f"),
        playerId(hostId),
        request,
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND_RESPONSE" });
  });
});
