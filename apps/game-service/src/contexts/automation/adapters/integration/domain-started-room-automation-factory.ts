import type { Room } from "@three-zero-four/room-domain";
import { hydrateGameplaySnapshot } from "../../../gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type { NewAutomationJob } from "../../../rooms/application/room-persistence-model.js";
import type {
  StartedRoomAutomationFactory,
  StartedRoomSnapshot,
} from "../../../rooms/application/started-room-initialization.js";
import {
  automationSeatIndex,
  phaseTimeoutMs,
} from "../../application/automation-policy.js";
import type { AutomatableGameplay } from "../../application/automation-scheduler.js";
import type { AutomationJobIdentityProvider } from "../../application/automation-scheduling-store.js";
import { presentDomainGameplayForAutomation } from "./domain-gameplay-automation-presenter.js";

export class DomainStartedRoomAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainStartedRoomAutomationError";
  }
}

export class DomainStartedRoomAutomationFactory
  implements StartedRoomAutomationFactory
{
  constructor(
    private readonly identities: AutomationJobIdentityProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly botActionDelayMs = 900,
  ) {}

  create(room: Room, snapshot: StartedRoomSnapshot): NewAutomationJob | null {
    if (room.status !== "in_hand") {
      throw new DomainStartedRoomAutomationError(
        "Room automation requires a started room",
      );
    }
    let gameplay: AutomatableGameplay;
    try {
      const hand = hydrateGameplaySnapshot({
        ruleProfileId: room.profileId,
        schemaVersion: snapshot.schemaVersion,
        state: snapshot.state,
      });
      gameplay = presentDomainGameplayForAutomation(
        hand,
        room.seats.map((seat) => ({
          connectionStatus: seat.connectionStatus,
          occupantType: seat.occupant.kind,
          seatIndex: Number(seat.position),
        })),
      );
    } catch {
      throw new DomainStartedRoomAutomationError(
        "Started room gameplay snapshot is invalid",
      );
    }
    const targetSeatIndex = automationSeatIndex(gameplay.state);
    if (targetSeatIndex === null) return null;
    const seat = gameplay.state.seats[targetSeatIndex];
    if (!seat || (seat.type !== "human" && seat.type !== "bot")) return null;
    if (seat.type === "human" && seat.connectionStatus === "disconnected") {
      return null;
    }
    const isAutomated = seat.type === "bot" || Boolean(seat.autopilot);
    return {
      dueAt: new Date(
        this.now().getTime() +
          (isAutomated
            ? this.botActionDelayMs
            : phaseTimeoutMs(gameplay.state)),
      ),
      expectedEventVersion: Number(room.eventVersion),
      id: this.identities.nextAutomationJobId(),
      kind: isAutomated ? "BOT_ACTION" : "TURN_TIMEOUT",
      roomId: room.id,
      targetSeatIndex,
    };
  }
}
