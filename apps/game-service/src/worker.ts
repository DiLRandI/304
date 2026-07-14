import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { NodeRoomInviteCodeProvider } from "./contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { RoomMaintenance } from "./contexts/rooms/application/room-maintenance.js";
import { RoomCoordinator } from "./domain/room-coordinator.js";
import { PostgresRoomStore } from "./domain/room-store.js";
import { createDatabase } from "./infra/database.js";
import { createReadiness } from "./infra/readiness.js";
import { createRedis } from "./infra/redis.js";
import {
  AutomationTelemetry,
  MaintenanceTelemetry,
  Presence,
  RoomLease,
  WorkerTelemetry,
} from "./infra/redis-coordination.js";
import { AutomationWorker } from "./worker/automation-worker.js";
import { RoomMaintenanceWorker } from "./worker/room-maintenance-worker.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const coordinator = new RoomCoordinator({
  inviteCodes: new NodeRoomInviteCodeProvider(),
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
const maintenanceTelemetry = new MaintenanceTelemetry(redis);
const workerTelemetry = new WorkerTelemetry(
  redis,
  undefined,
  config.AUTOMATION_POLL_INTERVAL_MS * 3 + 1_000,
);
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
