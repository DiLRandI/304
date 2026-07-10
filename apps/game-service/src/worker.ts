import { loadConfig } from "./config.js";
import { RoomCoordinator } from "./domain/room-coordinator.js";
import { PostgresRoomStore } from "./domain/room-store.js";
import { createDatabase } from "./infra/database.js";
import { createReadiness } from "./infra/readiness.js";
import { createRedis } from "./infra/redis.js";
import {
  AutomationTelemetry,
  Presence,
  RoomLease,
} from "./infra/redis-coordination.js";
import { AutomationWorker } from "./worker/automation-worker.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const coordinator = new RoomCoordinator({
  store,
  lease: new RoomLease(redis, config.ROOM_LEASE_TTL_MS),
  presence: new Presence(redis, config.PRESENCE_TTL_SECONDS),
  automation: {
    botActionDelayMs: config.BOT_ACTION_DELAY_MS,
    disconnectGraceSeconds: config.DISCONNECT_GRACE_SECONDS,
  },
});
const readiness = createReadiness(database, redis);
const telemetry = new AutomationTelemetry(redis);
const worker = new AutomationWorker({
  store,
  coordinator,
  pollIntervalMs: config.AUTOMATION_POLL_INTERVAL_MS,
  health: async () => {
    const [databaseHealthy, redisHealthy] = await Promise.all([
      readiness.database(),
      readiness.redis(),
    ]);
    return databaseHealthy && redisHealthy;
  },
  heartbeatPath: "/tmp/g304-worker-heartbeat",
  onJob: (outcome) => telemetry.record(outcome),
});

await worker.start();

let isClosing = false;
async function close(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  process.stdout.write(`automation worker shutdown requested: ${signal}\n`);
  await worker.stop();
  await redis.quit();
  await database.close();
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));
