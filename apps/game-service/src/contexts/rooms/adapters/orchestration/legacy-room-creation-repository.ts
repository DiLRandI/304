import { projectRoom, type Room } from "@three-zero-four/room-domain";
import { createLobbyEngine } from "../../../gameplay/adapters/engine/legacy-engine-factory.js";
import type {
  RoomCreationCommit,
  RoomCreationRepository,
} from "../../application/create-room.js";
import type {
  RoomCoordinatorStore,
  RoomSessionCommandDuplicate,
} from "../../application/room-coordinator-store.js";
import type {
  StoredRoom,
  StoredSeat,
} from "../../application/room-persistence-model.js";
import { mapPersistedRoomProjection } from "../persistence/room-projection-record-mapper.js";
import {
  mapPersistedRoom,
  mapRoomSeatsForPersistence,
  type PersistedRoomRecord,
  type PersistedSeatRecord,
} from "../persistence/room-record-mapper.js";

export type LegacyRoomCreationStore = Pick<
  RoomCoordinatorStore,
  "createRoom" | "findSessionDuplicate" | "loadRoomByReference" | "loadSeats"
>;

export class LegacyRoomCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyRoomCreationError";
  }
}

function storedSeats(room: Room): StoredSeat[] {
  return mapRoomSeatsForPersistence(room).map((seat) => ({
    botDifficulty: seat.botDifficulty,
    connectionStatus: seat.connectionStatus as NonNullable<
      StoredSeat["connectionStatus"]
    >,
    displayName: seat.displayName,
    occupantType: seat.occupantType as StoredSeat["occupantType"],
    playerId: seat.playerId,
    seatIndex: seat.position,
  }));
}

function persistedRoom(room: StoredRoom): PersistedRoomRecord {
  return {
    eventVersion: room.eventVersion,
    hostPlayerId: room.hostPlayerId,
    id: room.id,
    inviteCode: room.inviteCode,
    profileId: room.ruleProfileId,
    settings: room.settings,
    status: room.status,
  };
}

function persistedSeat(seat: StoredSeat): PersistedSeatRecord {
  return {
    botDifficulty: seat.botDifficulty,
    connectionStatus:
      seat.connectionStatus ??
      (seat.occupantType === "bot" ? "online" : "disconnected"),
    displayName: seat.displayName,
    occupantType: seat.occupantType,
    playerId: seat.playerId,
    position: seat.seatIndex,
  };
}

export class LegacyRoomCreationRepository implements RoomCreationRepository {
  constructor(private readonly store: LegacyRoomCreationStore) {}

  async create(commit: RoomCreationCommit) {
    const seats = storedSeats(commit.room);
    const host = seats.find(
      (seat) =>
        seat.occupantType === "human" &&
        seat.playerId === commit.room.hostPlayerId,
    );
    if (!host?.displayName) {
      throw new LegacyRoomCreationError("Created room host is missing");
    }
    const snapshot = createLobbyEngine(
      { displayName: host.displayName },
      seats,
      commit.room.profileId,
      commit.room.settings,
    ).getSnapshot();
    await this.store.createRoom({
      commandId: commit.commandId,
      deduplicationResponse: commit.response,
      hostPlayerId: commit.room.hostPlayerId,
      id: commit.room.id,
      inviteCode: commit.room.inviteCode,
      ruleProfileId: commit.room.profileId,
      seats,
      sessionId: commit.sessionId,
      settings: commit.room.settings,
      snapshot,
    });
    const durable = await this.store.findSessionDuplicate(
      commit.sessionId,
      commit.commandId,
    );
    if (!durable) {
      throw new LegacyRoomCreationError("Created room replay is missing");
    }
    return this.replay(durable);
  }

  async findDuplicate(sessionId: string, commandId: string) {
    const duplicate = await this.store.findSessionDuplicate(
      sessionId,
      commandId,
    );
    return duplicate ? this.replay(duplicate) : null;
  }

  private async replay(duplicate: RoomSessionCommandDuplicate) {
    if (duplicate.deduplicationResponse !== undefined) {
      return mapPersistedRoomProjection(duplicate.deduplicationResponse);
    }
    const room = await this.store.loadRoomByReference(duplicate.roomId);
    if (!room) {
      throw new LegacyRoomCreationError("Duplicate created room is missing");
    }
    const seats = await this.store.loadSeats(room.id);
    const aggregate = mapPersistedRoom(
      persistedRoom(room),
      seats.map(persistedSeat),
    );
    return projectRoom(aggregate, aggregate.hostPlayerId);
  }
}
