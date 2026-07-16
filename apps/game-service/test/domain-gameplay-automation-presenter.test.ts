import { describe, expect, it } from "vitest";
import { presentDomainGameplayForAutomation } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-presenter.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

describe("presentDomainGameplayForAutomation", () => {
  it("maps domain phases, turns, and room-owned seat state", () => {
    const hand = startedGameplayHand();

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
