import { describe, expect, it } from "vitest";
import {
  createLobby,
  inviteCode,
  joinLobby,
  playerId,
  projectRoom,
  roomId,
  startRoom,
} from "../src/index.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");

function joinedRoom() {
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

describe("room projection", () => {
  it("identifies the viewer and host without exposing player ids", () => {
    const projection = projectRoom(joinedRoom(), guestId);

    expect(projection.viewerSeatPosition).toBe(1);
    expect(projection.seats[0]).toEqual({
      connectionStatus: "online",
      displayName: "Asha",
      isHost: true,
      isViewer: false,
      occupantType: "human",
      position: 0,
    });
    expect(projection.seats[1]).toMatchObject({
      displayName: "Bimal",
      isHost: false,
      isViewer: true,
      occupantType: "human",
    });
    expect(JSON.stringify(projection)).not.toContain(hostId);
    expect(JSON.stringify(projection)).not.toContain(guestId);
  });

  it("projects empty and bot seats without internal membership data", () => {
    const lobby = projectRoom(joinedRoom(), hostId);
    expect(lobby.seats[2]).toMatchObject({
      displayName: null,
      occupantType: "empty",
    });

    const started = startRoom(joinedRoom(), hostId);
    if (!started.ok) throw new Error("Expected start");
    const active = projectRoom(started.room, hostId);
    expect(active.seats[2]).toMatchObject({
      botDifficulty: "easy",
      displayName: "Bot 3",
      occupantType: "bot",
    });
  });

  it("returns a null viewer position for a player who is not seated", () => {
    const stranger = playerId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
    expect(projectRoom(joinedRoom(), stranger).viewerSeatPosition).toBeNull();
  });
});
