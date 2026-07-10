import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RoomCoordinator } from "../src/domain/room-coordinator.js";
import { AutomationWorker } from "../src/worker/automation-worker.js";

describe("automation worker", () => {
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
