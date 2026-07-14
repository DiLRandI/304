import type { MaintenanceResult } from "../domain/room-maintenance.js";

export interface MaintenanceRunner {
  runOnce(now?: Date): Promise<MaintenanceResult>;
}

export class RoomMaintenanceWorker {
  private active: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dependencies: {
      maintenance: MaintenanceRunner;
      onRun?: (result: MaintenanceResult) => void | Promise<void>;
      pollIntervalMs: number;
    },
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, this.dependencies.pollIntervalMs);
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.active) return;
    const work = this.process(now);
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

  private async process(now: Date): Promise<void> {
    const result = await this.dependencies.maintenance.runOnce(now);
    try {
      await this.dependencies.onRun?.(result);
    } catch {
      // Metrics callbacks must not turn a completed maintenance pass into a retry.
    }
  }
}
