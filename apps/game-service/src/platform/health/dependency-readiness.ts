import type { RedisClientType } from "redis";
import type { Database } from "../postgres/database.js";

export function createReadiness(database: Database, redis: RedisClientType) {
  return {
    database: () => database.health(),
    async redis() {
      try {
        return (await redis.ping()) === "PONG";
      } catch {
        return false;
      }
    },
  };
}
