import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RoomCoordinator } from "../src/domain/room-coordinator.js";
import type { ClaimedAutomationJob } from "../src/domain/room-store.js";
import { AutomationWorker } from "../src/worker/automation-worker.js";
import {
  type MaintenanceRunner,
  RoomMaintenanceWorker,
} from "../src/worker/room-maintenance-worker.js";

function claimedJob(id: string, roomId: string): ClaimedAutomationJob {
  return {
    attempts: 1,
    dueAt: new Date("2026-07-10T21:00:00.000Z"),
    expectedEventVersion: 1,
    id,
    kind: "BOT_ACTION",
    roomId,
    targetSeatIndex: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("automation worker", () => {
  it("claims another full batch before waiting for the next polling interval", async () => {
    const firstBatch = Array.from({ length: 16 }, (_value, index) =>
      claimedJob(`first-${index}`, `room-${index}`),
    );
    const nextBatch = [claimedJob("next", "room-next")];
    const store = {
      claimDueAutomationJobs: vi
        .fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(nextBatch),
      completeAutomationJob: vi.fn().mockResolvedValue(undefined),
      countPendingAutomationJobs: vi.fn().mockResolvedValue(0),
      releaseAutomationJob: vi.fn().mockResolvedValue(undefined),
    };
    const runAutomation = vi.fn().mockResolvedValue("completed" as const);
    const worker = new AutomationWorker({
      store,
      coordinator: { runAutomation } as unknown as RoomCoordinator,
      ownerId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      pollIntervalMs: 500,
    });

    await worker.runOnce(new Date("2026-07-10T21:00:30.000Z"));

    expect(store.claimDueAutomationJobs).toHaveBeenCalledTimes(2);
    expect(runAutomation).toHaveBeenCalledTimes(17);
  });

  it("runs separate room queues concurrently without overlapping one room's jobs", async () => {
    const firstRoomFirstJob = claimedJob("room-a-first", "room-a");
    const firstRoomSecondJob = claimedJob("room-a-second", "room-a");
    const secondRoomJob = claimedJob("room-b-first", "room-b");
    const firstRoomFirstResult = deferred<"completed">();
    const firstRoomSecondResult = deferred<"completed">();
    const secondRoomResult = deferred<"completed">();
    const store = {
      claimDueAutomationJobs: vi
        .fn()
        .mockResolvedValue([
          firstRoomFirstJob,
          firstRoomSecondJob,
          secondRoomJob,
        ]),
      completeAutomationJob: vi.fn().mockResolvedValue(undefined),
      countPendingAutomationJobs: vi.fn().mockResolvedValue(0),
      releaseAutomationJob: vi.fn().mockResolvedValue(undefined),
    };
    const runAutomation = vi.fn((job: ClaimedAutomationJob) => {
      if (job.id === firstRoomFirstJob.id) return firstRoomFirstResult.promise;
      if (job.id === firstRoomSecondJob.id) {
        return firstRoomSecondResult.promise;
      }
      return secondRoomResult.promise;
    });
    const worker = new AutomationWorker({
      store,
      coordinator: { runAutomation } as unknown as RoomCoordinator,
      ownerId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      pollIntervalMs: 500,
    });
    const running = worker.runOnce();

    try {
      await nextTick();
      const startedIds = runAutomation.mock.calls.map(([job]) => job.id);
      expect(startedIds).toEqual(
        expect.arrayContaining([firstRoomFirstJob.id, secondRoomJob.id]),
      );
      expect(startedIds).not.toContain(firstRoomSecondJob.id);
    } finally {
      firstRoomFirstResult.resolve("completed");
      firstRoomSecondResult.resolve("completed");
      secondRoomResult.resolve("completed");
      await running;
    }
  });

  it("keeps its polling timer referenced so a standalone worker continues to claim due jobs", async () => {
    const interval = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(global, "setInterval")
      .mockReturnValue(interval);
    const store = {
      claimDueAutomationJobs: vi.fn().mockResolvedValue([]),
      completeAutomationJob: vi.fn(),
      countPendingAutomationJobs: vi.fn().mockResolvedValue(0),
      releaseAutomationJob: vi.fn(),
    };
    const worker = new AutomationWorker({
      store,
      coordinator: {} as RoomCoordinator,
      ownerId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      pollIntervalMs: 500,
    });

    try {
      await worker.start();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 500);
      expect(interval.unref).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
      setIntervalSpy.mockRestore();
    }
  });

  it("does not overlap polls and records a heartbeat after a healthy poll", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "g304-worker-"));
    const heartbeatPath = path.join(tempDir, "heartbeat");
    let finishClaim: ((jobs: []) => void) | undefined;
    const claim = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finishClaim = resolve;
        }),
    );
    const store = {
      claimDueAutomationJobs: claim,
      completeAutomationJob: vi.fn(),
      countPendingAutomationJobs: vi.fn().mockResolvedValue(4),
      releaseAutomationJob: vi.fn(),
    };
    const pending = vi.fn();
    const worker = new AutomationWorker({
      store,
      coordinator: {} as RoomCoordinator,
      pollIntervalMs: 500,
      ownerId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      health: async () => true,
      heartbeatPath,
      onPending: pending,
    });

    try {
      const first = worker.runOnce();
      await Promise.resolve();
      await worker.runOnce();
      expect(claim).toHaveBeenCalledTimes(1);
      finishClaim?.([]);
      await first;

      expect(pending).toHaveBeenCalledWith(4);
      await expect(readFile(heartbeatPath, "utf8")).resolves.toMatch(/^\d+\n$/);
    } finally {
      await worker.stop();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("awaits asynchronous outcome reporting without failing completed work", async () => {
    const store = {
      claimDueAutomationJobs: vi.fn().mockResolvedValue([
        {
          attempts: 1,
          dueAt: new Date(),
          expectedEventVersion: 1,
          id: "job-1",
          kind: "BOT_ACTION" as const,
          roomId: "room-1",
          targetSeatIndex: 1,
        },
      ]),
      completeAutomationJob: vi.fn().mockResolvedValue(undefined),
      countPendingAutomationJobs: vi.fn().mockResolvedValue(0),
      releaseAutomationJob: vi.fn().mockResolvedValue(undefined),
    };
    const reported = vi.fn().mockResolvedValue(undefined);
    const worker = new AutomationWorker({
      store,
      coordinator: {
        runAutomation: vi.fn().mockResolvedValue("completed"),
      } as unknown as RoomCoordinator,
      onJob: reported,
      ownerId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      pollIntervalMs: 500,
    });

    await worker.runOnce();

    expect(store.completeAutomationJob).toHaveBeenCalledWith(
      "job-1",
      "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
    );
    expect(reported).toHaveBeenCalledWith("completed");
  });
});

describe("room maintenance worker", () => {
  it("runs immediately, does not overlap a pass, reports aggregate results, and stops its timer", async () => {
    const interval = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(global, "setInterval")
      .mockReturnValue(interval);
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const firstRun = deferred<{
      closedRooms: number;
      purgedRooms: number;
      revokedSessions: number;
    }>();
    const maintenance = {
      runOnce: vi.fn().mockReturnValue(firstRun.promise),
    } satisfies MaintenanceRunner;
    const reported = vi.fn().mockResolvedValue(undefined);
    const worker = new RoomMaintenanceWorker({
      maintenance,
      onRun: reported,
      pollIntervalMs: 60_000,
    });

    try {
      const started = worker.start();
      await nextTick();
      await worker.runOnce();
      expect(maintenance.runOnce).toHaveBeenCalledOnce();

      firstRun.resolve({
        closedRooms: 2,
        purgedRooms: 1,
        revokedSessions: 3,
      });
      await started;

      expect(reported).toHaveBeenCalledWith({
        closedRooms: 2,
        purgedRooms: 1,
        revokedSessions: 3,
      });
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
      await worker.stop();
      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
