import { describe, expect, it } from "vitest";
import {
  createLobby,
  eventVersion,
  executeRoomCommand,
  inviteCode,
  playerId,
  type Room,
  roomId,
} from "../src/index.js";

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

describe("room commands and events", () => {
  it("emits a versioned player-joined event", () => {
    const result = executeRoomCommand(lobby(), {
      actor: { displayName: "Bimal", playerId: guestId },
      expectedVersion: eventVersion(1),
      type: "JOIN_ROOM",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      {
        displayName: "Bimal",
        playerId: guestId,
        position: 1,
        type: "PLAYER_JOINED",
        version: 2,
      },
    ]);
    expect(result.room.eventVersion).toBe(2);
  });

  it("rejects a stale command before evaluating room rules", () => {
    expect(
      executeRoomCommand(lobby(), {
        actor: hostId,
        expectedVersion: eventVersion(0),
        type: "START_ROOM",
      }),
    ).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "Room state changed; refresh and retry",
      },
      ok: false,
    });
  });

  it("emits room-started with the bot-filled positions", () => {
    const result = executeRoomCommand(lobby(), {
      actor: hostId,
      expectedVersion: eventVersion(1),
      type: "START_ROOM",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      { botPositions: [1, 2, 3], type: "ROOM_STARTED", version: 2 },
    ]);
  });

  it("names disconnect, autopilot, and reconnect transitions explicitly", () => {
    const joined = executeRoomCommand(lobby(), {
      actor: { displayName: "Bimal", playerId: guestId },
      expectedVersion: eventVersion(1),
      type: "JOIN_ROOM",
    });
    if (!joined.ok) throw new Error("Expected join");
    const started = executeRoomCommand(joined.room, {
      actor: hostId,
      expectedVersion: eventVersion(2),
      type: "START_ROOM",
    });
    if (!started.ok) throw new Error("Expected start");
    const disconnected = executeRoomCommand(started.room, {
      actor: guestId,
      connectionStatus: "disconnected",
      expectedVersion: eventVersion(3),
      type: "SET_CONNECTION",
    });
    if (!disconnected.ok) throw new Error("Expected disconnect");
    expect(disconnected.events[0]?.type).toBe("PLAYER_DISCONNECTED");

    const autopilot = executeRoomCommand(disconnected.room, {
      actor: guestId,
      connectionStatus: "autopilot",
      expectedVersion: eventVersion(4),
      type: "SET_CONNECTION",
    });
    if (!autopilot.ok) throw new Error("Expected autopilot");
    expect(autopilot.events[0]?.type).toBe("AUTOPILOT_ENABLED");

    const online = executeRoomCommand(autopilot.room, {
      actor: guestId,
      connectionStatus: "online",
      expectedVersion: eventVersion(5),
      type: "SET_CONNECTION",
    });
    if (!online.ok) throw new Error("Expected reconnect");
    expect(online.events[0]?.type).toBe("AUTOPILOT_CANCELLED");
  });

  it("emits room-closed when the last human leaves", () => {
    const result = executeRoomCommand(lobby(), {
      actor: hostId,
      expectedVersion: eventVersion(1),
      type: "LEAVE_ROOM",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      { playerId: hostId, position: 0, type: "ROOM_CLOSED", version: 2 },
    ]);
  });
});
