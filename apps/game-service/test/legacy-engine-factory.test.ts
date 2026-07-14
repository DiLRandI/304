import { describe, expect, it } from "vitest";
import {
  createLobbyEngine,
  createStartedEngine,
  seatCountForProfile,
} from "../src/contexts/gameplay/adapters/engine/legacy-engine-factory.js";

const settings = {
  botDifficulty: "normal" as const,
  enableSecondBidding: true,
};
const seats = [
  {
    botDifficulty: null,
    connectionStatus: "online" as const,
    displayName: "Host",
    occupantType: "human" as const,
    playerId: "host-player",
    seatIndex: 0,
  },
  {
    botDifficulty: "normal",
    connectionStatus: "online" as const,
    displayName: "Bot",
    occupantType: "bot" as const,
    playerId: null,
    seatIndex: 1,
  },
  {
    botDifficulty: null,
    connectionStatus: "disconnected" as const,
    displayName: null,
    occupantType: "empty" as const,
    playerId: null,
    seatIndex: 2,
  },
  {
    botDifficulty: null,
    connectionStatus: "disconnected" as const,
    displayName: null,
    occupantType: "empty" as const,
    playerId: null,
    seatIndex: 3,
  },
];

describe("legacy engine factory", () => {
  it("maps rule profiles to their seat counts", () => {
    expect(seatCountForProfile("classic_304_4p")).toBe(4);
    expect(seatCountForProfile("six_304_36")).toBe(6);
  });

  it("creates a lobby engine from room-facing inputs", () => {
    const engine = createLobbyEngine(
      { displayName: "Host" },
      seats,
      "classic_304_4p",
      settings,
    );

    expect(engine.state.phase).toBe("setup");
    expect(engine.state.humanCount).toBe(1);
    expect(engine.state.seats).toHaveLength(4);
  });

  it("creates and starts an engine for a persisted room", () => {
    const engine = createStartedEngine(
      {
        hostPlayerId: "host-player",
        ruleProfileId: "classic_304_4p",
        settings,
      },
      seats,
    );

    expect(engine.state.phase).not.toBe("setup");
    expect(engine.state.seats[0]?.userId).toBe("host-player");
  });
});
