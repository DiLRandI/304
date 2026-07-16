import type { RuleProfileId } from "@three-zero-four/contracts";

export type RoomMaintenanceAutomationKind =
  | "BOT_ACTION"
  | "TURN_TIMEOUT"
  | "DISCONNECT_GRACE"
  | "TRICK_ADVANCE";

export interface RoomMaintenanceRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly ruleProfileId: RuleProfileId;
  readonly status:
    | "lobby"
    | "in_hand"
    | "hand_result"
    | "closed"
    | "recovery_failed";
  readonly updatedAt: Date;
}

export interface RoomMaintenanceSnapshot {
  readonly eventVersion: number;
  readonly state: unknown;
}

export interface CloseRoomForMaintenanceInput {
  readonly actorPlayerId: string | null;
  readonly commandId: string;
  readonly eventType: string;
  readonly expectedVersion: number;
  readonly payload: unknown;
  readonly roomId: string;
  readonly ruleProfileId: RuleProfileId;
  readonly snapshot: unknown;
  readonly status: "lobby" | "in_hand" | "hand_result" | "closed";
}

export interface RoomMaintenanceStore<Transaction> {
  appendEventAndSnapshot(
    transaction: Transaction,
    input: CloseRoomForMaintenanceInput,
  ): Promise<number>;
  cancelAutomationForRoom(
    transaction: Transaction,
    roomId: string,
    kinds: readonly RoomMaintenanceAutomationKind[],
  ): Promise<void>;
  findStaleRoomIds(
    lobbyCutoff: Date,
    terminalCutoff: Date,
    limit: number,
  ): Promise<string[]>;
  loadRoomForUpdate(
    transaction: Transaction,
    roomId: string,
  ): Promise<RoomMaintenanceRoom | null>;
  loadSnapshot(
    roomId: string,
    transaction: Transaction,
  ): Promise<RoomMaintenanceSnapshot | null>;
  purgeClosedRooms(cutoff: Date, limit: number): Promise<number>;
  revokeExpiredSessions(
    cutoff: Date,
    revokedAt: Date,
    limit: number,
  ): Promise<number>;
  transaction<Result>(
    callback: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}
