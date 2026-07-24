import type { GameplayHand } from "./aggregate.js";
import { type Card, compareRank, type RandomSource } from "./card.js";
import { legalGameplayCommands } from "./legal-actions.js";
import type { GameplayCommand } from "./messages.js";
import { teamForSeat } from "./scoring.js";
import type { SeatIndex, Suit } from "./values.js";
import { InvalidGameplayValue } from "./values.js";

export type GameplayBotDifficulty = "easy" | "normal" | "strong";

export interface GameplayBotOptions {
  readonly difficulty: GameplayBotDifficulty;
  readonly random: RandomSource;
}

type BidCommand = Extract<GameplayCommand, { type: "BID" }>;
type CardCommand = Extract<GameplayCommand, { type: "PLAY_CARD" }>;
type TrumpCommand = Extract<GameplayCommand, { type: "SELECT_TRUMP" }>;

const suits: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];

const fourCardCeilings: Readonly<
  Record<
    GameplayBotDifficulty,
    readonly { readonly minimumScore: number; readonly ceiling: number }[]
  >
> = {
  easy: [
    { ceiling: 180, minimumScore: 95 },
    { ceiling: 170, minimumScore: 75 },
    { ceiling: 160, minimumScore: 55 },
  ],
  normal: [
    { ceiling: 200, minimumScore: 105 },
    { ceiling: 190, minimumScore: 90 },
    { ceiling: 180, minimumScore: 75 },
    { ceiling: 170, minimumScore: 60 },
    { ceiling: 160, minimumScore: 45 },
  ],
  strong: [
    { ceiling: 220, minimumScore: 125 },
    { ceiling: 210, minimumScore: 115 },
    { ceiling: 200, minimumScore: 100 },
    { ceiling: 190, minimumScore: 85 },
    { ceiling: 180, minimumScore: 70 },
    { ceiling: 170, minimumScore: 55 },
    { ceiling: 160, minimumScore: 40 },
  ],
};

export function evaluateFourCardBidHand(cards: readonly Card[]): number {
  const suitCounts = Object.fromEntries(
    suits.map((suit) => [suit, 0]),
  ) as Record<Suit, number>;
  let score = 0;
  for (const card of cards) {
    suitCounts[card.suit] += 1;
    score += card.points;
    if (card.rank === "J") score += 15;
    if (card.rank === "9") score += 8;
    if (card.rank === "A") score += 3;
  }
  return score + Math.max(...Object.values(suitCounts)) * 8;
}

export function fourCardBidCeiling(
  difficulty: GameplayBotDifficulty,
  score: number,
): number | null {
  return (
    fourCardCeilings[difficulty].find(
      ({ minimumScore }) => score >= minimumScore,
    )?.ceiling ?? null
  );
}

function randomValue(random: RandomSource): number {
  const value = random.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new InvalidGameplayValue(
      "INVALID_RANDOM_VALUE",
      "Invalid random value",
    );
  }
  return value;
}

function scoreTrumpSuit(cards: readonly Card[], suit: Suit): number {
  const candidates = cards.filter((card) => card.suit === suit);
  return (
    candidates.length * 9 +
    candidates.reduce((total, card) => total + card.points, 0) +
    candidates.reduce(
      (total, card) =>
        total + (card.rank === "J" ? 50 : card.rank === "9" ? 30 : 0),
      0,
    )
  );
}

function bestTrumpSuit(cards: readonly Card[]): Suit | null {
  if (cards.length === 0) return null;
  return suits.reduce(
    (best, suit) =>
      best === null || scoreTrumpSuit(cards, suit) > scoreTrumpSuit(cards, best)
        ? suit
        : best,
    null as Suit | null,
  );
}

function actorVisibleCards(
  hand: GameplayHand,
  actor: SeatIndex,
): readonly Card[] {
  const cards = hand.deal.hands[actor] ?? [];
  const indicator = hand.trump.maker === actor ? hand.trump.indicator : null;
  if (!indicator || cards.some((card) => card.id === indicator.id))
    return cards;
  return [...cards, indicator];
}

function candidateTrumpSuit(
  hand: GameplayHand,
  actor: SeatIndex,
  visibleCards: readonly Card[],
): Suit | null {
  if (hand.trump.maker === actor && hand.trump.indicator !== null) {
    return hand.trump.indicator.suit;
  }
  return bestTrumpSuit(visibleCards);
}

function secondBidCeiling(
  hand: GameplayHand,
  actor: SeatIndex,
  difficulty: GameplayBotDifficulty,
): number | null {
  if (difficulty === "easy") return null;

  const visibleCards = actorVisibleCards(hand, actor);
  const candidateSuit = candidateTrumpSuit(hand, actor, visibleCards);
  if (candidateSuit === null) return null;
  const candidateCards = visibleCards.filter(
    (card) => card.suit === candidateSuit,
  );
  const hasJack = candidateCards.some((card) => card.rank === "J");
  const hasNine = candidateCards.some((card) => card.rank === "9");
  if (!hasJack || !hasNine) return null;

  const handPoints = visibleCards.reduce(
    (total, card) => total + card.points,
    0,
  );
  if (difficulty === "normal") return handPoints >= 100 ? 250 : null;

  const jackSuits = new Set(
    visibleCards.filter((card) => card.rank === "J").map((card) => card.suit),
  );
  if (jackSuits.size === suits.length && handPoints >= 140) return 300;

  return Math.min(290, 230 + candidateCards.length * 10);
}

function partnerIsHighest(hand: GameplayHand, actor: SeatIndex): boolean {
  const bidder = hand.bidding.currentBidder;
  return (
    bidder !== null &&
    bidder !== actor &&
    teamForSeat(bidder) === teamForSeat(actor)
  );
}

function chooseBid(
  hand: GameplayHand,
  actor: SeatIndex,
  legal: readonly GameplayCommand[],
  difficulty: GameplayBotDifficulty,
): GameplayCommand | null {
  const bids = legal
    .filter((command): command is BidCommand => command.type === "BID")
    .sort((first, second) => first.amount - second.amount);
  if (partnerIsHighest(hand, actor)) return null;

  if (hand.phase === "four-bidding") {
    const score = evaluateFourCardBidHand(
      hand.deal.firstHands[actor] ?? hand.deal.hands[actor] ?? [],
    );
    const ceiling = fourCardBidCeiling(difficulty, score);
    if (ceiling === null || (hand.bidding.currentBid ?? 0) > ceiling) {
      return null;
    }
    return bids.find((command) => command.amount <= ceiling) ?? null;
  }

  if (hand.phase === "second-bidding") {
    const ceiling = secondBidCeiling(hand, actor, difficulty);
    if (ceiling === null || (hand.bidding.currentBid ?? 0) > ceiling) {
      return null;
    }
    return bids.find((command) => command.amount <= ceiling) ?? null;
  }

  return null;
}

function chooseTrump(
  hand: GameplayHand,
  actor: SeatIndex,
  legal: readonly GameplayCommand[],
): GameplayCommand | null {
  const candidates =
    hand.bidding.round === "four"
      ? (hand.deal.firstHands[actor] ?? [])
      : (hand.deal.hands[actor] ?? []);
  let bestSuit: Suit | null = null;
  let bestScore = -1;
  for (const suit of suits) {
    const score = scoreTrumpSuit(candidates, suit);
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }
  const preferred = candidates.find((card) => card.suit === bestSuit);
  if (!preferred) return null;
  return (
    legal.find(
      (command): command is TrumpCommand =>
        command.type === "SELECT_TRUMP" && command.cardId === preferred.id,
    ) ?? null
  );
}

function chooseTrumpMode(
  hand: GameplayHand,
  legal: readonly GameplayCommand[],
  random: RandomSource,
): GameplayCommand | null {
  const open = legal.find((command) => command.type === "TRUMP_OPEN");
  const closed = legal.find((command) => command.type === "TRUMP_CLOSE");
  if (!open) return closed ?? null;
  if (!closed) return open;
  if ((hand.bidding.currentBid ?? 0) >= 250 && randomValue(random) > 0.4) {
    return closed;
  }
  return open;
}

function chooseCard(
  hand: GameplayHand,
  actor: SeatIndex,
  legal: readonly GameplayCommand[],
): GameplayCommand | null {
  const cards = legal.filter(
    (command): command is CardCommand => command.type === "PLAY_CARD",
  );
  return (
    cards.toSorted((first, second) => {
      if (first.faceDown !== second.faceDown) return first.faceDown ? 1 : -1;
      const firstCard = first.fromIndicator
        ? hand.trump.indicator
        : hand.deal.hands[actor]?.find((card) => card.id === first.cardId);
      const secondCard = second.fromIndicator
        ? hand.trump.indicator
        : hand.deal.hands[actor]?.find((card) => card.id === second.cardId);
      if (!firstCard || !secondCard) return 0;
      return compareRank(hand.profile, firstCard.rank, secondCard.rank);
    })[0] ?? null
  );
}

export function chooseGameplayBotCommand(
  hand: GameplayHand,
  actor: SeatIndex,
  options: GameplayBotOptions,
): GameplayCommand | null {
  const { difficulty, random } = options;
  const legal = legalGameplayCommands(hand, actor);
  if (legal.length === 0) return null;

  if (hand.phase === "four-bidding" || hand.phase === "second-bidding") {
    return (
      chooseBid(hand, actor, legal, difficulty) ??
      legal.find((command) => command.type === "PASS_BID") ??
      legal[0] ??
      null
    );
  }
  if (hand.phase === "trump-selection") {
    return chooseTrump(hand, actor, legal) ?? legal[0] ?? null;
  }
  if (hand.phase === "trump-choice") {
    return chooseTrumpMode(hand, legal, random) ?? legal[0] ?? null;
  }
  if (hand.phase === "trick-play") {
    return chooseCard(hand, actor, legal) ?? legal[0] ?? null;
  }
  return (
    legal.find((command) => command.type === "ACK_RESULT") ?? legal[0] ?? null
  );
}
