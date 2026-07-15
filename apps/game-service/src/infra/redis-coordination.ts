import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { ServiceError } from "../shared/service-error.js";

const RELEASE_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
const ROOM_LEASE_RETRY_DELAYS_MS = [25, 75, 150, 250] as const;
const AUTOMATION_OUTCOME_METRICS_KEY = "g304:metrics:automation-outcomes";
const MAINTENANCE_METRICS_KEY = "g304:metrics:maintenance";
const WORKER_HEARTBEAT_METRICS_KEY = "g304:metrics:worker-heartbeat";

export type AutomationOutcomeMetric = "completed" | "stale" | "failed";
export interface MaintenanceTelemetrySnapshot {
  closedRooms: number;
  purgedRooms: number;
  revokedSessions: number;
}

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
    for (let attempt = 0; ; attempt += 1) {
      const acquired = await this.redis.set(key, owner, {
        NX: true,
        PX: this.ttlMs,
      });
      if (acquired === "OK") {
        try {
          return await work();
        } finally {
          await this.redis.eval(RELEASE_LEASE_SCRIPT, {
            keys: [key],
            arguments: [owner],
          });
        }
      }

      const retryDelayMs = ROOM_LEASE_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs === undefined) {
        throw new ServiceError("ROOM_BUSY", 503, "Room is busy; retry shortly");
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelayMs);
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

function requireMaintenanceMetricValue(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "Maintenance metric values must be non-negative integers",
    );
  }
}

export class MaintenanceTelemetry {
  constructor(
    private readonly redis: RedisClientType,
    private readonly key = MAINTENANCE_METRICS_KEY,
  ) {}

  async record(result: MaintenanceTelemetrySnapshot): Promise<void> {
    requireMaintenanceMetricValue(result.revokedSessions);
    requireMaintenanceMetricValue(result.closedRooms);
    requireMaintenanceMetricValue(result.purgedRooms);
    const transaction = this.redis.multi();
    transaction.hIncrBy(this.key, "revoked_sessions", result.revokedSessions);
    transaction.hIncrBy(this.key, "closed_rooms", result.closedRooms);
    transaction.hIncrBy(this.key, "purged_rooms", result.purgedRooms);
    await transaction.exec();
  }

  async snapshot(): Promise<MaintenanceTelemetrySnapshot> {
    const values = await this.redis.hGetAll(this.key);
    const parse = (field: string): number => {
      const value = Number(values[field] ?? 0);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    return {
      closedRooms: parse("closed_rooms"),
      purgedRooms: parse("purged_rooms"),
      revokedSessions: parse("revoked_sessions"),
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
