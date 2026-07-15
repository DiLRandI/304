import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { ServiceError } from "../../../../shared/service-error.js";
import type { RoomLease as RoomLeasePort } from "../../application/room-coordination-ports.js";

const RELEASE_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
const ROOM_LEASE_RETRY_DELAYS_MS = [25, 75, 150, 250] as const;

function redisKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export class RedisRoomLease implements RoomLeasePort {
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
