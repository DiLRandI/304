import { isDeepStrictEqual } from "node:util";
import type { QueryResultRow } from "pg";
import type { Database } from "../../../../infra/database.js";
import type {
  RoomCommandCommit,
  RoomCommandWriter,
} from "../../application/execute-room-command.js";
import type {
  StartedRoomAutomationFactory,
  StartedRoomSnapshotFactory,
} from "../../application/started-room-initialization.js";
import { mapRoomEventForPersistence } from "./room-event-record-mapper.js";
import { mapRoomSeatsForPersistence } from "./room-record-mapper.js";

interface LockedRoomRow extends QueryResultRow {
  readonly event_version: number | string;
}

interface DuplicateRow extends QueryResultRow {
  readonly actor_player_id: string | null;
  readonly request: unknown;
}

type TransactionalDatabase = Pick<Database, "transaction">;

type RoomCommandPersistenceErrorCode =
  | "COMMAND_ID_CONFLICT"
  | "INVALID_COMMIT"
  | "ROOM_NOT_FOUND"
  | "VERSION_CONFLICT";

export class RoomCommandPersistenceError extends Error {
  constructor(
    readonly code: RoomCommandPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomCommandPersistenceError";
  }
}

function validateCommit(input: RoomCommandCommit): void {
  if (input.events.length > 1) {
    throw new RoomCommandPersistenceError(
      "INVALID_COMMIT",
      "Room commands currently support at most one persisted event",
    );
  }
  const expectedResultVersion =
    Number(input.expectedVersion) + (input.events.length === 0 ? 0 : 1);
  if (
    Number(input.room.eventVersion) !== expectedResultVersion ||
    input.events.some(
      (event) => Number(event.version) !== expectedResultVersion,
    )
  ) {
    throw new RoomCommandPersistenceError(
      "INVALID_COMMIT",
      "Room command versions are inconsistent",
    );
  }
}

export class PostgresRoomCommandWriter implements RoomCommandWriter {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly startedRoomSnapshots?: StartedRoomSnapshotFactory,
    private readonly startedRoomAutomation?: StartedRoomAutomationFactory,
  ) {}

  async commit(input: RoomCommandCommit): Promise<void> {
    validateCommit(input);
    const event = input.events[0];
    const startedRoomSnapshot =
      event?.type === "ROOM_STARTED"
        ? this.startedRoomSnapshots?.create(input.room)
        : undefined;
    const startedRoomAutomation =
      startedRoomSnapshot === undefined
        ? null
        : (this.startedRoomAutomation?.create(
            input.room,
            startedRoomSnapshot,
          ) ?? null);
    const persistedEvent = event
      ? mapRoomEventForPersistence(event, input.room, startedRoomSnapshot)
      : null;
    await this.database.transaction(async (transaction) => {
      const locked = await transaction.query<LockedRoomRow>(
        "SELECT event_version FROM rooms WHERE id = $1 FOR UPDATE",
        [input.room.id],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new RoomCommandPersistenceError(
          "ROOM_NOT_FOUND",
          "Room was not found",
        );
      }

      const duplicateResult = await transaction.query<DuplicateRow>(
        "SELECT actor_player_id, request FROM command_deduplications WHERE room_id = $1 AND command_id = $2",
        [input.room.id, input.commandId],
      );
      const duplicate = duplicateResult.rows[0];
      if (duplicate) {
        if (
          duplicate.actor_player_id !== input.actorPlayerId ||
          !isDeepStrictEqual(duplicate.request, input.request)
        ) {
          throw new RoomCommandPersistenceError(
            "COMMAND_ID_CONFLICT",
            "Command id belongs to another player",
          );
        }
        return;
      }

      if (Number(current.event_version) !== Number(input.expectedVersion)) {
        throw new RoomCommandPersistenceError(
          "VERSION_CONFLICT",
          "Room state changed; refresh and retry",
        );
      }

      if (event && persistedEvent) {
        const updatedRoom = await transaction.query<{ id: string }>(
          "UPDATE rooms SET event_version = $2, status = $3, host_player_id = $4, settings = $5::jsonb, recovery_error = NULL, updated_at = now() WHERE id = $1 AND event_version = $6 RETURNING id",
          [
            input.room.id,
            input.room.eventVersion,
            input.room.status,
            input.room.hostPlayerId,
            JSON.stringify(input.room.settings),
            input.expectedVersion,
          ],
        );
        if (updatedRoom.rows.length !== 1) {
          throw new RoomCommandPersistenceError(
            "VERSION_CONFLICT",
            "Room state changed; refresh and retry",
          );
        }

        for (const seat of mapRoomSeatsForPersistence(input.room)) {
          const updatedSeat = await transaction.query<{ seat_index: number }>(
            "UPDATE room_seats SET player_id = $3, occupant_type = $4, bot_difficulty = $5, connection_status = $6, joined_at = CASE WHEN $3::uuid IS NULL THEN NULL WHEN player_id IS DISTINCT FROM $3::uuid THEN now() ELSE joined_at END, last_presence_at = CASE WHEN $6 = 'online' THEN now() ELSE last_presence_at END, disconnected_at = CASE WHEN $6 = 'disconnected' THEN COALESCE(disconnected_at, now()) ELSE NULL END, autopilot_started_at = CASE WHEN $6 = 'autopilot' THEN COALESCE(autopilot_started_at, now()) ELSE NULL END WHERE room_id = $1 AND seat_index = $2 RETURNING seat_index",
            [
              input.room.id,
              seat.position,
              seat.playerId,
              seat.occupantType,
              seat.botDifficulty,
              seat.connectionStatus,
            ],
          );
          if (updatedSeat.rows.length !== 1) {
            throw new RoomCommandPersistenceError(
              "INVALID_COMMIT",
              "Persisted room seat is missing",
            );
          }
        }

        await transaction.query(
          "INSERT INTO game_events (room_id, event_version, command_id, actor_player_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
          [
            input.room.id,
            event.version,
            input.commandId,
            input.actorPlayerId,
            persistedEvent.eventType,
            JSON.stringify(persistedEvent.payload),
          ],
        );
        if (startedRoomSnapshot !== undefined) {
          await transaction.query(
            "INSERT INTO game_snapshots (room_id, event_version, schema_version, rule_profile_id, state) VALUES ($1, $2, 1, $3, $4::jsonb)",
            [
              input.room.id,
              input.room.eventVersion,
              input.room.profileId,
              JSON.stringify(startedRoomSnapshot),
            ],
          );
        }
        if (startedRoomAutomation) {
          await transaction.query(
            "INSERT INTO room_automation_jobs (id, room_id, expected_event_version, kind, target_seat_index, due_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (room_id, kind, expected_event_version, target_seat_index) DO NOTHING",
            [
              startedRoomAutomation.id,
              startedRoomAutomation.roomId,
              startedRoomAutomation.expectedEventVersion,
              startedRoomAutomation.kind,
              startedRoomAutomation.targetSeatIndex,
              startedRoomAutomation.dueAt,
            ],
          );
        }
        await transaction.query(
          "INSERT INTO room_outbox (room_id, event_version) VALUES ($1, $2)",
          [input.room.id, input.room.eventVersion],
        );
      }

      await transaction.query(
        "INSERT INTO command_deduplications (room_id, command_id, actor_player_id, request, response) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)",
        [
          input.room.id,
          input.commandId,
          input.actorPlayerId,
          JSON.stringify(input.request),
          JSON.stringify(input.response),
        ],
      );
    });
  }
}
