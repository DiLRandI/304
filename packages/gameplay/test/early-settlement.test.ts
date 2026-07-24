import { describe, expect, it } from "vitest";
import {
  acknowledgeGameplayResult,
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type Card,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  type RuleProfileId,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

function cardsWorth(profileId: RuleProfileId, points: number): Card[] {
  const profile = getRuleProfile(profileId);
  const pointCards = buildDeck(profile)
    .filter((card) => card.points > 0)
    .toSorted((first, second) => second.points - first.points);

  function collect(remaining: number, start = 0): Card[] | null {
    if (remaining === 0) return [];
    for (let index = start; index < pointCards.length; index += 1) {
      const card = pointCards[index];
      if (!card || card.points > remaining) continue;
      const rest = collect(remaining - card.points, index);
      if (rest) return [card, ...rest];
    }
    return null;
  }

  const cards = collect(points);
  if (!cards) throw new Error(`Could not create ${points} captured points`);
  return cards;
}

function almostCompletedTrick(
  profileId: RuleProfileId,
  input: {
    bidderPoints: number;
    endHandWhenOutcomeCertain: boolean;
    opponentPoints: number;
  },
): GameplayHand {
  const profile = getRuleProfile(profileId);
  const deck = buildDeck(profile);
  const trickCards = deck
    .filter((card) => card.suit === "clubs")
    .slice(0, profile.seatCount);
  if (trickCards.length !== profile.seatCount) {
    throw new Error("Expected one same-suit card per seat");
  }
  const lastSeat = seatIndex(profile.seatCount - 1, profile.seatCount);
  const started = startGameplayHand({
    dealer: lastSeat,
    deck,
    endHandWhenOutcomeCertain: input.endHandWhenOutcomeCertain,
    handNumber: 1,
    profile,
    secondBiddingEnabled: false,
    tokens: initialTokens(profile),
  });
  return {
    ...started,
    activeSeat: lastSeat,
    bidding: {
      ...started.bidding,
      activeSeat: null,
      currentBid: bidAmount(160),
      currentBidder: seatIndex(0, profile.seatCount),
      status: "complete",
    },
    capturedCards: Array.from({ length: profile.seatCount }, (_, seat) =>
      seat === 0
        ? cardsWorth(profileId, input.bidderPoints)
        : seat === 1
          ? cardsWorth(profileId, input.opponentPoints)
          : [],
    ),
    currentTrick: {
      activeSeat: lastSeat,
      leaderSeat: seatIndex(0, profile.seatCount),
      openedTrump: false,
      plays: trickCards.slice(0, -1).map((card, actor) => ({
        actor: seatIndex(actor, profile.seatCount),
        card,
        faceDown: false,
        fromIndicator: false,
      })),
      points: trickCards
        .slice(0, -1)
        .reduce((total, card) => total + card.points, 0),
      status: "active",
      winnerSeat: null,
    },
    deal: {
      ...started.deal,
      deck: [],
      hands: trickCards.map((card) => [card]),
    },
    phase: "trick-play",
    trump: {
      indicator: null,
      maker: seatIndex(0, profile.seatCount),
      mode: "open",
      open: true,
      suit: "clubs",
    },
  };
}

function completeTrick(hand: GameplayHand): GameplayHand {
  const actor = hand.activeSeat;
  const card = actor === null ? undefined : hand.deal.hands[actor]?.[0];
  if (actor === null || !card) throw new Error("Expected the final trick play");
  const decision = applyGameplayCommand(hand, {
    actor,
    cardId: card.id,
    faceDown: false,
    fromIndicator: false,
    type: "PLAY_CARD",
  });
  expect(decision.ok).toBe(true);
  if (!decision.ok) return hand;
  return decision.hand;
}

describe("early hand settlement", () => {
  it.each([
    ["classic_304_4p", 130],
    ["six_304_36", 98],
  ] as const)("settles a %s hand exactly when the bidder reaches the bid", (profileId, bidderPoints) => {
    const before = almostCompletedTrick(profileId, {
      bidderPoints,
      endHandWhenOutcomeCertain: true,
      opponentPoints: 0,
    });
    const after = completeTrick(before);

    expect(after.phase).toBe("hand-result");
    expect(after.result).toMatchObject({
      bidderTeamPoints: 160,
      movement: 1,
      settlementReason: "bid-reached",
      success: true,
    });
    expect(after.tokens).toEqual([12, 10]);
  });

  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("settles a %s hand when the opponent exceeds the exact unreachable threshold", (profileId) => {
    const after = completeTrick(
      almostCompletedTrick(profileId, {
        bidderPoints: 0,
        endHandWhenOutcomeCertain: true,
        opponentPoints: 145,
      }),
    );

    expect(after.phase).toBe("hand-result");
    expect(after.result).toMatchObject({
      movement: 2,
      otherTeamPoints: 145,
      settlementReason: "bid-unreachable",
      success: false,
    });
    expect(after.tokens).toEqual([9, 13]);
  });

  it("does not settle when the opponent is exactly at the unreachable boundary", () => {
    const after = completeTrick(
      almostCompletedTrick("classic_304_4p", {
        bidderPoints: 0,
        endHandWhenOutcomeCertain: true,
        opponentPoints: 144,
      }),
    );

    expect(after.phase).toBe("trick-result");
    expect(after.result).toBeNull();
  });

  it("does not settle when the bidder remains one point below the bid", () => {
    const after = completeTrick(
      almostCompletedTrick("classic_304_4p", {
        bidderPoints: 129,
        endHandWhenOutcomeCertain: true,
        opponentPoints: 0,
      }),
    );

    expect(after.phase).toBe("trick-result");
    expect(after.result).toBeNull();
  });

  it("keeps playing when early settlement is disabled", () => {
    const after = completeTrick(
      almostCompletedTrick("classic_304_4p", {
        bidderPoints: 160,
        endHandWhenOutcomeCertain: false,
        opponentPoints: 0,
      }),
    );

    expect(after.phase).toBe("trick-result");
    expect(after.result).toBeNull();
  });

  it("uses all-tricks-played for a normal final-trick result", () => {
    const profile = getRuleProfile("classic_304_4p");
    const before = almostCompletedTrick("classic_304_4p", {
      bidderPoints: 160,
      endHandWhenOutcomeCertain: true,
      opponentPoints: 0,
    });
    const paused = completeTrick({
      ...before,
      completedTricks: Array.from(
        { length: profile.cardBatch[0] + profile.cardBatch[1] - 1 },
        () => ({
          activeSeat: null,
          leaderSeat: seatIndex(0, 4),
          openedTrump: false,
          plays: [],
          points: 0,
          status: "complete" as const,
          winnerSeat: seatIndex(0, 4),
        }),
      ),
    });

    expect(paused.phase).toBe("trick-result");
    const settled = applyGameplayCommand(paused, {
      actor: null,
      type: "ADVANCE_TRICK",
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.hand.result).toMatchObject({
      settlementReason: "all-tricks-played",
    });
  });

  it("carries the setting into the next hand", () => {
    const profile = getRuleProfile("classic_304_4p");
    const hand: GameplayHand = {
      ...startGameplayHand({
        dealer: seatIndex(3, 4),
        deck: buildDeck(profile),
        endHandWhenOutcomeCertain: true,
        handNumber: 1,
        profile,
        secondBiddingEnabled: false,
        tokens: initialTokens(profile),
      }),
      activeSeat: null,
      phase: "hand-result",
    };

    const acknowledged = acknowledgeGameplayResult(hand, buildDeck(profile));

    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) return;
    expect(acknowledged.hand.endHandWhenOutcomeCertain).toBe(true);
  });
});
