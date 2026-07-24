import {
  commandId,
  createLobby,
  inviteCode,
  playerId,
  projectRoom,
  type RoomProjection,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import {
  CreateRoomHandler,
  type RoomCreationCommit,
  type RoomCreationRepository,
} from "../src/contexts/rooms/application/create-room.js";
import type { RoomPresence } from "../src/contexts/rooms/application/room-command-ports.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const createCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
const input = {
  commandId: createCommandId,
  host: { displayName: "Asha", playerId: hostId },
  profileId: "classic_304_4p" as const,
  sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
  settings: {
    botDifficulty: "easy" as const,
    enableSecondBidding: true,
    endHandWhenOutcomeCertain: true,
  },
};
const winningResponse = projectRoom(
  createLobby({
    host: input.host,
    id: roomId("f63f4748-bf45-488e-a09e-c47c27b26df5"),
    inviteCode: inviteCode("304-ZyXwVuTsRqPo_987"),
    profileId: input.profileId,
    settings: input.settings,
  }),
  hostId,
);

class CreationRepository implements RoomCreationRepository {
  readonly commits: RoomCreationCommit[] = [];
  createdResponse: RoomProjection | null = null;
  duplicate: RoomProjection | null = null;
  error: Error | null = null;

  async create(commit: RoomCreationCommit): Promise<RoomProjection> {
    if (this.error) throw this.error;
    this.commits.push(commit);
    return this.createdResponse ?? commit.response;
  }

  async findDuplicate(): Promise<RoomProjection | null> {
    return this.duplicate;
  }
}

class Presence implements RoomPresence {
  readonly touched: { playerId: string; roomId: string }[] = [];

  async remove(): Promise<void> {}

  async touch(roomId: string, actor: string): Promise<void> {
    this.touched.push({ playerId: actor, roomId });
  }
}

function handler(repository: CreationRepository, presence = new Presence()) {
  return {
    handler: new CreateRoomHandler(
      repository,
      presence,
      { nextRoomId: () => "12f8e3e8-6729-4c46-b78a-d1a0e804c55a" },
      { next: () => "304-AbCdEfGhIjKl_123" },
    ),
    presence,
  };
}

describe("CreateRoomHandler", () => {
  it("creates and projects a lobby before recording host presence", async () => {
    const repository = new CreationRepository();
    const runtime = handler(repository);

    const projection = await runtime.handler.execute(input);

    expect(projection).toMatchObject({
      eventVersion: 1,
      id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
      inviteCode: "304-AbCdEfGhIjKl_123",
      status: "lobby",
      viewerSeatPosition: 0,
    });
    expect(repository.commits).toHaveLength(1);
    expect(repository.commits[0]).toMatchObject({
      commandId: createCommandId,
      room: { hostPlayerId: hostId },
      sessionId: input.sessionId,
    });
    expect(repository.commits[0]?.room.seats[0]).toMatchObject({
      occupant: { kind: "human", playerId: hostId },
    });
    expect(runtime.presence.touched).toEqual([
      { playerId: hostId, roomId: projection.id },
    ]);
  });

  it("returns an idempotent projection without creating another room", async () => {
    const repository = new CreationRepository();
    const first = handler(repository);
    repository.duplicate = await first.handler.execute(input);
    repository.commits.length = 0;
    first.presence.touched.length = 0;

    await expect(first.handler.execute(input)).resolves.toBe(
      repository.duplicate,
    );
    expect(repository.commits).toEqual([]);
    expect(first.presence.touched).toEqual([
      { playerId: hostId, roomId: repository.duplicate.id },
    ]);
  });

  it("returns the persistence-confirmed winner of a concurrent create", async () => {
    const repository = new CreationRepository();
    repository.createdResponse = winningResponse;
    const runtime = handler(repository);

    await expect(runtime.handler.execute(input)).resolves.toBe(winningResponse);
    expect(runtime.presence.touched).toEqual([
      { playerId: hostId, roomId: winningResponse.id },
    ]);
  });

  it("does not record presence when persistence fails", async () => {
    const repository = new CreationRepository();
    repository.error = new Error("create failed");
    const runtime = handler(repository);

    await expect(runtime.handler.execute(input)).rejects.toThrow(
      "create failed",
    );
    expect(runtime.presence.touched).toEqual([]);
  });
});
