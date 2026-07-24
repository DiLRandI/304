import type { RoomProjection } from "@three-zero-four/contracts";
import {
  isRecord,
  nonNegativeInteger,
  nullableString,
} from "./projection-value";

export interface LobbyRoomView {
  kind: "lobby";
  isHost: boolean;
  lobby: {
    endHandWhenOutcomeCertain: boolean;
    ruleProfileId: string;
    seats: Array<{
      botDifficulty: string | null;
      displayName: string | null;
      occupantType: "bot" | "empty" | "human";
      seatIndex: number;
    }>;
  };
}

export function readLobbyRoomView(
  projection: RoomProjection,
): LobbyRoomView | null {
  if (projection.status !== "lobby" || !isRecord(projection.view)) return null;
  const lobby = projection.view.lobby;
  if (
    !isRecord(lobby) ||
    typeof lobby.endHandWhenOutcomeCertain !== "boolean" ||
    typeof lobby.ruleProfileId !== "string" ||
    typeof projection.view.isHost !== "boolean"
  ) {
    return null;
  }
  if (!Array.isArray(lobby.seats)) return null;

  const seats: LobbyRoomView["lobby"]["seats"] = [];
  for (const item of lobby.seats) {
    if (!isRecord(item)) return null;
    const seatIndex = nonNegativeInteger(item.seatIndex);
    const displayName = nullableString(item.displayName);
    const botDifficulty = nullableString(item.botDifficulty);
    if (
      seatIndex === null ||
      displayName === undefined ||
      botDifficulty === undefined ||
      (item.occupantType !== "human" &&
        item.occupantType !== "bot" &&
        item.occupantType !== "empty")
    ) {
      return null;
    }
    seats.push({
      botDifficulty,
      displayName,
      occupantType: item.occupantType,
      seatIndex,
    });
  }

  return {
    kind: "lobby",
    isHost: projection.view.isHost,
    lobby: {
      endHandWhenOutcomeCertain: lobby.endHandWhenOutcomeCertain,
      ruleProfileId: lobby.ruleProfileId,
      seats,
    },
  };
}
