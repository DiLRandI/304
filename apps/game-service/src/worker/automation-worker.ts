import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { RoomCoordinator } from "../domain/room-coordinator.js";
import type { PostgresRoomStore } from "../domain/room-store.js";

export type AutomationWorkerOutcome = "completed" | "stale" | "failed";

type AutomationStore = Pick<
  PostgresRoomStore,
  | "claimDueAutomationJobs"
  | "countPendingAutomationJobs"
  | "completeAutomationJob"
  | "releaseAutomationJob"
>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Automation job failed";
}

export class AutomationWorker {
  private active: Promise<void> | undefined;
  private readonly ownerId: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dependencies: {
      store: AutomationStore;
      coordinator: RoomCoordinator;
      pollIntervalMs: number;
      ownerId?: string;
      roomId?: string;
      onJob?: (outcome: AutomationWorkerOutcome) => void | Promise<void>;
      onPending?: (count: number) => void | Promise<void>;
      health?: () => Promise<boolean>;
      heartbeatPath?: string;
    },
  ) {
    this.ownerId = dependencies.ownerId ?? randomUUID();
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, this.dependencies.pollIntervalMs);
    this.timer.unref();
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.active) return;
    const work = this.processDueJobs(now);
    this.active = work;
    try {
      await work;
    } finally {
      if (this.active === work) this.active = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }

  private async processDueJobs(now: Date): Promise<void> {
    const jobs = await this.dependencies.store.claimDueAutomationJobs(
      this.ownerId,
      now,
      16,
      this.dependencies.roomId,
    );
    for (const job of jobs) {
      try {
        const outcome = await this.dependencies.coordinator.runAutomation(job);
        await this.dependencies.store.completeAutomationJob(
          job.id,
          this.ownerId,
        );
        await this.report(outcome);
      } catch (error) {
        await this.dependencies.store
          .releaseAutomationJob(job.id, this.ownerId, errorMessage(error))
          .catch(() => undefined);
        await this.report("failed");
      }
    }
    await this.reportPending(
      await this.dependencies.store.countPendingAutomationJobs(),
    );
    await this.recordHeartbeat();
  }

  private async report(outcome: AutomationWorkerOutcome): Promise<void> {
    try {
      await this.dependencies.onJob?.(outcome);
    } catch {
      // Metrics callbacks must not affect durable job completion.
    }
  }

  private async reportPending(count: number): Promise<void> {
    try {
      await this.dependencies.onPending?.(count);
    } catch {
      // Metrics callbacks must not affect durable job completion.
    }
  }

  private async recordHeartbeat(): Promise<void> {
    if (!this.dependencies.health || !this.dependencies.heartbeatPath) return;
    if (!(await this.dependencies.health())) return;
    await writeFile(this.dependencies.heartbeatPath, `${Date.now()}\n`, "utf8");
  }
}
