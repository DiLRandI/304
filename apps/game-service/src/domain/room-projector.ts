import type { RoomProjection } from "@three-zero-four/contracts";
import { DomainError } from "./errors.js";
import type { RoomStatus, StoredRoom, StoredSeat } from "./room-store.js";

type ProjectableStatus = Extract<
  RoomStatus,
  "lobby" | "in_hand" | "hand_result"
>;

function projectableStatus(status: RoomStatus): ProjectableStatus {
  if (status === "lobby" || status === "in_hand" || status === "hand_result") {
    return status;
  }
  throw new DomainError("ROOM_UNAVAILABLE", 503, "Room is unavailable");
}

export function projectLobbyForViewer(
  room: StoredRoom,
  seats: readonly StoredSeat[],
  viewerSeatIndex: number | null,
): RoomProjection {
  const isHost =
    viewerSeatIndex !== null &&
    seats.find((seat) => seat.seatIndex === viewerSeatIndex)?.playerId ===
      room.hostPlayerId;
  return {
    roomId: room.id,
    inviteCode: room.inviteCode,
    eventVersion: room.eventVersion,
    status: projectableStatus(room.status),
    viewerSeatIndex,
    view: {
      isHost,
      lobby: {
        ruleProfileId: room.ruleProfileId,
        seats: seats.map((seat) => ({
          seatIndex: seat.seatIndex,
          occupantType: seat.occupantType,
          displayName: seat.displayName,
          botDifficulty: seat.botDifficulty,
        })),
      },
    },
  };
}
