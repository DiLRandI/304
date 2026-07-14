import type { RoomProjection } from "@three-zero-four/contracts";
import type { GameEngine } from "@three-zero-four/game-engine";
import { DomainError } from "../../../../domain/errors.js";
import { presentGameAction } from "./game-action-presenter.js";

type ProjectableStatus = "lobby" | "in_hand" | "hand_result";

export interface GameplayRoomRecord {
  readonly eventVersion: number;
  readonly hostPlayerId: string;
  readonly id: string;
  readonly inviteCode: string;
  readonly status: ProjectableStatus | "closed" | "recovery_failed";
}

function projectableStatus(
  status: GameplayRoomRecord["status"],
): ProjectableStatus {
  if (status === "lobby" || status === "in_hand" || status === "hand_result") {
    return status;
  }
  throw new DomainError("ROOM_UNAVAILABLE", 503, "Room is unavailable");
}

export function projectRoomForPlayer(
  room: GameplayRoomRecord,
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
