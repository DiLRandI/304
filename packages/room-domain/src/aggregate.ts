import type { RoomSeat, RoomSettings, RoomStatus } from "./room.js";
import {
  type EventVersion,
  eventVersion,
  type InviteCode,
  type PlayerId,
  type RoomId,
  type SeatPosition,
  seatPosition,
} from "./values.js";

export type RoomRuleProfileId = "classic_304_4p" | "six_304_36";

export interface Room {
  readonly eventVersion: EventVersion;
  readonly hostPlayerId: PlayerId;
  readonly id: RoomId;
  readonly inviteCode: InviteCode;
  readonly profileId: RoomRuleProfileId;
  readonly seats: readonly RoomSeat[];
  readonly settings: RoomSettings;
  readonly status: RoomStatus;
}

export interface RoomPlayer {
  readonly displayName: string;
  readonly playerId: PlayerId;
}

export interface CreateLobbyInput {
  readonly host: RoomPlayer;
  readonly id: RoomId;
  readonly inviteCode: InviteCode;
  readonly profileId: RoomRuleProfileId;
  readonly settings: RoomSettings;
}

export type JoinLobbyResult =
  | {
      readonly joined: boolean;
      readonly ok: true;
      readonly position: SeatPosition;
      readonly room: Room;
    }
  | {
      readonly error: {
        readonly code: "ROOM_FULL" | "ROOM_NOT_JOINABLE";
        readonly message: string;
      };
      readonly ok: false;
    };

function seatCount(profileId: RoomRuleProfileId): 4 | 6 {
  return profileId === "six_304_36" ? 6 : 4;
}

export function createLobby(input: CreateLobbyInput): Room {
  const count = seatCount(input.profileId);
  const seats: RoomSeat[] = Array.from({ length: count }, (_, index) =>
    index === 0
      ? {
          connectionStatus: "online",
          occupant: {
            displayName: input.host.displayName,
            kind: "human",
            playerId: input.host.playerId,
          },
          position: seatPosition(index, count),
        }
      : {
          connectionStatus: "disconnected",
          occupant: { kind: "empty" },
          position: seatPosition(index, count),
        },
  );
  return {
    eventVersion: eventVersion(1),
    hostPlayerId: input.host.playerId,
    id: input.id,
    inviteCode: input.inviteCode,
    profileId: input.profileId,
    seats,
    settings: { ...input.settings },
    status: "lobby",
  };
}

export function joinLobby(room: Room, player: RoomPlayer): JoinLobbyResult {
  const existingSeat = room.seats.find(
    (seat) =>
      seat.occupant.kind === "human" &&
      seat.occupant.playerId === player.playerId,
  );
  if (existingSeat) {
    return {
      joined: false,
      ok: true,
      position: existingSeat.position,
      room,
    };
  }
  if (room.status !== "lobby") {
    return {
      error: {
        code: "ROOM_NOT_JOINABLE",
        message: "Room is not accepting joins",
      },
      ok: false,
    };
  }
  const availableSeat = room.seats.find(
    (seat) => seat.occupant.kind === "empty",
  );
  if (!availableSeat) {
    return {
      error: { code: "ROOM_FULL", message: "Room has no available seats" },
      ok: false,
    };
  }

  const seats = room.seats.map((seat) =>
    seat.position === availableSeat.position
      ? {
          ...seat,
          connectionStatus: "online" as const,
          occupant: {
            displayName: player.displayName,
            kind: "human" as const,
            playerId: player.playerId,
          },
        }
      : seat,
  );
  return {
    joined: true,
    ok: true,
    position: availableSeat.position,
    room: {
      ...room,
      eventVersion: eventVersion(room.eventVersion + 1),
      seats,
    },
  };
}
