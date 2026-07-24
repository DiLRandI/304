import type { RuleProfileId } from "@three-zero-four/contracts";

export type RoomStatus =
  | "lobby"
  | "in_hand"
  | "hand_result"
  | "closed"
  | "recovery_failed";

export type ConnectionStatus = "online" | "disconnected" | "autopilot";

export type AutomationJobKind =
  | "BOT_ACTION"
  | "TURN_TIMEOUT"
  | "DISCONNECT_GRACE"
  | "TRICK_ADVANCE";

export interface RoomSettings {
  botDifficulty: "easy" | "normal" | "strong";
  enableSecondBidding: boolean;
  endHandWhenOutcomeCertain: boolean;
}

export interface StoredRoom {
  id: string;
  inviteCode: string;
  status: RoomStatus;
  eventVersion: number;
  hostPlayerId: string;
  ruleProfileId: RuleProfileId;
  settings: RoomSettings;
  recoveryError: string | null;
  updatedAt: Date;
}

export interface StoredSeat {
  seatIndex: number;
  playerId: string | null;
  occupantType: "human" | "bot" | "empty";
  botDifficulty: string | null;
  displayName: string | null;
  connectionStatus?: ConnectionStatus;
  lastPresenceAt?: Date | null;
  disconnectedAt?: Date | null;
  autopilotStartedAt?: Date | null;
}

export interface NewAutomationJob {
  id: string;
  roomId: string;
  expectedEventVersion: number;
  kind: AutomationJobKind;
  targetSeatIndex: number;
  dueAt: Date;
}

export interface ClaimedAutomationJob extends NewAutomationJob {
  attempts: number;
}
