import {
  eventVersion,
  inviteCode,
  playerId,
  type Room,
  roomId,
  type SeatOccupant,
  seatPosition,
} from "@three-zero-four/room-domain";

export interface PersistedRoomRecord {
  readonly eventVersion: number;
  readonly hostPlayerId: string;
  readonly id: string;
  readonly inviteCode: string;
  readonly profileId: string;
  readonly settings: unknown;
  readonly status: string;
}

export interface PersistedSeatRecord {
  readonly botDifficulty: string | null;
  readonly connectionStatus: string;
  readonly displayName: string | null;
  readonly occupantType: string;
  readonly playerId: string | null;
  readonly position: number;
}

export class RoomPersistenceMappingError extends Error {
  constructor(
    readonly code: "INVALID_ROOM_RECORD" | "INVALID_ROOM_SEAT",
    message: string,
  ) {
    super(message);
    this.name = "RoomPersistenceMappingError";
  }
}

const roomStatuses = new Set<Room["status"]>([
  "closed",
  "hand_result",
  "in_hand",
  "lobby",
  "recovery_failed",
]);
const connectionStatuses = new Set([
  "autopilot",
  "disconnected",
  "online",
] as const);
const botDifficulties = new Set(["easy", "normal", "strong"] as const);

function mapSettings(value: unknown): Room["settings"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoomPersistenceMappingError(
      "INVALID_ROOM_RECORD",
      "Room settings are invalid",
    );
  }
  const settings = value as Record<string, unknown>;
  const endHandWhenOutcomeCertain = settings.endHandWhenOutcomeCertain;
  if (
    !botDifficulties.has(settings.botDifficulty as "easy") ||
    typeof settings.enableSecondBidding !== "boolean" ||
    (endHandWhenOutcomeCertain !== undefined &&
      typeof endHandWhenOutcomeCertain !== "boolean")
  ) {
    throw new RoomPersistenceMappingError(
      "INVALID_ROOM_RECORD",
      "Room settings are invalid",
    );
  }
  return {
    botDifficulty: settings.botDifficulty as Room["settings"]["botDifficulty"],
    enableSecondBidding: settings.enableSecondBidding,
    endHandWhenOutcomeCertain: endHandWhenOutcomeCertain ?? false,
  };
}

function mapOccupant(
  seat: PersistedSeatRecord,
  position: number,
): SeatOccupant {
  if (seat.occupantType === "human") {
    if (!seat.playerId || !seat.displayName) {
      throw new RoomPersistenceMappingError(
        "INVALID_ROOM_SEAT",
        "Human seat identity is incomplete",
      );
    }
    return {
      displayName: seat.displayName,
      kind: "human",
      playerId: playerId(seat.playerId),
    };
  }
  if (seat.occupantType === "bot") {
    if (!botDifficulties.has(seat.botDifficulty as "easy")) {
      throw new RoomPersistenceMappingError(
        "INVALID_ROOM_SEAT",
        "Bot seat difficulty is invalid",
      );
    }
    return {
      difficulty: seat.botDifficulty as "easy" | "normal" | "strong",
      displayName: seat.displayName ?? `Bot ${position + 1}`,
      kind: "bot",
    };
  }
  if (seat.occupantType === "empty") return { kind: "empty" };
  throw new RoomPersistenceMappingError(
    "INVALID_ROOM_SEAT",
    "Room seat occupant type is invalid",
  );
}

export function mapPersistedRoom(
  record: PersistedRoomRecord,
  persistedSeats: readonly PersistedSeatRecord[],
): Room {
  const profileId =
    record.profileId === "classic_304_4p" || record.profileId === "six_304_36"
      ? record.profileId
      : null;
  if (!profileId || !roomStatuses.has(record.status as Room["status"])) {
    throw new RoomPersistenceMappingError(
      "INVALID_ROOM_RECORD",
      "Room status or profile is invalid",
    );
  }
  const seatCount = profileId === "six_304_36" ? 6 : 4;
  if (persistedSeats.length !== seatCount) {
    throw new RoomPersistenceMappingError(
      "INVALID_ROOM_RECORD",
      "Room seat count does not match its profile",
    );
  }
  const seats = persistedSeats
    .toSorted((first, second) => first.position - second.position)
    .map((seat, expectedPosition) => {
      if (
        seat.position !== expectedPosition ||
        !connectionStatuses.has(
          seat.connectionStatus as "autopilot" | "disconnected" | "online",
        )
      ) {
        throw new RoomPersistenceMappingError(
          "INVALID_ROOM_SEAT",
          "Room seat position or connection status is invalid",
        );
      }
      return {
        connectionStatus: seat.connectionStatus as
          | "autopilot"
          | "disconnected"
          | "online",
        occupant: mapOccupant(seat, expectedPosition),
        position: seatPosition(expectedPosition, seatCount),
      };
    });
  return {
    eventVersion: eventVersion(record.eventVersion),
    hostPlayerId: playerId(record.hostPlayerId),
    id: roomId(record.id),
    inviteCode: inviteCode(record.inviteCode),
    profileId,
    seats,
    settings: mapSettings(record.settings),
    status: record.status as Room["status"],
  };
}

export function mapRoomSeatsForPersistence(
  room: Room,
): readonly PersistedSeatRecord[] {
  return room.seats.map((seat) => ({
    botDifficulty:
      seat.occupant.kind === "bot" ? seat.occupant.difficulty : null,
    connectionStatus: seat.connectionStatus,
    displayName:
      seat.occupant.kind === "empty" ? null : seat.occupant.displayName,
    occupantType: seat.occupant.kind,
    playerId: seat.occupant.kind === "human" ? seat.occupant.playerId : null,
    position: seat.position,
  }));
}
