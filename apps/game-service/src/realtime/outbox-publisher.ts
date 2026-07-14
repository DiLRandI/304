import { randomUUID } from "node:crypto";
import type { RoomChangePublisher } from "./room-change-bus.js";

export interface PendingRoomNotification {
  readonly eventVersion: number;
  readonly id: number;
  readonly roomId: string;
}

export interface OutboxStore {
  claimRoomNotifications(
    owner: string,
    limit: number,
    roomId?: string,
  ): Promise<PendingRoomNotification[]>;
  countPendingRoomNotifications(): Promise<number>;
  markRoomNotificationPublished(id: number, owner: string): Promise<void>;
  releaseRoomNotification(
    id: number,
    owner: string,
    error: string,
  ): Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Room notification publish failed";
}

export class OutboxPublisher {
  private active: Promise<void> | undefined;
  private readonly ownerId: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dependencies: {
      store: OutboxStore;
      bus: RoomChangePublisher;
      pollIntervalMs: number;
      ownerId?: string;
      onPending?: (count: number) => void;
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

  async runOnce(): Promise<void> {
    if (this.active) return this.active;
    const work = this.publishPending();
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

  private async publishPending(): Promise<void> {
    const notifications = await this.dependencies.store.claimRoomNotifications(
      this.ownerId,
      32,
    );
    for (const notification of notifications) {
      await this.publishOne(notification);
    }
    this.dependencies.onPending?.(
      await this.dependencies.store.countPendingRoomNotifications(),
    );
  }

  private async publishOne(
    notification: PendingRoomNotification,
  ): Promise<void> {
    try {
      await this.dependencies.bus.publish({
        roomId: notification.roomId,
        eventVersion: notification.eventVersion,
      });
      await this.dependencies.store.markRoomNotificationPublished(
        notification.id,
        this.ownerId,
      );
    } catch (error) {
      await this.dependencies.store.releaseRoomNotification(
        notification.id,
        this.ownerId,
        errorMessage(error),
      );
    }
  }
}
