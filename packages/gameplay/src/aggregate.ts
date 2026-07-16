import { type BiddingState, createFourCardBidding } from "./bidding.js";
import type { Card } from "./card.js";
import { createDeal, type DealState, dealBatch } from "./dealing.js";
import type { RuleProfile } from "./profile.js";
import type { TokenBalance } from "./scoring.js";
import type { TrickState } from "./trick.js";
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
