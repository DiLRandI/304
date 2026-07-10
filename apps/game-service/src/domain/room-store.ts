import type { QueryResultRow } from "pg";
import type { Database } from "../infra/database.js";
import { DomainError } from "./errors.js";

export type RoomStatus =
  | "lobby"
  | "in_hand"
  | "hand_result"
  | "closed"
  | "recovery_failed";

export interface RoomSettings {
  botDifficulty: "easy";
  enableSecondBidding: boolean;
}

export interface StoredRoom {
  id: string;
  inviteCode: string;
  status: RoomStatus;
  eventVersion: number;
  hostPlayerId: string;
  ruleProfileId: "classic_304_4p";
  settings: RoomSettings;
  recoveryError: string | null;
}

export interface StoredSeat {
  seatIndex: number;
  playerId: string | null;
  occupantType: "human" | "bot" | "empty";
  botDifficulty: string | null;
  displayName: string | null;
}

export interface StoredSnapshot {
  eventVersion: number;
  schemaVersion: number;
  ruleProfileId: "classic_304_4p";
  state: unknown;
}

export interface StoredEvent {
  eventVersion: number;
  commandId: string;
  actorPlayerId: string | null;
  eventType: string;
  payload: unknown;
}

export interface CommandDuplicate {
  eventVersion: number;
  eventType: string;
}

export interface NewRoomInput {
  id: string;
  inviteCode: string;
  hostPlayerId: string;
  commandId: string;
  ruleProfileId: "classic_304_4p";
  settings: RoomSettings;
  seats: readonly StoredSeat[];
  snapshot: unknown;
}

export interface AppendEventInput {
  roomId: string;
  expectedVersion: number;
  commandId: string;
  actorPlayerId: string;
  eventType: string;
  payload: unknown;
  snapshot: unknown;
  status: Extract<RoomStatus, "in_hand" | "hand_result">;
}

export type Queryable = Pick<Database, "query">;

interface RoomRow extends QueryResultRow {
  id: string;
  invite_code: string;
  status: string;
  event_version: string | number;
  host_player_id: string;
  rule_profile_id: string;
  settings: unknown;
  recovery_error: string | null;
}

interface SeatRow extends QueryResultRow {
  seat_index: number;
  player_id: string | null;
  occupant_type: string;
  bot_difficulty: string | null;
  display_name: string | null;
}

interface SnapshotRow extends QueryResultRow {
  event_version: string | number;
  schema_version: number;
  rule_profile_id: string;
  state: unknown;
}

interface EventRow extends QueryResultRow {
  event_version: string | number;
  command_id: string;
  actor_player_id: string | null;
  event_type: string;
  payload: unknown;
}

interface DuplicateRow extends QueryResultRow {
  event_version: string | number;
  event_type: string;
  actor_player_id: string | null;
}

const roomStatuses = new Set<RoomStatus>([
  "lobby",
  "in_hand",
  "hand_result",
  "closed",
  "recovery_failed",
]);

const seatTypes = new Set<StoredSeat["occupantType"]>([
  "human",
  "bot",
  "empty",
]);

function toSafeNumber(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DomainError("ROOM_DATA_INVALID", 500, `Invalid ${field}`);
  }
  return parsed;
}

function parseSettings(value: unknown): RoomSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room settings");
  }
  const settings = value as Record<string, unknown>;
  const enableSecondBidding = settings.enableSecondBidding;
  if (
    settings.botDifficulty !== "easy" ||
    typeof enableSecondBidding !== "boolean"
  ) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room settings");
  }
  return {
    botDifficulty: "easy",
    enableSecondBidding,
  };
}

function mapRoom(row: RoomRow): StoredRoom {
  if (!roomStatuses.has(row.status as RoomStatus)) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room status");
  }
  if (row.rule_profile_id !== "classic_304_4p") {
    throw new DomainError(
      "ROOM_DATA_INVALID",
      500,
      "Invalid room rule profile",
    );
  }
  return {
    id: row.id,
    inviteCode: row.invite_code,
    status: row.status as RoomStatus,
    eventVersion: toSafeNumber(row.event_version, "room event version"),
    hostPlayerId: row.host_player_id,
    ruleProfileId: row.rule_profile_id,
    settings: parseSettings(row.settings),
    recoveryError: row.recovery_error,
  };
}

function mapSeat(row: SeatRow): StoredSeat {
  if (!seatTypes.has(row.occupant_type as StoredSeat["occupantType"])) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room seat");
  }
  return {
    seatIndex: row.seat_index,
    playerId: row.player_id,
    occupantType: row.occupant_type as StoredSeat["occupantType"],
    botDifficulty: row.bot_difficulty,
    displayName: row.display_name,
  };
}

function mapSnapshot(row: SnapshotRow): StoredSnapshot {
  if (row.rule_profile_id !== "classic_304_4p") {
    throw new DomainError(
      "ROOM_DATA_INVALID",
      500,
      "Invalid snapshot rule profile",
    );
  }
  return {
    eventVersion: toSafeNumber(row.event_version, "snapshot event version"),
    schemaVersion: row.schema_version,
    ruleProfileId: row.rule_profile_id,
    state: row.state,
  };
}

function mapEvent(row: EventRow): StoredEvent {
  return {
    eventVersion: toSafeNumber(row.event_version, "event version"),
    commandId: row.command_id,
    actorPlayerId: row.actor_player_id,
    eventType: row.event_type,
    payload: row.payload,
  };
}

export class PostgresRoomStore {
  constructor(private readonly database: Database) {}

  transaction<T>(callback: (transaction: Queryable) => Promise<T>): Promise<T> {
    return this.database.transaction(callback);
  }

  async createRoom(input: NewRoomInput): Promise<StoredRoom> {
    if (input.seats.length !== 4) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Classic rooms require four seats",
      );
    }
    return this.transaction(async (transaction) => {
      await transaction.query(
        "INSERT INTO rooms (id, invite_code, status, rule_profile_id, event_version, host_player_id, settings) VALUES ($1, $2, 'lobby', $3, 1, $4, $5::jsonb)",
        [
          input.id,
          input.inviteCode,
          input.ruleProfileId,
          input.hostPlayerId,
          JSON.stringify(input.settings),
        ],
      );
      for (const seat of input.seats) {
        await transaction.query(
          "INSERT INTO room_seats (room_id, seat_index, player_id, occupant_type, bot_difficulty, joined_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END)",
          [
            input.id,
            seat.seatIndex,
            seat.playerId,
            seat.occupantType,
            seat.botDifficulty,
          ],
        );
      }
      await transaction.query(
        "INSERT INTO game_events (room_id, event_version, command_id, actor_player_id, event_type, payload) VALUES ($1, 1, $2, $3, 'ROOM_CREATED', $4::jsonb)",
        [
          input.id,
          input.commandId,
          input.hostPlayerId,
          JSON.stringify({ ruleProfileId: input.ruleProfileId }),
        ],
      );
      await transaction.query(
        "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, 1, 1, $2, $3::jsonb)",
        [input.id, input.ruleProfileId, JSON.stringify(input.snapshot)],
      );
      await transaction.query(
        "INSERT INTO command_deduplications (room_id, command_id, actor_player_id, response) VALUES ($1, $2, $3, $4::jsonb)",
        [
          input.id,
          input.commandId,
          input.hostPlayerId,
          JSON.stringify({ eventVersion: 1 }),
        ],
      );
      return {
        id: input.id,
        inviteCode: input.inviteCode,
        status: "lobby",
        eventVersion: 1,
        hostPlayerId: input.hostPlayerId,
        ruleProfileId: input.ruleProfileId,
        settings: input.settings,
        recoveryError: null,
      };
    });
  }

  async loadRoom(roomId: string): Promise<StoredRoom | null> {
    const result = await this.database.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings, recovery_error FROM rooms WHERE id = $1",
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async loadRoomForUpdate(
    transaction: Queryable,
    roomId: string,
  ): Promise<StoredRoom | null> {
    const result = await transaction.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings, recovery_error FROM rooms WHERE id = $1 FOR UPDATE",
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async loadSeats(
    roomId: string,
    transaction: Queryable = this.database,
  ): Promise<StoredSeat[]> {
    const result = await transaction.query<SeatRow>(
      "SELECT room_seats.seat_index, room_seats.player_id, room_seats.occupant_type, room_seats.bot_difficulty, players.display_name FROM room_seats LEFT JOIN players ON players.id = room_seats.player_id WHERE room_seats.room_id = $1 ORDER BY room_seats.seat_index",
      [roomId],
    );
    return result.rows.map(mapSeat);
  }

  async loadSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const result = await this.database.query<SnapshotRow>(
      "SELECT event_version, schema_version, rule_profile_id, state FROM game_snapshots WHERE room_id = $1 ORDER BY event_version DESC LIMIT 1",
      [roomId],
    );
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
  }

  async loadSnapshotAt(
    transaction: Queryable,
    roomId: string,
    eventVersion: number,
  ): Promise<StoredSnapshot | null> {
    const result = await transaction.query<SnapshotRow>(
      "SELECT event_version, schema_version, rule_profile_id, state FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [roomId, eventVersion],
    );
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
  }

  async loadEventsAfter(
    roomId: string,
    eventVersion: number,
  ): Promise<StoredEvent[]> {
    const result = await this.database.query<EventRow>(
      "SELECT event_version, command_id, actor_player_id, event_type, payload FROM game_events WHERE room_id = $1 AND event_version > $2 ORDER BY event_version",
      [roomId, eventVersion],
    );
    return result.rows.map(mapEvent);
  }

  async findDuplicate(
    roomId: string,
    commandId: string,
    actorPlayerId: string,
    transaction: Queryable = this.database,
  ): Promise<CommandDuplicate | null> {
    const result = await transaction.query<DuplicateRow>(
      "SELECT game_events.event_version, game_events.event_type, command_deduplications.actor_player_id FROM command_deduplications JOIN game_events ON game_events.room_id = command_deduplications.room_id AND game_events.command_id = command_deduplications.command_id WHERE command_deduplications.room_id = $1 AND command_deduplications.command_id = $2",
      [roomId, commandId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.actor_player_id !== actorPlayerId) {
      throw new DomainError(
        "COMMAND_ID_CONFLICT",
        409,
        "Command id belongs to another player",
      );
    }
    return {
      eventVersion: toSafeNumber(row.event_version, "duplicate event version"),
      eventType: row.event_type,
    };
  }

  async requireHumanSeat(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<number> {
    const result = await transaction.query<{ seat_index: number }>(
      "SELECT seat_index FROM room_seats WHERE room_id = $1 AND player_id = $2 AND occupant_type = 'human'",
      [roomId, playerId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new DomainError(
        "SEAT_REQUIRED",
        403,
        "You are not seated in this room",
      );
    }
    return row.seat_index;
  }

  async appendEventAndSnapshot(
    transaction: Queryable,
    input: AppendEventInput,
  ): Promise<number> {
    const nextVersion = input.expectedVersion + 1;
    const updated = await transaction.query<{ event_version: string | number }>(
      "UPDATE rooms SET event_version = $2, status = $3, recovery_error = NULL, updated_at = now() WHERE id = $1 AND event_version = $4 RETURNING event_version",
      [input.roomId, nextVersion, input.status, input.expectedVersion],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "VERSION_CONFLICT",
        409,
        "Room state changed; refresh and retry",
      );
    }
    await transaction.query(
      "INSERT INTO game_events (room_id, event_version, command_id, actor_player_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [
        input.roomId,
        nextVersion,
        input.commandId,
        input.actorPlayerId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
    await transaction.query(
      "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, $2, 1, 'classic_304_4p', $3::jsonb)",
      [input.roomId, nextVersion, JSON.stringify(input.snapshot)],
    );
    await transaction.query(
      "INSERT INTO command_deduplications (room_id, command_id, actor_player_id, response) VALUES ($1, $2, $3, $4::jsonb)",
      [
        input.roomId,
        input.commandId,
        input.actorPlayerId,
        JSON.stringify({ eventVersion: nextVersion }),
      ],
    );
    return nextVersion;
  }

  async markRecoveryFailed(
    roomId: string,
    recoveryError: string,
  ): Promise<void> {
    await this.database.query(
      "UPDATE rooms SET status = 'recovery_failed', recovery_error = $2, updated_at = now() WHERE id = $1",
      [roomId, recoveryError.slice(0, 500)],
    );
  }
}
