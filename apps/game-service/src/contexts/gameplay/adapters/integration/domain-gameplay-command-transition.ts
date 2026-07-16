import type { GameAction } from "@three-zero-four/contracts";
import {
  applyGameplayCommand,
  type GameplayCommand,
  type GameplayHand,
} from "@three-zero-four/gameplay";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../persistence/domain-gameplay-snapshot-codec.js";
import { toGameplayCommand } from "./wire-gameplay-command-mapper.js";

export interface GameplayCommandTransition {
  readonly command: GameplayCommand;
  readonly hand: GameplayHand;
  readonly snapshot: LegacyGameplaySnapshotRecord;
}

export function transitionGameplayCommand(
  source: LegacyGameplaySnapshotRecord,
  action: GameAction,
  actorSeatIndex: number,
): GameplayCommandTransition {
  const before = decodeGameplayHand(source);
  const command = toGameplayCommand(
    action,
    actorSeatIndex,
    before.profile.seatCount,
    before.trump.indicator?.id ?? null,
  );
  const decision = applyGameplayCommand(before, command);
  if (!decision.ok) {
    throw new GameplayApplicationError(
      "ACTION_REJECTED",
      decision.error.message,
    );
  }
  return {
    command,
    hand: decision.hand,
    snapshot: encodeGameplayHand(decision.hand, { command, source }),
  };
}
