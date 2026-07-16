import {
  type CommandId,
  type EventVersion,
  executeRoomCommand,
  type PlayerId,
  projectRoom,
  type Room,
  type RoomCommand,
  type RoomEvent,
  type RoomId,
  type RoomProjection,
} from "@three-zero-four/room-domain";
import { RoomApplicationError } from "./room-application-error.js";

export interface RoomCommandCommit {
  readonly actorPlayerId: PlayerId;
  readonly commandId: CommandId;
  readonly events: readonly RoomEvent[];
  readonly expectedVersion: EventVersion;
  readonly request: RoomCommand;
  readonly response: RoomProjection;
  readonly room: Room;
}

export interface RoomCommandReader {
  findByReference(reference: string): Promise<Room | null>;
  findDuplicate(
    roomId: RoomId,
    commandId: CommandId,
    actorPlayerId: PlayerId,
    request: RoomCommand,
  ): Promise<RoomProjection | null>;
}

export interface RoomCommandWriter {
  commit(input: RoomCommandCommit): Promise<void>;
}

export interface RoomCommandRepository
  extends RoomCommandReader,
    RoomCommandWriter {}

export interface ExecuteRoomCommandInput {
  readonly command: RoomCommand;
  readonly commandId: CommandId;
  readonly roomReference: string;
}

const expectedRepositoryErrors = new Set([
  "COMMAND_ID_CONFLICT",
  "ROOM_NOT_FOUND",
  "VERSION_CONFLICT",
]);

function normalizeRepositoryError(error: unknown): RoomApplicationError | null {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !expectedRepositoryErrors.has(error.code)
  ) {
    return null;
  }
  return new RoomApplicationError(error.code, error.message);
}

function actorPlayerId(command: RoomCommand): PlayerId {
  return command.type === "JOIN_ROOM" ? command.actor.playerId : command.actor;
}

export class ExecuteRoomCommandHandler {
  constructor(private readonly repository: RoomCommandRepository) {}

  async execute(input: ExecuteRoomCommandInput): Promise<RoomProjection> {
    try {
      const room = await this.repository.findByReference(input.roomReference);
      if (!room) {
        throw new RoomApplicationError("ROOM_NOT_FOUND", "Room was not found");
      }
      const actor = actorPlayerId(input.command);
      const duplicate = await this.repository.findDuplicate(
        room.id,
        input.commandId,
        actor,
        input.command,
      );
      if (duplicate) return duplicate;

      const result = executeRoomCommand(room, input.command);
      if (!result.ok) {
        throw new RoomApplicationError(result.error.code, result.error.message);
      }
      const response = projectRoom(result.room, actor);
      await this.repository.commit({
        actorPlayerId: actor,
        commandId: input.commandId,
        events: result.events,
        expectedVersion: room.eventVersion,
        request: input.command,
        response,
        room: result.room,
      });
      return response;
    } catch (error) {
      if (error instanceof RoomApplicationError) throw error;
      throw normalizeRepositoryError(error) ?? error;
    }
  }
}
