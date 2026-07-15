import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { LegacyGameplayAutomationExecutor } from "./contexts/automation/adapters/execution/legacy-gameplay-automation-executor.js";
import { LegacyGameplayAutomationScheduler } from "./contexts/automation/adapters/scheduling/legacy-gameplay-automation-scheduler.js";
import { LegacyGameplayRecovery } from "./contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.js";
import { RedisRoomLease } from "./contexts/rooms/adapters/coordination/redis-room-lease.js";
import { RedisRoomPresence } from "./contexts/rooms/adapters/coordination/redis-room-presence.js";
import { PostgresRoomStore } from "./contexts/rooms/adapters/persistence/postgres-room-store.js";
import { NodeRoomIdentityProvider } from "./contexts/rooms/adapters/security/node-room-identity-provider.js";
import { RoomMaintenance } from "./contexts/rooms/application/room-maintenance.js";
import { AutomationWorker } from "./delivery/workers/automation-worker.js";
import { createReadiness } from "./platform/health/dependency-readiness.js";
import {
  AutomationTelemetry,
  MaintenanceTelemetry,
  WorkerTelemetry,
} from "./platform/observability/redis-service-telemetry.js";
import { createDatabase } from "./platform/postgres/database.js";
import { createRedis } from "./platform/redis/redis-client.js";
import { RoomMaintenanceWorker } from "./worker/room-maintenance-worker.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const identities = new NodeRoomIdentityProvider();
const lease = new RedisRoomLease(redis, config.ROOM_LEASE_TTL_MS);
const presence = new RedisRoomPresence(redis, config.PRESENCE_TTL_SECONDS);
const automation = new LegacyGameplayAutomationScheduler({
  config: {
    botActionDelayMs: config.BOT_ACTION_DELAY_MS,
    disconnectGraceSeconds: config.DISCONNECT_GRACE_SECONDS,
  },
  identities,
  store,
});
const executor = new LegacyGameplayAutomationExecutor({
  automation,
  lease,
  presence,
  recovery: new LegacyGameplayRecovery(store),
  store,
});
const readiness = createReadiness(database, redis);
const telemetry = new AutomationTelemetry(redis);
const maintenanceTelemetry = new MaintenanceTelemetry(redis);
const workerTelemetry = new WorkerTelemetry(
  redis,
  undefined,
  config.AUTOMATION_POLL_INTERVAL_MS * 3 + 1_000,
);
const worker = new AutomationWorker({
  store,
  executor,
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
  onHealthyPoll: () => workerTelemetry.recordHeartbeat(),
});
const maintenance = new RoomMaintenance({
  batchSize: config.MAINTENANCE_BATCH_SIZE,
  closedRetentionDays: config.ROOM_CLOSED_RETENTION_DAYS,
  commandIds: { next: randomUUID },
  expiredSessionRevokeHours: config.EXPIRED_SESSION_REVOKE_HOURS,
  lobbyIdleHours: config.ROOM_LOBBY_IDLE_HOURS,
  store,
  terminalRetentionDays: config.ROOM_TERMINAL_RETENTION_DAYS,
});
const maintenanceWorker = new RoomMaintenanceWorker({
  maintenance,
  onRun: (result) => maintenanceTelemetry.record(result),
  pollIntervalMs: config.MAINTENANCE_POLL_INTERVAL_MS,
});

await Promise.all([worker.start(), maintenanceWorker.start()]);

let isClosing = false;
async function close(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  process.stdout.write(`automation worker shutdown requested: ${signal}\n`);
  await Promise.all([worker.stop(), maintenanceWorker.stop()]);
  await redis.quit();
  await database.close();
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));
