import { describe, expect, it, vi } from "vitest";
import { projectRoomForPlayer } from "../src/contexts/gameplay/adapters/delivery/gameplay-room-presenter.js";

const room = {
  eventVersion: 7,
  hostPlayerId: "host-player",
  id: "room-1",
  inviteCode: "304-room",
  status: "hand_result" as const,
};

function engineFor(viewerPlayerId: string) {
  return {
    getLegalActions: vi
      .fn()
      .mockReturnValue([{ type: "ACK_RESULT" }, { type: "PASS_BID" }]),
    getPrompt: vi.fn().mockReturnValue("Review the result"),
    getPublicState: vi.fn().mockReturnValue({ phase: "hand_result" }),
    getSeatView: vi.fn().mockReturnValue({ hand: [], seatIndex: 0 }),
    state: { seats: [{ userId: viewerPlayerId }] },
  };
}

describe("projectRoomForPlayer", () => {
  it("presents result acknowledgement to the host", () => {
    const projection = projectRoomForPlayer(
      room,
      engineFor("host-player") as never,
      0,
    );

    expect(projection.view.isHost).toBe(true);
    expect(projection.view.legalActions).toEqual([
      { type: "ACK_RESULT" },
      { type: "PASS_BID" },
    ]);
  });

  it("hides host-only result acknowledgement from another player", () => {
    const projection = projectRoomForPlayer(
      room,
      engineFor("guest-player") as never,
      0,
    );

    expect(projection.view.isHost).toBe(false);
    expect(projection.view.legalActions).toEqual([{ type: "PASS_BID" }]);
  });

  it("rejects a viewer without a private seat", () => {
    const engine = engineFor("guest-player");
    engine.getSeatView.mockReturnValue(null);

    expect(() => projectRoomForPlayer(room, engine as never, 0)).toThrow(
      expect.objectContaining({ code: "SEAT_REQUIRED", kind: "forbidden" }),
    );
  });

  it("rejects a room state that cannot be projected", () => {
    expect(() =>
      projectRoomForPlayer(
        { ...room, status: "closed" },
        engineFor("host-player") as never,
        0,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "ROOM_UNAVAILABLE",
        kind: "unavailable",
      }),
    );
  });
});
