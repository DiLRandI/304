import { describe, expect, it } from "vitest";
import {
  mapPersistedRoom,
  mapRoomSeatsForPersistence,
  type PersistedRoomRecord,
  type PersistedSeatRecord,
  RoomPersistenceMappingError,
} from "../src/contexts/rooms/adapters/persistence/room-record-mapper.js";

const room: PersistedRoomRecord = {
  eventVersion: 2,
  hostPlayerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
  id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
  inviteCode: "304-AbCdEfGhIjKl_123",
  profileId: "classic_304_4p",
  settings: { botDifficulty: "normal", enableSecondBidding: true },
  status: "lobby",
};

const seats: PersistedSeatRecord[] = [
  {
    botDifficulty: null,
    connectionStatus: "online",
    displayName: "Asha",
    occupantType: "human",
    playerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
    position: 0,
  },
  {
    botDifficulty: "normal",
    connectionStatus: "online",
    displayName: null,
    occupantType: "bot",
    playerId: null,
    position: 1,
  },
  ...[2, 3].map(
    (position): PersistedSeatRecord => ({
      botDifficulty: null,
      connectionStatus: "disconnected",
      displayName: null,
      occupantType: "empty",
      playerId: null,
      position,
    }),
  ),
];

describe("room persistence record mapper", () => {
  it("maps database-shaped records into the pure room aggregate", () => {
    const mapped = mapPersistedRoom(room, seats);

    expect(mapped).toMatchObject({
      eventVersion: 2,
      hostPlayerId: room.hostPlayerId,
      id: room.id,
      profileId: "classic_304_4p",
      status: "lobby",
    });
    expect(mapped.seats[0]?.occupant).toEqual({
      displayName: "Asha",
      kind: "human",
      playerId: room.hostPlayerId,
    });
    expect(mapped.seats[1]?.occupant).toEqual({
      difficulty: "normal",
      displayName: "Bot 2",
      kind: "bot",
    });
  });

  it("maps the domain seats back to persistence fields", () => {
    expect(mapRoomSeatsForPersistence(mapPersistedRoom(room, seats))).toEqual([
      seats[0],
      { ...seats[1], displayName: "Bot 2" },
      seats[2],
      seats[3],
    ]);
  });

  it("keeps persisted early settlement settings and disables it for legacy records", () => {
    expect(
      mapPersistedRoom(
        {
          ...room,
          settings: {
            botDifficulty: "normal",
            enableSecondBidding: true,
            endHandWhenOutcomeCertain: true,
          },
        },
        seats,
      ).settings,
    ).toMatchObject({ endHandWhenOutcomeCertain: true });
    expect(mapPersistedRoom(room, seats).settings).toMatchObject({
      endHandWhenOutcomeCertain: false,
    });
  });

  it("rejects a human seat without complete identity data", () => {
    expect(() =>
      mapPersistedRoom(room, [
        { ...seats[0], displayName: null },
        ...seats.slice(1),
      ]),
    ).toThrowError(
      new RoomPersistenceMappingError(
        "INVALID_ROOM_SEAT",
        "Human seat identity is incomplete",
      ),
    );
  });

  it("rejects a seat count that does not match the profile", () => {
    expect(() => mapPersistedRoom(room, seats.slice(0, 3))).toThrowError(
      "Room seat count does not match its profile",
    );
  });
});
