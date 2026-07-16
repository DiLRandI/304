import type { Room, RoomRuleProfileId } from "./aggregate.js";
import type {
  BotDifficulty,
  ConnectionStatus,
  RoomSettings,
  RoomStatus,
} from "./room.js";
import type {
  EventVersion,
  InviteCode,
  PlayerId,
  RoomId,
  SeatPosition,
} from "./values.js";

export interface RoomSeatProjection {
  readonly botDifficulty?: BotDifficulty;
  readonly connectionStatus: ConnectionStatus;
  readonly displayName: string | null;
  readonly isHost: boolean;
  readonly isViewer: boolean;
  readonly occupantType: "bot" | "empty" | "human";
  readonly position: SeatPosition;
}

export interface RoomProjection {
  readonly eventVersion: EventVersion;
  readonly id: RoomId;
  readonly inviteCode: InviteCode;
  readonly profileId: RoomRuleProfileId;
  readonly seats: readonly RoomSeatProjection[];
  readonly settings: RoomSettings;
  readonly status: RoomStatus;
  readonly viewerSeatPosition: SeatPosition | null;
}

export function projectRoom(room: Room, viewer: PlayerId): RoomProjection {
  const viewerSeat = room.seats.find(
    (seat) =>
      seat.occupant.kind === "human" && seat.occupant.playerId === viewer,
  );
  return {
    eventVersion: room.eventVersion,
    id: room.id,
    inviteCode: room.inviteCode,
    profileId: room.profileId,
    seats: room.seats.map((seat) => {
      const displayName =
        seat.occupant.kind === "empty" ? null : seat.occupant.displayName;
      const isHost =
        seat.occupant.kind === "human" &&
        seat.occupant.playerId === room.hostPlayerId;
      const projection: RoomSeatProjection = {
        connectionStatus: seat.connectionStatus,
        displayName,
        isHost,
        isViewer: seat.position === viewerSeat?.position,
        occupantType: seat.occupant.kind,
        position: seat.position,
      };
      if (seat.occupant.kind === "bot") {
        return { ...projection, botDifficulty: seat.occupant.difficulty };
      }
      return projection;
    }),
    settings: room.settings,
    status: room.status,
    viewerSeatPosition: viewerSeat?.position ?? null,
  };
}
