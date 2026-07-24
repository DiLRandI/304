import { describe, expect, it, vi } from "vitest";
import type {
  AutomatableGameplay,
  AutomatableRoom,
} from "../src/contexts/automation/application/automation-scheduler.js";
import type {
  AutomationSchedulingSeat,
  ScheduledAutomationJob,
} from "../src/contexts/automation/application/automation-scheduling-store.js";
import { GameplayAutomationScheduler } from "../src/contexts/automation/application/gameplay-automation-scheduler.js";

const room: AutomatableRoom = {
  eventVersion: 7,
  id: "room-1",
  status: "in_hand",
};

function gameplay(state: AutomatableGameplay["state"]): AutomatableGameplay {
  return { state };
}

function harness(seats: AutomationSchedulingSeat[] = []) {
  const jobs: ScheduledAutomationJob[] = [];
  const cancelAutomationForRoom = vi.fn(async () => undefined);
  const store = {
    cancelAutomationForRoom,
    loadSeats: vi.fn(async () => seats),
    scheduleAutomation: vi.fn(
      async (_transaction, job: ScheduledAutomationJob) => {
        jobs.push(job);
      },
    ),
  };
  let identity = 0;
  return {
    cancelAutomationForRoom,
    jobs,
    scheduler: new GameplayAutomationScheduler({
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

describe("GameplayAutomationScheduler", () => {
  it("replaces prior jobs and schedules the active human timeout", async () => {
    const { cancelAutomationForRoom, jobs, scheduler } = harness();

    await scheduler.schedule(
      Symbol("transaction"),
      room,
      gameplay({
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
        connectionStatus: "disconnected",
        disconnectedAt,
        occupantType: "human",
        playerId: "player-1",
        seatIndex: 0,
      },
    ]);

    await scheduler.schedule(
      Symbol("transaction"),
      room,
      gameplay({
        activeSeat: 1,
        phase: "trick_play",
        seats: [{ type: "empty" }, { type: "bot" }],
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

  it("cleans up obsolete trick jobs without scheduling a replacement for an early result", async () => {
    const { cancelAutomationForRoom, jobs, scheduler } = harness();

    await scheduler.schedule(
      Symbol("transaction"),
      { ...room, status: "hand_result" },
      gameplay({
        activeSeat: null,
        currentTrick: { winnerSeat: 0 },
        phase: "hand_result",
        seats: [{ connectionStatus: "online", type: "human" }],
      }),
    );

    expect(cancelAutomationForRoom).toHaveBeenNthCalledWith(
      1,
      expect.any(Symbol),
      room.id,
      ["BOT_ACTION", "TURN_TIMEOUT", "TRICK_ADVANCE"],
    );
    expect(jobs).toEqual([]);
  });
});
