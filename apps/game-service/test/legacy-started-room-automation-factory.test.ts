import {
  createLobby,
  inviteCode,
  playerId,
  roomId,
  startRoom,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import { LegacyStartedRoomAutomationFactory } from "../src/contexts/automation/adapters/integration/legacy-started-room-automation-factory.js";
import { LegacyStartedRoomSnapshotFactory } from "../src/contexts/rooms/adapters/integration/legacy-started-room-snapshot-factory.js";

describe("LegacyStartedRoomAutomationFactory", () => {
  it("schedules the initial active turn from recovered gameplay state", () => {
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
    );
    const state = snapshot as {
      activeSeat: number;
      seats: Array<{ type: "bot" | "human" }>;
    };
    const targetSeatIndex = state.activeSeat;
    const isBot = state.seats[targetSeatIndex]?.type === "bot";
    const factory = new LegacyStartedRoomAutomationFactory(
      {
        nextAutomationJobId: () => "83dd5df8-6036-463e-a7db-6d7f96fc3b52",
      },
      () => new Date("2030-01-01T00:00:00.000Z"),
      900,
    );

    expect(factory.create(started.room, snapshot)).toEqual({
      dueAt: new Date(
        isBot ? "2030-01-01T00:00:00.900Z" : "2030-01-01T00:00:30.000Z",
      ),
      expectedEventVersion: 2,
      id: "83dd5df8-6036-463e-a7db-6d7f96fc3b52",
      kind: isBot ? "BOT_ACTION" : "TURN_TIMEOUT",
      roomId: started.room.id,
      targetSeatIndex,
    });
  });
});
