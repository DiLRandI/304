import {
  applyGameplayCommand,
  type GameplayCommand,
  type GameplayHand,
} from "@three-zero-four/gameplay";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../../../gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";
import { AutomationExecutionError } from "../../application/automation-execution-error.js";

export interface AutomatedGameplayCommandTransition {
  readonly command: GameplayCommand;
  readonly hand: GameplayHand;
  readonly snapshot: LegacyGameplaySnapshotRecord;
}

export function transitionAutomatedGameplayCommand(
  source: LegacyGameplaySnapshotRecord,
  command: GameplayCommand,
): AutomatedGameplayCommandTransition {
  const before = decodeGameplayHand(source);
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
    snapshot: encodeGameplayHand(decision.hand, { command, source }),
  };
}
