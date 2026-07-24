import type { GameplayCommand } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { transitionAutomatedGameplayCommand } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-transition.js";
import { hydrateGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { pausedTrickGameplayHand } from "./support/gameplay-hand-fixture.js";

describe("transitionAutomatedGameplayCommand", () => {
  it("persists an automation transition as schema v2", () => {
    const before = pausedTrickGameplayHand();
    const command: GameplayCommand = { actor: null, type: "ADVANCE_TRICK" };

    const result = transitionAutomatedGameplayCommand(before, command);

    expect(result.snapshot.schemaVersion).toBe(3);
    expect(hydrateGameplaySnapshot(result.snapshot)).toEqual(result.hand);
    expect(before.phase).toBe("trick-result");
  });

  it("advances a completed trick through the Gameplay aggregate", () => {
    const before = pausedTrickGameplayHand();
    const command: GameplayCommand = { actor: null, type: "ADVANCE_TRICK" };

    const result = transitionAutomatedGameplayCommand(before, command);

    expect(result.hand.phase).toBe("trick-play");
    expect(result.hand.activeSeat).toBe(before.currentTrick?.winnerSeat);
    expect(hydrateGameplaySnapshot(result.snapshot)).toEqual(result.hand);
    expect(before.phase).toBe("trick-result");
  });

  it("reports a rejected domain decision as an automation error", () => {
    const before = pausedTrickGameplayHand();
    const command: GameplayCommand = { actor: null, type: "ACK_RESULT" };

    expect(() => transitionAutomatedGameplayCommand(before, command)).toThrow(
      expect.objectContaining({ code: "AUTOMATION_ACTION_REJECTED" }),
    );
  });
});
