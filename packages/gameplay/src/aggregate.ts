import {
  type BiddingState,
  createFourCardBidding,
  decideBidding,
  evolveBidding,
  startSecondBidding,
} from "./bidding.js";
import type { Card } from "./card.js";
import {
  createDeal,
  type DealState,
  dealBatch,
  removeCardFromSeat,
} from "./dealing.js";
import type { GameplayCommand } from "./messages.js";
import type { RuleProfile } from "./profile.js";
import {
  type CancelledHand,
  cancelHand,
  type HandScore,
  type TokenBalance,
} from "./scoring.js";
import { createTrick, type TrickState } from "./trick.js";
import { chooseTrumpMode } from "./trump.js";
import { type SeatIndex, type Suit, seatIndex } from "./values.js";

export type GameplayPhase =
  | "four-bidding"
  | "trump-selection"
  | "second-bidding"
  | "trump-choice"
  | "trick-play"
  | "trick-result"
  | "hand-result"
  | "match-complete";

export interface TrumpState {
  readonly indicator: Card | null;
  readonly maker: SeatIndex | null;
  readonly mode: "closed" | "open" | null;
  readonly open: boolean;
  readonly suit: Suit | null;
}

export interface GameplayHand {
  readonly activeSeat: SeatIndex | null;
  readonly bidding: BiddingState;
  readonly completedTricks: readonly TrickState[];
  readonly currentTrick: TrickState | null;
  readonly deal: DealState;
  readonly dealer: SeatIndex;
  readonly handNumber: number;
  readonly phase: GameplayPhase;
  readonly profile: RuleProfile;
  readonly result: CancelledHand | HandScore | null;
  readonly tokens: TokenBalance;
  readonly trump: TrumpState;
}

export interface StartGameplayHandInput {
  readonly dealer: SeatIndex;
  readonly deck: readonly Card[];
  readonly handNumber: number;
  readonly profile: RuleProfile;
  readonly secondBiddingEnabled: boolean;
  readonly tokens: TokenBalance;
}

export type AggregateCommandResult =
  | { readonly hand: GameplayHand; readonly ok: true }
  | {
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
      readonly ok: false;
    };

export function nextDealer(dealer: SeatIndex, seatCount: 4 | 6): SeatIndex {
  return seatIndex((dealer + 1) % seatCount, seatCount);
}

export function startGameplayHand(input: StartGameplayHandInput): GameplayHand {
  const deal = dealBatch(
    createDeal(input.profile, input.deck),
    input.dealer,
    input.profile.cardBatch[0],
    true,
  );
  const bidding = createFourCardBidding(
    input.profile,
    input.dealer,
    input.secondBiddingEnabled && input.profile.cardBatch[1] > 0,
  );
  return {
    activeSeat: bidding.activeSeat,
    bidding,
    completedTricks: [],
    currentTrick: null,
    deal,
    dealer: input.dealer,
    handNumber: input.handNumber,
    phase: "four-bidding",
    profile: input.profile,
    result: null,
    tokens: [...input.tokens],
    trump: {
      indicator: null,
      maker: null,
      mode: null,
      open: false,
      suit: null,
    },
  };
}

function rejected(code: string, message: string): AggregateCommandResult {
  return { error: { code, message }, ok: false };
}

function returnIndicatorToMaker(hand: GameplayHand): DealState {
  const { indicator, maker } = hand.trump;
  if (!indicator || maker === null) return hand.deal;
  const hands = hand.deal.hands.map((cards, actor) => {
    if (actor !== maker || cards.some((card) => card.id === indicator.id)) {
      return cards;
    }
    return [...cards, indicator];
  });
  return { ...hand.deal, hands };
}

function applyBiddingCommand(
  hand: GameplayHand,
  command: GameplayCommand,
): AggregateCommandResult {
  const decision = decideBidding(hand.profile, hand.bidding, command);
  if (!decision.ok) return decision;
  const bidding = evolveBidding(hand.bidding, decision.events);
  const updated = { ...hand, activeSeat: bidding.activeSeat, bidding };
  if (bidding.status === "active") return { hand: updated, ok: true };
  if (bidding.status === "cancelled") {
    return {
      hand: {
        ...updated,
        activeSeat: null,
        phase: "hand-result",
        result: cancelHand(hand.tokens),
      },
      ok: true,
    };
  }

  const maker = bidding.currentBidder;
  if (maker === null || bidding.currentBid === null) {
    return rejected("INVALID_STATE", "Completed bidding has no maker or bid");
  }
  if (hand.phase === "four-bidding") {
    return {
      hand: {
        ...updated,
        activeSeat: maker,
        phase: "trump-selection",
        trump: { ...hand.trump, maker },
      },
      ok: true,
    };
  }

  const originalMaker = hand.trump.maker;
  const newMakerWon =
    bidding.currentBid !== bidding.previousBid && maker !== originalMaker;
  if (newMakerWon) {
    return {
      hand: {
        ...updated,
        activeSeat: maker,
        deal: returnIndicatorToMaker(hand),
        phase: "trump-selection",
        trump: {
          indicator: null,
          maker,
          mode: null,
          open: false,
          suit: null,
        },
      },
      ok: true,
    };
  }
  return {
    hand: {
      ...updated,
      activeSeat: maker,
      phase: "trump-choice",
      trump: { ...hand.trump, maker },
    },
    ok: true,
  };
}

function applyTrumpSelection(
  hand: GameplayHand,
  command: Extract<GameplayCommand, { type: "SELECT_TRUMP" }>,
): AggregateCommandResult {
  const maker = hand.trump.maker;
  if (maker === null || command.actor !== maker) {
    return rejected("NOT_TRUMP_MAKER", "Only trump maker can select trump");
  }
  const eligibleCards =
    hand.bidding.round === "four"
      ? (hand.deal.firstHands[maker] ?? [])
      : (hand.deal.hands[maker] ?? []);
  const selected = eligibleCards.find((card) => card.id === command.cardId);
  if (!selected) {
    return rejected(
      "INVALID_TRUMP_CARD",
      "Trump indicator must be eligible for this bidding round",
    );
  }
  const removed = removeCardFromSeat(hand.deal, maker, command.cardId);
  if (!removed.ok) return removed;

  const trump: TrumpState = {
    indicator: selected,
    maker,
    mode: null,
    open: false,
    suit: selected.suit,
  };
  if (hand.bidding.round === "second") {
    return {
      hand: {
        ...hand,
        activeSeat: maker,
        deal: removed.deal,
        phase: "trump-choice",
        trump,
      },
      ok: true,
    };
  }

  const deal = dealBatch(
    removed.deal,
    hand.dealer,
    hand.profile.cardBatch[1],
    false,
  );
  const currentBid = hand.bidding.currentBid;
  const shouldRunSecondBidding =
    currentBid !== null &&
    hand.bidding.secondBiddingEnabled &&
    currentBid + hand.profile.fourCardBidStep <= hand.profile.maxBid;
  if (shouldRunSecondBidding) {
    const bidding = startSecondBidding(
      hand.profile,
      maker,
      currentBid,
      hand.bidding.currentBidder ?? maker,
    );
    return {
      hand: {
        ...hand,
        activeSeat: bidding.activeSeat,
        bidding,
        deal,
        phase: "second-bidding",
        trump,
      },
      ok: true,
    };
  }
  return {
    hand: {
      ...hand,
      activeSeat: maker,
      deal,
      phase: "trump-choice",
      trump,
    },
    ok: true,
  };
}

function applyTrumpChoice(
  hand: GameplayHand,
  command: Extract<GameplayCommand, { type: "TRUMP_CLOSE" | "TRUMP_OPEN" }>,
): AggregateCommandResult {
  const maker = hand.trump.maker;
  if (maker === null) {
    return rejected("INVALID_STATE", "Trump maker is not available");
  }
  const mode = command.type === "TRUMP_OPEN" ? "open" : "closed";
  const choice = chooseTrumpMode(hand.profile, maker, command.actor, mode);
  if (!choice.ok) return choice;

  let deal = hand.deal;
  let indicator = hand.trump.indicator;
  if (mode === "open") {
    deal = returnIndicatorToMaker(hand);
    indicator = null;
  }
  const currentTrick = createTrick(maker);
  return {
    hand: {
      ...hand,
      activeSeat: maker,
      currentTrick,
      deal,
      phase: "trick-play",
      trump: {
        ...hand.trump,
        indicator,
        mode,
        open: mode === "open",
      },
    },
    ok: true,
  };
}

export function applyGameplayCommand(
  hand: GameplayHand,
  command: GameplayCommand,
): AggregateCommandResult {
  if (hand.phase === "four-bidding" || hand.phase === "second-bidding") {
    return applyBiddingCommand(hand, command);
  }
  if (hand.phase === "trump-selection" && command.type === "SELECT_TRUMP") {
    return applyTrumpSelection(hand, command);
  }
  if (
    hand.phase === "trump-choice" &&
    (command.type === "TRUMP_CLOSE" || command.type === "TRUMP_OPEN")
  ) {
    return applyTrumpChoice(hand, command);
  }
  return rejected("ACTION_NOT_ALLOWED", "Command is not allowed in this phase");
}
