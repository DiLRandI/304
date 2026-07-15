import type { GameEngine } from "@three-zero-four/game-engine";
import {
  automationSeatIndex,
  completedTrickWinner,
  phaseTimeoutMs,
} from "../../../automation/application/automation-policy.js";
import type { RoomIdentityProvider } from "../../../rooms/application/room-identity-provider.js";
import type { StoredRoom } from "../../../rooms/application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../../rooms/application/room-persistence-store.js";
import type { GameplayAutomationScheduler } from "../../application/gameplay-automation-scheduler.js";

type AutomationStore = Pick<
  RoomPersistenceStore,
  "cancelAutomationForRoom" | "loadSeats" | "scheduleAutomation"
>;

export interface LegacyGameplayAutomationConfig {
  readonly botActionDelayMs?: number;
  readonly disconnectGraceSeconds?: number;
  readonly trickRevealDelayMs?: number;
}

interface LegacyGameplayAutomationDependencies {
  readonly config?: LegacyGameplayAutomationConfig;
  readonly identities: Pick<RoomIdentityProvider, "nextAutomationJobId">;
  readonly now?: () => Date;
  readonly store: AutomationStore;
}

const DEFAULTS = {
  botActionDelayMs: 900,
  disconnectGraceSeconds: 120,
  trickRevealDelayMs: 2_000,
};

export class LegacyGameplayAutomationScheduler
  implements GameplayAutomationScheduler
{
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: LegacyGameplayAutomationDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async schedule(
    transaction: RoomTransaction,
    room: StoredRoom,
    engine: GameEngine,
  ): Promise<void> {
    await this.dependencies.store.cancelAutomationForRoom(
      transaction,
      room.id,
      ["BOT_ACTION", "TURN_TIMEOUT", "TRICK_ADVANCE"],
    );
    await this.dependencies.store.cancelAutomationForRoom(
      transaction,
      room.id,
      ["DISCONNECT_GRACE"],
    );
    if (room.status === "in_hand") {
      await this.scheduleDisconnectGraceJobs(transaction, room);
    }
    if (engine.state.phase === "trick_result") {
      const winnerSeat = completedTrickWinner(engine.state);
      if (winnerSeat === null) return;
      await this.dependencies.store.scheduleAutomation(transaction, {
        dueAt: new Date(
          this.now().getTime() +
            (this.dependencies.config?.trickRevealDelayMs ??
              DEFAULTS.trickRevealDelayMs),
        ),
        expectedEventVersion: room.eventVersion,
        id: this.dependencies.identities.nextAutomationJobId(),
        kind: "TRICK_ADVANCE",
        roomId: room.id,
        targetSeatIndex: winnerSeat,
      });
      return;
    }
    const targetSeatIndex = automationSeatIndex(engine.state);
    if (targetSeatIndex === null) return;
    const seat = engine.state.seats[targetSeatIndex];
    if (!seat || (seat.type !== "human" && seat.type !== "bot")) return;
    if (seat.type === "human" && seat.connectionStatus === "disconnected") {
      return;
    }
    const isAutomated = seat.type === "bot" || Boolean(seat.autopilot);
    const delayMs = isAutomated
      ? (this.dependencies.config?.botActionDelayMs ??
        DEFAULTS.botActionDelayMs)
      : phaseTimeoutMs(engine.state);
    await this.dependencies.store.scheduleAutomation(transaction, {
      dueAt: new Date(this.now().getTime() + delayMs),
      expectedEventVersion: room.eventVersion,
      id: this.dependencies.identities.nextAutomationJobId(),
      kind: isAutomated ? "BOT_ACTION" : "TURN_TIMEOUT",
      roomId: room.id,
      targetSeatIndex,
    });
  }

  private async scheduleDisconnectGraceJobs(
    transaction: RoomTransaction,
    room: StoredRoom,
  ): Promise<void> {
    const disconnectGraceMs =
      (this.dependencies.config?.disconnectGraceSeconds ??
        DEFAULTS.disconnectGraceSeconds) * 1_000;
    const seats = await this.dependencies.store.loadSeats(room.id, transaction);
    for (const seat of seats) {
      if (
        seat.occupantType !== "human" ||
        !seat.playerId ||
        seat.connectionStatus !== "disconnected"
      ) {
        continue;
      }
      await this.dependencies.store.scheduleAutomation(transaction, {
        dueAt: new Date(
          (seat.disconnectedAt?.getTime() ?? this.now().getTime()) +
            disconnectGraceMs,
        ),
        expectedEventVersion: room.eventVersion,
        id: this.dependencies.identities.nextAutomationJobId(),
        kind: "DISCONNECT_GRACE",
        roomId: room.id,
        targetSeatIndex: seat.seatIndex,
      });
    }
  }
}
