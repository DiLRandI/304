import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

function snapshot(profileId: "classic_304_4p" | "six_304_36"): {
  engine: GameEngine;
  record: LegacyGameplaySnapshotRecord;
} {
  const engine = new GameEngine({
    humanCount: profileId === "classic_304_4p" ? 4 : 6,
    ruleProfile: profileId,
  });
  engine.startMatch();
  return {
    engine,
    record: {
      ruleProfileId: profileId,
      schemaVersion: 1,
      state: engine.getSnapshot(),
    },
  };
}

describe("domain gameplay compatibility snapshot decoder", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("decodes a started %s four-card bidding snapshot", (profileId) => {
    const { engine, record } = snapshot(profileId);
    const legacy = engine.getSnapshot();

    const hand = decodeGameplayHand(record);

    expect(hand.profile.id).toBe(profileId);
    expect(hand.phase).toBe("four-bidding");
    expect(hand.dealer).toBe(legacy.dealerSeat);
    expect(hand.activeSeat).toBe(legacy.activeSeat);
    expect(hand.handNumber).toBe(1);
    expect(hand.deal.deck.map((card) => card.id)).toEqual(
      legacy.deck.map((card) => card.cardId),
    );
    expect(
      hand.deal.hands.map((cards) => cards.map((card) => card.id)),
    ).toEqual(legacy.seats.map((seat) => seat.hand.map((card) => card.cardId)));
    expect(hand.tokens).toEqual([11, 11]);
  });

  it.each([
    { matchTokens: null, phase: "hand-result" },
    { matchTokens: [1, 1], phase: "match-complete" },
  ] as const)("decodes a scored $phase snapshot", ({ matchTokens, phase }) => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    if (matchTokens) {
      (engine.state as unknown as { tokens: [number, number] }).tokens = [
        ...matchTokens,
      ];
    }
    const apply = (action: Record<string, unknown>) => {
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
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an active bidding seat");
    apply({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      apply({ type: "PASS_BID" });
    }
    const indicator = engine
      .getLegalActions(maker)
      .find((action) => action.type === "SELECT_TRUMP");
    if (!indicator) throw new Error("Expected a trump indicator action");
    apply(indicator);
    apply({ type: "TRUMP_OPEN" });
    let actions = 0;
    while (
      engine.getSnapshot().phase !== "hand_result" &&
      engine.getSnapshot().phase !== "match_complete" &&
      actions < 64
    ) {
      if (engine.getSnapshot().phase === "trick_result") {
        expect(engine.advanceTrick()).toEqual({ ok: true });
      } else {
        const actor = engine.getSnapshot().activeSeat;
        if (actor === null) throw new Error("Expected an active trick seat");
        const action = engine
          .getLegalActions(actor)
          .find((candidate) => candidate.type === "PLAY_CARD");
        if (!action) throw new Error("Expected a legal card play");
        apply(action);
      }
      actions += 1;
    }
    const legacy = engine.getSnapshot();

    const hand = decodeGameplayHand({
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: legacy,
    });

    expect(hand.phase).toBe(phase);
    expect(hand.result).toMatchObject({
      bid: legacy.handResult?.bid,
      bidderTeam: legacy.handResult?.bidderTeam,
      bidderTeamPoints: legacy.handResult?.bidderTeamPoints,
      matchComplete: phase === "match-complete",
      tokens: legacy.tokens,
      winningTeam: legacy.handResult?.winningTeam,
    });
    expect(hand.completedTricks).toHaveLength(8);
  });
});
