import type { GameAction } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import type { GameplayCommand } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { transitionAutomatedGameplayCommand } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-transition.js";
import {
  decodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";

function pausedTrickSnapshot(): LegacyGameplaySnapshotRecord {
  const engine = new GameEngine({
    enableSecondBidding: false,
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();

  const apply = (action: GameAction): void => {
    const actor = engine.getSnapshot().activeSeat;
    if (actor === null) throw new Error("Expected an active gameplay seat");
    expect(
      engine.applyAction({
        ...action,
        actorSeatIndex: actor,
        seatIndex: actor,
      }),
    ).toEqual({ ok: true });
  };

  apply({ amount: 160, type: "BID" });
  while (engine.getSnapshot().phase === "four_bidding") {
    apply({ type: "PASS_BID" });
  }
  const maker = engine.getSnapshot().activeSeat;
  const indicator =
    maker === null
      ? undefined
      : engine
          .getLegalActions(maker)
          .find((candidate) => candidate.type === "SELECT_TRUMP");
  if (!indicator) throw new Error("Expected a trump indicator action");
  apply(indicator);
  apply({ type: "TRUMP_OPEN" });
  while (engine.getSnapshot().phase === "trick_play") {
    const actor = engine.getSnapshot().activeSeat;
    const action =
      actor === null
        ? undefined
        : engine
            .getLegalActions(actor)
            .find((candidate) => candidate.type === "PLAY_CARD");
    if (!action) throw new Error("Expected a legal card play");
    apply(action);
  }

  return {
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: engine.getSnapshot(),
  };
}

describe("transitionAutomatedGameplayCommand", () => {
  it("advances a completed trick through the Gameplay aggregate", () => {
    const source = pausedTrickSnapshot();
    const before = decodeGameplayHand(source);
    const command: GameplayCommand = { actor: null, type: "ADVANCE_TRICK" };

    const result = transitionAutomatedGameplayCommand(source, command);

    expect(result.hand.phase).toBe("trick-play");
    expect(result.hand.activeSeat).toBe(before.currentTrick?.winnerSeat);
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(decodeGameplayHand(source)).toEqual(before);
  });

  it("reports a rejected domain decision as an automation error", () => {
    const source = pausedTrickSnapshot();
    const command: GameplayCommand = { actor: null, type: "ACK_RESULT" };

    expect(() => transitionAutomatedGameplayCommand(source, command)).toThrow(
      expect.objectContaining({ code: "AUTOMATION_ACTION_REJECTED" }),
    );
  });
});
