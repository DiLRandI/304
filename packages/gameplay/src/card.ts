import type { Rank, RuleProfile } from "./profile.js";
import {
  type CardId,
  cardId,
  InvalidGameplayValue,
  type Suit,
} from "./values.js";

export interface Card {
  readonly id: CardId;
  readonly points: number;
  readonly rank: Rank;
  readonly suit: Suit;
}

export interface RandomSource {
  next(): number;
}

const suits = ["clubs", "diamonds", "hearts", "spades"] as const;
const suitPrefixes: Readonly<Record<Suit, "C" | "D" | "H" | "S">> = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S",
};

export function buildDeck(profile: RuleProfile): Card[] {
  return suits.flatMap((suit) =>
    profile.deckRanks.map((rank) => ({
      id: cardId(`${suitPrefixes[suit]}_${rank}`),
      points: profile.cardPoints[rank] ?? 0,
      rank,
      suit,
    })),
  );
}

export function compareRank(
  profile: RuleProfile,
  first: Rank,
  second: Rank,
): number {
  const firstPower = profile.rankOrderHighToLow.indexOf(first);
  const secondPower = profile.rankOrderHighToLow.indexOf(second);
  if (firstPower < secondPower) return 1;
  if (firstPower > secondPower) return -1;
  return 0;
}

export function compareCardsForTrick(
  profile: RuleProfile,
  first: Card,
  second: Card,
  trumpSuit: Suit,
  ledSuit: Suit,
  trumpOpen: boolean,
): number {
  const firstIsTrump = trumpOpen && first.suit === trumpSuit;
  const secondIsTrump = trumpOpen && second.suit === trumpSuit;
  if (firstIsTrump && !secondIsTrump) return 1;
  if (!firstIsTrump && secondIsTrump) return -1;
  if (firstIsTrump && secondIsTrump) {
    return compareRank(profile, first.rank, second.rank);
  }
  if (first.suit === ledSuit && second.suit !== ledSuit) return 1;
  if (first.suit !== ledSuit && second.suit === ledSuit) return -1;
  if (first.suit === second.suit) {
    return compareRank(profile, first.rank, second.rank);
  }
  return 0;
}

export function shuffleDeck(
  cards: readonly Card[],
  random: RandomSource,
): Card[] {
  const shuffled = cards.map((current) => ({ ...current }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = random.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new InvalidGameplayValue(
        "INVALID_RANDOM_VALUE",
        "Invalid random value",
      );
    }
    const swapIndex = Math.floor(value * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (!current || !replacement) {
      throw new InvalidGameplayValue(
        "INVALID_RANDOM_VALUE",
        "Invalid random value",
      );
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}
