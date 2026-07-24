import { describe, expect, it } from "vitest";
import {
  createLobby,
  inviteCode,
  joinLobby,
  leaveRoom,
  playerId,
  type Room,
  roomId,
  startRoom,
} from "../src/index.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");

function lobby(): Room {
  return createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: {
      botDifficulty: "strong",
      enableSecondBidding: true,
      endHandWhenOutcomeCertain: true,
    },
  });
}

function withGuest(): Room {
  const joined = joinLobby(lobby(), {
    displayName: "Bimal",
    playerId: guestId,
  });
  if (!joined.ok) throw new Error("Expected guest join");
  return joined.room;
}

describe("room lifecycle rules", () => {
  it("allows only the host to start and fills empty seats with configured bots", () => {
    const rejected = startRoom(withGuest(), guestId);
    expect(rejected).toEqual({
      error: {
        code: "HOST_REQUIRED",
        message: "Only the host can start the room",
      },
      ok: false,
    });

    const started = startRoom(withGuest(), hostId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.status).toBe("in_hand");
    expect(started.room.eventVersion).toBe(3);
    expect(
      started.room.seats
        .slice(2)
        .every(
          (seat) =>
            seat.occupant.kind === "bot" &&
            seat.occupant.difficulty === "strong" &&
            seat.connectionStatus === "online",
        ),
    ).toBe(true);
  });

  it("rejects starting a room that has already started", () => {
    const started = startRoom(lobby(), hostId);
    if (!started.ok) throw new Error("Expected room start");
    expect(startRoom(started.room, hostId)).toEqual({
      error: {
        code: "ROOM_ALREADY_STARTED",
        message: "Room has already started",
      },
      ok: false,
    });
  });

  it("clears a guest seat when they leave the lobby", () => {
    const left = leaveRoom(withGuest(), guestId);
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.status).toBe("left");
    expect(left.room.eventVersion).toBe(3);
    expect(left.room.seats[1]).toMatchObject({
      connectionStatus: "disconnected",
      occupant: { kind: "empty" },
    });
    expect(left.room.hostPlayerId).toBe(hostId);
  });

  it("transfers host ownership to the lowest remaining human seat", () => {
    const left = leaveRoom(withGuest(), hostId);
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.status).toBe("left");
    expect(left.room.hostPlayerId).toBe(guestId);
    expect(left.room.status).toBe("lobby");
  });

  it("closes the room when its last human leaves", () => {
    const left = leaveRoom(lobby(), hostId);
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.status).toBe("closed");
    expect(left.room.status).toBe("closed");
  });

  it("requires a human seat to leave", () => {
    expect(leaveRoom(lobby(), guestId)).toEqual({
      error: {
        code: "SEAT_REQUIRED",
        message: "You are not seated in this room",
      },
      ok: false,
    });
  });
});
