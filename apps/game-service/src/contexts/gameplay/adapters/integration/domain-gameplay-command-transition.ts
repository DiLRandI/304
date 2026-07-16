import type { GameAction } from "@three-zero-four/contracts";
import {
  acknowledgeGameplayResult,
  applyGameplayCommand,
  type GameplayCommand,
  type GameplayHand,
} from "@three-zero-four/gameplay";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";
import type {
  GameplayHandShuffler,
  PreparedGameplayHandDeck,
} from "../../application/gameplay-hand-shuffler.js";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../persistence/domain-gameplay-snapshot-codec.js";
import {
  type GameplaySnapshotRecord,
  serializeGameplaySnapshot,
} from "../persistence/gameplay-snapshot-codec.js";
import { toGameplayCommand } from "./wire-gameplay-command-mapper.js";

export interface GameplayCommandTransition {
  readonly command: GameplayCommand;
  readonly hand: GameplayHand;
  readonly nextHand?: PreparedGameplayHandDeck;
  readonly snapshot: LegacyGameplaySnapshotRecord;
}

export function transitionGameplayCommand(
  source: LegacyGameplaySnapshotRecord,
  action: GameAction,
  actorSeatIndex: number,
  shuffler: GameplayHandShuffler,
): GameplayCommandTransition {
  const before = decodeGameplayHand(source);
  const command = toGameplayCommand(
    action,
    actorSeatIndex,
    before.profile.seatCount,
    before.trump.indicator?.id ?? null,
  );
  const nextHand =
    command.type === "ACK_RESULT"
      ? shuffler.prepare(before.profile, before.handNumber + 1)
      : undefined;
  const decision = nextHand
    ? acknowledgeGameplayResult(before, nextHand.deck)
    : applyGameplayCommand(before, command);
  if (!decision.ok) {
    throw new GameplayApplicationError(
      "ACTION_REJECTED",
      decision.error.message,
    );
  }
  return {
    command,
    hand: decision.hand,
    ...(nextHand ? { nextHand } : {}),
    snapshot: encodeGameplayHand(decision.hand, {
      command,
      ...(nextHand ? { nextHand } : {}),
      source,
    }),
  };
}

export interface HydratedGameplayCommandTransition {
  readonly command: GameplayCommand;
  readonly hand: GameplayHand;
  readonly nextHand?: PreparedGameplayHandDeck;
  readonly snapshot: GameplaySnapshotRecord;
}

export function transitionHydratedGameplayCommand(
  before: GameplayHand,
  action: GameAction,
  actorSeatIndex: number,
  shuffler: GameplayHandShuffler,
): HydratedGameplayCommandTransition {
  const command = toGameplayCommand(
    action,
    actorSeatIndex,
    before.profile.seatCount,
    before.trump.indicator?.id ?? null,
  );
  const nextHand =
    command.type === "ACK_RESULT"
      ? shuffler.prepare(before.profile, before.handNumber + 1)
      : undefined;
  const decision = nextHand
    ? acknowledgeGameplayResult(before, nextHand.deck)
    : applyGameplayCommand(before, command);
  if (!decision.ok) {
    throw new GameplayApplicationError(
      "ACTION_REJECTED",
      decision.error.message,
    );
  }
  return {
    command,
    hand: decision.hand,
    ...(nextHand ? { nextHand } : {}),
    snapshot: serializeGameplaySnapshot(decision.hand),
  };
}
