import type { GameEngine } from "@three-zero-four/game-engine";

export interface AutomatableRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly status: string;
}

export interface AutomationScheduler {
  schedule(
    transaction: unknown,
    room: AutomatableRoom,
    engine: GameEngine,
  ): Promise<void>;
}
