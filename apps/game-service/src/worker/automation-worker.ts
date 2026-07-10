import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { RoomCoordinator } from "../domain/room-coordinator.js";
import type {
  ClaimedAutomationJob,
  PostgresRoomStore,
} from "../domain/room-store.js";

export type AutomationWorkerOutcome = "completed" | "stale" | "failed";

const AUTOMATION_CLAIM_BATCH_SIZE = 16;
const MAX_AUTOMATION_JOBS_PER_RUN = 512;
const MAX_CONCURRENT_ROOM_QUEUES = 8;

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
      onHealthyPoll?: () => void | Promise<void>;
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
    let claimedCount = 0;
    let claimTime = now;

    while (claimedCount < MAX_AUTOMATION_JOBS_PER_RUN) {
      const limit = Math.min(
        AUTOMATION_CLAIM_BATCH_SIZE,
        MAX_AUTOMATION_JOBS_PER_RUN - claimedCount,
      );
      const jobs = await this.dependencies.store.claimDueAutomationJobs(
        this.ownerId,
        claimTime,
        limit,
        this.dependencies.roomId,
      );
      if (jobs.length === 0) break;

      await this.processClaimedJobs(jobs);
      claimedCount += jobs.length;
      if (jobs.length < limit) break;
      claimTime = new Date();
    }

    await this.reportPending(
      await this.dependencies.store.countPendingAutomationJobs(),
    );
    await this.recordHeartbeat();
  }

  private async processClaimedJobs(
    jobs: readonly ClaimedAutomationJob[],
  ): Promise<void> {
    const queuesByRoom = new Map<string, ClaimedAutomationJob[]>();
    for (const job of jobs) {
      const queue = queuesByRoom.get(job.roomId) ?? [];
      queue.push(job);
      queuesByRoom.set(job.roomId, queue);
    }

    const roomQueues = [...queuesByRoom.values()];
    let nextQueueIndex = 0;
    const processNextRoomQueue = async (): Promise<void> => {
      while (nextQueueIndex < roomQueues.length) {
        const queue = roomQueues[nextQueueIndex];
        nextQueueIndex += 1;
        if (!queue) continue;
        for (const job of queue) {
          await this.processClaimedJob(job);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_ROOM_QUEUES, roomQueues.length) },
        () => processNextRoomQueue(),
      ),
    );
  }

  private async processClaimedJob(job: ClaimedAutomationJob): Promise<void> {
    try {
      const outcome = await this.dependencies.coordinator.runAutomation(job);
      await this.dependencies.store.completeAutomationJob(job.id, this.ownerId);
      await this.report(outcome);
    } catch (error) {
      await this.dependencies.store
        .releaseAutomationJob(job.id, this.ownerId, errorMessage(error))
        .catch(() => undefined);
      await this.report("failed");
    }
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
    if (!this.dependencies.health) return;
    if (!(await this.dependencies.health())) return;
    try {
      await this.dependencies.onHealthyPoll?.();
    } catch {
      // Monitoring must not prevent durable automation work from completing.
    }
    if (this.dependencies.heartbeatPath) {
      await writeFile(
        this.dependencies.heartbeatPath,
        `${Date.now()}\n`,
        "utf8",
      );
    }
  }
}
