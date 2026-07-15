import type { GameEngine } from "@three-zero-four/game-engine";
import type { StoredRoom } from "../../rooms/application/room-persistence-model.js";
import type { RoomTransaction } from "../../rooms/application/room-persistence-store.js";

export interface GameplayAutomationScheduler {
  schedule(
    transaction: RoomTransaction,
    room: StoredRoom,
    engine: GameEngine,
  ): Promise<void>;
}
