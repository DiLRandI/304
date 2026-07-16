import { describe, expect, it } from "vitest";
import { readLobbyRoomView } from "../src/features/room/model/lobby-view.js";
import { activeProjection, lobbyProjection } from "./browser-fixtures.js";

describe("lobby room view", () => {
  it("reads the server-owned lobby projection", () => {
    const view = readLobbyRoomView(lobbyProjection());

    expect(view).toMatchObject({
      isHost: true,
      kind: "lobby",
      lobby: {
        ruleProfileId: "classic_304_4p",
      },
    });
    expect(view?.lobby.seats).toHaveLength(4);
    expect(view?.lobby.seats[0]).toMatchObject({
      displayName: "Asha",
      occupantType: "human",
      seatIndex: 0,
    });
  });

  it("rejects active and malformed lobby projections", () => {
    expect(readLobbyRoomView(activeProjection())).toBeNull();

    const malformed = lobbyProjection();
    malformed.view = {
      isHost: true,
      lobby: {
        ruleProfileId: "classic_304_4p",
        seats: [{ occupantType: "admin", seatIndex: 0 }],
      },
    };
    expect(readLobbyRoomView(malformed)).toBeNull();
  });
});
