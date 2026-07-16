import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import { presentDomainGameplayForAutomation } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-presenter.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

describe("presentDomainGameplayForAutomation", () => {
  it("maps domain phases, turns, and room-owned seat state", () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const hand = decodeGameplayHand({
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    });

    expect(
      presentDomainGameplayForAutomation(
        hand,
        Array.from({ length: 4 }, (_, seatIndex) => ({
          connectionStatus:
            seatIndex === hand.activeSeat ? ("autopilot" as const) : undefined,
          occupantType:
            seatIndex === hand.activeSeat
              ? ("human" as const)
              : ("bot" as const),
          seatIndex,
        })),
      ),
    ).toEqual({
      state: {
        activeSeat: hand.activeSeat,
        currentTrick: null,
        phase: "four_bidding",
        seats: Array.from({ length: 4 }, (_, seatIndex) => ({
          autopilot: seatIndex === hand.activeSeat,
          ...(seatIndex === hand.activeSeat
            ? { connectionStatus: "autopilot" }
            : {}),
          type: seatIndex === hand.activeSeat ? "human" : "bot",
        })),
      },
    });
  });
});
