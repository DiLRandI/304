import type { Card } from "./card.js";
import type { RuleProfile } from "./profile.js";
import type { CardId, SeatIndex } from "./values.js";

export interface DealState {
  readonly deck: readonly Card[];
  readonly firstHands: readonly (readonly Card[])[];
  readonly hands: readonly (readonly Card[])[];
  readonly seatCount: 4 | 6;
}

export type RemoveCardResult =
  | { readonly card: Card; readonly deal: DealState; readonly ok: true }
  | {
      readonly error: {
        readonly code: "CARD_NOT_IN_HAND";
        readonly message: "Card is not in the seat's hand";
      };
      readonly ok: false;
    };

export function createDeal(
  profile: RuleProfile,
  deck: readonly Card[],
): DealState {
  return {
    deck: [...deck],
    firstHands: Array.from({ length: profile.seatCount }, () => []),
    hands: Array.from({ length: profile.seatCount }, () => []),
    seatCount: profile.seatCount,
  };
}

export function dealBatch(
  state: DealState,
  dealer: SeatIndex,
  countPerSeat: number,
  markFirstBatch: boolean,
): DealState {
  const deck = [...state.deck];
  const hands = state.hands.map((hand) => [...hand]);
  const firstHands = state.firstHands.map((hand) => [...hand]);

  for (let round = 0; round < countPerSeat; round += 1) {
    for (let offset = 0; offset < state.seatCount; offset += 1) {
      const actor = (dealer + 1 + offset) % state.seatCount;
      const card = deck.pop();
      if (!card) continue;
      hands[actor]?.push(card);
      if (markFirstBatch) firstHands[actor]?.push(card);
    }
  }

  return { ...state, deck, firstHands, hands };
}

export function removeCardFromSeat(
  state: DealState,
  actor: SeatIndex,
  selectedCardId: CardId | undefined,
): RemoveCardResult {
  const hand = state.hands[actor] ?? [];
  const card = hand.find((candidate) => candidate.id === selectedCardId);
  if (!card) {
    return {
      error: {
        code: "CARD_NOT_IN_HAND",
        message: "Card is not in the seat's hand",
      },
      ok: false,
    };
  }
  const hands = state.hands.map((currentHand, seat) =>
    seat === actor
      ? currentHand.filter((candidate) => candidate.id !== selectedCardId)
      : currentHand,
  );
  return { card, deal: { ...state, hands }, ok: true };
}
