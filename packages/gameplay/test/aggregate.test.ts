import { describe, expect, it } from "vitest";
import {
  buildDeck,
  getRuleProfile,
  initialTokens,
  nextDealer,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

describe("gameplay hand aggregate", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("starts a %s hand in four-card bidding", (profileId) => {
    const profile = getRuleProfile(profileId);
    const dealer = seatIndex(profile.seatCount - 1, profile.seatCount);
    const hand = startGameplayHand({
      dealer,
      deck: buildDeck(profile),
      endHandWhenOutcomeCertain: false,
      handNumber: 1,
      profile,
      secondBiddingEnabled: true,
      tokens: initialTokens(profile),
    });

    expect(hand.phase).toBe("four-bidding");
    expect(hand.activeSeat).toBe(0);
    expect(hand.deal.hands.map((cards) => cards.length)).toEqual(
      Array.from({ length: profile.seatCount }, () => profile.cardBatch[0]),
    );
    expect(hand.deal.deck).toHaveLength(
      profile.cardBatch[1] * profile.seatCount,
    );
    expect(hand.bidding.round).toBe("four");
    expect(hand.trump).toEqual({
      indicator: null,
      maker: null,
      mode: null,
      open: false,
      suit: null,
    });
    expect(hand.completedTricks).toEqual([]);
    expect(hand.currentTrick).toBeNull();
  });

  it("can disable second bidding at the aggregate boundary", () => {
    const profile = getRuleProfile("classic_304_4p");
    const hand = startGameplayHand({
      dealer: seatIndex(0, 4),
      deck: buildDeck(profile),
      endHandWhenOutcomeCertain: false,
      handNumber: 3,
      profile,
      secondBiddingEnabled: false,
      tokens: [8, 14],
    });

    expect(hand.handNumber).toBe(3);
    expect(hand.tokens).toEqual([8, 14]);
    expect(hand.bidding.secondBiddingEnabled).toBe(false);
  });

  it("rotates the dealer within the profile's seat count", () => {
    expect(nextDealer(seatIndex(3, 4), 4)).toBe(0);
    expect(nextDealer(seatIndex(4, 6), 6)).toBe(5);
  });
});
