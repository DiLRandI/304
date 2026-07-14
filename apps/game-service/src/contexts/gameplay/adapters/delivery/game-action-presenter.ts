import type { GameAction } from "@three-zero-four/contracts";
import { DomainError } from "../../../../domain/errors.js";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function presentGameAction(action: Record<string, unknown>): GameAction {
  switch (action.type) {
    case "BID":
      if (typeof action.amount === "number") {
        return { type: "BID", amount: action.amount };
      }
      break;
    case "PASS_BID":
      return { type: "PASS_BID" };
    case "SELECT_TRUMP":
      if (isString(action.cardId)) {
        return { type: "SELECT_TRUMP", cardId: action.cardId };
      }
      break;
    case "TRUMP_OPEN":
      return { type: "TRUMP_OPEN" };
    case "TRUMP_CLOSE":
      return { type: "TRUMP_CLOSE" };
    case "PLAY_CARD":
      if (isString(action.cardId)) {
        return {
          type: "PLAY_CARD",
          cardId: action.cardId,
          faceDown: Boolean(action.faceDown),
          fromIndicator: Boolean(action.fromIndicator),
        };
      }
      break;
    case "ACK_RESULT":
      return { type: "ACK_RESULT" };
    default:
      break;
  }
  throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid legal action");
}
