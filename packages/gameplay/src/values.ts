declare const gameplayBrand: unique symbol;

type GameplayValue<Value, Name extends string> = Value & {
  readonly [gameplayBrand]: Name;
};

export type BidAmount = GameplayValue<number, "BidAmount">;
export type CardId = GameplayValue<string, "CardId">;
export type RuleProfileId = "classic_304_4p" | "six_304_36";
export type SeatIndex = GameplayValue<number, "SeatIndex">;
export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Team = "A" | "B";

export class InvalidGameplayValue extends Error {
  constructor(
    readonly code:
      | "INVALID_BID_AMOUNT"
      | "INVALID_CARD_ID"
      | "INVALID_RULE_PROFILE"
      | "INVALID_SEAT_INDEX",
    message: string,
  ) {
    super(message);
    this.name = "InvalidGameplayValue";
  }
}

export function bidAmount(value: number): BidAmount {
  if (!Number.isInteger(value) || value < 160 || value > 304) {
    throw new InvalidGameplayValue("INVALID_BID_AMOUNT", "Invalid bid amount");
  }
  return value as BidAmount;
}

export function cardId(value: string): CardId {
  if (!/^[CDHS]_(?:6|7|8|9|10|J|Q|K|A)$/.test(value)) {
    throw new InvalidGameplayValue("INVALID_CARD_ID", "Invalid card id");
  }
  return value as CardId;
}

export function ruleProfileId(value: string): RuleProfileId {
  if (value !== "classic_304_4p" && value !== "six_304_36") {
    throw new InvalidGameplayValue(
      "INVALID_RULE_PROFILE",
      "Invalid rule profile",
    );
  }
  return value;
}

export function seatIndex(value: number, seatCount: number): SeatIndex {
  if (
    !Number.isInteger(value) ||
    !Number.isInteger(seatCount) ||
    seatCount < 1 ||
    value < 0 ||
    value >= seatCount
  ) {
    throw new InvalidGameplayValue("INVALID_SEAT_INDEX", "Invalid seat index");
  }
  return value as SeatIndex;
}
