import type { GameEngine } from "@three-zero-four/game-engine";
import type { StoredRoom } from "../../rooms/application/room-persistence-model.js";
import type { RoomTransaction } from "../../rooms/application/room-persistence-store.js";

export interface GameplayRecovery {
  recover(transaction: RoomTransaction, room: StoredRoom): Promise<GameEngine>;
}
