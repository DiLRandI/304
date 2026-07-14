import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";
import { describe, expect, it, vi } from "vitest";
import { SubmitGameplayCommandHandler } from "../src/contexts/gameplay/application/submit-gameplay-command.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";

const session: AuthenticatedSession = {
  displayName: "Asha",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
  sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
};
const command: GameCommand = {
  action: { type: "PASS_BID" },
  commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
  expectedVersion: 2,
  roomId: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
};
const projection = {
  eventVersion: 3,
  inviteCode: "304-AbCdEfGhIjKl_123",
  roomId: command.roomId,
  status: "in_hand",
  viewerSeatIndex: 0,
  view: { isHost: true },
} satisfies RoomProjection;

describe("SubmitGameplayCommandHandler", () => {
  it("delegates an authenticated command to the gameplay executor", async () => {
    const calls: string[] = [];
    const refresh = vi.fn(async () => {
      calls.push("presence");
    });
    const submitCommand = vi.fn(async () => {
      calls.push("command");
      return projection;
    });
    const handler = new SubmitGameplayCommandHandler(
      { submitCommand },
      { refresh },
    );

    await expect(handler.execute({ command, session })).resolves.toEqual(
      projection,
    );
    expect(calls).toEqual(["presence", "command"]);
    expect(refresh).toHaveBeenCalledWith(session, command.roomId);
    expect(submitCommand).toHaveBeenCalledWith(session, command);
  });
});
