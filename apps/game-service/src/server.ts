import { buildApp, loadConfig } from "./app.js";
import { RoomCoordinator } from "./domain/room-coordinator.js";
import { PostgresRoomStore } from "./domain/room-store.js";
import { SessionService } from "./domain/session-service.js";
import { createDatabase } from "./infra/database.js";
import { createReadiness } from "./infra/readiness.js";
import { createRedis } from "./infra/redis.js";
import {
  AutomationTelemetry,
  Presence,
  RateLimiter,
  RoomLease,
} from "./infra/redis-coordination.js";
import { createMetrics } from "./metrics.js";
import { OutboxPublisher } from "./realtime/outbox-publisher.js";
import { RedisRoomChangeBus } from "./realtime/room-change-bus.js";
import { RoomSocketHub } from "./realtime/room-socket-hub.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const sessions = new SessionService(database, {
  pepper: config.SESSION_SECRET_PEPPER,
  ttlDays: config.SESSION_TTL_DAYS,
});
const coordinator = new RoomCoordinator({
  store,
  lease: new RoomLease(redis, config.ROOM_LEASE_TTL_MS),
  presence: new Presence(redis, config.PRESENCE_TTL_SECONDS),
  automation: {
    botActionDelayMs: config.BOT_ACTION_DELAY_MS,
    disconnectGraceSeconds: config.DISCONNECT_GRACE_SECONDS,
  },
});
const game = {
  coordinator,
  sessions,
  rateLimiter: new RateLimiter(redis),
};
const metrics = createMetrics();
const automationTelemetry = new AutomationTelemetry(redis);
const roomChanges = new RedisRoomChangeBus(redis);
const hub = new RoomSocketHub({
  coordinator,
  onConnectionCount: (count) => metrics.activeWebsocketConnections.set(count),
});
await roomChanges.start((notice) => hub.handleRoomChanged(notice));
const outboxPublisher = new OutboxPublisher({
  store,
  bus: roomChanges,
  pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
  onPending: (count) => metrics.pendingRoomOutbox.set(count),
});
const refreshMetrics = async (): Promise<void> => {
  const [outboxPending, automationPending, outcomes] = await Promise.all([
    store.countPendingRoomNotifications(),
    store.countPendingAutomationJobs(),
    automationTelemetry.snapshot(),
  ]);
  metrics.pendingRoomOutbox.set(outboxPending);
  metrics.pendingAutomationJobs.set(automationPending);
  for (const outcome of ["completed", "stale", "failed"] as const) {
    metrics.automationJobOutcomes.set({ outcome }, outcomes[outcome]);
  }
};
let realtimeStopped = false;
const realtime = {
  hub,
  async stop(): Promise<void> {
    if (realtimeStopped) return;
    realtimeStopped = true;
    await outboxPublisher.stop();
    await hub.close();
    await roomChanges.close();
  },
};
const app = await buildApp({
  config,
  readiness: createReadiness(database, redis),
  game,
  realtime,
  metrics,
  refreshMetrics,
});
await outboxPublisher.start();

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
