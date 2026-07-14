import type { EngineSeat, GameEngine } from "@three-zero-four/game-engine";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";

export type BotDifficulty = "easy" | "normal" | "strong";
export type SeatConnectionStatus = "online" | "disconnected" | "autopilot";

export interface GameplaySeatRecord {
  readonly botDifficulty: string | null;
  readonly connectionStatus?: SeatConnectionStatus;
  readonly displayName: string | null;
  readonly occupantType: "human" | "bot" | "empty";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === "easy" || value === "normal" || value === "strong";
}

export function toEngineSeat(seat: GameplaySeatRecord): EngineSeat {
  const result: EngineSeat = {
    index: seat.seatIndex,
    type: seat.occupantType,
    connectionStatus:
      seat.connectionStatus ??
      (seat.occupantType === "bot" ? "online" : "disconnected"),
  };
  if (seat.displayName) result.displayName = seat.displayName;
  if (seat.playerId) result.userId = seat.playerId;
  if (seat.botDifficulty) result.difficulty = seat.botDifficulty;
  if (seat.connectionStatus === "autopilot") result.autopilot = true;
  return result;
}

export function applyLobbySeat(
  engine: GameEngine,
  seat: GameplaySeatRecord,
): void {
  const target = engine.state.seats[seat.seatIndex];
  if (!target) throw new RecoveryError("unknown");
  target.type = seat.occupantType;
  target.displayName =
    seat.displayName ?? (seat.occupantType === "bot" ? "Bot" : "Open seat");
  if (seat.playerId) target.userId = seat.playerId;
  else delete target.userId;
  if (seat.botDifficulty) target.difficulty = seat.botDifficulty;
  else delete target.difficulty;
  target.connectionStatus = seat.connectionStatus ?? "online";
  target.autopilot = seat.connectionStatus === "autopilot";
  engine.state.humanCount = engine.state.seats.filter(
    (candidate) => candidate.type === "human",
  ).length;
}

export function applyConnectionState(
  engine: GameEngine,
  seatIndex: number,
  connectionStatus: SeatConnectionStatus,
): void {
  const target = engine.state.seats[seatIndex];
  if (!target) throw new RecoveryError("unknown");
  target.connectionStatus = connectionStatus;
  target.autopilot = connectionStatus === "autopilot";
}
