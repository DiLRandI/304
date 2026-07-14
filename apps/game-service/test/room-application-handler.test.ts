import {
  commandId,
  createLobby,
  eventVersion,
  inviteCode,
  playerId,
  projectRoom,
  type Room,
  type RoomProjection,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import {
  ExecuteRoomCommandHandler,
  RoomApplicationError,
  type RoomCommandCommit,
  type RoomCommandRepository,
} from "../src/contexts/rooms/application/execute-room-command.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");
const roomCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");

function room(): Room {
  return createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: { botDifficulty: "easy", enableSecondBidding: true },
  });
}

class FakeRoomRepository implements RoomCommandRepository {
  commitCalls: RoomCommandCommit[] = [];
  duplicate: RoomProjection | null = null;

  constructor(public current: Room | null = room()) {}

  async commit(input: RoomCommandCommit): Promise<void> {
    this.commitCalls.push(input);
    this.current = input.room;
  }

  async findByReference(): Promise<Room | null> {
    return this.current;
  }

  async findDuplicate(): Promise<RoomProjection | null> {
    return this.duplicate;
  }
}

describe("execute room command application handler", () => {
  it("executes, persists, and projects an accepted command", async () => {
    const repository = new FakeRoomRepository();
    const handler = new ExecuteRoomCommandHandler(repository);
    const projection = await handler.execute({
      command: {
        actor: { displayName: "Bimal", playerId: guestId },
        expectedVersion: eventVersion(1),
        type: "JOIN_ROOM",
      },
      commandId: roomCommandId,
      roomReference: "304-AbCdEfGhIjKl_123",
    });

    expect(projection.viewerSeatPosition).toBe(1);
    expect(repository.commitCalls).toHaveLength(1);
    expect(repository.commitCalls[0]).toMatchObject({
      actorPlayerId: guestId,
      commandId: roomCommandId,
      expectedVersion: 1,
      events: [{ type: "PLAYER_JOINED", version: 2 }],
      response: projection,
      room: { eventVersion: 2 },
    });
  });

  it("returns a duplicate result without executing or committing again", async () => {
    const repository = new FakeRoomRepository();
    repository.duplicate = projectRoom(room(), hostId);
    const handler = new ExecuteRoomCommandHandler(repository);
    const projection = await handler.execute({
      command: {
        actor: hostId,
        expectedVersion: eventVersion(1),
        type: "START_ROOM",
      },
      commandId: roomCommandId,
      roomReference: "304-AbCdEfGhIjKl_123",
    });

    expect(projection).toBe(repository.duplicate);
    expect(repository.commitCalls).toEqual([]);
  });

  it("reports a missing room through an application error", async () => {
    const handler = new ExecuteRoomCommandHandler(new FakeRoomRepository(null));
    await expect(
      handler.execute({
        command: {
          actor: hostId,
          expectedVersion: eventVersion(1),
          type: "START_ROOM",
        },
        commandId: roomCommandId,
        roomReference: "missing",
      }),
    ).rejects.toEqual(
      new RoomApplicationError("ROOM_NOT_FOUND", "Room was not found"),
    );
  });

  it("promotes domain rejections to application errors", async () => {
    const handler = new ExecuteRoomCommandHandler(new FakeRoomRepository());
    await expect(
      handler.execute({
        command: {
          actor: guestId,
          expectedVersion: eventVersion(1),
          type: "START_ROOM",
        },
        commandId: roomCommandId,
        roomReference: "304-AbCdEfGhIjKl_123",
      }),
    ).rejects.toMatchObject({ code: "HOST_REQUIRED" });
  });
});
