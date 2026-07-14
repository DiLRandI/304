import type {
  CommandId,
  EventVersion,
  PlayerId,
  RoomId,
  RoomPlayer,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type { ExecuteRoomCommandInput } from "./execute-room-command.js";

export interface RoomCommandExecutor {
  execute(input: ExecuteRoomCommandInput): Promise<RoomProjection>;
}

export interface RoomPresence {
  touch(roomId: RoomId, playerId: PlayerId): Promise<void>;
}

export interface JoinRoomInput {
  readonly actor: RoomPlayer;
  readonly commandId: CommandId;
  readonly expectedVersion: EventVersion;
  readonly roomReference: string;
}

export class JoinRoomHandler {
  constructor(
    private readonly commands: RoomCommandExecutor,
    private readonly presence: RoomPresence,
  ) {}

  async execute(input: JoinRoomInput): Promise<RoomProjection> {
    const projection = await this.commands.execute({
      command: {
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        type: "JOIN_ROOM",
      },
      commandId: input.commandId,
      roomReference: input.roomReference,
    });
    await this.presence.touch(projection.id, input.actor.playerId);
    return projection;
  }
}
