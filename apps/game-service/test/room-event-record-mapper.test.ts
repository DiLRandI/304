import {
  createLobby,
  eventVersion,
  executeRoomCommand,
  inviteCode,
  joinLobby,
  playerId,
  type Room,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import {
  mapRoomEventForPersistence,
  RoomEventPersistenceMappingError,
} from "../src/contexts/rooms/adapters/persistence/room-event-record-mapper.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");

function lobby(): Room {
  return createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: { botDifficulty: "normal", enableSecondBidding: true },
  });
}

function accepted(
  room: Room,
  command: Parameters<typeof executeRoomCommand>[1],
) {
  const result = executeRoomCommand(room, command);
  if (!result.ok || !result.events[0]) {
    throw new Error("Expected an accepted event-producing command");
  }
  return { event: result.events[0], room: result.room };
}

describe("room event persistence mapper", () => {
  it("keeps joined-player events compatible with legacy recovery", () => {
    const result = accepted(lobby(), {
      actor: { displayName: "Bimal", playerId: guestId },
      expectedVersion: eventVersion(1),
      type: "JOIN_ROOM",
    });

    expect(mapRoomEventForPersistence(result.event, result.room)).toEqual({
      eventType: "PLAYER_JOINED",
      payload: { displayName: "Bimal", seatIndex: 1 },
    });
  });

  it("derives leave replacement and host transfer from the resulting room", () => {
    const joined = joinLobby(lobby(), {
      displayName: "Bimal",
      playerId: guestId,
    });
    if (!joined.ok) throw new Error("Expected guest join to succeed");
    const result = accepted(joined.room, {
      actor: hostId,
      expectedVersion: joined.room.eventVersion,
      type: "LEAVE_ROOM",
    });

    expect(mapRoomEventForPersistence(result.event, result.room)).toEqual({
      eventType: "PLAYER_LEFT",
      payload: {
        botDifficulty: null,
        hostPlayerId: guestId,
        reason: null,
        replacement: "empty",
        seatIndex: 0,
      },
    });
  });

  it("records a bot replacement after a hand", () => {
    const joined = joinLobby(lobby(), {
      displayName: "Bimal",
      playerId: guestId,
    });
    if (!joined.ok) throw new Error("Expected guest join to succeed");
    const handResult: Room = { ...joined.room, status: "hand_result" };
    const result = accepted(handResult, {
      actor: guestId,
      expectedVersion: handResult.eventVersion,
      type: "LEAVE_ROOM",
    });

    expect(
      mapRoomEventForPersistence(result.event, result.room).payload,
    ).toEqual({
      botDifficulty: "normal",
      hostPlayerId: hostId,
      reason: null,
      replacement: "bot",
      seatIndex: 1,
    });
  });

  it("maps connection changes to the legacy seat-index payload", () => {
    const active: Room = { ...lobby(), status: "in_hand" };
    const result = accepted(active, {
      actor: hostId,
      connectionStatus: "autopilot",
      expectedVersion: active.eventVersion,
      type: "SET_CONNECTION",
    });

    expect(mapRoomEventForPersistence(result.event, result.room)).toEqual({
      eventType: "AUTOPILOT_ENABLED",
      payload: { seatIndex: 0 },
    });
  });

  it("requires gameplay state before a room-start event can be persisted", () => {
    const result = accepted(lobby(), {
      actor: hostId,
      expectedVersion: eventVersion(1),
      type: "START_ROOM",
    });

    expect(() =>
      mapRoomEventForPersistence(result.event, result.room),
    ).toThrowError(
      new RoomEventPersistenceMappingError(
        "GAMEPLAY_STATE_REQUIRED",
        "Room start requires an atomic gameplay snapshot",
      ),
    );
  });
});
