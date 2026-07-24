import { describe, expect, it } from "vitest";
import {
  createLobby,
  eventVersion,
  inviteCode,
  joinLobby,
  playerId,
  type Room,
  roomId,
} from "../src/index.js";

const ids = [
  "9c9c7530-224f-4d5e-b354-1c78df2f063b",
  "28fc47b6-e8ef-4de7-8c43-7e027a41d70f",
  "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
  "13659867-c24f-43b8-8211-888011a09ac6",
  "0a4bd4d5-365f-4dc4-ab3f-87c3e2929c49",
] as const;

function lobby(
  profile: "classic_304_4p" | "six_304_36" = "classic_304_4p",
): Room {
  return createLobby({
    host: {
      displayName: "Asha",
      playerId: playerId(ids[0]),
    },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: profile,
    settings: {
      botDifficulty: "easy",
      enableSecondBidding: true,
      endHandWhenOutcomeCertain: true,
    },
  });
}

describe("room lobby aggregate", () => {
  it.each([
    ["classic_304_4p", 4],
    ["six_304_36", 6],
  ] as const)("creates a %s lobby with the host in seat zero", (profileId, seatCount) => {
    const room = lobby(profileId);

    expect(room.status).toBe("lobby");
    expect(room.eventVersion).toBe(1);
    expect(room.seats).toHaveLength(seatCount);
    expect(room.seats[0]).toMatchObject({
      connectionStatus: "online",
      occupant: { displayName: "Asha", kind: "human", playerId: ids[0] },
      position: 0,
    });
    expect(
      room.seats.slice(1).every((seat) => seat.occupant.kind === "empty"),
    ).toBe(true);
  });

  it("assigns joining players to the lowest empty seat", () => {
    const result = joinLobby(lobby(), {
      displayName: "Bimal",
      playerId: playerId(ids[1]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.joined).toBe(true);
    expect(result.position).toBe(1);
    expect(result.room.eventVersion).toBe(2);
    expect(result.room.seats[1]?.occupant).toMatchObject({
      displayName: "Bimal",
      kind: "human",
      playerId: ids[1],
    });
  });

  it("returns the existing seat without changing the room", () => {
    const room = lobby();
    const result = joinLobby(room, {
      displayName: "Asha",
      playerId: playerId(ids[0]),
    });

    expect(result).toEqual({ joined: false, ok: true, position: 0, room });
  });

  it("rejects joins after the room leaves the lobby", () => {
    const room = { ...lobby(), status: "in_hand" as const };
    expect(
      joinLobby(room, { displayName: "Bimal", playerId: playerId(ids[1]) }),
    ).toEqual({
      error: {
        code: "ROOM_NOT_JOINABLE",
        message: "Room is not accepting joins",
      },
      ok: false,
    });
  });

  it("rejects a join when every seat is occupied", () => {
    let room = lobby();
    for (const id of ids.slice(1, 4)) {
      const result = joinLobby(room, {
        displayName: "Guest",
        playerId: playerId(id),
      });
      expect(result.ok).toBe(true);
      if (result.ok) room = result.room;
    }
    expect(room.eventVersion).toBe(eventVersion(4));
    expect(
      joinLobby(room, { displayName: "Extra", playerId: playerId(ids[4]) }),
    ).toEqual({
      error: { code: "ROOM_FULL", message: "Room has no available seats" },
      ok: false,
    });
  });
});
