import type { RoomProjection } from "@three-zero-four/contracts";
import type { StoredRoom } from "./room-persistence-model.js";
import type { RoomTransaction } from "./room-persistence-store.js";

export class ActiveRoomProjectionError extends Error {
  constructor(readonly roomId: string) {
    super(`Active room projection failed for ${roomId}`);
    this.name = "ActiveRoomProjectionError";
  }
}

export interface ActiveRoomProjectionReader {
  project(
    transaction: RoomTransaction,
    room: StoredRoom,
    viewerSeatIndex: number,
  ): Promise<RoomProjection>;
}
