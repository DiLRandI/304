import type { Card } from "./card.js";
import type { RuleProfile } from "./profile.js";
import type { CardId, SeatIndex } from "./values.js";

export type TrumpMode = "closed" | "open";

interface TrumpError {
  readonly error: {
    readonly code:
      | "INVALID_TRUMP_CARD"
      | "NOT_TRUMP_MAKER"
      | "TRUMP_MODE_NOT_ALLOWED";
    readonly message: string;
  };
  readonly ok: false;
}

export type TrumpSelection =
  | {
      readonly hand: readonly Card[];
      readonly indicator: Card;
      readonly ok: true;
    }
  | TrumpError;

export function selectTrumpIndicator(
  hand: readonly Card[],
  eligibleCardIds: readonly CardId[],
  selectedCardId: CardId | undefined,
): TrumpSelection {
  const indicator = hand.find(
    (card) => card.id === selectedCardId && eligibleCardIds.includes(card.id),
  );
  if (!indicator) {
    return {
      error: {
        code: "INVALID_TRUMP_CARD",
        message: "Trump indicator must be an eligible card in the maker's hand",
      },
      ok: false,
    };
  }
  return {
    hand: hand.filter((card) => card.id !== indicator.id),
    indicator,
    ok: true,
  };
}

export function chooseTrumpMode(
  profile: RuleProfile,
  maker: SeatIndex,
  actor: SeatIndex,
  mode: TrumpMode,
): { readonly mode: TrumpMode; readonly ok: true } | TrumpError {
  if (actor !== maker) {
    return {
      error: {
        code: "NOT_TRUMP_MAKER",
        message: "Only trump maker can choose trump mode",
      },
      ok: false,
    };
  }
  if (
    (mode === "closed" && !profile.allowClosedTrump) ||
    (mode === "open" && !profile.allowOpenTrump)
  ) {
    return {
      error: {
        code: "TRUMP_MODE_NOT_ALLOWED",
        message: "Trump mode is not allowed by the rule profile",
      },
      ok: false,
    };
  }
  return { mode, ok: true };
}
