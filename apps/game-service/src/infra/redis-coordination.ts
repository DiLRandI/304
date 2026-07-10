import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { DomainError } from "../domain/errors.js";

const RELEASE_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
const FIXED_WINDOW_INCREMENT_SCRIPT =
  "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return count";
const AUTOMATION_OUTCOME_METRICS_KEY = "g304:metrics:automation-outcomes";
const WORKER_HEARTBEAT_METRICS_KEY = "g304:metrics:worker-heartbeat";

export type AutomationOutcomeMetric = "completed" | "stale" | "failed";

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

  async remove(roomId: string, playerId: string): Promise<void> {
    await this.redis.del(
      `g304:presence:${redisKeyPart(roomId)}:${redisKeyPart(playerId)}`,
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
  constructor(
    private readonly redis: RedisClientType,
    private readonly keyPrefix = "g304",
  ) {}

  async consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `${this.keyPrefix}:rate:${redisKeyPart(scope)}:${redisKeyPart(subject)}`;
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

export class AutomationTelemetry {
  constructor(
    private readonly redis: RedisClientType,
    private readonly key = AUTOMATION_OUTCOME_METRICS_KEY,
  ) {}

  async record(outcome: AutomationOutcomeMetric): Promise<void> {
    await this.redis.hIncrBy(this.key, outcome, 1);
  }

  async snapshot(): Promise<Record<AutomationOutcomeMetric, number>> {
    const values = await this.redis.hGetAll(this.key);
    const parse = (outcome: AutomationOutcomeMetric): number => {
      const value = Number(values[outcome] ?? 0);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    return {
      completed: parse("completed"),
      stale: parse("stale"),
      failed: parse("failed"),
    };
  }
}

export class WorkerTelemetry {
  constructor(
    private readonly redis: RedisClientType,
    private readonly key = WORKER_HEARTBEAT_METRICS_KEY,
    private readonly ttlMs = 90_000,
  ) {}

  async recordHeartbeat(timestampMs = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) return;
    await this.redis.set(this.key, String(timestampMs), {
      PX: Math.max(1_000, this.ttlMs),
    });
  }

  async ageSeconds(nowMs = Date.now()): Promise<number> {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return Infinity;
    const raw = await this.redis.get(this.key);
    if (raw === null) return Infinity;
    const timestampMs = Number(raw);
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) return Infinity;
    return Math.max(0, (nowMs - timestampMs) / 1_000);
  }
}
