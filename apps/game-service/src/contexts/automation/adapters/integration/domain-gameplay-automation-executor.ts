import {
  chooseGameplayBotCommand,
  type GameplayBotDifficulty,
  seatIndex,
} from "@three-zero-four/gameplay";
import {
  GameplaySnapshotCodecError,
  serializeGameplaySnapshot,
} from "../../../gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type { GameplayHandRecovery } from "../../../gameplay/application/gameplay-hand-recovery.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import { AutomationExecutionError } from "../../application/automation-execution-error.js";
import type {
  AutomationJobLease,
  AutomationJobPresence,
  AutomationJobRoom,
  AutomationJobSeat,
  AutomationJobStore,
  AutomationJobTransaction,
  ClaimedDomainAutomationJob,
} from "../../application/automation-job-store.js";
import type { AutomationRandomSource } from "../../application/automation-random-source.js";
import type { AutomationScheduler } from "../../application/automation-scheduler.js";
import { presentAutomatedGameplayAction } from "./domain-gameplay-automation-action-presenter.js";
import { presentDomainGameplayForAutomation } from "./domain-gameplay-automation-presenter.js";
import { transitionAutomatedGameplayCommand } from "./domain-gameplay-automation-transition.js";

interface DomainGameplayAutomationDependencies {
  readonly automation: AutomationScheduler;
  readonly lease: AutomationJobLease;
  readonly presence: AutomationJobPresence;
  readonly random: AutomationRandomSource;
  readonly recovery: GameplayHandRecovery;
  readonly store: AutomationJobStore;
}

function roomNotFound(): AutomationExecutionError {
  return new AutomationExecutionError("ROOM_NOT_FOUND", "Room was not found");
}

function ensureAvailable(room: AutomationJobRoom): void {
  if (room.status === "recovery_failed") {
    throw new AutomationExecutionError(
      "ROOM_RECOVERY_FAILED",
      "Room is unavailable",
    );
  }
  if (room.status === "closed") {
    throw new AutomationExecutionError(
      "ROOM_UNAVAILABLE",
      "Room is unavailable",
    );
  }
}

function activeStatus(phase: string): "hand_result" | "in_hand" {
  return phase === "hand-result" || phase === "match-complete"
    ? "hand_result"
    : "in_hand";
}

function isResultPhase(phase: string): boolean {
  return phase === "hand-result" || phase === "match-complete";
}

function withAutopilot(
  seats: readonly AutomationJobSeat[],
  targetSeatIndex: number,
): AutomationJobSeat[] {
  return seats.map((seat) =>
    seat.seatIndex === targetSeatIndex
      ? { ...seat, connectionStatus: "autopilot" }
      : seat,
  );
}

function isGameplayBotDifficulty(
  value: string | null,
): value is GameplayBotDifficulty {
  return value === "easy" || value === "normal" || value === "strong";
}

export function gameplayBotOptionsForSeat(seat: AutomationJobSeat): {
  readonly difficulty: GameplayBotDifficulty;
} {
  if (seat.occupantType === "human") return { difficulty: "normal" };
  if (isGameplayBotDifficulty(seat.botDifficulty)) {
    return { difficulty: seat.botDifficulty };
  }
  throw new AutomationExecutionError(
    "INVALID_BOT_DIFFICULTY",
    "Bot seat has an invalid difficulty",
  );
}

export class DomainGameplayAutomationExecutor {
  constructor(
    private readonly dependencies: DomainGameplayAutomationDependencies,
  ) {}

  run(job: ClaimedDomainAutomationJob): Promise<"completed" | "stale"> {
    return this.withRoomLease(job.roomId, async (transaction, room) => {
      if (room.eventVersion !== job.expectedEventVersion) return "stale";
      if (room.status !== "in_hand" && room.status !== "hand_result") {
        return "stale";
      }

      const hand = await this.dependencies.recovery.recover(transaction, room);
      const seats = await this.dependencies.store.loadSeats(
        room.id,
        transaction,
      );

      if (job.kind === "TRICK_ADVANCE") {
        if (
          hand.phase !== "trick-result" ||
          hand.currentTrick?.winnerSeat !== job.targetSeatIndex
        ) {
          return "stale";
        }
        const transition = transitionAutomatedGameplayCommand(hand, {
          actor: null,
          type: "ADVANCE_TRICK",
        });
        const status = activeStatus(transition.hand.phase);
        const eventVersion =
          await this.dependencies.store.appendEventAndSnapshot(transaction, {
            actorPlayerId: null,
            commandId: job.id,
            eventType: "TRICK_ADVANCED",
            expectedVersion: room.eventVersion,
            payload: { winnerSeat: job.targetSeatIndex },
            roomId: room.id,
            ruleProfileId: room.ruleProfileId,
            snapshot: transition.snapshot.state,
            snapshotSchemaVersion: 3,
            status,
          });
        await this.schedule(
          transaction,
          { ...room, eventVersion, status },
          transition.hand,
          seats,
        );
        return "completed";
      }

      if (isResultPhase(hand.phase)) return "stale";
      if (
        job.kind !== "DISCONNECT_GRACE" &&
        hand.activeSeat !== job.targetSeatIndex
      ) {
        return "stale";
      }
      const storedSeat = seats.find(
        (seat) => seat.seatIndex === job.targetSeatIndex,
      );
      if (!storedSeat) return "stale";

      if (job.kind === "TURN_TIMEOUT" || job.kind === "DISCONNECT_GRACE") {
        if (job.kind === "DISCONNECT_GRACE") {
          if (!storedSeat.playerId) return "stale";
          const onlinePlayerIds =
            await this.dependencies.presence.onlinePlayerIds(room.id, [
              storedSeat.playerId,
            ]);
          if (onlinePlayerIds.has(storedSeat.playerId)) return "stale";
        }
        if (
          storedSeat.occupantType !== "human" ||
          storedSeat.connectionStatus === "autopilot"
        ) {
          return "stale";
        }
        await this.dependencies.store.markSeatAutopilot(
          transaction,
          room.id,
          job.targetSeatIndex,
        );
        const status = activeStatus(hand.phase);
        const eventVersion =
          await this.dependencies.store.appendEventAndSnapshot(transaction, {
            actorPlayerId: null,
            commandId: job.id,
            eventType: "AUTOPILOT_ENABLED",
            expectedVersion: room.eventVersion,
            payload: { reason: job.kind, seatIndex: job.targetSeatIndex },
            roomId: room.id,
            ruleProfileId: room.ruleProfileId,
            snapshot: serializeGameplaySnapshot(hand).state,
            snapshotSchemaVersion: 3,
            status,
          });
        await this.schedule(
          transaction,
          { ...room, eventVersion, status },
          hand,
          withAutopilot(seats, job.targetSeatIndex),
        );
        return "completed";
      }

      if (job.kind !== "BOT_ACTION") return "stale";
      const isAutopilot =
        storedSeat.occupantType === "human" &&
        storedSeat.connectionStatus === "autopilot";
      if (storedSeat.occupantType !== "bot" && !isAutopilot) return "stale";
      const actor = seatIndex(job.targetSeatIndex, hand.profile.seatCount);
      const command = chooseGameplayBotCommand(hand, actor, {
        ...gameplayBotOptionsForSeat(storedSeat),
        random: this.dependencies.random,
      });
      if (!command || command.type === "ACK_RESULT") return "stale";
      const transition = transitionAutomatedGameplayCommand(hand, command);
      const status = activeStatus(transition.hand.phase);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: null,
          commandId: job.id,
          eventType: isAutopilot ? "AUTOPILOT_ACTION" : "BOT_ACTION",
          expectedVersion: room.eventVersion,
          payload: {
            action: presentAutomatedGameplayAction(command),
            seatIndex: job.targetSeatIndex,
          },
          roomId: room.id,
          ruleProfileId: room.ruleProfileId,
          snapshot: transition.snapshot.state,
          snapshotSchemaVersion: 3,
          status,
        },
      );
      await this.schedule(
        transaction,
        { ...room, eventVersion, status },
        transition.hand,
        seats,
      );
      return "completed";
    });
  }

  private schedule(
    transaction: AutomationJobTransaction,
    room: AutomationJobRoom,
    hand: Parameters<typeof presentDomainGameplayForAutomation>[0],
    seats: readonly AutomationJobSeat[],
  ): Promise<void> {
    return this.dependencies.automation.schedule(
      transaction,
      room,
      presentDomainGameplayForAutomation(hand, seats),
    );
  }

  private async withRoomLease<Result>(
    roomId: string,
    work: (
      transaction: AutomationJobTransaction,
      room: AutomationJobRoom,
    ) => Promise<Result>,
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
        throw new AutomationExecutionError(
          "ROOM_RECOVERY_FAILED",
          "Room is unavailable",
        );
      }
      throw error;
    }
  }
}
