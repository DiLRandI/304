import {
  applyGameplayCommand,
  type GameplayCommand,
  type GameplayHand,
} from "@three-zero-four/gameplay";
import {
  type GameplaySnapshotRecord,
  serializeGameplaySnapshot,
} from "../../../gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { AutomationExecutionError } from "../../application/automation-execution-error.js";

export interface AutomatedGameplayCommandTransition {
  readonly command: GameplayCommand;
  readonly hand: GameplayHand;
  readonly snapshot: GameplaySnapshotRecord;
}

export function transitionAutomatedGameplayCommand(
  before: GameplayHand,
  command: GameplayCommand,
): AutomatedGameplayCommandTransition {
  const decision = applyGameplayCommand(before, command);
  if (!decision.ok) {
    throw new AutomationExecutionError(
      "AUTOMATION_ACTION_REJECTED",
      decision.error.message,
    );
  }
  return {
    command,
    hand: decision.hand,
    snapshot: serializeGameplaySnapshot(decision.hand),
  };
}
