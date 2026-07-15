import type { RoomProjection } from "@three-zero-four/contracts";
import { projectRoomForPlayer } from "../../../gameplay/adapters/delivery/gameplay-room-presenter.js";
import type { GameplayRecovery } from "../../../gameplay/application/gameplay-recovery.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import {
  ActiveRoomProjectionError,
  type ActiveRoomProjectionReader,
} from "../../application/active-room-projection-reader.js";
import type { StoredRoom } from "../../application/room-persistence-model.js";
import type { RoomTransaction } from "../../application/room-persistence-store.js";

export class GameplayRoomProjectionReader
  implements ActiveRoomProjectionReader
{
  constructor(private readonly recovery: GameplayRecovery) {}

  async project(
    transaction: RoomTransaction,
    room: StoredRoom,
    viewerSeatIndex: number,
  ): Promise<RoomProjection> {
    try {
      const engine = await this.recovery.recover(transaction, room);
      return projectRoomForPlayer(room, engine, viewerSeatIndex);
    } catch (error) {
      if (error instanceof RecoveryError) {
        throw new ActiveRoomProjectionError(room.id);
      }
      throw error;
    }
  }
}
