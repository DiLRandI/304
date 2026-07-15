import type { GameEngine } from "@three-zero-four/game-engine";

export interface RecoverableGameplayRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly ruleProfileId: string;
}

export interface GameplayRecovery {
  recover(
    transaction: unknown,
    room: RecoverableGameplayRoom,
  ): Promise<GameEngine>;
}
