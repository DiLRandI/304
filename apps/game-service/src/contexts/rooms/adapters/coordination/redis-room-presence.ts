import type { RedisClientType } from "redis";
import type { RoomPresence } from "../../application/room-coordination-ports.js";

function redisKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export class RedisRoomPresence implements RoomPresence {
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
