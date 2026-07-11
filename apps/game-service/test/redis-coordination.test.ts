import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AutomationTelemetry,
  MaintenanceTelemetry,
  Presence,
  RateLimiter,
  RoomLease,
  WorkerTelemetry,
} from "../src/infra/redis-coordination.js";

const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
const describeIntegration = redisUrl ? describe : describe.skip;
let redis: RedisClientType;

describeIntegration("Redis game coordination", () => {
  beforeAll(async () => {
    redis = createClient({ url: redisUrl });
    await redis.connect();
  });

  afterAll(async () => redis.quit());

  it("does not execute a room mutation when another owner holds its lease", async () => {
    const roomId = randomUUID();
    await redis.set(`g304:lease:${roomId}`, "other-owner", { PX: 5_000 });
    const lease = new RoomLease(redis, 5_000);

    await expect(
      lease.withLease(roomId, async () => "accepted"),
    ).rejects.toMatchObject({
      code: "ROOM_BUSY",
      statusCode: 503,
    });
  });

  it("releases only its own lease and tracks expiring presence", async () => {
    const roomId = randomUUID();
    const playerId = randomUUID();
    const lease = new RoomLease(redis, 5_000);
    const presence = new Presence(redis, 30);

    await expect(lease.withLease(roomId, async () => "accepted")).resolves.toBe(
      "accepted",
    );
    await expect(
      lease.withLease(roomId, async () => "accepted-again"),
    ).resolves.toBe("accepted-again");
    await presence.touch(roomId, playerId);
    await expect(presence.onlinePlayerIds(roomId, [playerId])).resolves.toEqual(
      new Set([playerId]),
    );
    await presence.remove(roomId, playerId);
    await expect(presence.onlinePlayerIds(roomId, [playerId])).resolves.toEqual(
      new Set(),
    );
  });

  it("limits a subject after the configured fixed window capacity", async () => {
    const limiter = new RateLimiter(redis);
    const scope = `test-${randomUUID()}`;

    await expect(
      limiter.consume(scope, "player", 2, 60),
    ).resolves.toBeUndefined();
    await expect(
      limiter.consume(scope, "player", 2, 60),
    ).resolves.toBeUndefined();
    await expect(limiter.consume(scope, "player", 2, 60)).rejects.toMatchObject(
      {
        code: "RATE_LIMITED",
        statusCode: 429,
      },
    );
  });

  it("stores durable automation outcome totals for service metrics", async () => {
    const key = `g304:test:automation-outcomes:${randomUUID()}`;
    const telemetry = new AutomationTelemetry(redis, key);

    await expect(telemetry.snapshot()).resolves.toEqual({
      completed: 0,
      failed: 0,
      stale: 0,
    });
    await telemetry.record("completed");
    await telemetry.record("completed");
    await telemetry.record("stale");

    await expect(telemetry.snapshot()).resolves.toEqual({
      completed: 2,
      failed: 0,
      stale: 1,
    });
    await redis.del(key);
  });

  it("publishes a bounded worker heartbeat age for service metrics", async () => {
    const key = `g304:test:worker-heartbeat:${randomUUID()}`;
    const telemetry = new WorkerTelemetry(redis, key, 30_000);

    await expect(telemetry.ageSeconds(1_700_000_000_000)).resolves.toBe(
      Infinity,
    );
    await telemetry.recordHeartbeat(1_700_000_000_000);
    await expect(telemetry.ageSeconds(1_700_000_005_000)).resolves.toBe(5);
    await expect(telemetry.ageSeconds(1_699_999_999_000)).resolves.toBe(0);

    await redis.del(key);
  });

  it("stores only bounded aggregate maintenance totals", async () => {
    const key = `g304:test:maintenance:${randomUUID()}`;
    const telemetry = new MaintenanceTelemetry(redis, key);

    await expect(telemetry.snapshot()).resolves.toEqual({
      closedRooms: 0,
      purgedRooms: 0,
      revokedSessions: 0,
    });
    await telemetry.record({
      closedRooms: 2,
      purgedRooms: 1,
      revokedSessions: 3,
    });
    await expect(telemetry.snapshot()).resolves.toEqual({
      closedRooms: 2,
      purgedRooms: 1,
      revokedSessions: 3,
    });
    await expect(
      telemetry.record({
        closedRooms: -1,
        purgedRooms: 0,
        revokedSessions: 0,
      }),
    ).rejects.toThrow(
      "Maintenance metric values must be non-negative integers",
    );

    await redis.del(key);
  });
});
