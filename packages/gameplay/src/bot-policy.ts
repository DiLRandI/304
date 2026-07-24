import type { GameplayHand } from "./aggregate.js";
import { compareRank, type RandomSource } from "./card.js";
import { legalGameplayCommands } from "./legal-actions.js";
import type { GameplayCommand } from "./messages.js";
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

function chooseBid(
  hand: GameplayHand,
  actor: SeatIndex,
  legal: readonly GameplayCommand[],
): GameplayCommand | null {
  const cards = hand.deal.hands[actor] ?? [];
  const suitCounts = Object.fromEntries(
    suits.map((suit) => [suit, 0]),
  ) as Record<Suit, number>;
  for (const card of cards) suitCounts[card.suit] += 1;
  const handScore =
    cards.reduce((total, card) => total + card.points, 0) +
    Object.values(suitCounts).reduce(
      (total, count) => total + Math.max(0, count - 2) * 4,
      0,
    );
  const bids = legal
    .filter((command): command is BidCommand => command.type === "BID")
    .sort((first, second) => first.amount - second.amount);

  if (hand.phase === "four-bidding") {
    const lastChanceToOpen =
      hand.bidding.currentBid === null &&
      hand.bidding.noBidPasses >= hand.profile.seatCount - 1;
    if (handScore < 40 && !lastChanceToOpen) return null;
    if (hand.profile.id === "six_304_36") {
      return (
        bids
          .toReversed()
          .find(
            (command) =>
              command.amount >= 160 &&
              command.amount <= 190 + Math.floor(handScore / 5),
          ) ?? null
      );
    }
    return bids[Math.min(2, bids.length - 1)] ?? null;
  }

  if (hand.phase === "second-bidding") {
    if (
      bids.length === 0 ||
      (hand.profile.id === "classic_304_4p" &&
        cards.reduce((total, card) => total + card.points, 0) < 100)
    ) {
      return null;
    }
    const currentBid = hand.bidding.currentBid ?? 0;
    return (
      bids
        .toReversed()
        .find(
          (command) =>
            command.amount >= 250 &&
            command.amount <= currentBid + 20 + Math.floor(handScore / 4),
        ) ?? null
    );
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
    const cards = candidates.filter((card) => card.suit === suit);
    const score =
      cards.length * 9 +
      cards.reduce((total, card) => total + card.points, 0) +
      cards.reduce(
        (total, card) =>
          total + (card.rank === "J" ? 50 : card.rank === "9" ? 30 : 0),
        0,
      );
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
  const { random } = options;
  const legal = legalGameplayCommands(hand, actor);
  if (legal.length === 0) return null;

  if (hand.phase === "four-bidding" || hand.phase === "second-bidding") {
    return (
      chooseBid(hand, actor, legal) ??
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
