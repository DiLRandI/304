import type { GameEngine } from "@three-zero-four/game-engine";

export interface RecoverableGameplayRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly ruleProfileId: string;
}

export interface GameplayRecoveryEvent {
  readonly actorPlayerId: string | null;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface GameplayRecoverySeat {
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly seatIndex: number;
}

export interface GameplayRecoverySnapshot {
  readonly eventVersion: number;
  readonly ruleProfileId: string;
  readonly state: unknown;
}

export interface GameplayRecoveryStore {
  findSeatIndex(
    transaction: unknown,
    roomId: string,
    playerId: string,
  ): Promise<number | null>;
  loadEventsAfter(
    roomId: string,
    eventVersion: number,
    transaction?: unknown,
  ): Promise<GameplayRecoveryEvent[]>;
  loadSeats(
    roomId: string,
    transaction?: unknown,
  ): Promise<GameplayRecoverySeat[]>;
  loadSnapshot(
    roomId: string,
    transaction?: unknown,
  ): Promise<GameplayRecoverySnapshot | null>;
}

export interface GameplayRecovery {
  recover(
    transaction: unknown,
    room: RecoverableGameplayRoom,
  ): Promise<GameEngine>;
}
