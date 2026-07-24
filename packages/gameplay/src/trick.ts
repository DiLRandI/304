import type { Card } from "./card.js";
import { compareCardsForTrick } from "./card.js";
import type { RuleProfile } from "./profile.js";
import type { CardId, SeatIndex, Suit } from "./values.js";

export interface TrickPlay {
  readonly actor: SeatIndex;
  readonly card: Card;
  readonly faceDown: boolean;
  readonly fromIndicator: boolean;
}

export interface TrickState {
  readonly activeSeat: SeatIndex | null;
  readonly leaderSeat: SeatIndex;
  readonly openedTrump: boolean;
  readonly plays: readonly TrickPlay[];
  readonly points: number;
  readonly status: "active" | "complete";
  readonly trumpRevealReason?:
    | "face-down-trump-cut"
    | "high-bid-after-first-trick"
    | null;
  readonly winnerSeat: SeatIndex | null;
}

export interface TrickContext {
  readonly completedTrickCount: number;
  readonly forceOpenOnCompletion?: boolean;
  readonly indicator: Card | null;
  readonly maker: SeatIndex;
  readonly mustLeadRemainingTrumps?: boolean;
  readonly profile: RuleProfile;
  readonly trumpOpen: boolean;
  readonly trumpSuit: Suit;
}

export interface LegalCardPlay {
  readonly cardId: CardId;
  readonly faceDown: boolean;
  readonly fromIndicator: boolean;
}

export interface TrickResolution {
  readonly openedTrump: boolean;
  readonly points: number;
  readonly winnerSeat: SeatIndex;
}

interface PlayCardError {
  readonly error: {
    readonly code: "ILLEGAL_CARD_PLAY" | "NOT_ACTIVE_SEAT";
    readonly message: string;
  };
  readonly ok: false;
}

export type PlayCardResult =
  | {
      readonly hand: readonly Card[];
      readonly indicator: Card | null;
      readonly ok: true;
      readonly trick: TrickState;
      readonly trumpOpen: boolean;
    }
  | PlayCardError;

export function createTrick(leaderSeat: SeatIndex): TrickState {
  return {
    activeSeat: leaderSeat,
    leaderSeat,
    openedTrump: false,
    plays: [],
    points: 0,
    status: "active",
    trumpRevealReason: null,
    winnerSeat: null,
  };
}

export function exhaustedTrumpLeadRequired(
  completedTricks: readonly TrickState[],
  maker: SeatIndex,
  trumpSuit: Suit,
): boolean {
  const previous = completedTricks[completedTricks.length - 1];
  const lead = previous?.plays[0];
  return Boolean(
    previous?.status === "complete" &&
      previous.leaderSeat === maker &&
      previous.winnerSeat === maker &&
      lead?.actor === maker &&
      lead.card.suit === trumpSuit &&
      previous.plays.slice(1).every((play) => play.card.suit !== trumpSuit),
  );
}

function play(
  card: Card,
  faceDown: boolean,
  fromIndicator: boolean,
): LegalCardPlay {
  return { cardId: card.id, faceDown, fromIndicator };
}

export function legalCardPlays(
  context: TrickContext,
  trick: TrickState,
  hand: readonly Card[],
  actor: SeatIndex,
): readonly LegalCardPlay[] {
  if (trick.status !== "active" || trick.activeSeat !== actor) return [];

  const ledSuit = trick.plays[0]?.card.suit;
  const isLeader = ledSuit === undefined;
  const cardsInLedSuit = ledSuit
    ? hand.filter((card) => card.suit === ledSuit)
    : [];
  let playableHand =
    !isLeader && cardsInLedSuit.length > 0 ? cardsInLedSuit : hand;
  if (isLeader && actor === context.maker && context.mustLeadRemainingTrumps) {
    const remainingTrumps = hand.filter(
      (card) => card.suit === context.trumpSuit,
    );
    if (remainingTrumps.length > 0) playableHand = remainingTrumps;
  } else if (
    isLeader &&
    actor === context.maker &&
    context.completedTrickCount === 0 &&
    !context.trumpOpen
  ) {
    playableHand = hand.filter((card) => card.suit !== context.trumpSuit);
  }
  const legal = playableHand.flatMap((card) => {
    if (isLeader || cardsInLedSuit.length > 0 || context.trumpOpen) {
      return [play(card, false, false)];
    }
    if (actor === context.maker && card.suit === context.trumpSuit) return [];
    return [play(card, true, false)];
  });

  const finalIndicatorOnlyCard =
    hand.length === 0 &&
    context.completedTrickCount ===
      context.profile.cardBatch[0] + context.profile.cardBatch[1] - 1;
  const makerCanCutWithIndicator =
    !isLeader && ledSuit !== context.trumpSuit && cardsInLedSuit.length === 0;
  if (
    context.indicator &&
    !context.trumpOpen &&
    actor === context.maker &&
    (finalIndicatorOnlyCard || makerCanCutWithIndicator)
  ) {
    legal.push(play(context.indicator, true, true));
  }
  return legal;
}

export function resolveTrick(
  profile: RuleProfile,
  plays: readonly TrickPlay[],
  trumpSuit: Suit,
  trumpOpen: boolean,
): TrickResolution {
  const first = plays[0];
  if (!first) throw new Error("Cannot resolve a trick without plays");

  const openedTrump =
    !trumpOpen &&
    plays.some((item) => item.faceDown && item.card.suit === trumpSuit);
  const effectiveTrumpOpen = trumpOpen || openedTrump;
  let winner = first;
  for (const candidate of plays.slice(1)) {
    if (
      compareCardsForTrick(
        profile,
        candidate.card,
        winner.card,
        trumpSuit,
        first.card.suit,
        effectiveTrumpOpen,
      ) > 0
    ) {
      winner = candidate;
    }
  }
  return {
    openedTrump,
    points: plays.reduce((total, item) => total + item.card.points, 0),
    winnerSeat: winner.actor,
  };
}

export function playCard(
  context: TrickContext,
  trick: TrickState,
  hand: readonly Card[],
  actor: SeatIndex,
  selection: {
    readonly cardId: CardId | undefined;
    readonly faceDown: boolean;
    readonly fromIndicator: boolean;
  },
): PlayCardResult {
  if (trick.status !== "active" || trick.activeSeat !== actor) {
    return {
      error: {
        code: "NOT_ACTIVE_SEAT",
        message: "Only the active seat can play",
      },
      ok: false,
    };
  }
  const legal = legalCardPlays(context, trick, hand, actor).some(
    (candidate) =>
      candidate.cardId === selection.cardId &&
      candidate.faceDown === selection.faceDown &&
      candidate.fromIndicator === selection.fromIndicator,
  );
  const selectedCard = selection.fromIndicator
    ? context.indicator
    : hand.find((card) => card.id === selection.cardId);
  if (!legal || !selectedCard) {
    return {
      error: { code: "ILLEGAL_CARD_PLAY", message: "Card play is not legal" },
      ok: false,
    };
  }

  const plays = [
    ...trick.plays,
    {
      actor,
      card: selectedCard,
      faceDown: selection.faceDown,
      fromIndicator: selection.fromIndicator,
    },
  ];
  const handAfterPlay = selection.fromIndicator
    ? hand
    : hand.filter((card) => card.id !== selectedCard.id);
  const indicator = selection.fromIndicator ? null : context.indicator;
  if (plays.length === context.profile.seatCount) {
    const resolution = resolveTrick(
      context.profile,
      plays,
      context.trumpSuit,
      context.trumpOpen,
    );
    const openedTrump =
      resolution.openedTrump || Boolean(context.forceOpenOnCompletion);
    const trumpRevealReason = resolution.openedTrump
      ? "face-down-trump-cut"
      : context.forceOpenOnCompletion
        ? "high-bid-after-first-trick"
        : null;
    return {
      hand: handAfterPlay,
      indicator,
      ok: true,
      trick: {
        ...trick,
        activeSeat: null,
        openedTrump,
        plays,
        points: resolution.points,
        status: "complete",
        trumpRevealReason,
        winnerSeat: resolution.winnerSeat,
      },
      trumpOpen: context.trumpOpen || openedTrump,
    };
  }

  return {
    hand: handAfterPlay,
    indicator,
    ok: true,
    trick: {
      ...trick,
      activeSeat: ((actor + 1) % context.profile.seatCount) as SeatIndex,
      plays,
      points: trick.points + selectedCard.points,
    },
    trumpOpen: context.trumpOpen,
  };
}
