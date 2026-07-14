import type {
  CommandId,
  PlayerId,
  Room,
  RoomCommand,
  RoomId,
  RoomProjection,
} from "@three-zero-four/room-domain";
import type { Database } from "../../../../infra/database.js";
import type {
  RoomCommandCommit,
  RoomCommandRepository,
} from "../../application/execute-room-command.js";
import { PostgresRoomCommandWriter } from "./postgres-room-command-writer.js";
import { PostgresRoomQueryRepository } from "./postgres-room-query-repository.js";

export class PostgresRoomCommandRepository implements RoomCommandRepository {
  private readonly reader: PostgresRoomQueryRepository;
  private readonly writer: PostgresRoomCommandWriter;

  constructor(database: Database) {
    this.reader = new PostgresRoomQueryRepository(database);
    this.writer = new PostgresRoomCommandWriter(database);
  }

  findByReference(reference: string): Promise<Room | null> {
    return this.reader.findByReference(reference);
  }

  findDuplicate(
    aggregateId: RoomId,
    duplicateCommandId: CommandId,
    actorPlayerId: PlayerId,
    request: RoomCommand,
  ): Promise<RoomProjection | null> {
    return this.reader.findDuplicate(
      aggregateId,
      duplicateCommandId,
      actorPlayerId,
      request,
    );
  }

  commit(input: RoomCommandCommit): Promise<void> {
    return this.writer.commit(input);
  }
}
