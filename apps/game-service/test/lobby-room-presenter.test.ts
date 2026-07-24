import { describe, expect, it } from "vitest";
import { projectLobbyForViewer } from "../src/contexts/rooms/adapters/delivery/lobby-room-presenter.js";

const room = {
  eventVersion: 3,
  hostPlayerId: "host-player",
  id: "room-1",
  inviteCode: "304-room",
  ruleProfileId: "classic_304_4p" as const,
  settings: { endHandWhenOutcomeCertain: true },
  status: "lobby" as const,
};
const seats = [
  {
    botDifficulty: null,
    displayName: "Host",
    occupantType: "human" as const,
    playerId: "host-player",
    seatIndex: 0,
  },
  {
    botDifficulty: "normal",
    displayName: null,
    occupantType: "bot" as const,
    playerId: null,
    seatIndex: 1,
  },
];

describe("projectLobbyForViewer", () => {
  it("marks a seated host and presents public seat details", () => {
    const projection = projectLobbyForViewer(room, seats, 0);

    expect(projection.view).toEqual({
      isHost: true,
      lobby: {
        endHandWhenOutcomeCertain: true,
        ruleProfileId: "classic_304_4p",
        seats: [
          {
            botDifficulty: null,
            displayName: "Host",
            occupantType: "human",
            seatIndex: 0,
          },
          {
            botDifficulty: "normal",
            displayName: null,
            occupantType: "bot",
            seatIndex: 1,
          },
        ],
      },
    });
  });

  it("does not grant host privileges to an unseated viewer", () => {
    expect(projectLobbyForViewer(room, seats, null).view.isHost).toBe(false);
  });

  it("rejects an unavailable room", () => {
    expect(() =>
      projectLobbyForViewer({ ...room, status: "closed" }, seats, 0),
    ).toThrow(
      expect.objectContaining({
        code: "ROOM_UNAVAILABLE",
        kind: "unavailable",
      }),
    );
  });
});
