import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import type { Room } from "@three-zero-four/room-domain";
import {
  automationSeatIndex,
  phaseTimeoutMs,
} from "../../../automation/application/automation-policy.js";
import type { RoomIdentityProvider } from "../../application/room-identity-provider.js";
import type { NewAutomationJob } from "../../application/room-persistence-model.js";

export class LegacyStartedRoomAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyStartedRoomAutomationError";
  }
}

export class LegacyStartedRoomAutomationFactory {
  constructor(
    private readonly identities: Pick<
      RoomIdentityProvider,
      "nextAutomationJobId"
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly botActionDelayMs = 900,
  ) {}

  create(room: Room, snapshot: unknown): NewAutomationJob | null {
    if (room.status !== "in_hand") {
      throw new LegacyStartedRoomAutomationError(
        "Room automation requires a started room",
      );
    }
    let engine: GameEngine;
    try {
      engine = GameEngine.hydrate(structuredClone(snapshot) as EngineState);
    } catch {
      throw new LegacyStartedRoomAutomationError(
        "Started room gameplay snapshot is invalid",
      );
    }
    const targetSeatIndex = automationSeatIndex(engine.state);
    if (targetSeatIndex === null) return null;
    const seat = engine.state.seats[targetSeatIndex];
    if (!seat || (seat.type !== "human" && seat.type !== "bot")) return null;
    if (seat.type === "human" && seat.connectionStatus === "disconnected") {
      return null;
    }
    const isAutomated = seat.type === "bot" || Boolean(seat.autopilot);
    const delayMs = isAutomated
      ? this.botActionDelayMs
      : phaseTimeoutMs(engine.state);
    return {
      dueAt: new Date(this.now().getTime() + delayMs),
      expectedEventVersion: Number(room.eventVersion),
      id: this.identities.nextAutomationJobId(),
      kind: isAutomated ? "BOT_ACTION" : "TURN_TIMEOUT",
      roomId: room.id,
      targetSeatIndex,
    };
  }
}
