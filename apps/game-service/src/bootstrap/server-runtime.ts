import { DomainStartedRoomAutomationFactory } from "../contexts/automation/adapters/integration/domain-started-room-automation-factory.js";
import { GameplayAutomationScheduler } from "../contexts/automation/application/gameplay-automation-scheduler.js";
import { NodeGameplayDealerSelector } from "../contexts/gameplay/adapters/entropy/node-gameplay-dealer-selector.js";
import { SecureGameplayHandShuffler } from "../contexts/gameplay/adapters/entropy/secure-gameplay-hand-shuffler.js";
import { DomainGameplayCommandExecutor } from "../contexts/gameplay/adapters/integration/domain-gameplay-command-executor.js";
import { DomainGameplayRecovery } from "../contexts/gameplay/adapters/persistence/domain-gameplay-recovery.js";
import { SubmitGameplayCommandHandler } from "../contexts/gameplay/application/submit-gameplay-command.js";
import { RedisRoomLease } from "../contexts/rooms/adapters/coordination/redis-room-lease.js";
import { RedisRoomPresence } from "../contexts/rooms/adapters/coordination/redis-room-presence.js";
import { LobbyRoomProjectionPresenter } from "../contexts/rooms/adapters/delivery/lobby-room-presenter.js";
import { DomainRoomConnections } from "../contexts/rooms/adapters/integration/domain-room-connections.js";
import { DomainStartedRoomSnapshotFactory } from "../contexts/rooms/adapters/integration/domain-started-room-snapshot-factory.js";
import { DurableRoomCreationRepository } from "../contexts/rooms/adapters/integration/durable-room-creation-repository.js";
import { GameplayRoomProjectionReader } from "../contexts/rooms/adapters/integration/gameplay-room-projection-reader.js";
import { RoomProjectionQueryAdapter } from "../contexts/rooms/adapters/orchestration/room-projection-query-adapter.js";
import { PostgresRoomCommandRepository } from "../contexts/rooms/adapters/persistence/postgres-room-command-repository.js";
import { PostgresRoomStore } from "../contexts/rooms/adapters/persistence/postgres-room-store.js";
import { NodeRoomIdentityProvider } from "../contexts/rooms/adapters/security/node-room-identity-provider.js";
import { NodeRoomInviteCodeProvider } from "../contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { CreateRoomHandler } from "../contexts/rooms/application/create-room.js";
import { ExecuteRoomCommandHandler } from "../contexts/rooms/application/execute-room-command.js";
import {
  GetRoomHandler,
  GetRoomSnapshotHandler,
} from "../contexts/rooms/application/get-room-projection.js";
import { JoinRoomHandler } from "../contexts/rooms/application/join-room.js";
import { LeaveRoomHandler } from "../contexts/rooms/application/leave-room.js";
import { StartRoomHandler } from "../contexts/rooms/application/start-room.js";
import { buildApp } from "../delivery/http/http-app.js";
import { RoomSocketHub } from "../delivery/realtime/room-socket-hub.js";
import { OutboxPublisher } from "../delivery/workers/outbox-publisher.js";
import { loadConfig } from "../platform/config/service-config.js";
import { createReadiness } from "../platform/health/dependency-readiness.js";
import {
  AutomationTelemetry,
  MaintenanceTelemetry,
  WorkerTelemetry,
} from "../platform/observability/redis-service-telemetry.js";
import { createMetrics } from "../platform/observability/service-metrics.js";
import { createDatabase } from "../platform/postgres/database.js";
import { createRedis } from "../platform/redis/redis-client.js";
import { RedisRoomChangeBus } from "../platform/redis/redis-room-change-bus.js";
import { RateLimiter } from "../platform/redis/request-rate-limiter.js";
import { createPlayerAccessService } from "./player-access.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = await createRedis(config.REDIS_URL);
const store = new PostgresRoomStore(database);
const sessions = createPlayerAccessService(database, {
  pepper: config.SESSION_SECRET_PEPPER,
  ttlDays: config.SESSION_TTL_DAYS,
});
const presence = new RedisRoomPresence(redis, config.PRESENCE_TTL_SECONDS);
const identities = new NodeRoomIdentityProvider();
const inviteCodes = new NodeRoomInviteCodeProvider();
const roomLease = new RedisRoomLease(redis, config.ROOM_LEASE_TTL_MS);
const gameplayRecovery = new DomainGameplayRecovery(store);
const gameplayShuffler = new SecureGameplayHandShuffler();
const gameplayAutomation = new GameplayAutomationScheduler({
  config: {
    botActionDelayMs: config.BOT_ACTION_DELAY_MS,
    disconnectGraceSeconds: config.DISCONNECT_GRACE_SECONDS,
  },
  identities,
  store,
});
const connections = new DomainRoomConnections({
  automation: gameplayAutomation,
  identities,
  lease: roomLease,
  presence,
  recovery: gameplayRecovery,
  store,
});
const roomCommands = new ExecuteRoomCommandHandler(
  new PostgresRoomCommandRepository(
    database,
    new DomainStartedRoomSnapshotFactory(
      new NodeGameplayDealerSelector(),
      gameplayShuffler,
    ),
    new DomainStartedRoomAutomationFactory(
      identities,
      () => new Date(),
      config.BOT_ACTION_DELAY_MS,
    ),
  ),
);
const roomQueries = new RoomProjectionQueryAdapter({
  activeRoomProjection: new GameplayRoomProjectionReader({
    recovery: gameplayRecovery,
    store,
  }),
  lease: roomLease,
  lobbyProjection: new LobbyRoomProjectionPresenter(),
  store,
});
const roomPresence = {
  refresh: connections.markRealtimePresence.bind(connections),
};
const gameplayCommands = new DomainGameplayCommandExecutor({
  automation: gameplayAutomation,
  lease: roomLease,
  recovery: gameplayRecovery,
  shuffler: gameplayShuffler,
  store,
});
const getRoomSnapshot = new GetRoomSnapshotHandler(roomQueries, roomPresence);
const game = {
  gameplayUseCases: {
    submit: new SubmitGameplayCommandHandler(gameplayCommands, roomPresence),
  },
  roomUseCases: {
    create: new CreateRoomHandler(
      new DurableRoomCreationRepository(store),
      presence,
      identities,
      inviteCodes,
    ),
    get: new GetRoomHandler(roomQueries, roomPresence),
    join: new JoinRoomHandler(roomCommands, presence),
    leave: new LeaveRoomHandler(roomCommands, presence),
    snapshot: getRoomSnapshot,
    start: new StartRoomHandler(roomCommands, presence),
  },
  sessions,
  rateLimiter: new RateLimiter(redis),
};
const metrics = createMetrics();
const automationTelemetry = new AutomationTelemetry(redis);
const maintenanceTelemetry = new MaintenanceTelemetry(redis);
const workerTelemetry = new WorkerTelemetry(redis);
const roomChanges = new RedisRoomChangeBus(redis);
const hub = new RoomSocketHub({
  connections,
  onConnectionCount: (count) => metrics.activeWebsocketConnections.set(count),
  snapshot: getRoomSnapshot,
});
await roomChanges.start((notice) => hub.handleRoomChanged(notice));
const outboxPublisher = new OutboxPublisher({
  store,
  bus: roomChanges,
  pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
  onPending: (count) => metrics.pendingRoomOutbox.set(count),
});
const refreshMetrics = async (): Promise<void> => {
  const [
    outboxPending,
    automationPending,
    outcomes,
    workerHeartbeatAge,
    maintenance,
  ] = await Promise.all([
    store.countPendingRoomNotifications(),
    store.countPendingAutomationJobs(),
    automationTelemetry.snapshot(),
    workerTelemetry.ageSeconds(),
    maintenanceTelemetry.snapshot(),
  ]);
  metrics.pendingRoomOutbox.set(outboxPending);
  metrics.pendingAutomationJobs.set(automationPending);
  for (const outcome of ["completed", "stale", "failed"] as const) {
    metrics.automationJobOutcomes.set({ outcome }, outcomes[outcome]);
  }
  metrics.workerHeartbeatAgeSeconds.set(workerHeartbeatAge);
  metrics.maintenanceSessionsRevokedTotal.set(maintenance.revokedSessions);
  metrics.maintenanceRoomsClosedTotal.set(maintenance.closedRooms);
  metrics.maintenanceRoomsPurgedTotal.set(maintenance.purgedRooms);
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
