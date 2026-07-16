import type { GameAction } from "@three-zero-four/contracts";
import {
  bidAmount,
  type CardId,
  cardId,
  type GameplayCommand,
  InvalidGameplayValue,
  seatIndex,
} from "@three-zero-four/gameplay";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";

function rejectedAction(): GameplayApplicationError {
  return new GameplayApplicationError("ACTION_REJECTED", "Action was rejected");
}

export function toGameplayCommand(
  action: GameAction,
  actorSeatIndex: number,
  seatCount: number,
  indicatorCardId: CardId | null,
): GameplayCommand {
  try {
    const actor = seatIndex(actorSeatIndex, seatCount);

    switch (action.type) {
      case "BID":
        return { actor, amount: bidAmount(action.amount), type: "BID" };
      case "PASS_BID":
        return { actor, type: "PASS_BID" };
      case "SELECT_TRUMP":
        return {
          actor,
          cardId: cardId(action.cardId),
          type: "SELECT_TRUMP",
        };
      case "TRUMP_OPEN":
        return { actor, type: "TRUMP_OPEN" };
      case "TRUMP_CLOSE":
        return { actor, type: "TRUMP_CLOSE" };
      case "PLAY_CARD": {
        const playedCardId =
          action.fromIndicator && action.cardId === "__trump_indicator__"
            ? indicatorCardId
            : cardId(action.cardId);

        if (playedCardId === null) {
          throw rejectedAction();
        }

        return {
          actor,
          cardId: playedCardId,
          faceDown: action.faceDown,
          fromIndicator: action.fromIndicator,
          type: "PLAY_CARD",
        };
      }
      case "ACK_RESULT":
        return { actor, type: "ACK_RESULT" };
    }
  } catch (error) {
    if (error instanceof InvalidGameplayValue) {
      throw rejectedAction();
    }
    throw error;
  }
}
