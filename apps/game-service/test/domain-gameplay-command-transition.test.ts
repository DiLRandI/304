import type { GameAction } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import { transitionGameplayCommand } from "../src/contexts/gameplay/adapters/integration/domain-gameplay-command-transition.js";
import {
  decodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";

function startedSnapshot(): LegacyGameplaySnapshotRecord {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  return {
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: engine.getSnapshot(),
  };
}

describe("transitionGameplayCommand", () => {
  it("applies a wire action through the Gameplay aggregate", () => {
    const source = startedSnapshot();
    const before = decodeGameplayHand(source);
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }

    const result = transitionGameplayCommand(
      source,
      { amount: 160, type: "BID" },
      before.activeSeat,
    );

    expect(result.command).toEqual({
      actor: before.activeSeat,
      amount: 160,
      type: "BID",
    });
    expect(result.hand.bidding.currentBid).toBe(160);
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(decodeGameplayHand(source)).toEqual(before);
  });

  it("reports a rejected domain decision as an application conflict", () => {
    const source = startedSnapshot();
    const before = decodeGameplayHand(source);
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }
    const inactiveSeat = (before.activeSeat + 1) % before.profile.seatCount;

    expect(() =>
      transitionGameplayCommand(source, { type: "PASS_BID" }, inactiveSeat),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });

  it("rejects a malformed wire value before applying the aggregate", () => {
    const source = startedSnapshot();

    expect(() =>
      transitionGameplayCommand(
        source,
        { cardId: "not-a-card", type: "SELECT_TRUMP" } as GameAction,
        0,
      ),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });
});
