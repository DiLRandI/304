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
  nextDealer,
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

describe("classic first leader and closed-mode availability", () => {
  it.each([
    ["classic_304_4p", 1, 3],
    ["six_304_36", 2, 4],
  ] as const)("starts %s trick one with the player to the dealer's right, not the maker", (profileId, dealerValue, makerValue) => {
    const hand = trumpChoiceHand(profileId, dealerValue, makerValue);
    const maker = hand.trump.maker;
    if (maker === null) throw new Error("Expected trump maker");

    const result = applyGameplayCommand(hand, {
      actor: maker,
      type: "TRUMP_OPEN",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const firstLeader = nextDealer(hand.dealer, hand.profile.seatCount);
    expect(firstLeader).not.toBe(maker);
    expect(result.hand.activeSeat).toBe(firstLeader);
    expect(result.hand.currentTrick?.leaderSeat).toBe(firstLeader);
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
