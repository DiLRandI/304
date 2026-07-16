import type { GameplayHand, RuleProfileId } from "@three-zero-four/gameplay";
import type {
  GameplayHandRecovery,
  GameplayHandRecoveryEvent,
  GameplayHandRecoveryStore,
  RecoverableGameplayHandRoom,
} from "../../application/gameplay-hand-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import { replayDomainGameplayEvent } from "../integration/domain-gameplay-event-replayer.js";
import { hydrateGameplaySnapshot } from "./gameplay-snapshot-codec.js";

function profileId(value: string, roomId: string): RuleProfileId {
  if (value === "classic_304_4p" || value === "six_304_36") return value;
  throw new RecoveryError(roomId);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hydrateStartedHand(
  roomId: string,
  ruleProfileId: RuleProfileId,
  event: GameplayHandRecoveryEvent,
): GameplayHand {
  const payload = record(event.payload);
  if (
    event.eventType !== "ROOM_STARTED" ||
    payload?.ruleProfileId !== ruleProfileId ||
    !record(payload.state)
  ) {
    throw new RecoveryError(roomId);
  }
  return hydrateGameplaySnapshot({
    ruleProfileId,
    schemaVersion:
      payload.schemaVersion === 1 || payload.schemaVersion === 2
        ? payload.schemaVersion
        : 1,
    state: payload.state,
  });
}

export class DomainGameplayRecovery implements GameplayHandRecovery {
  constructor(private readonly store: GameplayHandRecoveryStore) {}

  async recover(transaction: unknown, room: RecoverableGameplayHandRoom) {
    try {
      const ruleProfileId = profileId(room.ruleProfileId, room.id);
      const snapshot = await this.store.loadSnapshot(room.id, transaction);
      if (
        snapshot &&
        (snapshot.eventVersion > room.eventVersion ||
          snapshot.ruleProfileId !== ruleProfileId)
      ) {
        throw new RecoveryError(room.id);
      }
      const events = await this.store.loadEventsAfter(
        room.id,
        snapshot?.eventVersion ?? 0,
        transaction,
      );
      let hand: GameplayHand;
      let nextEventIndex = 0;
      try {
        if (!snapshot) throw new RecoveryError(room.id);
        hand = hydrateGameplaySnapshot({
          ruleProfileId,
          schemaVersion: snapshot.schemaVersion,
          state: snapshot.state,
        });
      } catch {
        const roomStartedIndex = events.findIndex(
          (event) => event.eventType === "ROOM_STARTED",
        );
        const roomStarted = events[roomStartedIndex];
        if (roomStartedIndex < 0 || !roomStarted) {
          throw new RecoveryError(room.id);
        }
        hand = hydrateStartedHand(room.id, ruleProfileId, roomStarted);
        nextEventIndex = roomStartedIndex + 1;
      }
      for (const event of events.slice(nextEventIndex)) {
        if (event.eventType === "ROOM_STARTED") {
          hand = hydrateStartedHand(room.id, ruleProfileId, event);
          continue;
        }
        const actorSeatIndex = event.actorPlayerId
          ? await this.store.findSeatIndex(
              transaction,
              room.id,
              event.actorPlayerId,
            )
          : null;
        hand = replayDomainGameplayEvent(room.id, hand, event, actorSeatIndex);
      }
      return hand;
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError(room.id);
    }
  }
}
