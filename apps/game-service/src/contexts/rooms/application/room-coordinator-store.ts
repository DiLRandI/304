import type { RuleProfileId } from "@three-zero-four/contracts";
import type {
  AutomationJobKind,
  NewAutomationJob,
  RoomSettings,
  RoomStatus,
  StoredRoom,
  StoredSeat,
} from "./room-persistence-model.js";

export type RoomTransaction = unknown;

export interface RoomCreationInput {
  deduplicationResponse?: unknown;
  id: string;
  inviteCode: string;
  hostPlayerId: string;
  sessionId?: string;
  commandId: string;
  ruleProfileId: RuleProfileId;
  settings: RoomSettings;
  seats: readonly StoredSeat[];
  snapshot: unknown;
}

export interface RoomEventAppendInput {
  roomId: string;
  expectedVersion: number;
  commandId: string;
  actorPlayerId: string | null;
  eventType: string;
  payload: unknown;
  snapshot: unknown;
  status: Extract<RoomStatus, "lobby" | "in_hand" | "hand_result" | "closed">;
  ruleProfileId: RuleProfileId;
  deduplicationResponse?: unknown;
}

export interface StoredRoomSnapshot {
  eventVersion: number;
  schemaVersion: number;
  ruleProfileId: RuleProfileId;
  state: unknown;
}

export interface StoredRoomEvent {
  eventVersion: number;
  commandId: string;
  actorPlayerId: string | null;
  eventType: string;
  payload: unknown;
}

export interface RoomCommandDuplicate {
  eventVersion: number;
  eventType: string;
  response: unknown;
}

export interface RoomSessionCommandDuplicate {
  deduplicationResponse?: unknown;
  roomId: string;
}

export interface RoomCoordinatorStore {
  appendEventAndSnapshot(
    transaction: RoomTransaction,
    input: RoomEventAppendInput,
  ): Promise<number>;
  assignHumanSeat(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<StoredSeat>;
  cancelAutomationForRoom(
    transaction: RoomTransaction,
    roomId: string,
    kinds: readonly AutomationJobKind[],
  ): Promise<void>;
  clearHumanSeat(
    transaction: RoomTransaction,
    roomId: string,
    seatIndex: number,
  ): Promise<StoredSeat>;
  createRoom(input: RoomCreationInput): Promise<StoredRoom>;
  fillEmptySeatsWithBots(
    transaction: RoomTransaction,
    roomId: string,
    botDifficulty: RoomSettings["botDifficulty"],
  ): Promise<void>;
  findDuplicate(
    roomId: string,
    commandId: string,
    actorPlayerId: string,
    transaction?: RoomTransaction,
  ): Promise<RoomCommandDuplicate | null>;
  findLowestHumanPlayerId(
    transaction: RoomTransaction,
    roomId: string,
  ): Promise<string | null>;
  findSeatIndex(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<number | null>;
  findSessionDuplicate(
    sessionId: string,
    commandId: string,
    transaction?: RoomTransaction,
  ): Promise<RoomSessionCommandDuplicate | null>;
  loadEventsAfter(
    roomId: string,
    eventVersion: number,
    transaction?: RoomTransaction,
  ): Promise<StoredRoomEvent[]>;
  loadRoomByReference(roomReference: string): Promise<StoredRoom | null>;
  loadRoomForUpdate(
    transaction: RoomTransaction,
    roomId: string,
  ): Promise<StoredRoom | null>;
  loadSeats(
    roomId: string,
    transaction?: RoomTransaction,
  ): Promise<StoredSeat[]>;
  loadSnapshot(
    roomId: string,
    transaction?: RoomTransaction,
  ): Promise<StoredRoomSnapshot | null>;
  loadSnapshotAt(
    transaction: RoomTransaction,
    roomId: string,
    eventVersion: number,
  ): Promise<StoredRoomSnapshot | null>;
  markRecoveryFailed(roomId: string, recoveryError: string): Promise<void>;
  markSeatAutopilot(
    transaction: RoomTransaction,
    roomId: string,
    seatIndex: number,
  ): Promise<void>;
  markSeatOffline(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<void>;
  markSeatOnline(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<number | null>;
  replaceHumanSeatWithBot(
    transaction: RoomTransaction,
    roomId: string,
    seatIndex: number,
    botDifficulty: RoomSettings["botDifficulty"],
  ): Promise<StoredSeat>;
  requireHumanSeat(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<number>;
  scheduleAutomation(
    transaction: RoomTransaction,
    job: NewAutomationJob,
  ): Promise<void>;
  transaction<T>(
    callback: (transaction: RoomTransaction) => Promise<T>,
  ): Promise<T>;
  transferHost(
    transaction: RoomTransaction,
    roomId: string,
    playerId: string,
  ): Promise<void>;
}
