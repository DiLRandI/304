import { presentDomainGameplayForAutomation } from "../../../automation/adapters/integration/domain-gameplay-automation-presenter.js";
import type { AutomationScheduler } from "../../../automation/application/automation-scheduler.js";
import {
  GameplaySnapshotCodecError,
  serializeGameplaySnapshot,
} from "../../../gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { GameplayApplicationError } from "../../../gameplay/application/gameplay-application-error.js";
import type { GameplayHandRecovery } from "../../../gameplay/application/gameplay-hand-recovery.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import type { GameplayActor } from "../../../gameplay/application/submit-gameplay-command.js";
import type {
  RoomLease,
  RoomPresence,
} from "../../application/room-coordination-ports.js";
import type { RoomIdentityProvider } from "../../application/room-identity-provider.js";
import type {
  ConnectionStatus,
  StoredRoom,
  StoredSeat,
} from "../../application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../application/room-persistence-store.js";

interface DomainRoomConnectionDependencies {
  readonly automation: AutomationScheduler;
  readonly identities: Pick<RoomIdentityProvider, "nextCommandId">;
  readonly lease: RoomLease;
  readonly presence: RoomPresence;
  readonly recovery: GameplayHandRecovery;
  readonly store: RoomPersistenceStore;
}

function roomNotFound(): GameplayApplicationError {
  return new GameplayApplicationError("ROOM_NOT_FOUND", "Room was not found");
}

function ensureAvailable(room: StoredRoom): void {
  if (room.status === "recovery_failed") {
    throw new GameplayApplicationError(
      "ROOM_RECOVERY_FAILED",
      "Room is unavailable",
    );
  }
  if (room.status === "closed") {
    throw new GameplayApplicationError(
      "ROOM_UNAVAILABLE",
      "Room is unavailable",
      "conflict",
    );
  }
}

function activeStatus(phase: string): "hand_result" | "in_hand" {
  return phase === "hand-result" || phase === "match-complete"
    ? "hand_result"
    : "in_hand";
}

function withConnectionStatus(
  seats: readonly StoredSeat[],
  seatIndex: number,
  connectionStatus: ConnectionStatus,
): StoredSeat[] {
  return seats.map((seat) =>
    seat.seatIndex === seatIndex ? { ...seat, connectionStatus } : seat,
  );
}

export class DomainRoomConnections {
  constructor(
    private readonly dependencies: DomainRoomConnectionDependencies,
  ) {}

  async markRealtimePresence(
    session: GameplayActor,
    roomId: string,
  ): Promise<void> {
    await this.withRoomLease(roomId, async (transaction, room) => {
      const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      const seats = await this.dependencies.store.loadSeats(
        room.id,
        transaction,
      );
      const storedSeat = seats.find(
        (seat) => seat.seatIndex === viewerSeatIndex,
      );
      if (!storedSeat) throw new RecoveryError(room.id);
      await this.dependencies.presence.touch(room.id, session.playerId);
      if (storedSeat.connectionStatus === "online") {
        await this.dependencies.store.markSeatOnline(
          transaction,
          room.id,
          session.playerId,
        );
        return;
      }

      const hand = await this.dependencies.recovery.recover(transaction, room);
      const snapshot = serializeGameplaySnapshot(hand);
      await this.dependencies.store.markSeatOnline(
        transaction,
        room.id,
        session.playerId,
      );
      const status = activeStatus(hand.phase);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: session.playerId,
          commandId: this.dependencies.identities.nextCommandId(),
          eventType:
            storedSeat.connectionStatus === "autopilot"
              ? "AUTOPILOT_CANCELLED"
              : "PLAYER_RECONNECTED",
          expectedVersion: room.eventVersion,
          payload: { seatIndex: viewerSeatIndex },
          roomId: room.id,
          ruleProfileId: room.ruleProfileId,
          snapshot: snapshot.state,
          snapshotSchemaVersion: 2,
          status,
        },
      );
      await this.dependencies.automation.schedule(
        transaction,
        { ...room, eventVersion, status },
        presentDomainGameplayForAutomation(
          hand,
          withConnectionStatus(seats, viewerSeatIndex, "online"),
        ),
      );
    });
  }

  async markRealtimeDisconnected(
    session: GameplayActor,
    roomId: string,
  ): Promise<void> {
    await this.withRoomLease(roomId, async (transaction, room) => {
      const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      const seats = await this.dependencies.store.loadSeats(
        room.id,
        transaction,
      );
      const storedSeat = seats.find(
        (seat) => seat.seatIndex === viewerSeatIndex,
      );
      if (storedSeat?.connectionStatus !== "online") return;

      const hand = await this.dependencies.recovery.recover(transaction, room);
      const snapshot = serializeGameplaySnapshot(hand);
      await this.dependencies.store.markSeatOffline(
        transaction,
        room.id,
        session.playerId,
      );
      const status = activeStatus(hand.phase);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: session.playerId,
          commandId: this.dependencies.identities.nextCommandId(),
          eventType: "PLAYER_DISCONNECTED",
          expectedVersion: room.eventVersion,
          payload: { seatIndex: viewerSeatIndex },
          roomId: room.id,
          ruleProfileId: room.ruleProfileId,
          snapshot: snapshot.state,
          snapshotSchemaVersion: 2,
          status,
        },
      );
      await this.dependencies.automation.schedule(
        transaction,
        { ...room, eventVersion, status },
        presentDomainGameplayForAutomation(
          hand,
          withConnectionStatus(seats, viewerSeatIndex, "disconnected"),
        ),
      );
    });
    await this.dependencies.presence.remove(roomId, session.playerId);
  }

  private async withRoomLease<Result>(
    roomId: string,
    work: (transaction: RoomTransaction, room: StoredRoom) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.dependencies.lease.withLease(roomId, () =>
        this.dependencies.store.transaction(async (transaction) => {
          const room = await this.dependencies.store.loadRoomForUpdate(
            transaction,
            roomId,
          );
          if (!room) throw roomNotFound();
          ensureAvailable(room);
          return work(transaction, room);
        }),
      );
    } catch (error) {
      if (
        error instanceof RecoveryError ||
        error instanceof GameplaySnapshotCodecError
      ) {
        await this.dependencies.store.markRecoveryFailed(
          roomId,
          "Snapshot replay failed",
        );
        throw new GameplayApplicationError(
          "ROOM_RECOVERY_FAILED",
          "Room is unavailable",
        );
      }
      throw error;
    }
  }
}
