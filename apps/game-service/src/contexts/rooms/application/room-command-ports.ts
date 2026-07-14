import type {
  PlayerId,
  RoomId,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type { ExecuteRoomCommandInput } from "./execute-room-command.js";

export interface RoomCommandExecutor {
  execute(input: ExecuteRoomCommandInput): Promise<RoomProjection>;
}

export interface RoomPresence {
  remove(roomId: RoomId, playerId: PlayerId): Promise<void>;
  touch(roomId: RoomId, playerId: PlayerId): Promise<void>;
}
