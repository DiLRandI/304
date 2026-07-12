import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import type { GameEngine } from "@three-zero-four/game-engine";
import { DomainError } from "./errors.js";
import type { RoomStatus, StoredRoom, StoredSeat } from "./room-store.js";

type ProjectableStatus = Extract<
  RoomStatus,
  "lobby" | "in_hand" | "hand_result"
>;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function toWireAction(action: Record<string, unknown>): GameAction {
  switch (action.type) {
    case "BID":
      if (typeof action.amount === "number") {
        return { type: "BID", amount: action.amount };
      }
      break;
    case "PASS_BID":
      return { type: "PASS_BID" };
    case "SELECT_TRUMP":
      if (isString(action.cardId))
        return { type: "SELECT_TRUMP", cardId: action.cardId };
      break;
    case "TRUMP_OPEN":
      return { type: "TRUMP_OPEN" };
    case "TRUMP_CLOSE":
      return { type: "TRUMP_CLOSE" };
    case "PLAY_CARD":
      if (isString(action.cardId)) {
        return {
          type: "PLAY_CARD",
          cardId: action.cardId,
          faceDown: Boolean(action.faceDown),
          fromIndicator: Boolean(action.fromIndicator),
        };
      }
      break;
    case "ACK_RESULT":
      return { type: "ACK_RESULT" };
    default:
      break;
  }
  throw new DomainError("ROOM_DATA_INVALID", 500, "Invalid legal action");
}

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
    .map(toWireAction);
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
