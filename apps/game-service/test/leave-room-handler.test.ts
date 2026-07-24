import {
  commandId,
  createLobby,
  eventVersion,
  executeRoomCommand,
  inviteCode,
  joinLobby,
  playerId,
  projectRoom,
  type RoomProjection,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import type { ExecuteRoomCommandInput } from "../src/contexts/rooms/application/execute-room-command.js";
import { LeaveRoomHandler } from "../src/contexts/rooms/application/leave-room.js";
import type {
  RoomCommandExecutor,
  RoomPresence,
} from "../src/contexts/rooms/application/room-command-ports.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");
const leaveCommandId = commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f");
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

class CommandExecutor implements RoomCommandExecutor {
  readonly calls: ExecuteRoomCommandInput[] = [];
  error: Error | null = null;

  constructor(public projection: RoomProjection) {}

  async execute(input: ExecuteRoomCommandInput): Promise<RoomProjection> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.projection;
  }
}

class Presence implements RoomPresence {
  readonly removed: { playerId: string; roomId: string }[] = [];

  async remove(roomId: string, playerId: string): Promise<void> {
    this.removed.push({ playerId, roomId });
  }

  async touch(): Promise<void> {}
}

describe("LeaveRoomHandler", () => {
  it("returns a left response and removes presence after persistence", async () => {
    const joined = joinLobby(lobby, {
      displayName: "Bimal",
      playerId: guestId,
    });
    if (!joined.ok) throw new Error("Expected guest join to succeed");
    const departed = executeRoomCommand(joined.room, {
      actor: guestId,
      expectedVersion: joined.room.eventVersion,
      type: "LEAVE_ROOM",
    });
    if (!departed.ok) throw new Error("Expected leave command to succeed");
    const executor = new CommandExecutor(projectRoom(departed.room, guestId));
    const presence = new Presence();
    const handler = new LeaveRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: guestId,
        commandId: leaveCommandId,
        expectedVersion: joined.room.eventVersion,
        roomId: joined.room.id,
      }),
    ).resolves.toEqual({
      eventVersion: departed.room.eventVersion,
      roomId: departed.room.id,
      status: "left",
    });
    expect(executor.calls[0]).toMatchObject({
      command: { actor: guestId, type: "LEAVE_ROOM" },
      roomReference: joined.room.id,
    });
    expect(presence.removed).toEqual([
      { playerId: guestId, roomId: joined.room.id },
    ]);
  });

  it("returns closed when the last human leaves", async () => {
    const departed = executeRoomCommand(lobby, {
      actor: hostId,
      expectedVersion: lobby.eventVersion,
      type: "LEAVE_ROOM",
    });
    if (!departed.ok) throw new Error("Expected leave command to succeed");
    const handler = new LeaveRoomHandler(
      new CommandExecutor(projectRoom(departed.room, hostId)),
      new Presence(),
    );

    await expect(
      handler.execute({
        actor: hostId,
        commandId: leaveCommandId,
        expectedVersion: eventVersion(1),
        roomId: lobby.id,
      }),
    ).resolves.toMatchObject({ status: "closed" });
  });

  it("does not remove presence when persistence fails", async () => {
    const executor = new CommandExecutor(projectRoom(lobby, hostId));
    executor.error = new Error("leave failed");
    const presence = new Presence();
    const handler = new LeaveRoomHandler(executor, presence);

    await expect(
      handler.execute({
        actor: hostId,
        commandId: leaveCommandId,
        expectedVersion: lobby.eventVersion,
        roomId: lobby.id,
      }),
    ).rejects.toThrow("leave failed");
    expect(presence.removed).toEqual([]);
  });
});
