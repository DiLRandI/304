import type { GameplayHand, RuleProfileId } from "@three-zero-four/gameplay";

export interface RecoverableGameplayHandRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly ruleProfileId: RuleProfileId;
}

export interface GameplayHandRecoveryEvent {
  readonly actorPlayerId: string | null;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface GameplayHandRecoverySnapshot {
  readonly eventVersion: number;
  readonly ruleProfileId: string;
  readonly schemaVersion: number;
  readonly state: unknown;
}

export interface GameplayHandRecoveryStore {
  findSeatIndex(
    transaction: unknown,
    roomId: string,
    playerId: string,
  ): Promise<number | null>;
  loadEventsAfter(
    roomId: string,
    eventVersion: number,
    transaction: unknown,
  ): Promise<GameplayHandRecoveryEvent[]>;
  loadSnapshot(
    roomId: string,
    transaction: unknown,
  ): Promise<GameplayHandRecoverySnapshot | null>;
}

export interface GameplayHandRecovery {
  recover(
    transaction: unknown,
    room: RecoverableGameplayHandRoom,
  ): Promise<GameplayHand>;
}
