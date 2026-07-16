import {
  automationSeatIndex,
  completedTrickWinner,
  phaseTimeoutMs,
} from "./automation-policy.js";
import type {
  AutomatableGameplay,
  AutomatableRoom,
  AutomationScheduler,
} from "./automation-scheduler.js";
import type {
  AutomationJobIdentityProvider,
  AutomationSchedulingStore,
} from "./automation-scheduling-store.js";

export interface GameplayAutomationConfig {
  readonly botActionDelayMs?: number;
  readonly disconnectGraceSeconds?: number;
  readonly trickRevealDelayMs?: number;
}

interface GameplayAutomationDependencies {
  readonly config?: GameplayAutomationConfig;
  readonly identities: AutomationJobIdentityProvider;
  readonly now?: () => Date;
  readonly store: AutomationSchedulingStore;
}

const DEFAULTS = {
  botActionDelayMs: 900,
  disconnectGraceSeconds: 120,
  trickRevealDelayMs: 2_000,
};

export class GameplayAutomationScheduler implements AutomationScheduler {
  private readonly now: () => Date;

  constructor(private readonly dependencies: GameplayAutomationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async schedule(
    transaction: unknown,
    room: AutomatableRoom,
    gameplay: AutomatableGameplay,
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
    if (gameplay.state.phase === "trick_result") {
      const winnerSeat = completedTrickWinner(gameplay.state);
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
    const targetSeatIndex = automationSeatIndex(gameplay.state);
    if (targetSeatIndex === null) return;
    const seat = gameplay.state.seats[targetSeatIndex];
    if (!seat || (seat.type !== "human" && seat.type !== "bot")) return;
    if (seat.type === "human" && seat.connectionStatus === "disconnected") {
      return;
    }
    const isAutomated = seat.type === "bot" || Boolean(seat.autopilot);
    const delayMs = isAutomated
      ? (this.dependencies.config?.botActionDelayMs ??
        DEFAULTS.botActionDelayMs)
      : phaseTimeoutMs(gameplay.state);
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
    transaction: unknown,
    room: AutomatableRoom,
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
