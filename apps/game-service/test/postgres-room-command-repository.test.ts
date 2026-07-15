import {
  commandId,
  createLobby,
  eventVersion,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresRoomCommandRepository } from "../src/contexts/rooms/adapters/persistence/postgres-room-command-repository.js";
import type { Database } from "../src/platform/postgres/database.js";

const actor = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const aggregateId = roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a");
const aggregateCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");

class EmptyDatabase implements Database {
  async query<Row extends QueryResultRow>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  async transaction<T>(
    callback: (transaction: Pick<Database, "query">) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

describe("PostgresRoomCommandRepository", () => {
  it("exposes the query and command adapters through one application port", async () => {
    const repository = new PostgresRoomCommandRepository(new EmptyDatabase());
    const request = {
      actor,
      expectedVersion: eventVersion(1),
      type: "START_ROOM",
    } as const;

    await expect(repository.findByReference("missing")).resolves.toBeNull();
    await expect(
      repository.findDuplicate(aggregateId, aggregateCommandId, actor, request),
    ).resolves.toBeNull();

    const room = createLobby({
      host: { displayName: "Asha", playerId: actor },
      id: aggregateId,
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: { botDifficulty: "easy", enableSecondBidding: true },
    });
    await expect(
      repository.commit({
        actorPlayerId: actor,
        commandId: aggregateCommandId,
        events: [],
        expectedVersion: eventVersion(0),
        request,
        response: projectRoom(room, actor),
        room,
      }),
    ).rejects.toMatchObject({ code: "INVALID_COMMIT" });
  });
});
