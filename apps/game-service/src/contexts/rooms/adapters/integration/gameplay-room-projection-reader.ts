import type { RoomProjection } from "@three-zero-four/contracts";
import { projectDomainRoomForPlayer } from "../../../gameplay/adapters/delivery/domain-gameplay-room-presenter.js";
import type { GameplayHandRecovery } from "../../../gameplay/application/gameplay-hand-recovery.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import {
  ActiveRoomProjectionError,
  type ActiveRoomProjectionReader,
} from "../../application/active-room-projection-reader.js";
import type { StoredRoom } from "../../application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../application/room-persistence-store.js";

interface GameplayRoomProjectionDependencies {
  readonly recovery: GameplayHandRecovery;
  readonly store: Pick<RoomPersistenceStore, "loadSeats">;
}

export class GameplayRoomProjectionReader
  implements ActiveRoomProjectionReader
{
  constructor(
    private readonly dependencies: GameplayRoomProjectionDependencies,
  ) {}

  async project(
    transaction: RoomTransaction,
    room: StoredRoom,
    viewerSeatIndex: number,
  ): Promise<RoomProjection> {
    try {
      const [hand, seats] = await Promise.all([
        this.dependencies.recovery.recover(transaction, room),
        this.dependencies.store.loadSeats(room.id, transaction),
      ]);
      return projectDomainRoomForPlayer(room, hand, seats, viewerSeatIndex);
    } catch (error) {
      if (error instanceof RecoveryError) {
        throw new ActiveRoomProjectionError(room.id);
      }
      throw error;
    }
  }
}
