import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAction } from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { buildApp, loadConfig } from "../src/app.js";
import { RoomCoordinator } from "../src/domain/room-coordinator.js";
import { PostgresRoomStore } from "../src/domain/room-store.js";
import { SessionService } from "../src/domain/session-service.js";
import { createDatabase, type Database } from "../src/infra/database.js";
import {
  Presence,
  RateLimiter,
  RoomLease,
} from "../src/infra/redis-coordination.js";

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
    legalActions?: GameAction[];
  };
}

interface TestRuntime {
  app: Awaited<ReturnType<typeof buildApp>>;
  database: Database;
  redis: RedisClientType;
}

let runtime: TestRuntime | undefined;

async function buildRealApp(): Promise<TestRuntime> {
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
  const sessions = new SessionService(database, {
    pepper: config.SESSION_SECRET_PEPPER,
    ttlDays: config.SESSION_TTL_DAYS,
  });
  const coordinator = new RoomCoordinator({
    store,
    lease: new RoomLease(redis, config.ROOM_LEASE_TTL_MS),
    presence: new Presence(redis, config.PRESENCE_TTL_SECONDS),
  });
  const app = await buildApp({
    config,
    readiness: { database: () => database.health(), redis: async () => true },
    game: { coordinator, sessions, rateLimiter: new RateLimiter(redis) },
  });
  return { app, database, redis };
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

async function getSnapshot(
  app: TestRuntime["app"],
  cookie: string,
  roomId: string,
): Promise<DurableProjection> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/rooms/${roomId}/snapshot`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DurableProjection;
}

afterEach(async () => closeRuntime());

describeIntegration("durable room HTTP API", () => {
  it("creates, joins, starts, commands, reconnects, and protects private cards", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Asha");
    const createResponse = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
    });
    expect(createResponse.statusCode).toBe(201);
    const room = createResponse.json() as DurableProjection;
    const currentRuntime = runtime;
    if (!currentRuntime) throw new Error("Test runtime is unavailable");
    const guests = await Promise.all(
      ["Bimal", "Chitra", "Dilan"].map((displayName) =>
        createGuest(currentRuntime.app, displayName),
      ),
    );

    let eventVersion = room.eventVersion;
    for (const guest of guests) {
      const joined = await runtime.app.inject({
        method: "POST",
        url: `/v1/rooms/${room.inviteCode}/join`,
        headers: { origin, cookie: guest.cookie },
        payload: { commandId: randomUUID(), expectedVersion: eventVersion },
      });
      expect(joined.statusCode).toBe(200);
      eventVersion = (joined.json() as DurableProjection).eventVersion;
    }

    const started = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/start`,
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), expectedVersion: eventVersion },
    });
    expect(started.statusCode).toBe(200);
    const startedProjection = started.json() as DurableProjection;
    const hostHand = startedProjection.view.privateSeat?.hand;
    expect(hostHand).toHaveLength(4);

    const players = [host, ...guests];
    let active: { cookie: string; projection: DurableProjection } | undefined;
    for (const player of players) {
      const projection = await getSnapshot(
        runtime.app,
        player.cookie,
        room.roomId,
      );
      if (
        projection.viewerSeatIndex === projection.view.publicState?.activeSeat
      ) {
        active = { cookie: player.cookie, projection };
        break;
      }
    }
    if (!active) throw new Error("No active human player");
    const action = active.projection.view.legalActions?.[0];
    if (!action) throw new Error("Active player has no legal action");
    const command = {
      commandId: randomUUID(),
      roomId: room.roomId,
      expectedVersion: active.projection.eventVersion,
      action,
    };
    const applied = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/commands`,
      headers: { origin, cookie: active.cookie },
      payload: command,
    });
    expect(applied.statusCode).toBe(200);
    const duplicate = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/commands`,
      headers: { origin, cookie: active.cookie },
      payload: command,
    });
    expect((duplicate.json() as DurableProjection).eventVersion).toBe(
      (applied.json() as DurableProjection).eventVersion,
    );

    const guestProjection = await getSnapshot(
      runtime.app,
      guests[0]?.cookie ?? "",
      room.roomId,
    );
    expect(JSON.stringify(guestProjection)).not.toContain(
      hostHand?.[0]?.cardId ?? "",
    );

    await closeRuntime();
    runtime = await buildRealApp();
    const resumed = await getSnapshot(runtime.app, host.cookie, room.roomId);
    expect(resumed.view.privateSeat?.hand).toEqual(hostHand);
  });

  it("enforces origin and rejects client-supplied seat authority", async () => {
    runtime = await buildRealApp();
    const originDenied = await runtime.app.inject({
      method: "POST",
      url: "/v1/guest-sessions",
      payload: { displayName: "Asha" },
    });
    expect(originDenied.statusCode).toBe(403);
    expect(originDenied.json()).toEqual({
      error: {
        code: "ORIGIN_DENIED",
        message: "Request origin is not allowed",
      },
    });

    const host = await createGuest(runtime.app, "Asha");
    const room = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
    });
    const projection = room.json() as DurableProjection;
    const malformed = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${projection.roomId}/commands`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        roomId: projection.roomId,
        expectedVersion: projection.eventVersion,
        actorSeatIndex: 3,
        action: { type: "PASS_BID" },
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Request is invalid" },
    });
  });
});
