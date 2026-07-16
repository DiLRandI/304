import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDeck,
  type Card,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalCardPlays,
  projectGameplayHand,
  type RuleProfileId,
  seatIndex,
  startGameplayHand,
  teamForSeat,
} from "../src/index.js";

interface LegacyFixture {
  readonly deck: {
    readonly cardCount: number;
    readonly points: number;
    readonly ranks: readonly string[];
  };
  readonly profile: {
    readonly cardBatch: readonly number[];
    readonly id: string;
    readonly seatCount: number;
    readonly teams: readonly string[];
    readonly tokens: readonly number[];
  };
  readonly projection: Record<string, unknown>;
}

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/legacy-gameplay-compatibility.json", import.meta.url),
    "utf8",
  ),
) as Record<RuleProfileId, LegacyFixture>;

function requiredCard(deck: readonly Card[], id: string): Card {
  const card = deck.find((candidate) => candidate.id === id);
  if (!card) throw new Error(`Missing parity card ${id}`);
  return card;
}

function parityHand(profileId: RuleProfileId): GameplayHand {
  const profile = getRuleProfile(profileId);
  const deck = buildDeck(profile);
  const started = startGameplayHand({
    dealer: seatIndex(profile.seatCount - 1, profile.seatCount),
    deck,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
  const hands = Array.from({ length: profile.seatCount }, () => [] as Card[]);
  hands[0] = [requiredCard(deck, "D_7")];
  hands[1] = [requiredCard(deck, "C_9"), requiredCard(deck, "H_A")];
  return {
    ...started,
    activeSeat: seatIndex(1, profile.seatCount),
    currentTrick: {
      activeSeat: seatIndex(1, profile.seatCount),
      leaderSeat: seatIndex(0, profile.seatCount),
      openedTrump: false,
      plays: [
        {
          actor: seatIndex(0, profile.seatCount),
          card: requiredCard(deck, "C_J"),
          faceDown: false,
          fromIndicator: false,
        },
      ],
      points: 30,
      status: "active",
      winnerSeat: null,
    },
    deal: {
      deck: [],
      firstHands: Array.from({ length: profile.seatCount }, () => []),
      hands,
      seatCount: profile.seatCount,
    },
    phase: "trick-play",
    trump: {
      indicator: requiredCard(deck, "S_9"),
      maker: seatIndex(0, profile.seatCount),
      mode: "closed",
      open: false,
      suit: "spades",
    },
  };
}

function visibleCardId(card: {
  readonly hidden: boolean;
  readonly id?: string;
}) {
  return card.hidden ? null : card.id;
}

describe("legacy gameplay compatibility", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("matches the stable %s deck, profile, action, and privacy fixture", (profileId) => {
    const expected = fixtures[profileId];
    const profile = getRuleProfile(profileId);
    const deck = buildDeck(profile);
    const hand = parityHand(profileId);
    const viewer = seatIndex(1, profile.seatCount);
    const opponent = projectGameplayHand(hand, viewer);
    const maker = projectGameplayHand(hand, seatIndex(0, profile.seatCount));
    const viewerless = projectGameplayHand(hand, null);
    const currentTrick = hand.currentTrick;
    if (!currentTrick) throw new Error("Expected parity trick state");
    const legalActions = legalCardPlays(
      {
        completedTrickCount: 0,
        indicator: hand.trump.indicator,
        maker: seatIndex(0, profile.seatCount),
        profile,
        trumpOpen: false,
        trumpSuit: "spades",
      },
      currentTrick,
      hand.deal.hands[viewer] ?? [],
      viewer,
    ).map((action) => ({ ...action, type: "PLAY_CARD" }));

    expect({
      cardCount: deck.length,
      points: deck.reduce((total, card) => total + card.points, 0),
      ranks: profile.deckRanks,
    }).toEqual(expected.deck);
    expect({
      cardBatch: profile.cardBatch,
      id: profile.id,
      seatCount: profile.seatCount,
      teams: Array.from({ length: profile.seatCount }, (_, actor) =>
        teamForSeat(seatIndex(actor, profile.seatCount)),
      ),
      tokens: initialTokens(profile),
    }).toEqual(expected.profile);
    expect({
      activeSeat: opponent.activeSeat,
      legalActions,
      opponentHand: opponent.seats[viewer]?.hand.map(visibleCardId),
      opponentTrump: {
        indicatorVisible: false,
        isOpen: opponent.trump.open,
        maker: opponent.trump.maker,
        suit: opponent.trump.suit,
      },
      publicHandSizes: opponent.seats.map((seat) => seat.handSize),
      publicTrickCard: opponent.currentTrick?.plays[0]
        ? visibleCardId(opponent.currentTrick.plays[0].card)
        : null,
      trumpMakerSuit: maker.trump.suit,
      viewerlessHasSeatIdentity: viewerless.seats.some((seat) => seat.isViewer),
      viewerlessTrumpSuit: viewerless.trump.suit,
    }).toEqual(expected.projection);
  });
});
