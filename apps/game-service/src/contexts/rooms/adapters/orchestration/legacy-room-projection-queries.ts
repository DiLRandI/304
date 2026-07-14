import type { RoomProjection } from "@three-zero-four/contracts";
import { ServiceError } from "../../../../shared/service-error.js";
import { projectRoomForPlayer } from "../../../gameplay/adapters/delivery/gameplay-room-presenter.js";
import { LegacyGameplayRecovery } from "../../../gameplay/adapters/persistence/legacy-gameplay-recovery.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import type { AuthenticatedSession } from "../../../player-access/application/player-session-ports.js";
import type { RoomLease } from "../../application/room-coordination-ports.js";
import type { StoredRoom } from "../../application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../application/room-persistence-store.js";
import { projectLobbyForViewer } from "../delivery/lobby-room-presenter.js";

interface LegacyRoomProjectionQueryDependencies {
  readonly gameplayRecovery?: Pick<LegacyGameplayRecovery, "recover">;
  readonly lease: RoomLease;
  readonly store: RoomPersistenceStore;
}

function roomNotFound(): ServiceError {
  return new ServiceError("ROOM_NOT_FOUND", 404, "Room was not found");
}

function ensureAvailable(room: StoredRoom): void {
  if (room.status === "recovery_failed") {
    throw new ServiceError("ROOM_RECOVERY_FAILED", 503, "Room is unavailable");
  }
  if (room.status === "closed") {
    throw new ServiceError("ROOM_UNAVAILABLE", 409, "Room is unavailable");
  }
}

export class LegacyRoomProjectionQueries {
  private readonly gameplayRecovery: Pick<LegacyGameplayRecovery, "recover">;

  constructor(
    private readonly dependencies: LegacyRoomProjectionQueryDependencies,
  ) {
    this.gameplayRecovery =
      dependencies.gameplayRecovery ??
      new LegacyGameplayRecovery(dependencies.store);
  }

  async getSnapshot(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<RoomProjection> {
    return this.withRoomLease(roomId, async (transaction, room) => {
      const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      return this.projectCurrent(transaction, room, viewerSeatIndex);
    });
  }

  async getRoom(
    session: AuthenticatedSession,
    roomReference: string,
  ): Promise<RoomProjection> {
    const referencedRoom =
      await this.dependencies.store.loadRoomByReference(roomReference);
    if (!referencedRoom) throw roomNotFound();
    return this.withRoomLease(referencedRoom.id, async (transaction, room) => {
      const viewerSeatIndex = await this.dependencies.store.findSeatIndex(
        transaction,
        room.id,
        session.playerId,
      );
      if (viewerSeatIndex !== null) {
        return this.projectCurrent(transaction, room, viewerSeatIndex);
      }
      if (room.status !== "lobby") {
        throw new ServiceError(
          "SEAT_REQUIRED",
          403,
          "You are not seated in this room",
        );
      }
      return projectLobbyForViewer(
        room,
        await this.dependencies.store.loadSeats(room.id, transaction),
        null,
      );
    });
  }

  async projectCurrent(
    transaction: RoomTransaction,
    room: StoredRoom,
    viewerSeatIndex: number,
  ): Promise<RoomProjection> {
    if (room.status === "lobby") {
      return projectLobbyForViewer(
        room,
        await this.dependencies.store.loadSeats(room.id, transaction),
        viewerSeatIndex,
      );
    }
    const engine = await this.gameplayRecovery.recover(transaction, room);
    return projectRoomForPlayer(room, engine, viewerSeatIndex);
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
        throw new ServiceError(
          "ROOM_RECOVERY_FAILED",
          503,
          "Room is unavailable",
        );
      }
      throw error;
    }
  }
}
