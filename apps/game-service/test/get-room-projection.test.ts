import type { RoomProjection } from "@three-zero-four/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import {
  GetRoomHandler,
  GetRoomSnapshotHandler,
} from "../src/contexts/rooms/application/get-room-projection.js";

const session: AuthenticatedSession = {
  displayName: "Asha",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: "player-1",
  sessionId: "session-1",
};
const lobbyProjection: RoomProjection = {
  eventVersion: 1,
  inviteCode: "304-room",
  roomId: "room-1",
  status: "lobby",
  viewerSeatIndex: null,
  view: {
    isHost: false,
    lobby: { ruleProfileId: "classic_304_4p", seats: [] },
  },
};
const seatedProjection: RoomProjection = {
  ...lobbyProjection,
  viewerSeatIndex: 0,
  view: { ...lobbyProjection.view, isHost: true },
};

describe("room projection query handlers", () => {
  it("refreshes presence before reading a room snapshot", async () => {
    const calls: string[] = [];
    const refresh = vi.fn(async () => {
      calls.push("presence");
    });
    const getSnapshot = vi.fn(async () => {
      calls.push("snapshot");
      return seatedProjection;
    });
    const handler = new GetRoomSnapshotHandler({ getSnapshot }, { refresh });

    await expect(
      handler.execute({ roomId: "room-1", session }),
    ).resolves.toEqual(seatedProjection);
    expect(calls).toEqual(["presence", "snapshot"]);
  });

  it("returns an unseated lobby projection without refreshing presence", async () => {
    const getRoom = vi.fn(async () => lobbyProjection);
    const getSnapshot = vi.fn(async () => seatedProjection);
    const refresh = vi.fn(async () => undefined);
    const handler = new GetRoomHandler({ getRoom, getSnapshot }, { refresh });

    await expect(
      handler.execute({ roomReference: "304-room", session }),
    ).resolves.toEqual(lobbyProjection);
    expect(refresh).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes and re-reads a room when the viewer is seated", async () => {
    const refreshedProjection = { ...seatedProjection, eventVersion: 2 };
    const getRoom = vi.fn(async () => seatedProjection);
    const getSnapshot = vi.fn(async () => refreshedProjection);
    const refresh = vi.fn(async () => undefined);
    const handler = new GetRoomHandler({ getRoom, getSnapshot }, { refresh });

    await expect(
      handler.execute({ roomReference: "304-room", session }),
    ).resolves.toEqual(refreshedProjection);
    expect(refresh).toHaveBeenCalledWith(session, "room-1");
    expect(getSnapshot).toHaveBeenCalledWith(session, "room-1");
  });
});
