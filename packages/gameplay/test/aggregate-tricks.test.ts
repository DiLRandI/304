import { describe, expect, it } from "vitest";
import {
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalCardPlays,
  seatIndex,
  startGameplayHand,
  type TrickContext,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

function apply(hand: GameplayHand, command: GameplayCommand): GameplayHand {
  const result = applyGameplayCommand(hand, command);
  expect(result.ok).toBe(true);
  if (!result.ok) return hand;
  return result.hand;
}

function startTrickPlay(): GameplayHand {
  let hand = startGameplayHand({
    dealer: seatIndex(3, 4),
    deck: buildDeck(profile),
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
  hand = apply(hand, {
    actor: seatIndex(0, 4),
    amount: bidAmount(160),
    type: "BID",
  });
  for (const actor of [1, 2, 3]) {
    hand = apply(hand, {
      actor: seatIndex(actor, 4),
      type: "PASS_BID",
    });
  }
  const indicator = hand.deal.firstHands[0]?.[0];
  if (!indicator) throw new Error("Expected an indicator card");
  hand = apply(hand, {
    actor: seatIndex(0, 4),
    cardId: indicator.id,
    type: "SELECT_TRUMP",
  });
  for (const actor of [0, 1, 2, 3]) {
    hand = apply(hand, {
      actor: seatIndex(actor, 4),
      type: "PASS_BID",
    });
  }
  return apply(hand, { actor: seatIndex(0, 4), type: "TRUMP_CLOSE" });
}

function trickContext(hand: GameplayHand): TrickContext {
  if (hand.trump.maker === null || hand.trump.suit === null) {
    throw new Error("Expected configured trump");
  }
  return {
    completedTrickCount: hand.completedTricks.length,
    forceOpenOnCompletion:
      !hand.trump.open &&
      hand.completedTricks.length === 0 &&
      (hand.bidding.currentBid ?? 0) >=
        hand.profile.revealTrumpAfterFirstTrickAtBidAtLeast,
    indicator: hand.trump.indicator,
    maker: hand.trump.maker,
    profile: hand.profile,
    trumpOpen: hand.trump.open,
    trumpSuit: hand.trump.suit,
  };
}

function playNextCard(hand: GameplayHand): GameplayHand {
  const actor = hand.activeSeat;
  const trick = hand.currentTrick;
  if (actor === null || !trick) throw new Error("Expected active trick play");
  const selection = legalCardPlays(
    trickContext(hand),
    trick,
    hand.deal.hands[actor] ?? [],
    actor,
  )[0];
  if (!selection) throw new Error("Expected a legal card play");
  return apply(hand, { actor, ...selection, type: "PLAY_CARD" });
}

describe("aggregate trick lifecycle", () => {
  it("pauses on a complete trick and starts the next trick with its winner", () => {
    let hand = startTrickPlay();
    for (let play = 0; play < 4; play += 1) hand = playNextCard(hand);

    expect(hand.phase).toBe("trick-result");
    expect(hand.activeSeat).toBeNull();
    expect(hand.completedTricks).toHaveLength(1);
    const winner = hand.currentTrick?.winnerSeat;
    expect(winner).not.toBeNull();
    expect(
      hand.capturedCards.reduce((total, cards) => total + cards.length, 0),
    ).toBe(4);

    hand = apply(hand, { actor: null, type: "ADVANCE_TRICK" });
    expect(hand.phase).toBe("trick-play");
    expect(hand.activeSeat).toBe(winner);
    expect(hand.currentTrick?.plays).toEqual([]);
  });

  it("plays all cards through the final result and scores the hand", () => {
    let hand = startTrickPlay();
    let actions = 0;
    while (hand.phase === "trick-play" || hand.phase === "trick-result") {
      hand =
        hand.phase === "trick-play"
          ? playNextCard(hand)
          : apply(hand, { actor: null, type: "ADVANCE_TRICK" });
      actions += 1;
      if (actions > 50) throw new Error("Gameplay did not terminate");
    }

    expect(hand.phase).toBe("hand-result");
    expect(hand.completedTricks).toHaveLength(8);
    expect(
      hand.capturedCards.reduce((total, cards) => total + cards.length, 0),
    ).toBe(32);
    expect(hand.result).toMatchObject({ bid: 160, bidderTeam: "A" });
    expect(hand.tokens).not.toEqual([11, 11]);
  });
});
