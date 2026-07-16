import type { RoomStatus } from "./room.js";

export type RoomClosureReason = "LOBBY_IDLE" | "TERMINAL_RETENTION";

export interface RoomMaintenanceCandidate {
  readonly status: RoomStatus;
  readonly updatedAt: Date;
}

export interface RoomMaintenanceCutoffs {
  readonly lobbyCutoff: Date;
  readonly terminalCutoff: Date;
}

export function roomClosureReason(
  room: RoomMaintenanceCandidate,
  cutoffs: RoomMaintenanceCutoffs,
): RoomClosureReason | null {
  if (room.status === "lobby" && room.updatedAt <= cutoffs.lobbyCutoff) {
    return "LOBBY_IDLE";
  }
  if (
    room.status === "hand_result" &&
    room.updatedAt <= cutoffs.terminalCutoff
  ) {
    return "TERMINAL_RETENTION";
  }
  return null;
}
