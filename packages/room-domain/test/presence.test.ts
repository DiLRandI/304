import { describe, expect, it } from "vitest";
import {
  createLobby,
  inviteCode,
  joinLobby,
  playerId,
  type Room,
  roomId,
  setPlayerConnection,
  startRoom,
} from "../src/index.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");

function lobby(): Room {
  const room = createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: { botDifficulty: "easy", enableSecondBidding: true },
  });
  const joined = joinLobby(room, { displayName: "Bimal", playerId: guestId });
  if (!joined.ok) throw new Error("Expected guest join");
  return joined.room;
}

describe("room presence rules", () => {
  it("marks an online human disconnected and increments the room version", () => {
    const result = setPlayerConnection(lobby(), guestId, "disconnected");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.room.eventVersion).toBe(3);
    expect(result.room.seats[1]?.connectionStatus).toBe("disconnected");
  });

  it("does not create another transition when status is unchanged", () => {
    const disconnected = setPlayerConnection(lobby(), guestId, "disconnected");
    if (!disconnected.ok) throw new Error("Expected disconnect");
    const repeated = setPlayerConnection(
      disconnected.room,
      guestId,
      "disconnected",
    );

    expect(repeated).toEqual({
      changed: false,
      ok: true,
      room: disconnected.room,
    });
  });

  it("cancels autopilot when the human reconnects", () => {
    const started = startRoom(lobby(), hostId);
    if (!started.ok) throw new Error("Expected room start");
    const autopilot = setPlayerConnection(started.room, guestId, "autopilot");
    if (!autopilot.ok) throw new Error("Expected autopilot");
    const online = setPlayerConnection(autopilot.room, guestId, "online");

    expect(online.ok).toBe(true);
    if (!online.ok) return;
    expect(online.room.seats[1]?.connectionStatus).toBe("online");
  });

  it("allows autopilot only while a hand is active", () => {
    expect(setPlayerConnection(lobby(), guestId, "autopilot")).toEqual({
      error: {
        code: "AUTOPILOT_NOT_ALLOWED",
        message: "Autopilot requires an active room",
      },
      ok: false,
    });
  });

  it("requires the player to occupy a human seat", () => {
    const stranger = playerId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
    expect(setPlayerConnection(lobby(), stranger, "online")).toEqual({
      error: {
        code: "SEAT_REQUIRED",
        message: "You are not seated in this room",
      },
      ok: false,
    });
  });
});
