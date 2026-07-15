import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RealtimeServerMessageSchema } from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { createPlayerAccessService } from "../src/bootstrap/player-access.js";
import { LegacyStartedRoomAutomationFactory } from "../src/contexts/automation/adapters/integration/legacy-started-room-automation-factory.js";
import { LegacyGameplayAutomationScheduler } from "../src/contexts/automation/adapters/scheduling/legacy-gameplay-automation-scheduler.js";
import { LegacyGameplayCommandExecutor } from "../src/contexts/gameplay/adapters/integration/legacy-gameplay-command-executor.js";
import { LegacyGameplayConnections } from "../src/contexts/gameplay/adapters/integration/legacy-gameplay-connections.js";
import { LegacyGameplayRecovery } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.js";
import { SubmitGameplayCommandHandler } from "../src/contexts/gameplay/application/submit-gameplay-command.js";
import { RedisRoomLease } from "../src/contexts/rooms/adapters/coordination/redis-room-lease.js";
import { RedisRoomPresence } from "../src/contexts/rooms/adapters/coordination/redis-room-presence.js";
import { LobbyRoomProjectionPresenter } from "../src/contexts/rooms/adapters/delivery/lobby-room-presenter.js";
import { GameplayRoomProjectionReader } from "../src/contexts/rooms/adapters/integration/gameplay-room-projection-reader.js";
import { LegacyRoomCreationRepository } from "../src/contexts/rooms/adapters/integration/legacy-room-creation-repository.js";
import { LegacyStartedRoomSnapshotFactory } from "../src/contexts/rooms/adapters/integration/legacy-started-room-snapshot-factory.js";
import { RoomProjectionQueryAdapter } from "../src/contexts/rooms/adapters/orchestration/room-projection-query-adapter.js";
import { PostgresRoomCommandRepository } from "../src/contexts/rooms/adapters/persistence/postgres-room-command-repository.js";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import { NodeRoomIdentityProvider } from "../src/contexts/rooms/adapters/security/node-room-identity-provider.js";
import { NodeRoomInviteCodeProvider } from "../src/contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { CreateRoomHandler } from "../src/contexts/rooms/application/create-room.js";
import { ExecuteRoomCommandHandler } from "../src/contexts/rooms/application/execute-room-command.js";
import {
  GetRoomHandler,
  GetRoomSnapshotHandler,
} from "../src/contexts/rooms/application/get-room-projection.js";
import { JoinRoomHandler } from "../src/contexts/rooms/application/join-room.js";
import { LeaveRoomHandler } from "../src/contexts/rooms/application/leave-room.js";
import { StartRoomHandler } from "../src/contexts/rooms/application/start-room.js";
import { buildApp } from "../src/delivery/http/http-app.js";
import { RoomSocketHub } from "../src/delivery/realtime/room-socket-hub.js";
import { OutboxPublisher } from "../src/delivery/workers/outbox-publisher.js";
import { loadConfig } from "../src/platform/config/service-config.js";
import {
  createDatabase,
  type Database,
} from "../src/platform/postgres/database.js";
import {
  RedisRoomChangeBus,
  ROOM_CHANGED_CHANNEL,
} from "../src/platform/redis/redis-room-change-bus.js";
import { RateLimiter } from "../src/platform/redis/request-rate-limiter.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
const describeIntegration = databaseUrl && redisUrl ? describe : describe.skip;
const origin = "http://127.0.0.1:3000";
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

interface DurableProjection {
  roomId: string;
  inviteCode: string;
  eventVersion: number;
  viewerSeatIndex: number | null;
  view: {
    publicState?: { activeSeat: number | null };
    privateSeat?: { hand: Array<{ cardId: string }> };
    legalActions?: Array<Record<string, unknown>>;
  };
}

interface SocketLike {
  close(code?: number, reason?: string): void;
  off(event: string, listener: (...args: never[]) => void): void;
  once(
    event: string,
    listener: (value: Buffer | ArrayBuffer | Buffer[] | Error) => void,
  ): void;
  send(data: string): void;
  terminate(): void;
}

interface TestRuntime {
  app: Awaited<ReturnType<typeof buildApp>>;
  database: Database;
  publisher: OutboxPublisher;
  redis: RedisClientType;
  roomChanges: RedisRoomChangeBus;
}

let runtime: TestRuntime | undefined;

async function buildRealtimeApp(): Promise<TestRuntime> {
  const database = createDatabase(databaseUrl);
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  await runMigrations(database, migrationsDir);
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "4100",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: origin,
    SESSION_COOKIE_NAME: "g304_session",
    SESSION_SECRET_PEPPER:
      "test-only-session-pepper-must-be-at-least-32-characters",
  });
  const store = new PostgresRoomStore(database);
  const sessions = createPlayerAccessService(database, {
    pepper: config.SESSION_SECRET_PEPPER,
    ttlDays: config.SESSION_TTL_DAYS,
  });
  const presence = new RedisRoomPresence(redis, config.PRESENCE_TTL_SECONDS);
  const identities = new NodeRoomIdentityProvider();
  const inviteCodes = new NodeRoomInviteCodeProvider();
  const roomLease = new RedisRoomLease(redis, config.ROOM_LEASE_TTL_MS);
  const gameplayRecovery = new LegacyGameplayRecovery(store);
  const gameplayAutomation = new LegacyGameplayAutomationScheduler({
    config: {
      botActionDelayMs: config.BOT_ACTION_DELAY_MS,
      disconnectGraceSeconds: config.DISCONNECT_GRACE_SECONDS,
    },
    identities,
    store,
  });
  const connections = new LegacyGameplayConnections({
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
      new LegacyStartedRoomSnapshotFactory(),
      new LegacyStartedRoomAutomationFactory(
        identities,
        () => new Date(),
        config.BOT_ACTION_DELAY_MS,
      ),
    ),
  );
  const roomQueries = new RoomProjectionQueryAdapter({
    activeRoomProjection: new GameplayRoomProjectionReader(gameplayRecovery),
    lease: roomLease,
    lobbyProjection: new LobbyRoomProjectionPresenter(),
    store,
  });
  const roomPresence = {
    refresh: connections.markRealtimePresence.bind(connections),
  };
  const gameplayCommands = new LegacyGameplayCommandExecutor({
    automation: gameplayAutomation,
    lease: roomLease,
    lobbyProjection: new LobbyRoomProjectionPresenter(),
    recovery: gameplayRecovery,
    store,
  });
  const getRoomSnapshot = new GetRoomSnapshotHandler(roomQueries, roomPresence);
  const roomChanges = new RedisRoomChangeBus(redis);
  const hub = new RoomSocketHub({
    connections,
    snapshot: getRoomSnapshot,
  });
  await roomChanges.start((notice) => hub.handleRoomChanged(notice));
  const publisher = new OutboxPublisher({
    store,
    bus: roomChanges,
    pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
  });
  const app = await buildApp({
    config,
    readiness: { database: () => database.health(), redis: async () => true },
    game: {
      gameplayUseCases: {
        submit: new SubmitGameplayCommandHandler(
          gameplayCommands,
          roomPresence,
        ),
      },
      roomUseCases: {
        create: new CreateRoomHandler(
          new LegacyRoomCreationRepository(store),
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
      rateLimiter: new RateLimiter(redis, `g304:test:${randomUUID()}`),
    },
    realtime: {
      hub,
      stop: async () => {
        await publisher.stop();
        await roomChanges.close();
        await hub.close();
      },
    },
  });
  await publisher.start();
  return { app, database, publisher, redis, roomChanges };
}

async function closeRuntime(): Promise<void> {
  if (!runtime) return;
  await runtime.app.close();
  await runtime.redis.quit();
  await runtime.database.close();
  runtime = undefined;
}

function cookieFrom(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const setCookie = response.headers["set-cookie"];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie");
  return value.split(";", 1)[0] ?? "";
}

function nextMessage(socket: SocketLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[] | Error) => {
      cleanup();
      if (data instanceof Error) {
        reject(data);
        return;
      }
      if (Array.isArray(data)) {
        resolve(Buffer.concat(data));
        return;
      }
      resolve(Buffer.from(data));
    };
    const onError = (error: Buffer | ArrayBuffer | Buffer[] | Error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("Socket failed"));
    };
    const cleanup = () => {
      socket.off("message", onMessage as (...args: never[]) => void);
      socket.off("error", onError as (...args: never[]) => void);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error("Timed out while waiting for realtime state");
}

async function createGuest(app: TestRuntime["app"], displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/guest-sessions",
    headers: { origin },
    payload: { displayName },
  });
  expect(response.statusCode).toBe(201);
  return {
    cookie: cookieFrom(response),
    playerId: (response.json() as { player: { id: string } }).player.id,
  };
}

async function openRoomSocket(
  app: TestRuntime["app"],
  roomId: string,
  cookie: string,
): Promise<{ socket: SocketLike; initial: Promise<Buffer> }> {
  let initial: Promise<Buffer> | undefined;
  const socket = (await app.injectWS(
    `/v1/realtime/rooms/${roomId}`,
    { headers: { cookie, origin } },
    {
      onOpen: (opened) => {
        initial = nextMessage(opened as unknown as SocketLike);
      },
    },
  )) as unknown as SocketLike;
  if (!initial) throw new Error("Expected an initialized room socket");
  return { socket, initial };
}

async function createStartedRoom(app: TestRuntime["app"]) {
  const host = await createGuest(app, "Asha");
  const created = await app.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: { origin, cookie: host.cookie },
    payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
  });
  expect(created.statusCode).toBe(201);
  const room = created.json() as DurableProjection;
  const guests = await Promise.all(
    ["Bimal", "Chitra", "Dilan"].map((displayName) =>
      createGuest(app, displayName),
    ),
  );
  let eventVersion = room.eventVersion;
  for (const guest of guests) {
    const joined = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: guest.cookie },
      payload: { commandId: randomUUID(), expectedVersion: eventVersion },
    });
    expect(joined.statusCode).toBe(200);
    eventVersion = (joined.json() as DurableProjection).eventVersion;
  }
  const started = await app.inject({
    method: "POST",
    url: `/v1/rooms/${room.roomId}/start`,
    headers: { origin, cookie: host.cookie },
    payload: { commandId: randomUUID(), expectedVersion: eventVersion },
  });
  expect(started.statusCode).toBe(200);
  return {
    guests,
    host,
    room,
    started: started.json() as DurableProjection,
  };
}

afterEach(async () => closeRuntime());

describeIntegration("private room realtime delivery", () => {
  it("ignores malformed Redis notices without dropping later room changes", async () => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    const roomChanges = new RedisRoomChangeBus(redis);
    const notices: Array<{ roomId: string; eventVersion: number }> = [];
    try {
      await roomChanges.start(async (notice) => {
        notices.push(notice);
      });
      await redis.publish(ROOM_CHANGED_CHANNEL, "not-json");
      await roomChanges.publish({
        roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        eventVersion: 7,
      });
      await waitFor(async () => notices.length === 1);
      expect(notices).toEqual([
        {
          roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
          eventVersion: 7,
        },
      ]);
    } finally {
      await roomChanges.close();
      await redis.quit();
    }
  });

  it("authenticates a room socket and sends only its viewer-specific snapshot", async () => {
    runtime = await buildRealtimeApp();
    const { guests, room, started } = await createStartedRoom(runtime.app);
    const guest = guests[0];
    if (!guest) throw new Error("Expected a guest");
    const hostCard = started.view.privateSeat?.hand[0]?.cardId;
    if (!hostCard) throw new Error("Expected a host private card");

    await expect(
      runtime.app.injectWS(`/v1/realtime/rooms/${room.roomId}`, {
        headers: {
          cookie: guest.cookie,
          origin: "https://not-allowed.example",
        },
      }),
    ).rejects.toThrow("403");

    const { socket, initial } = await openRoomSocket(
      runtime.app,
      room.roomId,
      guest.cookie,
    );
    const message = RealtimeServerMessageSchema.parse(
      JSON.parse((await initial).toString()),
    );

    expect(message.type).toBe("SNAPSHOT");
    expect(JSON.stringify(message)).not.toContain(hostCard);
    const presenceKey = `g304:presence:${encodeURIComponent(room.roomId)}:${encodeURIComponent(guest.playerId)}`;
    await runtime.redis.del(presenceKey);
    socket.send(JSON.stringify({ type: "PING" }));
    await waitFor(async () => (await runtime.redis.get(presenceKey)) === "1");
    const malformed = nextMessage(socket);
    socket.send("not-json");
    expect(
      RealtimeServerMessageSchema.parse(
        JSON.parse((await malformed).toString()),
      ),
    ).toMatchObject({ type: "ERROR", code: "INVALID_MESSAGE" });
  });

  it("keeps a human online until their last local room socket closes", async () => {
    runtime = await buildRealtimeApp();
    const { guests, room } = await createStartedRoom(runtime.app);
    const guest = guests[0];
    if (!guest) throw new Error("Expected a guest");
    const first = await openRoomSocket(runtime.app, room.roomId, guest.cookie);
    const second = await openRoomSocket(runtime.app, room.roomId, guest.cookie);
    await Promise.all([first.initial, second.initial]);

    first.socket.terminate();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await expect(
      runtime.database.query<{ connection_status: string }>(
        "SELECT connection_status FROM room_seats WHERE room_id = $1 AND seat_index = 1",
        [room.roomId],
      ),
    ).resolves.toEqual({ rows: [{ connection_status: "online" }] });

    second.socket.terminate();
    await waitFor(async () => {
      const seat = await runtime.database.query<{ connection_status: string }>(
        "SELECT connection_status FROM room_seats WHERE room_id = $1 AND seat_index = 1",
        [room.roomId],
      );
      return seat.rows[0]?.connection_status === "disconnected";
    });
  });

  it("fans a committed room version to independent clients and supports explicit resync", async () => {
    runtime = await buildRealtimeApp();
    const { guests, host, room, started } = await createStartedRoom(
      runtime.app,
    );
    const guest = guests[0];
    if (!guest) throw new Error("Expected a guest");
    const { socket: hostSocket, initial: hostInitial } = await openRoomSocket(
      runtime.app,
      room.roomId,
      host.cookie,
    );
    const { socket: guestSocket, initial: guestInitial } = await openRoomSocket(
      runtime.app,
      room.roomId,
      guest.cookie,
    );
    await Promise.all([hostInitial, guestInitial]);

    const players = [host, ...guests];
    let active: { cookie: string; projection: DurableProjection } | undefined;
    for (const player of players) {
      const snapshot = await runtime.app.inject({
        method: "GET",
        url: `/v1/rooms/${room.roomId}/snapshot`,
        headers: { cookie: player.cookie },
      });
      const projection = snapshot.json() as DurableProjection;
      if (
        projection.viewerSeatIndex === projection.view.publicState?.activeSeat
      ) {
        active = { cookie: player.cookie, projection };
        break;
      }
    }
    if (!active) throw new Error("Expected an active human player");
    const action = active.projection.view.legalActions?.[0];
    if (!action) throw new Error("Expected a legal human action");
    const hostUpdate = nextMessage(hostSocket);
    const guestUpdate = nextMessage(guestSocket);
    const applied = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/commands`,
      headers: { origin, cookie: active.cookie },
      payload: {
        commandId: randomUUID(),
        roomId: room.roomId,
        expectedVersion: active.projection.eventVersion,
        action,
      },
    });
    expect(applied.statusCode).toBe(200);
    const eventVersion = (applied.json() as DurableProjection).eventVersion;
    await runtime.publisher.runOnce();
    const updates = await Promise.all([hostUpdate, guestUpdate]);
    for (const update of updates) {
      expect(
        RealtimeServerMessageSchema.parse(JSON.parse(update.toString())),
      ).toMatchObject({
        type: "SNAPSHOT",
        projection: { eventVersion },
      });
    }

    const resync = nextMessage(guestSocket);
    guestSocket.send(JSON.stringify({ type: "RESYNC", roomId: room.roomId }));
    expect(
      RealtimeServerMessageSchema.parse(JSON.parse((await resync).toString())),
    ).toMatchObject({ type: "SNAPSHOT", projection: { eventVersion } });

    guestSocket.terminate();
    await waitFor(async () => {
      const seat = await runtime.database.query<{ connection_status: string }>(
        "SELECT connection_status FROM room_seats WHERE room_id = $1 AND seat_index = 1",
        [room.roomId],
      );
      return seat.rows[0]?.connection_status === "disconnected";
    });
    const { socket: reconnected, initial: reconnectedInitial } =
      await openRoomSocket(runtime.app, room.roomId, guest.cookie);
    const reconnectedSnapshot = RealtimeServerMessageSchema.parse(
      JSON.parse((await reconnectedInitial).toString()),
    );
    expect(reconnectedSnapshot).toMatchObject({
      type: "SNAPSHOT",
      projection: { eventVersion: expect.any(Number) },
    });
    if (reconnectedSnapshot.type !== "SNAPSHOT") {
      throw new Error("Expected a reconnected snapshot");
    }
    expect(reconnectedSnapshot.projection.eventVersion).toBeGreaterThan(
      eventVersion,
    );

    expect(started.eventVersion).toBeLessThan(eventVersion);
    hostSocket.terminate();
    reconnected.terminate();
  });
});
