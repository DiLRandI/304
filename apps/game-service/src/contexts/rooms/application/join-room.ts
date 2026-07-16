import type {
  CommandId,
  EventVersion,
  RoomPlayer,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type {
  RoomCommandExecutor,
  RoomPresence,
} from "./room-command-ports.js";

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
