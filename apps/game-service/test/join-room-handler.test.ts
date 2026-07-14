import {
  commandId,
  createLobby,
  eventVersion,
  inviteCode,
  playerId,
  projectRoom,
  type RoomProjection,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import type { ExecuteRoomCommandInput } from "../src/contexts/rooms/application/execute-room-command.js";
import {
  JoinRoomHandler,
  type RoomCommandExecutor,
  type RoomPresence,
} from "../src/contexts/rooms/application/join-room.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");
const joinCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
const projection = projectRoom(
  createLobby({
    host: { displayName: "Asha", playerId: hostId },
    id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
    inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
    profileId: "classic_304_4p",
    settings: { botDifficulty: "easy", enableSecondBidding: true },
  }),
  guestId,
);

class CommandExecutor implements RoomCommandExecutor {
  readonly calls: ExecuteRoomCommandInput[] = [];
  error: Error | null = null;

  async execute(input: ExecuteRoomCommandInput): Promise<RoomProjection> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return projection;
  }
}

class Presence implements RoomPresence {
  readonly calls: { playerId: string; roomId: string }[] = [];

  async touch(roomId: string, playerId: string): Promise<void> {
    this.calls.push({ playerId, roomId });
  }
}

describe("JoinRoomHandler", () => {
  it("executes a join command and records presence after persistence", async () => {
    const executor = new CommandExecutor();
    const presence = new Presence();
    const handler = new JoinRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: { displayName: "Bimal", playerId: guestId },
        commandId: joinCommandId,
        expectedVersion: eventVersion(1),
        roomReference: "304-AbCdEfGhIjKl_123",
      }),
    ).resolves.toBe(projection);

    expect(executor.calls).toEqual([
      {
        command: {
          actor: { displayName: "Bimal", playerId: guestId },
          expectedVersion: eventVersion(1),
          type: "JOIN_ROOM",
        },
        commandId: joinCommandId,
        roomReference: "304-AbCdEfGhIjKl_123",
      },
    ]);
    expect(presence.calls).toEqual([
      { playerId: guestId, roomId: projection.id },
    ]);
  });

  it("does not create presence when the command fails", async () => {
    const executor = new CommandExecutor();
    executor.error = new Error("join failed");
    const presence = new Presence();
    const handler = new JoinRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: { displayName: "Bimal", playerId: guestId },
        commandId: joinCommandId,
        expectedVersion: eventVersion(1),
        roomReference: "304-AbCdEfGhIjKl_123",
      }),
    ).rejects.toThrow("join failed");
    expect(presence.calls).toEqual([]);
  });
});
