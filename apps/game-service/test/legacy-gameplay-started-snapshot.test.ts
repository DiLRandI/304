import { describe, expect, it } from "vitest";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";
import {
  legacyStartedGameplaySnapshot,
  legacyStartedSixSeatGameplaySnapshot,
} from "./support/legacy-gameplay-snapshot-fixture.js";

describe("legacy started gameplay snapshot", () => {
  it.each([
    {
      profileId: "classic_304_4p",
      record: legacyStartedGameplaySnapshot(),
    },
    {
      profileId: "six_304_36",
      record: legacyStartedSixSeatGameplaySnapshot(),
    },
  ] as const)("decodes a started $profileId hand", ({ profileId, record }) => {
    const legacy = record.state as {
      activeSeat: number;
      dealerSeat: number;
      deck: Array<{ cardId: string }>;
      seats: Array<{ hand: Array<{ cardId: string }> }>;
    };

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
