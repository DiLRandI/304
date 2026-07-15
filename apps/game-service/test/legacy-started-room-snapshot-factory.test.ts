import {
  createLobby,
  inviteCode,
  playerId,
  roomId,
  startRoom,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import { LegacyStartedRoomSnapshotFactory } from "../src/contexts/rooms/adapters/integration/legacy-started-room-snapshot-factory.js";

describe("LegacyStartedRoomSnapshotFactory", () => {
  it("translates a started room aggregate into a recoverable gameplay snapshot", () => {
    const host = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
    const lobby = createLobby({
      host: { displayName: "Asha", playerId: host },
      id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: { botDifficulty: "normal", enableSecondBidding: true },
    });
    const started = startRoom(lobby, host);
    if (!started.ok) throw new Error("Expected room start to succeed");

    const snapshot = new LegacyStartedRoomSnapshotFactory().create(
      started.room,
    ) as {
      humanCount: number;
      phase: string;
      seats: Array<{ difficulty?: string; type: string; userId?: string }>;
    };

    expect(snapshot.phase).toBe("four_bidding");
    expect(snapshot.humanCount).toBe(1);
    expect(snapshot.seats).toHaveLength(4);
    expect(snapshot.seats[0]).toMatchObject({
      type: "human",
      userId: host,
    });
    expect(snapshot.seats.slice(1)).toMatchObject(
      Array.from({ length: 3 }, () => ({
        difficulty: "normal",
        type: "bot",
      })),
    );
  });
});
