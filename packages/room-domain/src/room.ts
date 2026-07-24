import type { PlayerId, SeatPosition } from "./values.js";

export type BotDifficulty = "easy" | "normal" | "strong";
export type ConnectionStatus = "autopilot" | "disconnected" | "online";
export type RoomStatus =
  | "closed"
  | "hand_result"
  | "in_hand"
  | "lobby"
  | "recovery_failed";

export interface RoomSettings {
  readonly botDifficulty: BotDifficulty;
  readonly enableSecondBidding: boolean;
  readonly endHandWhenOutcomeCertain: boolean;
}

export type SeatOccupant =
  | { readonly kind: "empty" }
  | {
      readonly difficulty: BotDifficulty;
      readonly displayName: string;
      readonly kind: "bot";
    }
  | {
      readonly displayName: string;
      readonly kind: "human";
      readonly playerId: PlayerId;
    };

export interface RoomSeat {
  readonly connectionStatus: ConnectionStatus;
  readonly occupant: SeatOccupant;
  readonly position: SeatPosition;
}
