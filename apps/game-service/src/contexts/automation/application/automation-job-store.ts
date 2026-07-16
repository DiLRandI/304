import type { RuleProfileId } from "@three-zero-four/gameplay";

export type AutomationJobTransaction = unknown;

export type DomainAutomationJobKind =
  | "BOT_ACTION"
  | "TURN_TIMEOUT"
  | "DISCONNECT_GRACE"
  | "TRICK_ADVANCE";

export interface AutomationJobRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly ruleProfileId: RuleProfileId;
  readonly status:
    | "lobby"
    | "in_hand"
    | "hand_result"
    | "closed"
    | "recovery_failed";
}

export interface AutomationJobSeat {
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly occupantType: "bot" | "empty" | "human";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

export interface ClaimedDomainAutomationJob {
  readonly attempts: number;
  readonly dueAt: Date;
  readonly expectedEventVersion: number;
  readonly id: string;
  readonly kind: DomainAutomationJobKind;
  readonly roomId: string;
  readonly targetSeatIndex: number;
}

export interface AppendAutomationEventInput {
  readonly actorPlayerId: null;
  readonly commandId: string;
  readonly eventType:
    | "AUTOPILOT_ACTION"
    | "AUTOPILOT_ENABLED"
    | "BOT_ACTION"
    | "TRICK_ADVANCED";
  readonly expectedVersion: number;
  readonly payload: unknown;
  readonly roomId: string;
  readonly ruleProfileId: RuleProfileId;
  readonly snapshot: unknown;
  readonly snapshotSchemaVersion: 1 | 2;
  readonly status: "hand_result" | "in_hand";
}

export interface AutomationJobStore {
  appendEventAndSnapshot(
    transaction: AutomationJobTransaction,
    input: AppendAutomationEventInput,
  ): Promise<number>;
  loadRoomForUpdate(
    transaction: AutomationJobTransaction,
    roomId: string,
  ): Promise<AutomationJobRoom | null>;
  loadSeats(
    roomId: string,
    transaction: AutomationJobTransaction,
  ): Promise<AutomationJobSeat[]>;
  markRecoveryFailed(roomId: string, recoveryError: string): Promise<void>;
  markSeatAutopilot(
    transaction: AutomationJobTransaction,
    roomId: string,
    seatIndex: number,
  ): Promise<void>;
  transaction<Result>(
    work: (transaction: AutomationJobTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface AutomationJobLease {
  withLease<Result>(
    roomId: string,
    work: () => Promise<Result>,
  ): Promise<Result>;
}

export interface AutomationJobPresence {
  onlinePlayerIds(
    roomId: string,
    playerIds: readonly string[],
  ): Promise<Set<string>>;
}
