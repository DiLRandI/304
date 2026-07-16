import type { GameplayHand } from "@three-zero-four/gameplay";
import type { AutomatableGameplay } from "../../application/automation-scheduler.js";

export interface DomainGameplayAutomationSeat {
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly occupantType: "bot" | "empty" | "human";
  readonly seatIndex: number;
}

export function presentDomainGameplayForAutomation(
  hand: GameplayHand,
  seats: readonly DomainGameplayAutomationSeat[],
): AutomatableGameplay {
  return {
    state: {
      activeSeat: hand.activeSeat,
      currentTrick: hand.currentTrick
        ? { winnerSeat: hand.currentTrick.winnerSeat }
        : null,
      phase: hand.phase.replaceAll("-", "_"),
      seats: seats
        .toSorted((first, second) => first.seatIndex - second.seatIndex)
        .map((seat) => ({
          autopilot: seat.connectionStatus === "autopilot",
          ...(seat.connectionStatus
            ? { connectionStatus: seat.connectionStatus }
            : {}),
          type: seat.occupantType,
        })),
    },
  };
}
