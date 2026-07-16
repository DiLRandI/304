import type { GameplayHand } from "@three-zero-four/gameplay";

export interface LoadedGameplaySnapshot {
  readonly eventVersion: number;
  readonly hand: GameplayHand;
}

export interface GameplaySnapshotReader {
  findLatest(roomId: string): Promise<LoadedGameplaySnapshot | null>;
}
