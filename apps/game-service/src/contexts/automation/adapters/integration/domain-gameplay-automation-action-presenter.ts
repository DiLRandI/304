import type { GameAction } from "@three-zero-four/contracts";
import type { GameplayCommand } from "@three-zero-four/gameplay";
import { AutomationExecutionError } from "../../application/automation-execution-error.js";

export function presentAutomatedGameplayAction(
  command: GameplayCommand,
): GameAction {
  switch (command.type) {
    case "BID":
      return { amount: command.amount, type: "BID" };
    case "PASS_BID":
      return { type: "PASS_BID" };
    case "SELECT_TRUMP":
      return { cardId: command.cardId, type: "SELECT_TRUMP" };
    case "TRUMP_OPEN":
      return { type: "TRUMP_OPEN" };
    case "TRUMP_CLOSE":
      return { type: "TRUMP_CLOSE" };
    case "PLAY_CARD":
      return {
        cardId: command.fromIndicator ? "__trump_indicator__" : command.cardId,
        faceDown: command.faceDown,
        fromIndicator: command.fromIndicator,
        type: "PLAY_CARD",
      };
    case "ACK_RESULT":
      return { type: "ACK_RESULT" };
    case "ADVANCE_TRICK":
      throw new AutomationExecutionError(
        "AUTOMATION_ACTION_REJECTED",
        "Trick advancement is not a wire gameplay action",
      );
  }
}
