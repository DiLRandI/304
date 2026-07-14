import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAction } from "@three-zero-four/contracts";
import { createClient, type RedisClientType } from "redis";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { buildApp, loadConfig } from "../src/app.js";
import { PlayerAccessService } from "../src/contexts/player-access/adapters/delivery/player-access-service.js";
import { NodeRoomInviteCodeProvider } from "../src/contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { RoomCoordinator } from "../src/domain/room-coordinator.js";
import { PostgresRoomStore } from "../src/domain/room-store.js";
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
    isHost?: boolean;
    publicState?: {
      activeSeat: number | null;
      dealerSeat?: number;
      handNumber?: number;
      phase?: string;
      seats?: Array<{
        difficulty: string | null;
        index: number;
        type: "bot" | "empty" | "human";
      }>;
    };
    privateSeat?: { hand: Array<{ cardId: string }> };
    legalActions?: GameAction[];
  };
}

interface TestRuntime {
  app: Awaited<ReturnType<typeof buildApp>>;
  coordinator: RoomCoordinator;
  database: Database;
  redis: RedisClientType;
  store: PostgresRoomStore;
}

interface TestPlayer {
  cookie: string;
  playerId: string;
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
  const sessions = new PlayerAccessService(database, {
    pepper: config.SESSION_SECRET_PEPPER,
    ttlDays: config.SESSION_TTL_DAYS,
  });
  const coordinator = new RoomCoordinator({
    inviteCodes: new NodeRoomInviteCodeProvider(),
    store,
    lease: new RoomLease(redis, config.ROOM_LEASE_TTL_MS),
    presence: new Presence(redis, config.PRESENCE_TTL_SECONDS),
    automation: { botActionDelayMs: 0, trickRevealDelayMs: 0 },
  });
  const app = await buildApp({
    config,
    readiness: { database: () => database.health(), redis: async () => true },
    game: {
      coordinator,
      sessions,
      rateLimiter: new RateLimiter(redis, `g304:test:${randomUUID()}`),
    },
  });
  return { app, coordinator, database, redis, store };
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

function isTerminalPhase(phase: string | undefined): boolean {
  return phase === "hand_result" || phase === "match_complete";
}

async function collectProjections(
  currentRuntime: TestRuntime,
  roomId: string,
  players: readonly TestPlayer[],
): Promise<Map<string, DurableProjection>> {
  const projections = new Map<string, DurableProjection>();
  for (const player of players) {
    projections.set(
      player.playerId,
      await getSnapshot(currentRuntime.app, player.cookie, roomId),
    );
  }
  return projections;
}

async function advanceToHandResult(
  currentRuntime: TestRuntime,
  roomId: string,
  players: readonly TestPlayer[],
): Promise<Map<string, DurableProjection>> {
  const automationOwner = randomUUID();
  for (let step = 0; step < 240; step += 1) {
    const projections = await collectProjections(
      currentRuntime,
      roomId,
      players,
    );
    const firstProjection = projections.values().next().value;
    if (!firstProjection) throw new Error("Room has no player projection");
    if (isTerminalPhase(firstProjection.view.publicState?.phase)) {
      return projections;
    }
    const activePlayer = players.find((player) => {
      const projection = projections.get(player.playerId);
      return (
        projection?.viewerSeatIndex === projection?.view.publicState?.activeSeat
      );
    });
    if (activePlayer) {
      const projection = projections.get(activePlayer.playerId);
      const action = projection?.view.legalActions?.[0];
      if (!action) throw new Error("Active human has no legal action");
      const applied = await currentRuntime.app.inject({
        method: "POST",
        url: `/v1/rooms/${roomId}/commands`,
        headers: { origin, cookie: activePlayer.cookie },
        payload: {
          action,
          commandId: randomUUID(),
          expectedVersion: projection?.eventVersion,
          roomId,
        },
      });
      expect(
        applied.statusCode,
        JSON.stringify({
          action,
          body: applied.json(),
          expectedVersion: projection?.eventVersion,
        }),
      ).toBe(200);
      continue;
    }
    const jobs = await currentRuntime.store.claimDueAutomationJobs(
      automationOwner,
      new Date(),
      16,
      roomId,
    );
    if (jobs.length === 0) {
      const settled = await collectProjections(currentRuntime, roomId, players);
      const settledPhase = settled.values().next().value?.view
        .publicState?.phase;
      if (isTerminalPhase(settledPhase)) return settled;
      throw new Error(
        `Expected a due bot action while advancing ${settledPhase ?? "unknown"} phase`,
      );
    }
    for (const job of jobs) {
      expect(await currentRuntime.coordinator.runAutomation(job)).toBe(
        "completed",
      );
      await currentRuntime.store.completeAutomationJob(job.id, automationOwner);
    }
  }
  throw new Error("Timed out while advancing the room to hand result");
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

  it("uses the host-selected bot difficulty when a room starts with bot fill", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Ravi");
    const created = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        ruleProfileId: "classic_304_4p",
        botDifficulty: "strong",
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json() as DurableProjection;

    const started = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/start`,
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), expectedVersion: room.eventVersion },
    });
    expect(started.statusCode).toBe(200);
    const publicState = (
      started.json() as DurableProjection & {
        view: {
          publicState: {
            seats: Array<{ difficulty: string; type: string }>;
          };
        };
      }
    ).view.publicState;
    expect(publicState.seats.filter((seat) => seat.type === "bot")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ difficulty: "strong", type: "bot" }),
        expect.objectContaining({ difficulty: "strong", type: "bot" }),
        expect.objectContaining({ difficulty: "strong", type: "bot" }),
      ]),
    );
  });

  it("lets a guest leave a lobby durably and returns the same safe result to a retry", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Asha");
    const guest = await createGuest(runtime.app, "Bimal");
    const created = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json() as DurableProjection;
    const joined = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: guest.cookie },
      payload: { commandId: randomUUID(), expectedVersion: room.eventVersion },
    });
    expect(joined.statusCode).toBe(200);
    const leave = {
      commandId: randomUUID(),
      expectedVersion: (joined.json() as DurableProjection).eventVersion,
    };

    const left = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: guest.cookie },
      payload: leave,
    });
    expect(left.statusCode).toBe(200);
    expect(left.json()).toEqual({
      eventVersion: leave.expectedVersion + 1,
      roomId: room.roomId,
      status: "left",
    });

    const duplicate = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: guest.cookie },
      payload: leave,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(left.json());

    await expect(
      runtime.database.query<{
        occupant_type: string;
        player_id: string | null;
      }>(
        "SELECT occupant_type, player_id FROM room_seats WHERE room_id = $1 AND seat_index = 1",
        [room.roomId],
      ),
    ).resolves.toEqual({
      rows: [{ occupant_type: "empty", player_id: null }],
    });
    await expect(
      runtime.database.query<{ event_type: string }>(
        "SELECT event_type FROM game_events WHERE room_id = $1 ORDER BY event_version DESC LIMIT 1",
        [room.roomId],
      ),
    ).resolves.toEqual({ rows: [{ event_type: "PLAYER_LEFT" }] });
    const departedSnapshot = await runtime.app.inject({
      method: "GET",
      url: `/v1/rooms/${room.roomId}/snapshot`,
      headers: { cookie: guest.cookie },
    });
    expect(departedSnapshot.statusCode).toBe(403);
  });

  it("transfers a lobby host and closes a room when its final human leaves", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Chitra");
    const guest = await createGuest(runtime.app, "Dilan");
    const created = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json() as DurableProjection;
    const joined = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: guest.cookie },
      payload: { commandId: randomUUID(), expectedVersion: room.eventVersion },
    });
    expect(joined.statusCode).toBe(200);

    const hostLeft = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: (joined.json() as DurableProjection).eventVersion,
      },
    });
    expect(hostLeft.statusCode).toBe(200);
    expect(hostLeft.json()).toMatchObject({ status: "left" });
    await expect(
      runtime.database.query<{ host_player_id: string }>(
        "SELECT host_player_id FROM rooms WHERE id = $1",
        [room.roomId],
      ),
    ).resolves.toEqual({ rows: [{ host_player_id: guest.playerId }] });

    const guestProjection = await getSnapshot(
      runtime.app,
      guest.cookie,
      room.roomId,
    );
    const finalLeave = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: guest.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: guestProjection.eventVersion,
      },
    });
    expect(finalLeave.statusCode).toBe(200);
    expect(finalLeave.json()).toMatchObject({ status: "closed" });
    await expect(
      runtime.database.query<{ status: string }>(
        "SELECT status FROM rooms WHERE id = $1",
        [room.roomId],
      ),
    ).resolves.toEqual({ rows: [{ status: "closed" }] });
    await expect(
      runtime.database.query<{ event_type: string }>(
        "SELECT event_type FROM game_events WHERE room_id = $1 ORDER BY event_version DESC LIMIT 1",
        [room.roomId],
      ),
    ).resolves.toEqual({ rows: [{ event_type: "ROOM_CLOSED" }] });
  });

  it("allows only the host to advance a hand result and rotates the next hand", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Eranga");
    const guest = await createGuest(runtime.app, "Farah");
    const created = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: { commandId: randomUUID(), ruleProfileId: "classic_304_4p" },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json() as DurableProjection;
    const joined = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: guest.cookie },
      payload: { commandId: randomUUID(), expectedVersion: room.eventVersion },
    });
    expect(joined.statusCode).toBe(200);
    const started = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/start`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: (joined.json() as DurableProjection).eventVersion,
      },
    });
    expect(started.statusCode).toBe(200);

    const results = await advanceToHandResult(runtime, room.roomId, [
      host,
      guest,
    ]);
    const hostResult = results.get(host.playerId);
    const guestResult = results.get(guest.playerId);
    if (!hostResult || !guestResult) throw new Error("Expected hand results");
    expect(hostResult.view.isHost).toBe(true);
    expect(guestResult.view.isHost).toBe(false);
    const restarted = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/start`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: hostResult.eventVersion,
      },
    });
    expect(restarted.statusCode).toBe(409);
    expect(guestResult.view.legalActions).not.toContainEqual({
      type: "ACK_RESULT",
    });
    const guestAck = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/commands`,
      headers: { origin, cookie: guest.cookie },
      payload: {
        action: { type: "ACK_RESULT" },
        commandId: randomUUID(),
        expectedVersion: guestResult.eventVersion,
        roomId: room.roomId,
      },
    });
    expect(guestAck.statusCode).toBe(403);
    expect(guestAck.json()).toEqual({
      error: { code: "HOST_REQUIRED", message: "Only the host can continue" },
    });

    const hostAck = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/commands`,
      headers: { origin, cookie: host.cookie },
      payload: {
        action: { type: "ACK_RESULT" },
        commandId: randomUUID(),
        expectedVersion: hostResult.eventVersion,
        roomId: room.roomId,
      },
    });
    expect(hostAck.statusCode).toBe(200);
    const nextHand = hostAck.json() as DurableProjection;
    expect(nextHand.view.publicState).toMatchObject({
      handNumber: (hostResult.view.publicState?.handNumber ?? 0) + 1,
      phase: "four_bidding",
    });
    expect(nextHand.view.publicState?.dealerSeat).not.toBe(
      hostResult.view.publicState?.dealerSeat,
    );
    expect(nextHand.view.privateSeat?.hand).toHaveLength(4);
  });

  it("replaces a departing result-state human with a configured bot and transfers a departing host", async () => {
    runtime = await buildRealApp();
    const host = await createGuest(runtime.app, "Gihan");
    const guest = await createGuest(runtime.app, "Hasini");
    const remainingGuest = await createGuest(runtime.app, "Indika");
    const created = await runtime.app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { origin, cookie: host.cookie },
      payload: {
        botDifficulty: "strong",
        commandId: randomUUID(),
        ruleProfileId: "classic_304_4p",
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json() as DurableProjection;
    const joined = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: guest.cookie },
      payload: { commandId: randomUUID(), expectedVersion: room.eventVersion },
    });
    expect(joined.statusCode).toBe(200);
    const secondJoined = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: { origin, cookie: remainingGuest.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: (joined.json() as DurableProjection).eventVersion,
      },
    });
    expect(secondJoined.statusCode).toBe(200);
    const started = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/start`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: (secondJoined.json() as DurableProjection)
          .eventVersion,
      },
    });
    expect(started.statusCode).toBe(200);

    const results = await advanceToHandResult(runtime, room.roomId, [
      host,
      guest,
      remainingGuest,
    ]);
    const guestResult = results.get(guest.playerId);
    if (!guestResult) throw new Error("Expected guest hand result");
    const guestLeft = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: guest.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: guestResult.eventVersion,
      },
    });
    expect(guestLeft.statusCode).toBe(200);
    expect(guestLeft.json()).toMatchObject({ status: "left" });
    const hostResult = await getSnapshot(runtime.app, host.cookie, room.roomId);
    expect(hostResult.view.publicState?.seats).toContainEqual(
      expect.objectContaining({
        difficulty: "strong",
        index: guestResult.viewerSeatIndex,
        type: "bot",
      }),
    );

    const leaveEventVersion = (guestLeft.json() as { eventVersion: number })
      .eventVersion;
    await runtime.database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [room.roomId, leaveEventVersion],
    );
    await closeRuntime();
    runtime = await buildRealApp();
    const recoveredHostResult = await getSnapshot(
      runtime.app,
      host.cookie,
      room.roomId,
    );
    expect(recoveredHostResult.view.publicState?.seats).toContainEqual(
      expect.objectContaining({
        difficulty: "strong",
        index: guestResult.viewerSeatIndex,
        type: "bot",
      }),
    );

    const hostLeft = await runtime.app.inject({
      method: "POST",
      url: `/v1/rooms/${room.roomId}/leave`,
      headers: { origin, cookie: host.cookie },
      payload: {
        commandId: randomUUID(),
        expectedVersion: recoveredHostResult.eventVersion,
      },
    });
    expect(hostLeft.statusCode).toBe(200);
    expect(hostLeft.json()).toMatchObject({ status: "left" });
    await expect(
      runtime.database.query<{ host_player_id: string }>(
        "SELECT host_player_id FROM rooms WHERE id = $1",
        [room.roomId],
      ),
    ).resolves.toEqual({
      rows: [{ host_player_id: remainingGuest.playerId }],
    });
    const newHostResult = await getSnapshot(
      runtime.app,
      remainingGuest.cookie,
      room.roomId,
    );
    expect(newHostResult.view.isHost).toBe(true);
    expect(newHostResult.view.legalActions).toContainEqual({
      type: "ACK_RESULT",
    });
  });
});
