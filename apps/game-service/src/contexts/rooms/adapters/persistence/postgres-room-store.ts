import type { RuleProfileId } from "@three-zero-four/contracts";
import type { QueryResultRow } from "pg";
import { DomainError } from "../../../../domain/errors.js";
import type { Database } from "../../../../infra/database.js";
import type {
  AutomationJobKind,
  ClaimedAutomationJob,
  ConnectionStatus,
  NewAutomationJob,
  RoomSettings,
  RoomStatus,
  StoredRoom,
  StoredSeat,
} from "../../application/room-persistence-model.js";

export type {
  AutomationJobKind,
  ClaimedAutomationJob,
  ConnectionStatus,
  NewAutomationJob,
  RoomSettings,
  RoomStatus,
  StoredRoom,
  StoredSeat,
} from "../../application/room-persistence-model.js";

export interface StoredSnapshot {
  eventVersion: number;
  schemaVersion: number;
  ruleProfileId: RuleProfileId;
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
  response: unknown;
}

export interface SessionCommandDuplicate {
  roomId: string;
}

export interface NewRoomInput {
  id: string;
  inviteCode: string;
  hostPlayerId: string;
  sessionId?: string;
  commandId: string;
  ruleProfileId: RuleProfileId;
  settings: RoomSettings;
  seats: readonly StoredSeat[];
  snapshot: unknown;
}

export interface AppendEventInput {
  roomId: string;
  expectedVersion: number;
  commandId: string;
  actorPlayerId: string | null;
  eventType: string;
  payload: unknown;
  snapshot: unknown;
  status: Extract<RoomStatus, "lobby" | "in_hand" | "hand_result" | "closed">;
  ruleProfileId: RuleProfileId;
  deduplicationResponse?: unknown;
}

export interface PendingRoomNotification {
  id: number;
  roomId: string;
  eventVersion: number;
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
  updated_at: Date;
}

interface SeatRow extends QueryResultRow {
  seat_index: number;
  player_id: string | null;
  occupant_type: string;
  bot_difficulty: string | null;
  display_name: string | null;
  connection_status: string;
  last_presence_at: Date | null;
  disconnected_at: Date | null;
  autopilot_started_at: Date | null;
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
  response: unknown;
}

interface SessionDuplicateRow extends QueryResultRow {
  room_id: string;
}

interface OutboxRow extends QueryResultRow {
  id: string | number;
  room_id: string;
  event_version: string | number;
}

interface AutomationJobRow extends QueryResultRow {
  id: string;
  room_id: string;
  expected_event_version: string | number;
  kind: string;
  target_seat_index: number;
  due_at: Date;
  attempts: string | number;
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
const connectionStatuses = new Set<ConnectionStatus>([
  "online",
  "disconnected",
  "autopilot",
]);
const automationJobKinds = new Set<AutomationJobKind>([
  "BOT_ACTION",
  "TURN_TIMEOUT",
  "DISCONNECT_GRACE",
  "TRICK_ADVANCE",
]);
const ruleProfileIds = new Set<RuleProfileId>(["classic_304_4p", "six_304_36"]);

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
    !["easy", "normal", "strong"].includes(settings.botDifficulty as string) ||
    typeof enableSecondBidding !== "boolean"
  ) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room settings");
  }
  return {
    botDifficulty: settings.botDifficulty as RoomSettings["botDifficulty"],
    enableSecondBidding,
  };
}

function mapRoom(row: RoomRow): StoredRoom {
  if (!roomStatuses.has(row.status as RoomStatus)) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room status");
  }
  if (!ruleProfileIds.has(row.rule_profile_id as RuleProfileId)) {
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
    ruleProfileId: row.rule_profile_id as RuleProfileId,
    settings: parseSettings(row.settings),
    recoveryError: row.recovery_error,
    updatedAt: row.updated_at,
  };
}

function mapSeat(row: SeatRow): StoredSeat {
  if (!seatTypes.has(row.occupant_type as StoredSeat["occupantType"])) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid room seat");
  }
  if (!connectionStatuses.has(row.connection_status as ConnectionStatus)) {
    throw new DomainError(
      "ROOM_DATA_INVALID",
      500,
      "Invalid room connection status",
    );
  }
  return {
    seatIndex: row.seat_index,
    playerId: row.player_id,
    occupantType: row.occupant_type as StoredSeat["occupantType"],
    botDifficulty: row.bot_difficulty,
    displayName: row.display_name,
    connectionStatus: row.connection_status as ConnectionStatus,
    lastPresenceAt: row.last_presence_at,
    disconnectedAt: row.disconnected_at,
    autopilotStartedAt: row.autopilot_started_at,
  };
}

function mapSnapshot(row: SnapshotRow): StoredSnapshot {
  if (!ruleProfileIds.has(row.rule_profile_id as RuleProfileId)) {
    throw new DomainError(
      "ROOM_DATA_INVALID",
      500,
      "Invalid snapshot rule profile",
    );
  }
  return {
    eventVersion: toSafeNumber(row.event_version, "snapshot event version"),
    schemaVersion: row.schema_version,
    ruleProfileId: row.rule_profile_id as RuleProfileId,
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

function mapRoomNotification(row: OutboxRow): PendingRoomNotification {
  return {
    id: toSafeNumber(row.id, "outbox id"),
    roomId: row.room_id,
    eventVersion: toSafeNumber(row.event_version, "outbox event version"),
  };
}

function mapAutomationJob(row: AutomationJobRow): ClaimedAutomationJob {
  if (!automationJobKinds.has(row.kind as AutomationJobKind)) {
    throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid automation job");
  }
  return {
    id: row.id,
    roomId: row.room_id,
    expectedEventVersion: toSafeNumber(
      row.expected_event_version,
      "automation job event version",
    ),
    kind: row.kind as AutomationJobKind,
    targetSeatIndex: row.target_seat_index,
    dueAt: row.due_at,
    attempts: toSafeNumber(row.attempts, "automation job attempts"),
  };
}

export class PostgresRoomStore {
  constructor(private readonly database: Database) {}

  transaction<T>(callback: (transaction: Queryable) => Promise<T>): Promise<T> {
    return this.database.transaction(callback);
  }

  async createRoom(input: NewRoomInput): Promise<StoredRoom> {
    const expectedSeatCount = input.ruleProfileId === "six_304_36" ? 6 : 4;
    if (input.seats.length !== expectedSeatCount) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Room seat count does not match its rule profile",
      );
    }
    return this.transaction(async (transaction) => {
      if (input.sessionId) {
        const lockedSession = await transaction.query<{ id: string }>(
          "SELECT id FROM sessions WHERE id = $1 FOR UPDATE",
          [input.sessionId],
        );
        if (!lockedSession.rows[0]) {
          throw new DomainError(
            "SESSION_REQUIRED",
            401,
            "A guest session is required",
          );
        }
        const duplicate = await this.findSessionDuplicate(
          input.sessionId,
          input.commandId,
          transaction,
        );
        if (duplicate) {
          const existing = await this.loadRoom(duplicate.roomId, transaction);
          if (existing) return existing;
          throw new DomainError(
            "ROOM_DATA_INVALID",
            500,
            "Duplicate room command has no room",
          );
        }
      }
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
        const connectionStatus =
          seat.connectionStatus ??
          (seat.occupantType === "bot" || seat.playerId === input.hostPlayerId
            ? "online"
            : "disconnected");
        await transaction.query(
          "INSERT INTO room_seats (room_id, seat_index, player_id, occupant_type, bot_difficulty, joined_at, connection_status, last_presence_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END, $6, CASE WHEN $6 = 'online' THEN now() ELSE NULL END)",
          [
            input.id,
            seat.seatIndex,
            seat.playerId,
            seat.occupantType,
            seat.botDifficulty,
            connectionStatus,
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
        "INSERT INTO room_outbox (room_id, event_version) VALUES ($1, 1)",
        [input.id],
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
      if (input.sessionId) {
        await transaction.query(
          "INSERT INTO session_command_deduplications (session_id, command_id, response) VALUES ($1, $2, $3::jsonb)",
          [
            input.sessionId,
            input.commandId,
            JSON.stringify({ roomId: input.id }),
          ],
        );
      }
      return {
        id: input.id,
        inviteCode: input.inviteCode,
        status: "lobby",
        eventVersion: 1,
        hostPlayerId: input.hostPlayerId,
        ruleProfileId: input.ruleProfileId,
        settings: input.settings,
        recoveryError: null,
        updatedAt: new Date(),
      };
    });
  }

  async loadRoom(
    roomId: string,
    transaction: Queryable = this.database,
  ): Promise<StoredRoom | null> {
    const result = await transaction.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings, recovery_error, updated_at FROM rooms WHERE id = $1",
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async loadRoomByReference(roomReference: string): Promise<StoredRoom | null> {
    const result = await this.database.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings, recovery_error, updated_at FROM rooms WHERE id::text = $1 OR invite_code = $1",
      [roomReference],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async loadRoomForUpdate(
    transaction: Queryable,
    roomId: string,
  ): Promise<StoredRoom | null> {
    const result = await transaction.query<RoomRow>(
      "SELECT id, invite_code, status, event_version, host_player_id, rule_profile_id, settings, recovery_error, updated_at FROM rooms WHERE id = $1 FOR UPDATE",
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async loadSeats(
    roomId: string,
    transaction: Queryable = this.database,
  ): Promise<StoredSeat[]> {
    const result = await transaction.query<SeatRow>(
      "SELECT room_seats.seat_index, room_seats.player_id, room_seats.occupant_type, room_seats.bot_difficulty, room_seats.connection_status, room_seats.last_presence_at, room_seats.disconnected_at, room_seats.autopilot_started_at, players.display_name FROM room_seats LEFT JOIN players ON players.id = room_seats.player_id WHERE room_seats.room_id = $1 ORDER BY room_seats.seat_index",
      [roomId],
    );
    return result.rows.map(mapSeat);
  }

  async findSeatIndex(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<number | null> {
    const result = await transaction.query<{ seat_index: number }>(
      "SELECT seat_index FROM room_seats WHERE room_id = $1 AND player_id = $2 AND occupant_type = 'human'",
      [roomId, playerId],
    );
    return result.rows[0]?.seat_index ?? null;
  }

  async assignHumanSeat(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<StoredSeat> {
    const existingSeatIndex = await this.findSeatIndex(
      transaction,
      roomId,
      playerId,
    );
    if (existingSeatIndex != null) {
      const seats = await this.loadSeats(roomId, transaction);
      const existing = seats.find(
        (seat) => seat.seatIndex === existingSeatIndex,
      );
      if (existing) return existing;
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Existing room seat is missing",
      );
    }
    const openSeat = await transaction.query<{ seat_index: number }>(
      "SELECT seat_index FROM room_seats WHERE room_id = $1 AND occupant_type = 'empty' ORDER BY seat_index LIMIT 1 FOR UPDATE",
      [roomId],
    );
    const row = openSeat.rows[0];
    if (!row) {
      throw new DomainError("ROOM_FULL", 409, "Room is full");
    }
    await transaction.query(
      "UPDATE room_seats SET player_id = $3, occupant_type = 'human', bot_difficulty = NULL, joined_at = now(), connection_status = 'online', last_presence_at = now(), disconnected_at = NULL, autopilot_started_at = NULL WHERE room_id = $1 AND seat_index = $2",
      [roomId, row.seat_index, playerId],
    );
    const seats = await this.loadSeats(roomId, transaction);
    const assigned = seats.find((seat) => seat.seatIndex === row.seat_index);
    if (!assigned) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Assigned room seat is missing",
      );
    }
    return assigned;
  }

  async fillEmptySeatsWithBots(
    transaction: Queryable,
    roomId: string,
    botDifficulty: RoomSettings["botDifficulty"],
  ): Promise<void> {
    await transaction.query(
      "UPDATE room_seats SET occupant_type = 'bot', bot_difficulty = $2, joined_at = NULL, connection_status = 'online', last_presence_at = now(), disconnected_at = NULL, autopilot_started_at = NULL WHERE room_id = $1 AND occupant_type = 'empty'",
      [roomId, botDifficulty],
    );
  }

  async clearHumanSeat(
    transaction: Queryable,
    roomId: string,
    seatIndex: number,
  ): Promise<StoredSeat> {
    const updated = await transaction.query<{ seat_index: number }>(
      "UPDATE room_seats SET player_id = NULL, occupant_type = 'empty', bot_difficulty = NULL, joined_at = NULL, connection_status = 'disconnected', last_presence_at = NULL, disconnected_at = NULL, autopilot_started_at = NULL WHERE room_id = $1 AND seat_index = $2 AND occupant_type = 'human' RETURNING seat_index",
      [roomId, seatIndex],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "SEAT_REQUIRED",
        403,
        "You are not seated in this room",
      );
    }
    const seats = await this.loadSeats(roomId, transaction);
    const seat = seats.find((candidate) => candidate.seatIndex === seatIndex);
    if (!seat) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Cleared room seat is missing",
      );
    }
    return seat;
  }

  async replaceHumanSeatWithBot(
    transaction: Queryable,
    roomId: string,
    seatIndex: number,
    botDifficulty: RoomSettings["botDifficulty"],
  ): Promise<StoredSeat> {
    const updated = await transaction.query<{ seat_index: number }>(
      "UPDATE room_seats SET player_id = NULL, occupant_type = 'bot', bot_difficulty = $3, joined_at = NULL, connection_status = 'online', last_presence_at = now(), disconnected_at = NULL, autopilot_started_at = NULL WHERE room_id = $1 AND seat_index = $2 AND occupant_type = 'human' RETURNING seat_index",
      [roomId, seatIndex, botDifficulty],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "SEAT_REQUIRED",
        403,
        "You are not seated in this room",
      );
    }
    const seats = await this.loadSeats(roomId, transaction);
    const seat = seats.find((candidate) => candidate.seatIndex === seatIndex);
    if (!seat) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "Replaced room seat is missing",
      );
    }
    return seat;
  }

  async findLowestHumanPlayerId(
    transaction: Queryable,
    roomId: string,
  ): Promise<string | null> {
    const result = await transaction.query<{ player_id: string }>(
      "SELECT player_id FROM room_seats WHERE room_id = $1 AND occupant_type = 'human' ORDER BY seat_index LIMIT 1",
      [roomId],
    );
    return result.rows[0]?.player_id ?? null;
  }

  async transferHost(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<void> {
    const updated = await transaction.query<{ id: string }>(
      "UPDATE rooms SET host_player_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM room_seats WHERE room_id = $1 AND player_id = $2 AND occupant_type = 'human') RETURNING id",
      [roomId, playerId],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "ROOM_DATA_INVALID",
        500,
        "New room host is not seated",
      );
    }
  }

  async loadSnapshot(
    roomId: string,
    transaction: Queryable = this.database,
  ): Promise<StoredSnapshot | null> {
    const result = await transaction.query<SnapshotRow>(
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
    transaction: Queryable = this.database,
  ): Promise<StoredEvent[]> {
    const result = await transaction.query<EventRow>(
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
      "SELECT game_events.event_version, game_events.event_type, command_deduplications.actor_player_id, command_deduplications.response FROM command_deduplications JOIN game_events ON game_events.room_id = command_deduplications.room_id AND game_events.command_id = command_deduplications.command_id WHERE command_deduplications.room_id = $1 AND command_deduplications.command_id = $2",
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
      response: row.response,
    };
  }

  async findSessionDuplicate(
    sessionId: string,
    commandId: string,
    transaction: Queryable = this.database,
  ): Promise<SessionCommandDuplicate | null> {
    const result = await transaction.query<SessionDuplicateRow>(
      "SELECT response->>'roomId' AS room_id FROM session_command_deduplications WHERE session_id = $1 AND command_id = $2",
      [sessionId, commandId],
    );
    const row = result.rows[0];
    return row?.room_id ? { roomId: row.room_id } : null;
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
      "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, $2, 1, $3, $4::jsonb)",
      [
        input.roomId,
        nextVersion,
        input.ruleProfileId,
        JSON.stringify(input.snapshot),
      ],
    );
    await transaction.query(
      "INSERT INTO room_outbox (room_id, event_version) VALUES ($1, $2)",
      [input.roomId, nextVersion],
    );
    await transaction.query(
      "INSERT INTO command_deduplications (room_id, command_id, actor_player_id, response) VALUES ($1, $2, $3, $4::jsonb)",
      [
        input.roomId,
        input.commandId,
        input.actorPlayerId,
        JSON.stringify(
          input.deduplicationResponse ?? { eventVersion: nextVersion },
        ),
      ],
    );
    return nextVersion;
  }

  async claimRoomNotifications(
    owner: string,
    limit: number,
    roomId?: string,
  ): Promise<PendingRoomNotification[]> {
    const claimed = await this.database.query<OutboxRow>(
      "WITH candidates AS (SELECT id FROM room_outbox WHERE published_at IS NULL AND (publishing_until IS NULL OR publishing_until <= now()) AND ($3::uuid IS NULL OR room_id = $3::uuid) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE room_outbox AS outbox SET publishing_owner = $1::uuid, publishing_until = now() + interval '30 seconds', publish_attempts = publish_attempts + 1, last_error = NULL FROM candidates WHERE outbox.id = candidates.id RETURNING outbox.id, outbox.room_id, outbox.event_version",
      [owner, limit, roomId ?? null],
    );
    return claimed.rows.map(mapRoomNotification);
  }

  async countPendingRoomNotifications(): Promise<number> {
    const result = await this.database.query<{ count: string | number }>(
      "SELECT count(*)::text AS count FROM room_outbox WHERE published_at IS NULL",
    );
    return toSafeNumber(result.rows[0]?.count ?? 0, "pending room outbox rows");
  }

  async markRoomNotificationPublished(
    id: number,
    owner: string,
  ): Promise<void> {
    const updated = await this.database.query<{ id: string | number }>(
      "UPDATE room_outbox SET published_at = now(), publishing_owner = NULL, publishing_until = NULL, last_error = NULL WHERE id = $1 AND publishing_owner = $2::uuid AND published_at IS NULL RETURNING id",
      [id, owner],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError("OUTBOX_CLAIM_LOST", 409, "Outbox claim was lost");
    }
  }

  async releaseRoomNotification(
    id: number,
    owner: string,
    error: string,
  ): Promise<void> {
    const updated = await this.database.query<{ id: string | number }>(
      "UPDATE room_outbox SET publishing_owner = NULL, publishing_until = NULL, last_error = $3 WHERE id = $1 AND publishing_owner = $2::uuid AND published_at IS NULL RETURNING id",
      [id, owner, error.slice(0, 500)],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError("OUTBOX_CLAIM_LOST", 409, "Outbox claim was lost");
    }
  }

  async scheduleAutomation(
    transaction: Queryable,
    job: NewAutomationJob,
  ): Promise<void> {
    await transaction.query(
      "INSERT INTO room_automation_jobs (id, room_id, expected_event_version, kind, target_seat_index, due_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (room_id, kind, expected_event_version, target_seat_index) DO NOTHING",
      [
        job.id,
        job.roomId,
        job.expectedEventVersion,
        job.kind,
        job.targetSeatIndex,
        job.dueAt,
      ],
    );
  }

  async claimDueAutomationJobs(
    owner: string,
    now: Date,
    limit: number,
    roomId?: string,
  ): Promise<ClaimedAutomationJob[]> {
    const claimed = await this.database.query<AutomationJobRow>(
      "WITH candidates AS (SELECT id FROM room_automation_jobs WHERE due_at <= $2 AND (state = 'pending' OR (state = 'claimed' AND lease_until <= $2)) AND ($4::uuid IS NULL OR room_id = $4::uuid) ORDER BY due_at, id FOR UPDATE SKIP LOCKED LIMIT $3) UPDATE room_automation_jobs AS job SET state = 'claimed', lease_owner = $1::uuid, lease_until = $2 + interval '30 seconds', attempts = attempts + 1, last_error = NULL FROM candidates WHERE job.id = candidates.id RETURNING job.id, job.room_id, job.expected_event_version, job.kind, job.target_seat_index, job.due_at, job.attempts",
      [owner, now, limit, roomId ?? null],
    );
    return claimed.rows.map(mapAutomationJob);
  }

  async countPendingAutomationJobs(): Promise<number> {
    const result = await this.database.query<{ count: string | number }>(
      "SELECT count(*)::text AS count FROM room_automation_jobs WHERE state IN ('pending', 'claimed')",
    );
    return toSafeNumber(result.rows[0]?.count ?? 0, "pending automation jobs");
  }

  async completeAutomationJob(id: string, owner: string): Promise<void> {
    const updated = await this.database.query<{ id: string }>(
      "UPDATE room_automation_jobs SET state = 'completed', completed_at = now(), lease_owner = NULL, lease_until = NULL WHERE id = $1::uuid AND lease_owner = $2::uuid AND state = 'claimed' RETURNING id",
      [id, owner],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "AUTOMATION_CLAIM_LOST",
        409,
        "Automation job claim was lost",
      );
    }
  }

  async releaseAutomationJob(
    id: string,
    owner: string,
    error: string,
  ): Promise<void> {
    const updated = await this.database.query<{ id: string }>(
      "UPDATE room_automation_jobs SET state = 'pending', due_at = now() + interval '1 second', lease_owner = NULL, lease_until = NULL, last_error = $3 WHERE id = $1::uuid AND lease_owner = $2::uuid AND state = 'claimed' RETURNING id",
      [id, owner, error.slice(0, 500)],
    );
    if (updated.rows.length !== 1) {
      throw new DomainError(
        "AUTOMATION_CLAIM_LOST",
        409,
        "Automation job claim was lost",
      );
    }
  }

  async cancelAutomationForRoom(
    transaction: Queryable,
    roomId: string,
    kinds: readonly AutomationJobKind[],
  ): Promise<void> {
    if (kinds.length === 0) return;
    await transaction.query(
      "UPDATE room_automation_jobs SET state = 'cancelled', lease_owner = NULL, lease_until = NULL WHERE room_id = $1 AND kind = ANY($2::text[]) AND state = 'pending'",
      [roomId, kinds],
    );
  }

  async markSeatOnline(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<number | null> {
    const updated = await transaction.query<{ seat_index: number }>(
      "UPDATE room_seats SET connection_status = 'online', last_presence_at = now(), disconnected_at = NULL, autopilot_started_at = NULL WHERE room_id = $1 AND player_id = $2 AND occupant_type = 'human' RETURNING seat_index",
      [roomId, playerId],
    );
    return updated.rows[0]?.seat_index ?? null;
  }

  async markSeatOffline(
    transaction: Queryable,
    roomId: string,
    playerId: string,
  ): Promise<void> {
    await transaction.query(
      "UPDATE room_seats SET connection_status = 'disconnected', disconnected_at = COALESCE(disconnected_at, now()) WHERE room_id = $1 AND player_id = $2 AND occupant_type = 'human' AND connection_status = 'online'",
      [roomId, playerId],
    );
  }

  async markSeatAutopilot(
    transaction: Queryable,
    roomId: string,
    seatIndex: number,
  ): Promise<void> {
    await transaction.query(
      "UPDATE room_seats SET connection_status = 'autopilot', autopilot_started_at = COALESCE(autopilot_started_at, now()) WHERE room_id = $1 AND seat_index = $2 AND occupant_type = 'human'",
      [roomId, seatIndex],
    );
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

  async revokeExpiredSessions(
    cutoff: Date,
    revokedAt: Date,
    limit: number,
  ): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      "WITH candidates AS (SELECT id FROM sessions WHERE expires_at <= $1 AND revoked_at IS NULL ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT $3) UPDATE sessions AS session SET revoked_at = $2 FROM candidates WHERE session.id = candidates.id RETURNING session.id",
      [cutoff, revokedAt, limit],
    );
    return result.rows.length;
  }

  async findStaleRoomIds(
    lobbyCutoff: Date,
    terminalCutoff: Date,
    limit: number,
  ): Promise<string[]> {
    const result = await this.database.query<{ id: string }>(
      "SELECT id FROM rooms WHERE (status = 'lobby' AND updated_at <= $1) OR (status = 'hand_result' AND updated_at <= $2) ORDER BY updated_at, id LIMIT $3",
      [lobbyCutoff, terminalCutoff, limit],
    );
    return result.rows.map((row) => row.id);
  }

  async purgeClosedRooms(cutoff: Date, limit: number): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      "WITH candidates AS (SELECT id FROM rooms WHERE status = 'closed' AND updated_at <= $1 ORDER BY updated_at, id FOR UPDATE SKIP LOCKED LIMIT $2) DELETE FROM rooms USING candidates WHERE rooms.id = candidates.id RETURNING rooms.id",
      [cutoff, limit],
    );
    return result.rows.length;
  }
}
