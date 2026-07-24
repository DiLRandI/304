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
import type {
  RoomCommandExecutor,
  RoomPresence,
} from "../src/contexts/rooms/application/room-command-ports.js";
import { StartRoomHandler } from "../src/contexts/rooms/application/start-room.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const startCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
const lobby = createLobby({
  host: { displayName: "Asha", playerId: hostId },
  id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
  inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
  profileId: "classic_304_4p",
  settings: {
    botDifficulty: "easy",
    enableSecondBidding: true,
    endHandWhenOutcomeCertain: true,
  },
});
const projection = projectRoom(lobby, hostId);

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
  readonly touched: { playerId: string; roomId: string }[] = [];

  async remove(): Promise<void> {}

  async touch(roomId: string, actor: string): Promise<void> {
    this.touched.push({ playerId: actor, roomId });
  }
}

describe("StartRoomHandler", () => {
  it("executes a start command and refreshes presence after persistence", async () => {
    const executor = new CommandExecutor();
    const presence = new Presence();
    const handler = new StartRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: hostId,
        commandId: startCommandId,
        expectedVersion: eventVersion(1),
        roomId: lobby.id,
      }),
    ).resolves.toBe(projection);
    expect(executor.calls).toEqual([
      {
        command: {
          actor: hostId,
          expectedVersion: eventVersion(1),
          type: "START_ROOM",
        },
        commandId: startCommandId,
        roomReference: lobby.id,
      },
    ]);
    expect(presence.touched).toEqual([
      { playerId: hostId, roomId: projection.id },
    ]);
  });

  it("does not refresh presence when the command fails", async () => {
    const executor = new CommandExecutor();
    executor.error = new Error("start failed");
    const presence = new Presence();
    const handler = new StartRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: hostId,
        commandId: startCommandId,
        expectedVersion: eventVersion(1),
        roomId: lobby.id,
      }),
    ).rejects.toThrow("start failed");
    expect(presence.touched).toEqual([]);
  });
});
