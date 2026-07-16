import type { Room, RoomEvent } from "@three-zero-four/room-domain";
import type { StartedRoomSnapshot } from "../../application/started-room-initialization.js";

export interface PersistedRoomEvent {
  readonly eventType: RoomEvent["type"];
  readonly payload: Readonly<Record<string, unknown>>;
}

export class RoomEventPersistenceMappingError extends Error {
  constructor(
    readonly code: "GAMEPLAY_STATE_REQUIRED" | "INVALID_ROOM_EVENT_RESULT",
    message: string,
  ) {
    super(message);
    this.name = "RoomEventPersistenceMappingError";
  }
}

function departedSeat(
  room: Room,
  event: Extract<RoomEvent, { type: "PLAYER_LEFT" | "ROOM_CLOSED" }>,
) {
  const seat = room.seats[event.position];
  if (!seat || seat.occupant.kind === "human") {
    throw new RoomEventPersistenceMappingError(
      "INVALID_ROOM_EVENT_RESULT",
      "Room leave result has an invalid replacement seat",
    );
  }
  return seat;
}

export function mapRoomEventForPersistence(
  event: RoomEvent,
  room: Room,
  startedRoomSnapshot?: StartedRoomSnapshot,
): PersistedRoomEvent {
  if (event.type === "ROOM_STARTED") {
    if (startedRoomSnapshot === undefined) {
      throw new RoomEventPersistenceMappingError(
        "GAMEPLAY_STATE_REQUIRED",
        "Room start requires an atomic gameplay snapshot",
      );
    }
    return {
      eventType: event.type,
      payload: {
        ruleProfileId: room.profileId,
        schemaVersion: startedRoomSnapshot.schemaVersion,
        state: startedRoomSnapshot.state,
      },
    };
  }
  if (event.type === "PLAYER_JOINED") {
    return {
      eventType: event.type,
      payload: {
        displayName: event.displayName,
        seatIndex: event.position,
      },
    };
  }
  if (event.type === "PLAYER_LEFT" || event.type === "ROOM_CLOSED") {
    const seat = departedSeat(room, event);
    const replacement = seat.occupant.kind;
    return {
      eventType: event.type,
      payload: {
        botDifficulty:
          seat.occupant.kind === "bot" ? seat.occupant.difficulty : null,
        hostPlayerId: room.status === "closed" ? null : room.hostPlayerId,
        reason: room.status === "closed" ? "LAST_HUMAN_LEFT" : null,
        replacement,
        seatIndex: event.position,
      },
    };
  }
  return {
    eventType: event.type,
    payload: { seatIndex: event.position },
  };
}
