import { describe, expect, it } from "vitest";
import {
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type CardId,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

function start(secondBiddingEnabled = true): GameplayHand {
  return startGameplayHand({
    dealer: seatIndex(3, 4),
    deck: buildDeck(profile),
    handNumber: 1,
    profile,
    secondBiddingEnabled,
    tokens: initialTokens(profile),
  });
}

function apply(hand: GameplayHand, command: GameplayCommand): GameplayHand {
  const result = applyGameplayCommand(hand, command);
  expect(result.ok).toBe(true);
  if (!result.ok) return hand;
  return result.hand;
}

function firstCardId(hand: GameplayHand, actor = 0): CardId {
  const selected = hand.deal.firstHands[actor]?.[0];
  if (!selected) throw new Error("Expected a first-hand card");
  return selected.id;
}

function finishOpeningBid(hand: GameplayHand, amount = 160): GameplayHand {
  let current = apply(hand, {
    actor: seatIndex(0, 4),
    amount: bidAmount(amount),
    type: "BID",
  });
  for (const actor of [1, 2, 3]) {
    if (current.phase !== "four-bidding") break;
    current = apply(current, {
      actor: seatIndex(actor, 4),
      type: "PASS_BID",
    });
  }
  return current;
}

describe("gameplay aggregate transitions", () => {
  it("moves from opening bidding to maker trump selection", () => {
    const hand = finishOpeningBid(start());

    expect(hand.phase).toBe("trump-selection");
    expect(hand.activeSeat).toBe(0);
    expect(hand.trump.maker).toBe(0);
    expect(hand.bidding.currentBid).toBe(160);
  });

  it("selects the first indicator, deals the second batch, and starts second bidding", () => {
    let hand = finishOpeningBid(start());
    const selectedCard = hand.deal.firstHands[0]?.[0];
    if (!selectedCard) throw new Error("Expected a first-hand card");
    hand = apply(hand, {
      actor: seatIndex(0, 4),
      cardId: selectedCard.id,
      type: "SELECT_TRUMP",
    });

    expect(hand.phase).toBe("second-bidding");
    expect(hand.deal.deck).toHaveLength(0);
    expect(hand.deal.hands.map((cards) => cards.length)).toEqual([7, 8, 8, 8]);
    expect(hand.trump.indicator?.id).toBe(selectedCard.id);
    expect(hand.trump.suit).toBe(selectedCard.suit);
    expect(hand.activeSeat).toBe(0);
  });

  it("finishes an all-pass second round before the maker chooses closed trump", () => {
    let hand = finishOpeningBid(start());
    hand = apply(hand, {
      actor: seatIndex(0, 4),
      cardId: firstCardId(hand),
      type: "SELECT_TRUMP",
    });
    for (const actor of [0, 1, 2, 3]) {
      hand = apply(hand, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }

    expect(hand.phase).toBe("trump-choice");
    expect(hand.activeSeat).toBe(0);

    hand = apply(hand, { actor: seatIndex(0, 4), type: "TRUMP_CLOSE" });
    expect(hand.phase).toBe("trick-play");
    expect(hand.currentTrick?.leaderSeat).toBe(0);
    expect(hand.trump.mode).toBe("closed");
  });

  it("returns the first indicator when a different maker wins second bidding", () => {
    let hand = finishOpeningBid(start());
    hand = apply(hand, {
      actor: seatIndex(0, 4),
      cardId: firstCardId(hand),
      type: "SELECT_TRUMP",
    });
    hand = apply(hand, { actor: seatIndex(0, 4), type: "PASS_BID" });
    hand = apply(hand, {
      actor: seatIndex(1, 4),
      amount: bidAmount(250),
      type: "BID",
    });
    hand = apply(hand, { actor: seatIndex(2, 4), type: "PASS_BID" });
    hand = apply(hand, { actor: seatIndex(3, 4), type: "PASS_BID" });

    expect(hand.phase).toBe("trump-selection");
    expect(hand.trump.maker).toBe(1);
    expect(hand.trump.indicator).toBeNull();
    expect(hand.deal.hands[0]).toHaveLength(8);

    const newIndicator = hand.deal.hands[1]?.[0];
    if (!newIndicator) throw new Error("Expected a full-hand card");
    hand = apply(hand, {
      actor: seatIndex(1, 4),
      cardId: newIndicator.id,
      type: "SELECT_TRUMP",
    });
    expect(hand.phase).toBe("trump-choice");
    expect(hand.trump.indicator?.id).toBe(newIndicator.id);
    expect(hand.deal.hands[1]).toHaveLength(7);
  });

  it("returns an open indicator to the maker's live hand", () => {
    let hand = finishOpeningBid(start(), 210);
    const indicatorId = firstCardId(hand);
    hand = apply(hand, {
      actor: seatIndex(0, 4),
      cardId: indicatorId,
      type: "SELECT_TRUMP",
    });
    for (const actor of [0, 1, 2, 3]) {
      hand = apply(hand, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }
    hand = apply(hand, { actor: seatIndex(0, 4), type: "TRUMP_OPEN" });

    expect(hand.trump.open).toBe(true);
    expect(hand.trump.indicator).toBeNull();
    expect(hand.deal.hands[0]?.map((card) => card.id)).toContain(indicatorId);
    expect(hand.deal.hands[0]).toHaveLength(8);
  });

  it("skips second bidding after an effective maximum opening bid", () => {
    let hand = start();
    for (const [actor, amount] of [
      [0, 200],
      [1, 250],
      [2, 300],
    ] as const) {
      hand = apply(hand, {
        actor: seatIndex(actor, 4),
        amount: bidAmount(amount),
        type: "BID",
      });
    }
    hand = apply(hand, {
      actor: seatIndex(2, 4),
      cardId: firstCardId(hand, 2),
      type: "SELECT_TRUMP",
    });

    expect(hand.phase).toBe("trump-choice");
    expect(hand.deal.deck).toHaveLength(0);
  });

  it("ends an all-pass opening round without changing tokens", () => {
    let hand = start();
    for (const actor of [0, 1, 2, 3]) {
      hand = apply(hand, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }

    expect(hand.phase).toBe("hand-result");
    expect(hand.activeSeat).toBeNull();
    expect(hand.result).toMatchObject({ noScore: true, tokens: [11, 11] });
  });
});
