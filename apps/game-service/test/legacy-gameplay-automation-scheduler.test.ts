import type { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { LegacyGameplayAutomationScheduler } from "../src/contexts/automation/adapters/scheduling/legacy-gameplay-automation-scheduler.js";
import type {
  NewAutomationJob,
  StoredRoom,
  StoredSeat,
} from "../src/contexts/rooms/application/room-persistence-model.js";

const room: StoredRoom = {
  eventVersion: 7,
  hostPlayerId: "host-player",
  id: "room-1",
  inviteCode: "304-room",
  recoveryError: null,
  ruleProfileId: "classic_304_4p",
  settings: { botDifficulty: "easy", enableSecondBidding: true },
  status: "in_hand",
  updatedAt: new Date(0),
};

function engine(state: Record<string, unknown>): GameEngine {
  return { state } as unknown as GameEngine;
}

function harness(seats: StoredSeat[] = []) {
  const jobs: NewAutomationJob[] = [];
  const cancelAutomationForRoom = vi.fn(async () => undefined);
  const store = {
    cancelAutomationForRoom,
    loadSeats: vi.fn(async () => seats),
    scheduleAutomation: vi.fn(async (_transaction, job: NewAutomationJob) => {
      jobs.push(job);
    }),
  };
  let identity = 0;
  return {
    cancelAutomationForRoom,
    jobs,
    scheduler: new LegacyGameplayAutomationScheduler({
      config: { botActionDelayMs: 250, disconnectGraceSeconds: 120 },
      identities: {
        nextAutomationJobId: () => {
          identity += 1;
          return `job-${identity}`;
        },
      },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      store,
    }),
  };
}

describe("LegacyGameplayAutomationScheduler", () => {
  it("replaces prior jobs and schedules the active human timeout", async () => {
    const { cancelAutomationForRoom, jobs, scheduler } = harness();

    await scheduler.schedule(
      Symbol("transaction"),
      room,
      engine({
        activeSeat: 0,
        phase: "four_bidding",
        seats: [{ connectionStatus: "online", type: "human" }],
      }),
    );

    expect(cancelAutomationForRoom).toHaveBeenNthCalledWith(
      1,
      expect.any(Symbol),
      room.id,
      ["BOT_ACTION", "TURN_TIMEOUT", "TRICK_ADVANCE"],
    );
    expect(cancelAutomationForRoom).toHaveBeenNthCalledWith(
      2,
      expect.any(Symbol),
      room.id,
      ["DISCONNECT_GRACE"],
    );
    expect(jobs).toEqual([
      {
        dueAt: new Date("2026-07-15T00:00:30.000Z"),
        expectedEventVersion: 7,
        id: "job-1",
        kind: "TURN_TIMEOUT",
        roomId: room.id,
        targetSeatIndex: 0,
      },
    ]);
  });

  it("schedules disconnect grace and the active bot independently", async () => {
    const disconnectedAt = new Date("2026-07-14T23:59:30.000Z");
    const { jobs, scheduler } = harness([
      {
        botDifficulty: null,
        connectionStatus: "disconnected",
        disconnectedAt,
        displayName: "Asha",
        occupantType: "human",
        playerId: "player-1",
        seatIndex: 0,
      },
    ]);

    await scheduler.schedule(
      Symbol("transaction"),
      room,
      engine({
        activeSeat: 1,
        phase: "trick_play",
        seats: [{}, { type: "bot" }],
      }),
    );

    expect(jobs).toEqual([
      expect.objectContaining({
        dueAt: new Date("2026-07-15T00:01:30.000Z"),
        kind: "DISCONNECT_GRACE",
        targetSeatIndex: 0,
      }),
      expect.objectContaining({
        dueAt: new Date("2026-07-15T00:00:00.250Z"),
        kind: "BOT_ACTION",
        targetSeatIndex: 1,
      }),
    ]);
  });
});
