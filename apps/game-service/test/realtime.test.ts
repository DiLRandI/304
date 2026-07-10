import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OutboxPublisher } from "../src/realtime/outbox-publisher.js";

describe("durable room outbox publisher", () => {
  it("publishes each claimed room version before acknowledging it", async () => {
    const store = {
      claimRoomNotifications: vi.fn().mockResolvedValue([
        {
          id: 42,
          roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
          eventVersion: 7,
        },
      ]),
      markRoomNotificationPublished: vi.fn().mockResolvedValue(undefined),
      releaseRoomNotification: vi.fn().mockResolvedValue(undefined),
    };
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisher({
      store,
      bus,
      pollIntervalMs: 250,
      ownerId: randomUUID(),
    });

    await publisher.runOnce();

    expect(bus.publish).toHaveBeenCalledWith({
      roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      eventVersion: 7,
    });
    expect(store.markRoomNotificationPublished).toHaveBeenCalledWith(
      42,
      expect.any(String),
    );
    expect(store.releaseRoomNotification).not.toHaveBeenCalled();
  });

  it("releases a claimed row when delivery fails so another publisher can retry", async () => {
    const store = {
      claimRoomNotifications: vi.fn().mockResolvedValue([
        {
          id: 43,
          roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
          eventVersion: 8,
        },
      ]),
      markRoomNotificationPublished: vi.fn().mockResolvedValue(undefined),
      releaseRoomNotification: vi.fn().mockResolvedValue(undefined),
    };
    const bus = { publish: vi.fn().mockRejectedValue(new Error("redis down")) };
    const publisher = new OutboxPublisher({
      store,
      bus,
      pollIntervalMs: 250,
      ownerId: randomUUID(),
    });

    await publisher.runOnce();

    expect(store.markRoomNotificationPublished).not.toHaveBeenCalled();
    expect(store.releaseRoomNotification).toHaveBeenCalledWith(
      43,
      expect.any(String),
      "redis down",
    );
  });

  it("drains immediately when it starts instead of waiting for its first interval", async () => {
    const store = {
      claimRoomNotifications: vi.fn().mockResolvedValue([]),
      markRoomNotificationPublished: vi.fn().mockResolvedValue(undefined),
      releaseRoomNotification: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = new OutboxPublisher({
      store,
      bus: { publish: vi.fn().mockResolvedValue(undefined) },
      pollIntervalMs: 60_000,
      ownerId: randomUUID(),
    });

    await publisher.start();
    await publisher.stop();

    expect(store.claimRoomNotifications).toHaveBeenCalledTimes(1);
  });
});
