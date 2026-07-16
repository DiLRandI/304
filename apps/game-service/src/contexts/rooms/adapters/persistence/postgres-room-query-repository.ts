import { isDeepStrictEqual } from "node:util";
import type {
  CommandId,
  PlayerId,
  Room,
  RoomCommand,
  RoomId,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { Database } from "../../../../platform/postgres/database.js";
import type { RoomCommandReader } from "../../application/execute-room-command.js";
import { mapPersistedRoomProjection } from "./room-projection-record-mapper.js";
import {
  mapPersistedRoom,
  type PersistedRoomRecord,
  type PersistedSeatRecord,
} from "./room-record-mapper.js";

interface RoomRow extends QueryResultRow {
  readonly event_version: number | string;
  readonly host_player_id: string;
  readonly id: string;
  readonly invite_code: string;
  readonly rule_profile_id: string;
  readonly settings: unknown;
  readonly status: string;
}

interface SeatRow extends QueryResultRow {
  readonly bot_difficulty: string | null;
  readonly connection_status: string;
  readonly display_name: string | null;
  readonly occupant_type: string;
  readonly player_id: string | null;
  readonly seat_index: number;
}

type RoomWithSeatRow = RoomRow & SeatRow;

interface DuplicateRow extends QueryResultRow {
  readonly actor_player_id: string | null;
  readonly request: unknown;
  readonly response: unknown;
}

type Queryable = Pick<Database, "query">;

export class RoomQueryRepositoryError extends Error {
  constructor(
    readonly code: "COMMAND_ID_CONFLICT" | "INVALID_COMMAND_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "RoomQueryRepositoryError";
  }
}

function persistedRoomRecord(row: RoomRow): PersistedRoomRecord {
  return {
    eventVersion: Number(row.event_version),
    hostPlayerId: row.host_player_id,
    id: row.id,
    inviteCode: row.invite_code,
    profileId: row.rule_profile_id,
    settings: row.settings,
    status: row.status,
  };
}

function persistedSeatRecord(row: SeatRow): PersistedSeatRecord {
  return {
    botDifficulty: row.bot_difficulty,
    connectionStatus: row.connection_status,
    displayName: row.display_name,
    occupantType: row.occupant_type,
    playerId: row.player_id,
    position: row.seat_index,
  };
}

export class PostgresRoomQueryRepository implements RoomCommandReader {
  constructor(private readonly database: Queryable) {}

  async findByReference(reference: string): Promise<Room | null> {
    const roomUuid = z.uuid().safeParse(reference).success ? reference : null;
    const result = await this.database.query<RoomWithSeatRow>(
      "SELECT rooms.id, rooms.invite_code, rooms.status, rooms.event_version, rooms.host_player_id, rooms.rule_profile_id, rooms.settings, room_seats.seat_index, room_seats.player_id, room_seats.occupant_type, room_seats.bot_difficulty, room_seats.connection_status, players.display_name FROM rooms JOIN room_seats ON room_seats.room_id = rooms.id LEFT JOIN players ON players.id = room_seats.player_id WHERE rooms.invite_code = $1 OR rooms.id = $2 ORDER BY room_seats.seat_index",
      [reference, roomUuid],
    );
    const room = result.rows[0];
    if (!room) return null;
    return mapPersistedRoom(
      persistedRoomRecord(room),
      result.rows.map(persistedSeatRecord),
    );
  }

  async findDuplicate(
    aggregateId: RoomId,
    duplicateCommandId: CommandId,
    actorPlayerId: PlayerId,
    request: RoomCommand,
  ): Promise<RoomProjection | null> {
    const result = await this.database.query<DuplicateRow>(
      "SELECT actor_player_id, request, response FROM command_deduplications WHERE room_id = $1 AND command_id = $2",
      [aggregateId, duplicateCommandId],
    );
    const duplicate = result.rows[0];
    if (!duplicate) return null;
    if (
      duplicate.actor_player_id !== actorPlayerId ||
      !isDeepStrictEqual(duplicate.request, request)
    ) {
      throw new RoomQueryRepositoryError(
        "COMMAND_ID_CONFLICT",
        "Command id belongs to another player",
      );
    }
    try {
      return mapPersistedRoomProjection(duplicate.response);
    } catch {
      throw new RoomQueryRepositoryError(
        "INVALID_COMMAND_RESPONSE",
        "Stored command response is invalid",
      );
    }
  }
}
