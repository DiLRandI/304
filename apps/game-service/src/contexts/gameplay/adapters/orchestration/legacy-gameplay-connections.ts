import type { AutomationScheduler } from "../../../automation/application/automation-scheduler.js";
import type { AuthenticatedSession } from "../../../player-access/application/player-session-ports.js";
import type {
  RoomLease,
  RoomPresence,
} from "../../../rooms/application/room-coordination-ports.js";
import type { RoomIdentityProvider } from "../../../rooms/application/room-identity-provider.js";
import type { StoredRoom } from "../../../rooms/application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../../rooms/application/room-persistence-store.js";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";
import type { GameplayRecovery } from "../../application/gameplay-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import { activeRoomStatus } from "../../application/gameplay-room-status.js";
import { applyConnectionState } from "../engine/legacy-engine-seat-mapper.js";

interface LegacyGameplayConnectionDependencies {
  readonly automation: AutomationScheduler;
  readonly identities: Pick<RoomIdentityProvider, "nextCommandId">;
  readonly lease: RoomLease;
  readonly presence: RoomPresence;
  readonly recovery: GameplayRecovery;
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

export class LegacyGameplayConnections {
  constructor(
    private readonly dependencies: LegacyGameplayConnectionDependencies,
  ) {}

  async markRealtimePresence(
    session: AuthenticatedSession,
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

      const engine = await this.dependencies.recovery.recover(
        transaction,
        room,
      );
      applyConnectionState(engine, viewerSeatIndex, "online");
      await this.dependencies.store.markSeatOnline(
        transaction,
        room.id,
        session.playerId,
      );
      const status = activeRoomStatus(engine.state);
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
          snapshot: engine.getSnapshot(),
          status,
        },
      );
      await this.dependencies.automation.schedule(
        transaction,
        { ...room, eventVersion, status },
        engine,
      );
    });
  }

  async markRealtimeDisconnected(
    session: AuthenticatedSession,
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

      const engine = await this.dependencies.recovery.recover(
        transaction,
        room,
      );
      applyConnectionState(engine, viewerSeatIndex, "disconnected");
      await this.dependencies.store.markSeatOffline(
        transaction,
        room.id,
        session.playerId,
      );
      const status = activeRoomStatus(engine.state);
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
          snapshot: engine.getSnapshot(),
          status,
        },
      );
      await this.dependencies.automation.schedule(
        transaction,
        { ...room, eventVersion, status },
        engine,
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
      if (error instanceof RecoveryError) {
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
