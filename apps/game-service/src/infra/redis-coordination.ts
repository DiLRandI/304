import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { DomainError } from "../domain/errors.js";

const RELEASE_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
const FIXED_WINDOW_INCREMENT_SCRIPT =
  "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return count";

function redisKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export class RoomLease {
  constructor(
    private readonly redis: RedisClientType,
    private readonly ttlMs: number,
  ) {}

  async withLease<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const key = `g304:lease:${redisKeyPart(roomId)}`;
    const owner = randomUUID();
    const acquired = await this.redis.set(key, owner, {
      NX: true,
      PX: this.ttlMs,
    });
    if (acquired !== "OK") {
      throw new DomainError("ROOM_BUSY", 503, "Room is busy; retry shortly");
    }
    try {
      return await work();
    } finally {
      await this.redis.eval(RELEASE_LEASE_SCRIPT, {
        keys: [key],
        arguments: [owner],
      });
    }
  }
}

export class Presence {
  constructor(
    private readonly redis: RedisClientType,
    private readonly ttlSeconds: number,
  ) {}

  async touch(roomId: string, playerId: string): Promise<void> {
    await this.redis.set(
      `g304:presence:${redisKeyPart(roomId)}:${redisKeyPart(playerId)}`,
      "1",
      { EX: this.ttlSeconds },
    );
  }

  async onlinePlayerIds(
    roomId: string,
    playerIds: readonly string[],
  ): Promise<Set<string>> {
    if (playerIds.length === 0) return new Set();
    const keys = playerIds.map(
      (playerId) =>
        `g304:presence:${redisKeyPart(roomId)}:${redisKeyPart(playerId)}`,
    );
    const values = await this.redis.mGet(keys);
    return new Set(
      playerIds.filter((_playerId, index) => values[index] === "1"),
    );
  }
}

export class RateLimiter {
  constructor(private readonly redis: RedisClientType) {}

  async consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `g304:rate:${redisKeyPart(scope)}:${redisKeyPart(subject)}`;
    const count = Number(
      await this.redis.eval(FIXED_WINDOW_INCREMENT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      }),
    );
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new DomainError(
        "RATE_LIMIT_UNAVAILABLE",
        503,
        "Rate limit is unavailable",
      );
    }
    if (count > limit) {
      throw new DomainError(
        "RATE_LIMITED",
        429,
        "Too many requests; retry shortly",
      );
    }
  }
}
