import { describe, expect, it } from "vitest";
import {
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type Card,
  createTrick,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
  seatIndex,
  startGameplayHand,
  type TrickPlay,
} from "../src/index.js";
import type { RuleProfileId, SeatIndex } from "../src/values.js";

function requiredCard(cards: readonly Card[], id: string): Card {
  const selected = cards.find((card) => card.id === id);
  if (!selected) throw new Error(`Expected card ${id}`);
  return selected;
}

function trumpChoiceHand(
  profileId: RuleProfileId,
  dealerValue: number,
  makerValue: number,
  makerCards?: readonly Card[],
): GameplayHand {
  const profile = getRuleProfile(profileId);
  const dealer = seatIndex(dealerValue, profile.seatCount);
  const maker = seatIndex(makerValue, profile.seatCount);
  const deck = buildDeck(profile);
  const indicator = requiredCard(deck, "S_J");
  const started = startGameplayHand({
    dealer,
    deck,
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
  return {
    ...started,
    activeSeat: maker,
    bidding: {
      ...started.bidding,
      activeSeat: null,
      currentBid: bidAmount(160),
      currentBidder: maker,
      status: "complete",
    },
    deal: {
      ...started.deal,
      hands: started.deal.hands.map((cards, actor) =>
        actor === maker ? (makerCards ?? cards) : cards,
      ),
    },
    phase: "trump-choice",
    trump: {
      indicator,
      maker,
      mode: null,
      open: false,
      suit: "spades",
    },
  };
}

function exhaustedTrumpHand(profileId: RuleProfileId): GameplayHand {
  const profile = getRuleProfile(profileId);
  const deck = buildDeck(profile);
  const maker = seatIndex(0, profile.seatCount);
  const started = startGameplayHand({
    dealer: seatIndex(profile.seatCount - 1, profile.seatCount),
    deck,
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
  const offSuitIds =
    profile.seatCount === 4
      ? ["H_7", "H_8", "H_9"]
      : ["H_7", "H_8", "H_9", "H_10", "H_K"];
  const previousPlays: TrickPlay[] = [
    {
      actor: maker,
      card: requiredCard(deck, "S_7"),
      faceDown: false,
      fromIndicator: false,
    },
    ...offSuitIds.map(
      (id, offset): TrickPlay => ({
        actor: seatIndex(offset + 1, profile.seatCount),
        card: requiredCard(deck, id),
        faceDown: true,
        fromIndicator: false,
      }),
    ),
  ];
  return {
    ...started,
    activeSeat: maker,
    bidding: {
      ...started.bidding,
      activeSeat: null,
      currentBid: bidAmount(200),
      currentBidder: maker,
      status: "complete",
    },
    completedTricks: [
      {
        activeSeat: null,
        leaderSeat: maker,
        openedTrump: false,
        plays: previousPlays,
        points: previousPlays.reduce(
          (total, play) => total + play.card.points,
          0,
        ),
        status: "complete",
        winnerSeat: maker,
      },
    ],
    currentTrick: createTrick(maker),
    deal: {
      ...started.deal,
      hands: started.deal.hands.map((cards, actor) =>
        actor === maker
          ? [
              requiredCard(deck, "S_9"),
              requiredCard(deck, "S_A"),
              requiredCard(deck, "H_J"),
            ]
          : cards,
      ),
    },
    phase: "trick-play",
    trump: {
      indicator: requiredCard(deck, "S_J"),
      maker,
      mode: "closed",
      open: false,
      suit: "spades",
    },
  };
}

function playCommands(hand: GameplayHand, actor: SeatIndex) {
  return legalGameplayCommands(hand, actor).filter(
    (command) => command.type === "PLAY_CARD",
  );
}

function closedTrickHand(
  currentBid: number,
  completedTrickCount: 0 | 1 = 0,
): GameplayHand {
  const profile = getRuleProfile("classic_304_4p");
  const deck = buildDeck(profile);
  const maker = seatIndex(2, 4);
  const started = startGameplayHand({
    dealer: seatIndex(3, 4),
    deck,
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
  const previousCards = ["D_J", "D_9", "D_A", "D_10"].map((id) =>
    requiredCard(deck, id),
  );
  const previousTrick = {
    activeSeat: null,
    leaderSeat: seatIndex(0, 4),
    openedTrump: false,
    plays: previousCards.map(
      (card, actor): TrickPlay => ({
        actor: seatIndex(actor, 4),
        card,
        faceDown: false,
        fromIndicator: false,
      }),
    ),
    points: previousCards.reduce((total, card) => total + card.points, 0),
    status: "complete" as const,
    winnerSeat: seatIndex(0, 4),
  };
  return {
    ...started,
    activeSeat: seatIndex(0, 4),
    bidding: {
      ...started.bidding,
      activeSeat: null,
      currentBid: bidAmount(currentBid),
      currentBidder: maker,
      status: "complete",
    },
    capturedCards:
      completedTrickCount === 0
        ? started.capturedCards
        : [previousCards, [], [], []],
    completedTricks: completedTrickCount === 0 ? [] : [previousTrick],
    currentTrick: createTrick(seatIndex(0, 4)),
    deal: {
      ...started.deal,
      hands: [
        [requiredCard(deck, "H_J")],
        [requiredCard(deck, "C_7")],
        [requiredCard(deck, "H_9")],
        [requiredCard(deck, "H_A")],
      ],
    },
    phase: "trick-play",
    trump: {
      indicator: requiredCard(deck, "S_J"),
      maker,
      mode: "closed",
      open: false,
      suit: "spades",
    },
  };
}

function completeClosedTrick(hand: GameplayHand): GameplayHand {
  const commands = [
    {
      actor: seatIndex(0, 4),
      cardId: "H_J",
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    },
    {
      actor: seatIndex(1, 4),
      cardId: "C_7",
      faceDown: true,
      fromIndicator: false,
      type: "PLAY_CARD",
    },
    {
      actor: seatIndex(2, 4),
      cardId: "H_9",
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    },
    {
      actor: seatIndex(3, 4),
      cardId: "H_A",
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    },
  ] as const;
  let current = hand;
  for (const command of commands) {
    const result = applyGameplayCommand(current, command);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    current = result.hand;
  }
  return current;
}

describe("classic first leader and closed-mode availability", () => {
  it.each([
    {
      dealerValue: 1,
      expectedLeaderValue: 2,
      makerValue: 3,
      profileId: "classic_304_4p",
    },
    {
      dealerValue: 2,
      expectedLeaderValue: 3,
      makerValue: 4,
      profileId: "six_304_36",
    },
  ] as const)("starts $profileId trick one with concrete dealer-right seat $expectedLeaderValue, not maker seat $makerValue", ({
    profileId,
    dealerValue,
    makerValue,
    expectedLeaderValue,
  }) => {
    const hand = trumpChoiceHand(profileId, dealerValue, makerValue);
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected trump maker");

    const result = applyGameplayCommand(hand, {
      actor: maker,
      type: "TRUMP_OPEN",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedLeader = seatIndex(
      expectedLeaderValue,
      hand.profile.seatCount,
    );
    expect(expectedLeader).not.toBe(maker);
    expect(result.hand.activeSeat).toBe(expectedLeader);
    expect(result.hand.currentTrick?.leaderSeat).toBe(expectedLeader);
  });

  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("does not offer closed mode in %s when the maker must lead but holds only trumps", (profileId) => {
    const profile = getRuleProfile(profileId);
    const deck = buildDeck(profile);
    const dealer = profile.seatCount - 1;
    const maker = 0;
    const hand = trumpChoiceHand(
      profileId,
      dealer,
      maker,
      deck
        .filter((card) => card.suit === "spades" && card.id !== "S_J")
        .slice(0, profile.cardBatch[0] + profile.cardBatch[1] - 1),
    );
    const actor = seatIndex(maker, profile.seatCount);

    expect(legalGameplayCommands(hand, actor)).toEqual([
      { actor, type: "TRUMP_OPEN" },
    ]);
    expect(applyGameplayCommand(hand, { actor, type: "TRUMP_CLOSE" })).toEqual({
      error: {
        code: "TRUMP_MODE_NOT_ALLOWED",
        message:
          "Closed trump is not allowed when the first leader has no non-trump card",
      },
      ok: false,
    });
  });
});

describe("automatic 250-plus first-trick reveal", () => {
  it("keeps a closed first trick closed when the actual bid is 249", () => {
    const hand = completeClosedTrick(closedTrickHand(249));

    expect(hand.completedTricks).toHaveLength(1);
    expect(hand.currentTrick?.openedTrump).toBe(false);
    expect(hand.trump.open).toBe(false);
    expect(hand.trump.indicator?.id).toBe("S_J");
  });

  it("opens trump after a closed first trick when the actual bid is exactly 250", () => {
    const hand = completeClosedTrick(closedTrickHand(250));

    expect(hand.completedTricks).toHaveLength(1);
    expect(hand.currentTrick?.openedTrump).toBe(true);
    expect(hand.currentTrick?.trumpRevealReason).toBe(
      "high-bid-after-first-trick",
    );
    expect(hand.trump.open).toBe(true);
    expect(hand.trump.indicator).toBeNull();
    expect(hand.trump.revealedIndicator?.id).toBe("S_J");
    expect(hand.deal.hands[2]?.map((card) => card.id)).toContain("S_J");
  });

  it("does not apply the 250-plus automatic reveal to a later closed trick", () => {
    const hand = completeClosedTrick(closedTrickHand(250, 1));

    expect(hand.completedTricks).toHaveLength(2);
    expect(hand.currentTrick?.openedTrump).toBe(false);
    expect(hand.trump.open).toBe(false);
    expect(hand.trump.indicator?.id).toBe("S_J");
  });
});

describe("exhausted-trump sequence", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("requires the maker to continue leading in-hand trumps in %s", (profileId) => {
    const hand = exhaustedTrumpHand(profileId);
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected trump maker");

    expect(playCommands(hand, maker)).toEqual([
      {
        actor: maker,
        cardId: "S_9",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      },
      {
        actor: maker,
        cardId: "S_A",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      },
    ]);
  });

  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("does not start the exhausted-trump sequence in %s when another player followed trump", (profileId) => {
    const hand = exhaustedTrumpHand(profileId);
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected trump maker");
    const deck = buildDeck(hand.profile);
    const previous = hand.completedTricks[0];
    if (!previous) throw new Error("Expected previous trick");
    const followed = {
      ...hand,
      completedTricks: [
        {
          ...previous,
          plays: previous.plays.map((play, index) =>
            index === 1 ? { ...play, card: requiredCard(deck, "S_8") } : play,
          ),
        },
      ],
    };

    expect(playCommands(followed, maker)).toContainEqual({
      actor: maker,
      cardId: "H_J",
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    });
  });
});
