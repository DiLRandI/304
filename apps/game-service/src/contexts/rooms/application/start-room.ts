import type {
  CommandId,
  EventVersion,
  PlayerId,
  RoomId,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type {
  RoomCommandExecutor,
  RoomPresence,
} from "./room-command-ports.js";

export interface StartRoomInput {
  readonly actor: PlayerId;
  readonly commandId: CommandId;
  readonly expectedVersion: EventVersion;
  readonly roomId: RoomId;
}

export class StartRoomHandler {
  constructor(
    private readonly commands: RoomCommandExecutor,
    private readonly presence: RoomPresence,
  ) {}

  async execute(input: StartRoomInput): Promise<RoomProjection> {
    const projection = await this.commands.execute({
      command: {
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        type: "START_ROOM",
      },
      commandId: input.commandId,
      roomReference: input.roomId,
    });
    await this.presence.touch(projection.id, input.actor);
    return projection;
  }
}
