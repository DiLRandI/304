import type { RoomProjection as WireRoomProjection } from "@three-zero-four/contracts";
import type { RoomProjection as DomainRoomProjection } from "@three-zero-four/room-domain";

export class RoomProjectionPresentationError extends Error {
  constructor(
    readonly code: "ACTIVE_ROOM_REQUIRES_GAMEPLAY",
    message: string,
  ) {
    super(message);
    this.name = "RoomProjectionPresentationError";
  }
}

export function presentLobbyRoom(
  projection: DomainRoomProjection,
): WireRoomProjection {
  if (projection.status !== "lobby") {
    throw new RoomProjectionPresentationError(
      "ACTIVE_ROOM_REQUIRES_GAMEPLAY",
      "Active rooms require a gameplay projection",
    );
  }
  const viewerSeat =
    projection.viewerSeatPosition === null
      ? null
      : projection.seats[projection.viewerSeatPosition];
  return {
    eventVersion: projection.eventVersion,
    inviteCode: projection.inviteCode,
    roomId: projection.id,
    status: "lobby",
    view: {
      isHost: viewerSeat?.isHost ?? false,
      lobby: {
        ruleProfileId: projection.profileId,
        seats: projection.seats.map((seat) => ({
          botDifficulty: seat.botDifficulty ?? null,
          displayName: seat.displayName,
          occupantType: seat.occupantType,
          seatIndex: seat.position,
        })),
      },
    },
    viewerSeatIndex: projection.viewerSeatPosition,
  };
}
