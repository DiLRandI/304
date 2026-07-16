import type { Room } from "@three-zero-four/room-domain";
import {
  createStartedEngine,
  type LegacyEngineRoomRecord,
} from "../../../gameplay/adapters/engine/legacy-engine-factory.js";
import type { GameplaySeatRecord } from "../../../gameplay/adapters/engine/legacy-engine-seat-mapper.js";
import type {
  StartedRoomSnapshot,
  StartedRoomSnapshotFactory,
} from "../../application/started-room-initialization.js";
import { mapRoomSeatsForPersistence } from "../persistence/room-record-mapper.js";

export class LegacyStartedRoomSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyStartedRoomSnapshotError";
  }
}

function gameplaySeats(room: Room): GameplaySeatRecord[] {
  return mapRoomSeatsForPersistence(room).map((seat) => ({
    botDifficulty: seat.botDifficulty,
    connectionStatus: seat.connectionStatus as NonNullable<
      GameplaySeatRecord["connectionStatus"]
    >,
    displayName: seat.displayName,
    occupantType: seat.occupantType as GameplaySeatRecord["occupantType"],
    playerId: seat.playerId,
    seatIndex: seat.position,
  }));
}

function engineRoom(room: Room): LegacyEngineRoomRecord {
  return {
    hostPlayerId: room.hostPlayerId,
    ruleProfileId: room.profileId,
    settings: room.settings,
  };
}

export class LegacyStartedRoomSnapshotFactory
  implements StartedRoomSnapshotFactory
{
  create(room: Room): StartedRoomSnapshot {
    if (room.status !== "in_hand") {
      throw new LegacyStartedRoomSnapshotError(
        "Gameplay snapshots require a started room",
      );
    }
    return {
      schemaVersion: 1,
      state: createStartedEngine(
        engineRoom(room),
        gameplaySeats(room),
      ).getSnapshot(),
    };
  }
}
