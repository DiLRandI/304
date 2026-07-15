import { ServiceError } from "../../../../shared/service-error.js";
import type {
  RoomLease,
  RoomPresence,
} from "../../../rooms/application/room-coordination-ports.js";
import type {
  ClaimedAutomationJob,
  StoredRoom,
} from "../../../rooms/application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../../rooms/application/room-persistence-store.js";
import {
  activeRoomStatus,
  activeSeatIndex,
  completedTrickWinner,
  isResultPhase,
} from "../../application/gameplay-automation-policy.js";
import type { GameplayAutomationScheduler } from "../../application/gameplay-automation-scheduler.js";
import type { GameplayRecovery } from "../../application/gameplay-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";

interface LegacyGameplayAutomationDependencies {
  readonly automation: GameplayAutomationScheduler;
  readonly lease: RoomLease;
  readonly presence: Pick<RoomPresence, "onlinePlayerIds">;
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

export class LegacyGameplayAutomationExecutor {
  constructor(
    private readonly dependencies: LegacyGameplayAutomationDependencies,
  ) {}

  run(job: ClaimedAutomationJob): Promise<"completed" | "stale"> {
    return this.withRoomLease(job.roomId, async (transaction, room) => {
      if (room.eventVersion !== job.expectedEventVersion) return "stale";
      if (room.status !== "in_hand" && room.status !== "hand_result") {
        return "stale";
      }

      const engine = await this.dependencies.recovery.recover(
        transaction,
        room,
      );
      if (job.kind === "TRICK_ADVANCE") {
        const winnerSeat = completedTrickWinner(engine.state);
        if (
          engine.state.phase !== "trick_result" ||
          winnerSeat == null ||
          winnerSeat !== job.targetSeatIndex
        ) {
          return "stale";
        }
        const result = engine.advanceTrick();
        if (!result.ok) {
          throw new ServiceError(
            "AUTOMATION_ACTION_REJECTED",
            500,
            "Trick advancement was rejected",
          );
        }
        const status = activeRoomStatus(engine.state);
        const eventVersion =
          await this.dependencies.store.appendEventAndSnapshot(transaction, {
            actorPlayerId: null,
            commandId: job.id,
            eventType: "TRICK_ADVANCED",
            expectedVersion: room.eventVersion,
            payload: { winnerSeat },
            roomId: room.id,
            ruleProfileId: room.ruleProfileId,
            snapshot: engine.getSnapshot(),
            status,
          });
        await this.dependencies.automation.schedule(
          transaction,
          { ...room, eventVersion, status },
          engine,
        );
        return "completed";
      }
      if (isResultPhase(engine.state)) return "stale";
      const activeSeat = activeSeatIndex(engine.state);
      if (
        job.kind !== "DISCONNECT_GRACE" &&
        activeSeat !== job.targetSeatIndex
      ) {
        return "stale";
      }
      const seat = engine.state.seats[job.targetSeatIndex];
      if (!seat) return "stale";

      if (job.kind === "TURN_TIMEOUT" || job.kind === "DISCONNECT_GRACE") {
        if (job.kind === "DISCONNECT_GRACE") {
          const seats = await this.dependencies.store.loadSeats(
            room.id,
            transaction,
          );
          const storedSeat = seats.find(
            (candidate) => candidate.seatIndex === job.targetSeatIndex,
          );
          if (!storedSeat?.playerId) return "stale";
          const onlinePlayerIds =
            await this.dependencies.presence.onlinePlayerIds(room.id, [
              storedSeat.playerId,
            ]);
          if (onlinePlayerIds.has(storedSeat.playerId)) return "stale";
        }
        if (seat.type !== "human" || seat.autopilot) return "stale";
        seat.autopilot = true;
        seat.connectionStatus = "autopilot";
        await this.dependencies.store.markSeatAutopilot(
          transaction,
          room.id,
          job.targetSeatIndex,
        );
        const eventVersion =
          await this.dependencies.store.appendEventAndSnapshot(transaction, {
            actorPlayerId: null,
            commandId: job.id,
            eventType: "AUTOPILOT_ENABLED",
            expectedVersion: room.eventVersion,
            payload: { seatIndex: job.targetSeatIndex, reason: job.kind },
            roomId: room.id,
            ruleProfileId: room.ruleProfileId,
            snapshot: engine.getSnapshot(),
            status: activeRoomStatus(engine.state),
          });
        const updatedRoom = {
          ...room,
          eventVersion,
          status: activeRoomStatus(engine.state),
        };
        await this.dependencies.automation.schedule(
          transaction,
          updatedRoom,
          engine,
        );
        return "completed";
      }

      if (job.kind !== "BOT_ACTION") return "stale";
      if (seat.type !== "bot" && !seat.autopilot) return "stale";
      const action = engine.getBotAction(job.targetSeatIndex);
      if (!action) return "stale";
      const result = engine.applyAutomationAction(action, job.targetSeatIndex);
      if (!result.ok) {
        throw new ServiceError(
          "AUTOMATION_ACTION_REJECTED",
          500,
          "Automation action was rejected",
        );
      }
      const status = activeRoomStatus(engine.state);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: null,
          commandId: job.id,
          eventType: seat.autopilot ? "AUTOPILOT_ACTION" : "BOT_ACTION",
          expectedVersion: room.eventVersion,
          payload: { seatIndex: job.targetSeatIndex, action },
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
      return "completed";
    });
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
