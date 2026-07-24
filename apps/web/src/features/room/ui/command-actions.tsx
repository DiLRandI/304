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
      return action.amount >= 250
        ? `Bid ${action.amount} — trump opens after trick one`
        : `Bid ${action.amount}`;
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
  currentBid = 0,
  hand,
  handResult,
  onSelect,
}: {
  actions: readonly GameAction[];
  currentBid?: number;
  hand: readonly ProjectedCard[];
  handResult: ProjectedHandResult | null;
  onSelect(action: GameAction): void;
}) {
  if (actions.length === 0) return null;
  const offersHighBid = actions.some(
    (action) => action.type === "BID" && action.amount >= 250,
  );
  const choosingTrumpMode = actions.some(
    (action) => action.type === "TRUMP_CLOSE" || action.type === "TRUMP_OPEN",
  );

  return (
    <section aria-label="Legal actions" className="command-actions">
      {offersHighBid ? (
        <p>
          Bids of 250 or more open trump automatically after the first trick.
        </p>
      ) : null}
      {choosingTrumpMode && currentBid >= 250 ? (
        <p>
          Your {currentBid} bid will open trump automatically after trick one,
          even if you keep it closed now.
        </p>
      ) : null}
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
