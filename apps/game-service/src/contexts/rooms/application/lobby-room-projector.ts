import type { RoomProjection } from "@three-zero-four/contracts";
import type { StoredRoom, StoredSeat } from "./room-persistence-model.js";

export interface LobbyRoomProjector {
  project(
    room: StoredRoom,
    seats: readonly StoredSeat[],
    viewerSeatIndex: number | null,
  ): RoomProjection;
}
