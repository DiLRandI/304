import {
  joinLobby,
  leaveRoom,
  type Room,
  type RoomPlayer,
  setPlayerConnection,
  startRoom,
} from "./aggregate.js";
import type { ConnectionStatus } from "./room.js";
import type { EventVersion, PlayerId, SeatPosition } from "./values.js";

interface VersionedRoomCommand {
  readonly expectedVersion: EventVersion;
}

export type RoomCommand =
  | (VersionedRoomCommand & {
      readonly actor: RoomPlayer;
      readonly type: "JOIN_ROOM";
    })
  | (VersionedRoomCommand & {
      readonly actor: PlayerId;
      readonly type: "LEAVE_ROOM";
    })
  | (VersionedRoomCommand & {
      readonly actor: PlayerId;
      readonly type: "START_ROOM";
    })
  | (VersionedRoomCommand & {
      readonly actor: PlayerId;
      readonly connectionStatus: ConnectionStatus;
      readonly type: "SET_CONNECTION";
    });

export type RoomEvent =
  | {
      readonly displayName: string;
      readonly playerId: PlayerId;
      readonly position: SeatPosition;
      readonly type: "PLAYER_JOINED";
      readonly version: EventVersion;
    }
  | {
      readonly botPositions: readonly SeatPosition[];
      readonly type: "ROOM_STARTED";
      readonly version: EventVersion;
    }
  | {
      readonly playerId: PlayerId;
      readonly position: SeatPosition;
      readonly type: "PLAYER_LEFT" | "ROOM_CLOSED";
      readonly version: EventVersion;
    }
  | {
      readonly playerId: PlayerId;
      readonly position: SeatPosition;
      readonly type:
        | "AUTOPILOT_CANCELLED"
        | "AUTOPILOT_ENABLED"
        | "PLAYER_DISCONNECTED"
        | "PLAYER_RECONNECTED";
      readonly version: EventVersion;
    };

export type RoomCommandResult =
  | {
      readonly events: readonly RoomEvent[];
      readonly ok: true;
      readonly room: Room;
    }
  | {
      readonly error: { readonly code: string; readonly message: string };
      readonly ok: false;
    };

function versionConflict(): RoomCommandResult {
  return {
    error: {
      code: "VERSION_CONFLICT",
      message: "Room state changed; refresh and retry",
    },
    ok: false,
  };
}

function playerPosition(room: Room, playerId: PlayerId): SeatPosition | null {
  return (
    room.seats.find(
      (seat) =>
        seat.occupant.kind === "human" && seat.occupant.playerId === playerId,
    )?.position ?? null
  );
}

export function executeRoomCommand(
  room: Room,
  command: RoomCommand,
): RoomCommandResult {
  if (room.eventVersion !== command.expectedVersion) return versionConflict();

  if (command.type === "JOIN_ROOM") {
    const joined = joinLobby(room, command.actor);
    if (!joined.ok) return joined;
    return {
      events: joined.joined
        ? [
            {
              displayName: command.actor.displayName,
              playerId: command.actor.playerId,
              position: joined.position,
              type: "PLAYER_JOINED",
              version: joined.room.eventVersion,
            },
          ]
        : [],
      ok: true,
      room: joined.room,
    };
  }

  if (command.type === "START_ROOM") {
    const botPositions = room.seats
      .filter((seat) => seat.occupant.kind === "empty")
      .map((seat) => seat.position);
    const started = startRoom(room, command.actor);
    if (!started.ok) return started;
    return {
      events: [
        {
          botPositions,
          type: "ROOM_STARTED",
          version: started.room.eventVersion,
        },
      ],
      ok: true,
      room: started.room,
    };
  }

  if (command.type === "LEAVE_ROOM") {
    const position = playerPosition(room, command.actor);
    const left = leaveRoom(room, command.actor);
    if (!left.ok) return left;
    if (position === null) {
      return {
        error: { code: "SEAT_REQUIRED", message: "Player seat is missing" },
        ok: false,
      };
    }
    return {
      events: [
        {
          playerId: command.actor,
          position,
          type: left.status === "closed" ? "ROOM_CLOSED" : "PLAYER_LEFT",
          version: left.room.eventVersion,
        },
      ],
      ok: true,
      room: left.room,
    };
  }

  const position = playerPosition(room, command.actor);
  const previousStatus =
    position === null ? null : room.seats[position]?.connectionStatus;
  const updated = setPlayerConnection(
    room,
    command.actor,
    command.connectionStatus,
  );
  if (!updated.ok) return updated;
  if (!updated.changed) return { events: [], ok: true, room: updated.room };
  if (position === null) {
    return {
      error: { code: "SEAT_REQUIRED", message: "Player seat is missing" },
      ok: false,
    };
  }
  const type =
    command.connectionStatus === "disconnected"
      ? "PLAYER_DISCONNECTED"
      : command.connectionStatus === "autopilot"
        ? "AUTOPILOT_ENABLED"
        : previousStatus === "autopilot"
          ? "AUTOPILOT_CANCELLED"
          : "PLAYER_RECONNECTED";
  return {
    events: [
      {
        playerId: command.actor,
        position,
        type,
        version: updated.room.eventVersion,
      },
    ],
    ok: true,
    room: updated.room,
  };
}
