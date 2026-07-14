import type { GameAction } from "@three-zero-four/contracts";
import type { ProjectedCard } from "../model/card-view";
import type { ProjectedHandResult } from "../model/hand-result-view";
import { cardLabel } from "./card";

function actionLabel(
  action: GameAction,
  handResult: ProjectedHandResult | null,
  hand: readonly ProjectedCard[],
): string {
  switch (action.type) {
    case "BID":
      return `Bid ${action.amount}`;
    case "PASS_BID":
      return "Pass bid";
    case "TRUMP_OPEN":
      return "Open trump";
    case "TRUMP_CLOSE":
      return "Keep trump closed";
    case "ACK_RESULT":
      return handResult &&
        !("noScore" in handResult) &&
        handResult.matchComplete
        ? "Play another match"
        : "Next hand";
    case "SELECT_TRUMP": {
      const card = hand.find((item) => item.cardId === action.cardId);
      return card ? `Choose ${cardLabel(card)} as trump` : "Choose trump";
    }
    case "PLAY_CARD": {
      if (action.fromIndicator) {
        return "Play hidden trump indicator face down";
      }
      const card = hand.find((item) => item.cardId === action.cardId);
      if (!card) {
        return action.faceDown
          ? "Play a legal card face down"
          : "Play a legal card";
      }
      return action.faceDown
        ? `Play ${cardLabel(card)} face down`
        : `Play ${cardLabel(card)}`;
    }
  }
}

export function CommandActions({
  actions,
  hand,
  handResult,
  onSelect,
}: {
  actions: readonly GameAction[];
  hand: readonly ProjectedCard[];
  handResult: ProjectedHandResult | null;
  onSelect(action: GameAction): void;
}) {
  if (actions.length === 0) return null;

  return (
    <section aria-label="Legal actions" className="command-actions">
      {actions.map((action) => (
        <button
          key={JSON.stringify(action)}
          onClick={() => onSelect(action)}
          type="button"
        >
          {actionLabel(action, handResult, hand)}
        </button>
      ))}
    </section>
  );
}
