import type { RuleProfileId } from "@three-zero-four/gameplay";
import type {
  GameplayHandRecovery,
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

export class DomainGameplayRecovery implements GameplayHandRecovery {
  constructor(private readonly store: GameplayHandRecoveryStore) {}

  async recover(transaction: unknown, room: RecoverableGameplayHandRoom) {
    try {
      const snapshot = await this.store.loadSnapshot(room.id, transaction);
      if (
        !snapshot ||
        snapshot.eventVersion > room.eventVersion ||
        snapshot.ruleProfileId !== room.ruleProfileId
      ) {
        throw new RecoveryError(room.id);
      }
      let hand = hydrateGameplaySnapshot({
        ruleProfileId: profileId(snapshot.ruleProfileId, room.id),
        schemaVersion: snapshot.schemaVersion,
        state: snapshot.state,
      });
      const events = await this.store.loadEventsAfter(
        room.id,
        snapshot.eventVersion,
        transaction,
      );
      for (const event of events) {
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
