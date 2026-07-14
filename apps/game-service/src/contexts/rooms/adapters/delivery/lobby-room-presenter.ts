import type { RoomProjection, RuleProfileId } from "@three-zero-four/contracts";
import { DomainError } from "../../../../domain/errors.js";

type ProjectableStatus = "lobby" | "in_hand" | "hand_result";

export interface LobbyRoomRecord {
  readonly eventVersion: number;
  readonly hostPlayerId: string;
  readonly id: string;
  readonly inviteCode: string;
  readonly ruleProfileId: RuleProfileId;
  readonly status: ProjectableStatus | "closed" | "recovery_failed";
}

export interface LobbySeatRecord {
  readonly botDifficulty: string | null;
  readonly displayName: string | null;
  readonly occupantType: "human" | "bot" | "empty";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

function projectableStatus(
  status: LobbyRoomRecord["status"],
): ProjectableStatus {
  if (status === "lobby" || status === "in_hand" || status === "hand_result") {
    return status;
  }
  throw new DomainError("ROOM_UNAVAILABLE", 503, "Room is unavailable");
}

export function projectLobbyForViewer(
  room: LobbyRoomRecord,
  seats: readonly LobbySeatRecord[],
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
