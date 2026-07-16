import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";
import { presentDomainGameplayForAutomation } from "../../../automation/adapters/integration/domain-gameplay-automation-presenter.js";
import type { AutomationScheduler } from "../../../automation/application/automation-scheduler.js";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";
import type {
  GameplayCommandLease,
  GameplayCommandRoom,
  GameplayCommandStore,
  GameplayCommandTransaction,
} from "../../application/gameplay-command-store.js";
import type { GameplayHandShuffler } from "../../application/gameplay-hand-shuffler.js";
import type { GameplayRecovery } from "../../application/gameplay-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import type {
  GameplayActor,
  GameplayCommandExecutor,
} from "../../application/submit-gameplay-command.js";
import { projectDomainRoomForPlayer } from "../delivery/domain-gameplay-room-presenter.js";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
} from "../persistence/gameplay-snapshot-codec.js";
import { transitionGameplayCommand } from "./domain-gameplay-command-transition.js";

interface DomainGameplayCommandDependencies {
  readonly automation: AutomationScheduler;
  readonly lease: GameplayCommandLease;
  readonly recovery: GameplayRecovery;
  readonly shuffler: GameplayHandShuffler;
  readonly store: GameplayCommandStore;
}

function roomNotFound(): GameplayApplicationError {
  return new GameplayApplicationError("ROOM_NOT_FOUND", "Room was not found");
}

function ensureAvailable(room: GameplayCommandRoom): void {
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

function activeStatus(
  phase: string,
): Extract<GameplayCommandRoom["status"], "in_hand" | "hand_result"> {
  return phase === "hand-result" || phase === "match-complete"
    ? "hand_result"
    : "in_hand";
}

export class DomainGameplayCommandExecutor implements GameplayCommandExecutor {
  constructor(
    private readonly dependencies: DomainGameplayCommandDependencies,
  ) {}

  submitCommand(
    session: GameplayActor,
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
        throw new GameplayApplicationError(
          "VERSION_CONFLICT",
          "Room state changed; refresh and retry",
        );
      }
      const viewerSeatIndex = await this.dependencies.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      if (room.status !== "in_hand" && room.status !== "hand_result") {
        throw new GameplayApplicationError(
          "ROOM_NOT_ACTIVE",
          "Room is not active",
        );
      }
      if (
        command.action.type === "ACK_RESULT" &&
        room.hostPlayerId !== session.playerId
      ) {
        throw new GameplayApplicationError(
          "HOST_REQUIRED",
          "Only the host can continue",
        );
      }
      const recovered = await this.dependencies.recovery.recover(
        transaction,
        room,
      );
      const transition = transitionGameplayCommand(
        {
          ruleProfileId: room.ruleProfileId,
          schemaVersion: 1,
          state: recovered.getSnapshot(),
        },
        command.action,
        viewerSeatIndex,
        this.dependencies.shuffler,
      );
      const status = activeStatus(transition.hand.phase);
      const eventVersion = await this.dependencies.store.appendEventAndSnapshot(
        transaction,
        {
          actorPlayerId: session.playerId,
          commandId: command.commandId,
          eventType: "GAME_ACTION",
          expectedVersion: room.eventVersion,
          payload: {
            action: command.action,
            seatIndex: viewerSeatIndex,
            ...(transition.nextHand ? { nextHand: transition.nextHand } : {}),
          },
          roomId: room.id,
          ruleProfileId: room.ruleProfileId,
          snapshot: transition.snapshot.state,
          snapshotSchemaVersion: 1,
          status,
        },
      );
      const updatedRoom = { ...room, eventVersion, status };
      const seats = await this.dependencies.store.loadSeats(
        room.id,
        transaction,
      );
      await this.dependencies.automation.schedule(
        transaction,
        updatedRoom,
        presentDomainGameplayForAutomation(transition.hand, seats),
      );
      return projectDomainRoomForPlayer(
        updatedRoom,
        transition.hand,
        seats,
        viewerSeatIndex,
      );
    });
  }

  private async projectAtVersion(
    transaction: GameplayCommandTransaction,
    room: GameplayCommandRoom,
    session: GameplayActor,
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
    const hand = hydrateGameplaySnapshot(snapshot);
    const snapshotRoom = {
      ...room,
      eventVersion,
      status: activeStatus(hand.phase),
    };
    return projectDomainRoomForPlayer(
      snapshotRoom,
      hand,
      await this.dependencies.store.loadSeats(room.id, transaction),
      viewerSeatIndex,
    );
  }

  private async withRoomLease<Result>(
    roomId: string,
    work: (
      transaction: GameplayCommandTransaction,
      room: GameplayCommandRoom,
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
        throw new GameplayApplicationError(
          "ROOM_RECOVERY_FAILED",
          "Room is unavailable",
        );
      }
      throw error;
    }
  }
}
