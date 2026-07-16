import type {
  CommandId,
  EventVersion,
  PlayerId,
  RoomId,
} from "@three-zero-four/room-domain";
import type {
  RoomCommandExecutor,
  RoomPresence,
} from "./room-command-ports.js";

export interface LeaveRoomInput {
  readonly actor: PlayerId;
  readonly commandId: CommandId;
  readonly expectedVersion: EventVersion;
  readonly roomId: RoomId;
}

export interface LeaveRoomOutput {
  readonly eventVersion: EventVersion;
  readonly roomId: RoomId;
  readonly status: "closed" | "left";
}

export class LeaveRoomHandler {
  constructor(
    private readonly commands: RoomCommandExecutor,
    private readonly presence: RoomPresence,
  ) {}

  async execute(input: LeaveRoomInput): Promise<LeaveRoomOutput> {
    const projection = await this.commands.execute({
      command: {
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        type: "LEAVE_ROOM",
      },
      commandId: input.commandId,
      roomReference: input.roomId,
    });
    await this.presence.remove(projection.id, input.actor);
    return {
      eventVersion: projection.eventVersion,
      roomId: projection.id,
      status: projection.status === "closed" ? "closed" : "left",
    };
  }
}
