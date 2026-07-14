import type { RoomProjection } from "@three-zero-four/contracts";
import type { GameEngine } from "@three-zero-four/game-engine";
import { presentGameAction } from "../contexts/gameplay/adapters/delivery/game-action-presenter.js";
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

export function projectRoomForPlayer(
  room: StoredRoom,
  engine: GameEngine,
  viewerSeatIndex: number,
): RoomProjection {
  const privateSeat = engine.getSeatView(viewerSeatIndex);
  if (!privateSeat) {
    throw new DomainError(
      "SEAT_REQUIRED",
      403,
      "You are not seated in this room",
    );
  }
  const isHost =
    engine.state.seats[viewerSeatIndex]?.userId === room.hostPlayerId;
  const legalActions = engine
    .getLegalActions(viewerSeatIndex)
    .filter((action) => action.type !== "ACK_RESULT" || isHost)
    .map(presentGameAction);
  return {
    roomId: room.id,
    inviteCode: room.inviteCode,
    eventVersion: room.eventVersion,
    status: projectableStatus(room.status),
    viewerSeatIndex,
    view: {
      isHost,
      publicState: engine.getPublicState(viewerSeatIndex),
      privateSeat,
      legalActions,
      prompt: engine.getPrompt(viewerSeatIndex),
    },
  };
}
