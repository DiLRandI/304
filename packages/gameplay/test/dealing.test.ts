import { describe, expect, it } from "vitest";
import {
  buildDeck,
  createDeal,
  dealBatch,
  getRuleProfile,
  removeCardFromSeat,
  seatIndex,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

describe("hand dealing", () => {
  it("deals the first batch clockwise from the dealer without mutation", () => {
    const deck = buildDeck(profile);
    const initial = createDeal(profile, deck);
    const dealt = dealBatch(
      initial,
      seatIndex(3, 4),
      profile.cardBatch[0],
      true,
    );

    expect(initial.deck).toHaveLength(32);
    expect(initial.hands.every((hand) => hand.length === 0)).toBe(true);
    expect(dealt.deck).toHaveLength(16);
    expect(dealt.hands.map((hand) => hand.length)).toEqual([4, 4, 4, 4]);
    expect(dealt.firstHands).toEqual(dealt.hands);
    expect(dealt.hands[0]?.[0]?.id).toBe(deck.at(-1)?.id);
    expect(new Set(dealt.hands.flat().map((card) => card.id)).size).toBe(16);
  });

  it("keeps the first-batch eligibility snapshot during the second deal", () => {
    const first = dealBatch(
      createDeal(profile, buildDeck(profile)),
      seatIndex(1, 4),
      profile.cardBatch[0],
      true,
    );
    const firstHandIds = first.firstHands.map((hand) =>
      hand.map((card) => card.id),
    );
    const second = dealBatch(
      first,
      seatIndex(1, 4),
      profile.cardBatch[1],
      false,
    );

    expect(second.deck).toHaveLength(0);
    expect(second.hands.map((hand) => hand.length)).toEqual([8, 8, 8, 8]);
    expect(
      second.firstHands.map((hand) => hand.map((card) => card.id)),
    ).toEqual(firstHandIds);
  });

  it("removes a selected indicator from only the maker's live hand", () => {
    const dealt = dealBatch(
      createDeal(profile, buildDeck(profile)),
      seatIndex(3, 4),
      profile.cardBatch[0],
      true,
    );
    const selectedId = dealt.firstHands[0]?.[1]?.id;
    const updated = removeCardFromSeat(dealt, seatIndex(0, 4), selectedId);

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.deal.hands[0]).toHaveLength(3);
    expect(updated.deal.firstHands[0]).toHaveLength(4);
    expect(updated.deal.hands.slice(1)).toEqual(dealt.hands.slice(1));
    expect(dealt.hands[0]).toHaveLength(4);
  });

  it("rejects removal of a card the seat does not hold", () => {
    const dealt = dealBatch(
      createDeal(profile, buildDeck(profile)),
      seatIndex(3, 4),
      profile.cardBatch[0],
      true,
    );
    expect(
      removeCardFromSeat(dealt, seatIndex(1, 4), dealt.hands[0]?.[0]?.id),
    ).toEqual({
      error: {
        code: "CARD_NOT_IN_HAND",
        message: "Card is not in the seat's hand",
      },
      ok: false,
    });
  });
});
