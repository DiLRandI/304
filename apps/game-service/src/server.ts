import { buildApp, loadConfig } from "./app.js";
import { RoomCoordinator } from "./domain/room-coordinator.js";
import { PostgresRoomStore } from "./domain/room-store.js";
import { SessionService } from "./domain/session-service.js";
import { createDatabase } from "./infra/database.js";
import { createReadiness } from "./infra/readiness.js";
import { createRedis } from "./infra/redis.js";
import {
  Presence,
  RateLimiter,
  RoomLease,
} from "./infra/redis-coordination.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const sessions = new SessionService(database, {
  pepper: config.SESSION_SECRET_PEPPER,
  ttlDays: config.SESSION_TTL_DAYS,
});
const game = {
  coordinator: new RoomCoordinator({
    store,
    lease: new RoomLease(redis, config.ROOM_LEASE_TTL_MS),
    presence: new Presence(redis, config.PRESENCE_TTL_SECONDS),
  }),
  sessions,
  rateLimiter: new RateLimiter(redis),
};
const app = await buildApp({
  config,
  readiness: createReadiness(database, redis),
  game,
});

let isClosing = false;
async function close(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  app.log.info({ signal }, "game service shutdown requested");
  await app.close();
  await redis.quit();
  await database.close();
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));
await app.listen({ host: config.HOST, port: config.PORT });
