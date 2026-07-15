import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";
import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import { ServiceError } from "../../../../shared/service-error.js";
import type { AuthenticatedSession } from "../../../player-access/application/player-session-ports.js";
import { projectLobbyForViewer } from "../../../rooms/adapters/delivery/lobby-room-presenter.js";
import type { RoomLease } from "../../../rooms/application/room-coordination-ports.js";
import type { StoredRoom } from "../../../rooms/application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../../rooms/application/room-persistence-store.js";
import type { GameplayAutomationScheduler } from "../../application/gameplay-automation-scheduler.js";
import type { GameplayRecovery } from "../../application/gameplay-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import { activeRoomStatus } from "../../application/gameplay-room-status.js";
import type { GameplayCommandExecutor } from "../../application/submit-gameplay-command.js";
import { projectRoomForPlayer } from "../delivery/gameplay-room-presenter.js";

interface LegacyGameplayCommandDependencies {
  readonly automation: GameplayAutomationScheduler;
  readonly lease: RoomLease;
  readonly recovery: GameplayRecovery;
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

export class LegacyGameplayCommandExecutor implements GameplayCommandExecutor {
  constructor(
    private readonly dependencies: LegacyGameplayCommandDependencies,
  ) {}

  submitCommand(
    session: AuthenticatedSession,
    command: GameCommand,
  ): Promise<RoomProjection> {
    return this.withRoomLease(command.roomId, async (transaction, room) => {
      const duplicate = await this.dependencies.store.findDuplicate(
        room.id,
        command.commandId,
        session.playerId,
        transaction,
      );
      if (duplicate) {
        return this.projectAtVersion(
          transaction,
          room,
          session,
          duplicate.eventVersion,
        );
      }
      if (room.eventVersion !== command.expectedVersion) {
        throw new ServiceError(
          "VERSION_CONFLICT",
          409,
          "Room state changed; refresh and retry",
        );
      }
      const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      if (room.status !== "in_hand" && room.status !== "hand_result") {
        throw new ServiceError("ROOM_NOT_ACTIVE", 409, "Room is not active");
      }
      if (
        command.action.type === "ACK_RESULT" &&
        room.hostPlayerId !== session.playerId
      ) {
        throw new ServiceError(
          "HOST_REQUIRED",
          403,
          "Only the host can continue",
        );
      }
      const engine = await this.dependencies.recovery.recover(
        transaction,
        room,
      );
      const result = engine.applyAction({
        ...command.action,
        seatIndex: viewerSeatIndex,
        actorSeatIndex: viewerSeatIndex,
      });
      if (!result.ok) {
        throw new ServiceError(
          "ACTION_REJECTED",
          409,
          result.reason ?? "Action was rejected",
        );
      }
      const status = activeRoomStatus(engine.state);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: session.playerId,
          commandId: command.commandId,
          eventType: "GAME_ACTION",
          expectedVersion: room.eventVersion,
          payload: { action: command.action },
          roomId: room.id,
          ruleProfileId: room.ruleProfileId,
          snapshot: engine.getSnapshot(),
          status,
        },
      );
      const updatedRoom = { ...room, eventVersion, status };
      await this.dependencies.automation.schedule(
        transaction,
        updatedRoom,
        engine,
      );
      return projectRoomForPlayer(updatedRoom, engine, viewerSeatIndex);
    });
  }

  private async projectAtVersion(
    transaction: RoomTransaction,
    room: StoredRoom,
    session: AuthenticatedSession,
    eventVersion: number,
  ): Promise<RoomProjection> {
    const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
      transaction,
      room.id,
      session.playerId,
    );
    const snapshot = await this.dependencies.store.loadSnapshotAt(
      transaction,
      room.id,
      eventVersion,
    );
    if (!snapshot || snapshot.ruleProfileId !== room.ruleProfileId) {
      throw new RecoveryError(room.id);
    }
    const engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const status = activeRoomStatus(engine.state);
    const snapshotRoom = { ...room, eventVersion, status };
    if (status === "lobby") {
      return projectLobbyForViewer(
        snapshotRoom,
        await this.dependencies.store.loadSeats(room.id, transaction),
        viewerSeatIndex,
      );
    }
    return projectRoomForPlayer(snapshotRoom, engine, viewerSeatIndex);
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
