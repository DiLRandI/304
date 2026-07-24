import {
  createLobby,
  eventVersion,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
  startRoom,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import {
  presentLobbyRoom,
  RoomProjectionPresentationError,
} from "../src/contexts/rooms/adapters/delivery/room-projection-presenter.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");

function lobby() {
  return createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: {
      botDifficulty: "normal",
      enableSecondBidding: true,
      endHandWhenOutcomeCertain: true,
    },
  });
}

describe("room projection presenter", () => {
  it("maps a privacy-safe domain lobby to the existing wire contract", () => {
    expect(presentLobbyRoom(projectRoom(lobby(), hostId))).toEqual({
      eventVersion: 1,
      inviteCode: "304-AbCdEfGhIjKl_123",
      roomId: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
      status: "lobby",
      view: {
        isHost: true,
        lobby: {
          endHandWhenOutcomeCertain: true,
          ruleProfileId: "classic_304_4p",
          seats: [
            {
              botDifficulty: null,
              displayName: "Asha",
              occupantType: "human",
              seatIndex: 0,
            },
            ...[1, 2, 3].map((seatIndex) => ({
              botDifficulty: null,
              displayName: null,
              occupantType: "empty",
              seatIndex,
            })),
          ],
        },
      },
      viewerSeatIndex: 0,
    });
  });

  it("rejects an active-room projection that lacks private gameplay state", () => {
    const result = startRoom(lobby(), hostId);
    if (!result.ok) throw new Error("Expected room start to succeed");

    expect(() =>
      presentLobbyRoom(projectRoom(result.room, hostId)),
    ).toThrowError(
      new RoomProjectionPresentationError(
        "ACTIVE_ROOM_REQUIRES_GAMEPLAY",
        "Active rooms require a gameplay projection",
      ),
    );
  });

  it("preserves a non-seated lobby viewer without inventing a seat", () => {
    const visitor = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");
    const projection = projectRoom(lobby(), visitor);

    expect(presentLobbyRoom(projection)).toMatchObject({
      eventVersion: eventVersion(1),
      viewerSeatIndex: null,
      view: { isHost: false },
    });
  });
});
