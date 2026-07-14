import { describe, expect, it } from "vitest";
import {
  applyConnectionState,
  applyLobbySeat,
  isBotDifficulty,
  toEngineSeat,
} from "../src/contexts/gameplay/adapters/engine/legacy-engine-seat-mapper.js";

describe("legacy engine seat mapper", () => {
  it("maps persisted seat details and connection defaults", () => {
    expect(
      toEngineSeat({
        botDifficulty: "strong",
        connectionStatus: "autopilot",
        displayName: "Guest",
        occupantType: "human",
        playerId: "guest-player",
        seatIndex: 2,
      }),
    ).toEqual({
      autopilot: true,
      connectionStatus: "autopilot",
      difficulty: "strong",
      displayName: "Guest",
      index: 2,
      type: "human",
      userId: "guest-player",
    });
    expect(
      toEngineSeat({
        botDifficulty: null,
        displayName: null,
        occupantType: "bot",
        playerId: null,
        seatIndex: 1,
      }).connectionStatus,
    ).toBe("online");
  });

  it("applies a lobby seat and recalculates the human count", () => {
    const engine = {
      state: {
        humanCount: 0,
        seats: [
          { index: 0, type: "empty" },
          { index: 1, type: "bot" },
        ],
      },
    };

    applyLobbySeat(engine as never, {
      botDifficulty: null,
      connectionStatus: "online",
      displayName: "Host",
      occupantType: "human",
      playerId: "host-player",
      seatIndex: 0,
    });

    expect(engine.state.humanCount).toBe(1);
    expect(engine.state.seats[0]).toMatchObject({
      autopilot: false,
      connectionStatus: "online",
      displayName: "Host",
      type: "human",
      userId: "host-player",
    });
  });

  it("applies connection state and rejects a missing seat", () => {
    const engine = {
      state: { seats: [{ index: 0, type: "human" }] },
    };

    applyConnectionState(engine as never, 0, "autopilot");
    expect(engine.state.seats[0]).toMatchObject({
      autopilot: true,
      connectionStatus: "autopilot",
    });
    expect(() => applyConnectionState(engine as never, 3, "online")).toThrow(
      "Room recovery failed",
    );
  });

  it("recognizes supported bot difficulties", () => {
    expect(["easy", "normal", "strong"].every(isBotDifficulty)).toBe(true);
    expect(isBotDifficulty("expert")).toBe(false);
  });
});
