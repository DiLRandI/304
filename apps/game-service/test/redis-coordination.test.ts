import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Presence,
  RateLimiter,
  RoomLease,
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
});
