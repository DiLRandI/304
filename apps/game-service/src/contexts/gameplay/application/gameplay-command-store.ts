import type { RuleProfileId } from "@three-zero-four/gameplay";

export type GameplayCommandTransaction = unknown;

export interface GameplayCommandRoom {
  readonly eventVersion: number;
  readonly hostPlayerId: string;
  readonly id: string;
  readonly inviteCode: string;
  readonly recoveryError: string | null;
  readonly ruleProfileId: RuleProfileId;
  readonly status:
    | "lobby"
    | "in_hand"
    | "hand_result"
    | "closed"
    | "recovery_failed";
}

export interface GameplayCommandSeat {
  readonly botDifficulty: string | null;
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly disconnectedAt?: Date | null;
  readonly displayName: string | null;
  readonly occupantType: "bot" | "empty" | "human";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

export interface GameplayCommandSnapshot {
  readonly eventVersion: number;
  readonly ruleProfileId: RuleProfileId;
  readonly schemaVersion: number;
  readonly state: unknown;
}

export interface GameplayCommandDuplicate {
  readonly eventVersion: number;
}

export interface AppendGameplayCommandInput {
  readonly actorPlayerId: string;
  readonly commandId: string;
  readonly eventType: "GAME_ACTION";
  readonly expectedVersion: number;
  readonly payload: unknown;
  readonly roomId: string;
  readonly ruleProfileId: RuleProfileId;
  readonly snapshot: unknown;
  readonly snapshotSchemaVersion: 1 | 2;
  readonly status: "in_hand" | "hand_result";
}

export interface GameplayCommandStore {
  appendEventAndSnapshot(
    transaction: GameplayCommandTransaction,
    input: AppendGameplayCommandInput,
  ): Promise<number>;
  findDuplicate(
    roomId: string,
    commandId: string,
    actorPlayerId: string,
    transaction: GameplayCommandTransaction,
  ): Promise<GameplayCommandDuplicate | null>;
  loadRoomForUpdate(
    transaction: GameplayCommandTransaction,
    roomId: string,
  ): Promise<GameplayCommandRoom | null>;
  loadSeats(
    roomId: string,
    transaction: GameplayCommandTransaction,
  ): Promise<GameplayCommandSeat[]>;
  loadSnapshot(
    roomId: string,
    transaction: GameplayCommandTransaction,
  ): Promise<GameplayCommandSnapshot | null>;
  loadSnapshotAt(
    transaction: GameplayCommandTransaction,
    roomId: string,
    eventVersion: number,
  ): Promise<GameplayCommandSnapshot | null>;
  markRecoveryFailed(roomId: string, recoveryError: string): Promise<void>;
  requireHumanSeat(
    transaction: GameplayCommandTransaction,
    roomId: string,
    playerId: string,
  ): Promise<number>;
  transaction<Result>(
    work: (transaction: GameplayCommandTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface GameplayCommandLease {
  withLease<Result>(
    roomId: string,
    work: () => Promise<Result>,
  ): Promise<Result>;
}
