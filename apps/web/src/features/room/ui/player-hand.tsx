import type { GameAction } from "@three-zero-four/contracts";
import { cardAction } from "../model/card-action";
import type { ProjectedCard } from "../model/card-view";
import { CardButton } from "./card";

export function PlayerHand({
  hand,
  isPlayersTurn,
  legalActions,
  onSelect,
}: {
  hand: readonly ProjectedCard[];
  isPlayersTurn: boolean;
  legalActions: readonly GameAction[];
  onSelect(action: GameAction): void;
}) {
  const unavailableReason = isPlayersTurn
    ? "This card is not legal for this turn. Use the highlighted legal cards or action buttons."
    : "Wait for your turn. The table will highlight legal cards when you can act.";

  return (
    <>
      <section aria-label="Your hand" className="player-hand">
        {hand.map((card) => (
          <CardButton
            action={cardAction(card, legalActions)}
            card={card}
            key={card.cardId}
            onSelect={onSelect}
            unavailableReason={unavailableReason}
          />
        ))}
      </section>
      <p className="card-legality-note" id="card-legality-note">
        {unavailableReason}
      </p>
    </>
  );
}
