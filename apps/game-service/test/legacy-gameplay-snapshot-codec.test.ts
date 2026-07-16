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
});
