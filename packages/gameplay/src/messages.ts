import type { BidAmount, CardId, SeatIndex } from "./values.js";

export type GameplayCommand =
  | {
      readonly actor: SeatIndex;
      readonly amount: BidAmount;
      readonly type: "BID";
    }
  | { readonly actor: SeatIndex; readonly type: "PASS_BID" }
  | {
      readonly actor: SeatIndex;
      readonly cardId: CardId;
      readonly type: "SELECT_TRUMP";
    }
  | { readonly actor: SeatIndex; readonly type: "TRUMP_OPEN" }
  | { readonly actor: SeatIndex; readonly type: "TRUMP_CLOSE" }
  | {
      readonly actor: SeatIndex;
      readonly cardId: CardId;
      readonly faceDown: boolean;
      readonly fromIndicator: boolean;
      readonly type: "PLAY_CARD";
    }
  | { readonly actor: SeatIndex | null; readonly type: "ACK_RESULT" }
  | { readonly actor: null; readonly type: "ADVANCE_TRICK" };

export type GameplayEvent =
  | {
      readonly actor: SeatIndex;
      readonly amount: BidAmount;
      readonly type: "BID_PLACED";
    }
  | { readonly actor: SeatIndex; readonly type: "BID_PASSED" }
  | { readonly type: "BIDDING_CANCELLED" }
  | { readonly type: "BIDDING_COMPLETED" }
  | {
      readonly actor: SeatIndex;
      readonly cardId: CardId;
      readonly type: "TRUMP_SELECTED";
    }
  | {
      readonly actor: SeatIndex;
      readonly open: boolean;
      readonly type: "TRUMP_MODE_CHOSEN";
    }
  | {
      readonly actor: SeatIndex;
      readonly cardId: CardId;
      readonly faceDown: boolean;
      readonly fromIndicator: boolean;
      readonly type: "CARD_PLAYED";
    }
  | { readonly type: "TRICK_COMPLETED"; readonly winner: SeatIndex }
  | { readonly type: "TRICK_ADVANCED" }
  | { readonly type: "HAND_COMPLETED" }
  | { readonly type: "RESULT_ACKNOWLEDGED" };

export interface GameplayDecisionError {
  readonly code:
    | "ACTION_NOT_ALLOWED"
    | "CARD_NOT_IN_HAND"
    | "INVALID_STATE"
    | "INVALID_BID"
    | "NOT_ACTIVE_SEAT"
    | "NOT_TRUMP_MAKER"
    | "RULE_VIOLATION";
  readonly message: string;
}

export type GameplayDecision =
  | {
      readonly events: readonly GameplayEvent[];
      readonly ok: true;
    }
  | {
      readonly error: GameplayDecisionError;
      readonly ok: false;
    };
