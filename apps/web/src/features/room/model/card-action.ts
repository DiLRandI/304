import type { GameAction } from "@three-zero-four/contracts";
import type { ProjectedCard } from "./card-view";

export function cardAction(
  card: ProjectedCard,
  actions: readonly GameAction[],
): GameAction | null {
  const matching = actions.filter(
    (action) =>
      (action.type === "PLAY_CARD" || action.type === "SELECT_TRUMP") &&
      action.cardId === card.cardId,
  );
  return (
    matching.find(
      (action) => action.type !== "PLAY_CARD" || action.faceDown === false,
    ) ??
    matching[0] ??
    null
  );
}

export function partitionCardActions(
  hand: readonly ProjectedCard[],
  legalActions: readonly GameAction[],
): { cardActions: GameAction[]; commandActions: GameAction[] } {
  const cardActions = hand
    .map((card) => cardAction(card, legalActions))
    .filter((action): action is GameAction => action !== null);
  const primaryCardActions = new Set(cardActions);
  return {
    cardActions,
    commandActions: legalActions.filter(
      (action) => !primaryCardActions.has(action),
    ),
  };
}
