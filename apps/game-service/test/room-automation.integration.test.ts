import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateRoomRequest } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { RoomCoordinator } from "../src/domain/room-coordinator.js";
import {
  type ClaimedAutomationJob,
  PostgresRoomStore,
} from "../src/domain/room-store.js";
import { SessionService } from "../src/domain/session-service.js";
import { createDatabase, type Database } from "../src/infra/database.js";
import { Presence, RoomLease } from "../src/infra/redis-coordination.js";
import { AutomationWorker } from "../src/worker/automation-worker.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const redisUrl = process.env.INTEGRATION_REDIS_URL ?? "";
const describeIntegration = databaseUrl && redisUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

interface AutomationCoordinator {
  runAutomation(job: ClaimedAutomationJob): Promise<"completed" | "stale">;
}

interface PresenceCoordinator {
  markRealtimePresence(
    session: Parameters<RoomCoordinator["getSnapshot"]>[0],
    roomId: string,
  ): Promise<void>;
}

interface ConnectionCoordinator {
  markRealtimeDisconnected(
    session: Parameters<RoomCoordinator["getSnapshot"]>[0],
    roomId: string,
  ): Promise<void>;
}

let database: Database;
let redis: RedisClientType;
let store: PostgresRoomStore;
let sessions: SessionService;

function coordinator(): RoomCoordinator {
  return new RoomCoordinator({
    store,
    lease: new RoomLease(redis, 5_000),
    presence: new Presence(redis, 60),
  });
}

function automation(
  coordinatorInstance: RoomCoordinator,
): AutomationCoordinator {
  return coordinatorInstance as unknown as AutomationCoordinator;
}

function presence(coordinatorInstance: RoomCoordinator): PresenceCoordinator {
  return coordinatorInstance as unknown as PresenceCoordinator;
}

function connection(
  coordinatorInstance: RoomCoordinator,
): ConnectionCoordinator {
  return coordinatorInstance as unknown as ConnectionCoordinator;
}

async function createStartedClassicRoom(
  game: RoomCoordinator,
  hostName: string,
  guestNames: readonly [string, string, string],
) {
  const host = await sessions.create(hostName);
  const created = await game.createRoom(host, {
    commandId: randomUUID(),
    ruleProfileId: "classic_304_4p",
  });
  const guests = await Promise.all(
    guestNames.map((displayName) => sessions.create(displayName)),
  );
  let eventVersion = created.eventVersion;
  for (const guest of guests) {
    const joined = await game.joinRoom(guest, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    eventVersion = joined.eventVersion;
  }
  const started = await game.startRoom(host, created.roomId, {
    commandId: randomUUID(),
    expectedVersion: eventVersion,
  });
  return { created, guests, host, players: [host, ...guests], started };
}

function completeClassicHandSnapshot(): Record<string, unknown> {
  const engine = new GameEngine({
    ruleProfile: "classic_304_4p",
    tableMode: "classic_4",
    initialSeats: Array.from({ length: 4 }, (_, index) => ({
      index,
      type: "human",
      displayName: `Player ${index + 1}`,
    })),
  });
  engine.startMatch();
  for (let actionsApplied = 0; actionsApplied < 100; actionsApplied += 1) {
    if (engine.state.phase === "hand_result") return engine.getSnapshot();
    const seatIndex = engine.state.activeSeat;
    if (typeof seatIndex !== "number") {
      throw new Error(`Expected an active seat during ${engine.state.phase}`);
    }
    const legalActions = engine.getLegalActions(seatIndex);
    const action =
      engine.state.phase === "four_bidding"
        ? engine.state.bidding.currentBid === 0
          ? legalActions.find(
              (candidate) =>
                candidate.type === "BID" && candidate.amount === 160,
            )
          : legalActions.find((candidate) => candidate.type === "PASS_BID")
        : engine.state.phase === "second_bidding"
          ? legalActions.find((candidate) => candidate.type === "PASS_BID")
          : engine.state.phase === "trump_selection"
            ? legalActions.find(
                (candidate) => candidate.type === "SELECT_TRUMP",
              )
            : engine.state.phase === "trump_choice"
              ? legalActions.find(
                  (candidate) => candidate.type === "TRUMP_OPEN",
                )
              : legalActions.find(
                  (candidate) => candidate.type === "PLAY_CARD",
                );
    if (!action) {
      throw new Error(`Expected a legal action during ${engine.state.phase}`);
    }
    const result = engine.applyAction({
      ...action,
      seatIndex,
      actorSeatIndex: seatIndex,
    });
    if (!result.ok) {
      throw new Error(result.reason ?? "Expected a legal engine action");
    }
  }
  throw new Error("Classic hand did not complete within the action limit");
}

describeIntegration("durable room automation", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    redis = createClient({ url: redisUrl });
    await redis.connect();
    store = new PostgresRoomStore(database);
    sessions = new SessionService(database, {
      pepper: "test-only-session-pepper-must-be-at-least-32-characters",
      ttlDays: 30,
    });
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  it("creates a six-seat lobby before exposing the six-seat profile", async () => {
    const game = coordinator();
    const host = await sessions.create("Asha");
    const projection = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "six_304_36",
    } as unknown as CreateRoomRequest);
    const lobby = projection.view.lobby as {
      ruleProfileId: string;
      seats: Array<{ seatIndex: number }>;
    };

    expect(lobby.ruleProfileId).toBe("six_304_36");
    expect(lobby.seats).toHaveLength(6);
    expect(lobby.seats.map((seat) => seat.seatIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    const guests = await Promise.all(
      ["Bimal", "Chitra", "Dilan", "Esha", "Farah"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    let eventVersion = projection.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, projection.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    const started = await game.startRoom(host, projection.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    const startedView = started.view as {
      publicState: { profileId: string; seats: unknown[] };
      privateSeat: { hand: unknown[] };
    };
    expect(startedView.publicState.profileId).toBe("six_304_36");
    expect(startedView.publicState.seats).toHaveLength(6);
    expect(startedView.privateSeat.hand).toHaveLength(4);
  });

  it("replays a durable room start when its start snapshot is unavailable", async () => {
    const game = coordinator();
    const { created, host, started } = await createStartedClassicRoom(
      game,
      "Arosha",
      ["Banu", "Chami", "Dineth"],
    );

    await database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [created.roomId, started.eventVersion],
    );

    const recovered = await coordinator().getSnapshot(host, created.roomId);
    expect(recovered).toMatchObject({
      eventVersion: started.eventVersion,
      status: "in_hand",
    });
  });

  it("turns a claimed timeout into a durable autopilot action", async () => {
    expect(automation(coordinator()).runAutomation).toBeTypeOf("function");
    const game = coordinator();
    const host = await sessions.create("Esha");
    const created = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });
    const guests = await Promise.all(
      ["Bimal", "Chitra", "Dilan"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    let eventVersion = created.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, created.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    await game.startRoom(host, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT'",
      [created.roomId],
    );
    const owner = randomUUID();
    const timeoutJob = (
      await store.claimDueAutomationJobs(
        owner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "TURN_TIMEOUT",
    );
    expect(timeoutJob).toMatchObject({
      roomId: created.roomId,
      kind: "TURN_TIMEOUT",
    });
    await automation(game).runAutomation(timeoutJob as ClaimedAutomationJob);
    await store.completeAutomationJob(timeoutJob?.id ?? "", owner);

    const events = await store.loadEventsAfter(created.roomId, eventVersion);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "AUTOPILOT_ENABLED" }),
      ]),
    );

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
      [created.roomId],
    );
    const botOwner = randomUUID();
    const botJobs = await store.claimDueAutomationJobs(
      botOwner,
      new Date(),
      1_000,
      created.roomId,
    );
    const botJob = botJobs.find(
      (candidate) =>
        candidate.roomId === created.roomId && candidate.kind === "BOT_ACTION",
    );
    if (!botJob) throw new Error("Expected an autopilot bot job");
    await automation(game).runAutomation(botJob);
    await store.completeAutomationJob(botJob.id, botOwner);

    expect(await store.loadEventsAfter(created.roomId, eventVersion)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "AUTOPILOT_ENABLED" }),
        expect.objectContaining({ eventType: "AUTOPILOT_ACTION" }),
      ]),
    );
  });

  it("cancels autopilot when its human reconnects before the bot job runs", async () => {
    expect(presence(coordinator()).markRealtimePresence).toBeTypeOf("function");
    const game = coordinator();
    const host = await sessions.create("Farah");
    const created = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });
    const guests = await Promise.all(
      ["Gayan", "Hansi", "Ishan"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    const players = [host, ...guests];
    let eventVersion = created.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, created.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    await game.startRoom(host, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT'",
      [created.roomId],
    );
    const owner = randomUUID();
    const timeoutJobs = await store.claimDueAutomationJobs(
      owner,
      new Date(),
      1_000,
      created.roomId,
    );
    const timeoutJob = timeoutJobs.find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "TURN_TIMEOUT",
    );
    if (!timeoutJob) throw new Error("Expected a timeout job");
    await automation(game).runAutomation(timeoutJob);
    await store.completeAutomationJob(timeoutJob.id, owner);

    const reconnectingPlayer = players[timeoutJob.targetSeatIndex];
    if (!reconnectingPlayer) throw new Error("Missing timed-out player");
    await presence(game).markRealtimePresence(
      reconnectingPlayer,
      created.roomId,
    );

    const events = await store.loadEventsAfter(created.roomId, eventVersion);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "AUTOPILOT_ENABLED" }),
        expect.objectContaining({ eventType: "AUTOPILOT_CANCELLED" }),
      ]),
    );
    const pendingBotJob = await database.query<{ state: string }>(
      "SELECT state FROM room_automation_jobs WHERE room_id = $1 AND kind = 'BOT_ACTION' ORDER BY created_at DESC LIMIT 1",
      [created.roomId],
    );
    expect(pendingBotJob.rows).toEqual([{ state: "cancelled" }]);
  });

  it("keeps autopilot enabled when the automated action has already committed", async () => {
    const game = coordinator();
    const { created, players, started } = await createStartedClassicRoom(
      game,
      "Isuri",
      ["Janith", "Kasun", "Lihini"],
    );

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT'",
      [created.roomId],
    );
    const timeoutOwner = randomUUID();
    const timeoutJob = (
      await store.claimDueAutomationJobs(
        timeoutOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "TURN_TIMEOUT",
    );
    if (!timeoutJob) throw new Error("Expected a timeout job");
    await automation(game).runAutomation(timeoutJob);
    await store.completeAutomationJob(timeoutJob.id, timeoutOwner);

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
      [created.roomId],
    );
    const botOwner = randomUUID();
    const botJob = (
      await store.claimDueAutomationJobs(
        botOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId && candidate.kind === "BOT_ACTION",
    );
    if (!botJob) throw new Error("Expected an autopilot bot job");
    await automation(game).runAutomation(botJob);
    await store.completeAutomationJob(botJob.id, botOwner);

    const automatedPlayer = players[timeoutJob.targetSeatIndex];
    if (!automatedPlayer) throw new Error("Expected the automated player");
    await presence(game).markRealtimePresence(automatedPlayer, created.roomId);

    const events = await store.loadEventsAfter(
      created.roomId,
      started.eventVersion,
    );
    expect(
      events.filter((event) => event.eventType === "AUTOPILOT_CANCELLED"),
    ).toEqual([]);
    await expect(
      database.query<{ connection_status: string }>(
        "SELECT connection_status FROM room_seats WHERE room_id = $1 AND seat_index = $2",
        [created.roomId, timeoutJob.targetSeatIndex],
      ),
    ).resolves.toEqual({ rows: [{ connection_status: "autopilot" }] });
  });

  it("uses timeout automation to acknowledge a completed hand", async () => {
    const game = coordinator();
    const { created, players, started } = await createStartedClassicRoom(
      game,
      "Milan",
      ["Nethmi", "Oshada", "Pavani"],
    );
    await database.query(
      "UPDATE rooms SET status = 'hand_result' WHERE id = $1",
      [created.roomId],
    );
    await database.query(
      "UPDATE game_snapshots SET state = $3::jsonb WHERE room_id = $1 AND event_version = $2",
      [
        created.roomId,
        started.eventVersion,
        JSON.stringify(completeClassicHandSnapshot()),
      ],
    );
    const disconnectedPlayer = players[1];
    if (!disconnectedPlayer) throw new Error("Expected a non-host player");
    await connection(game).markRealtimeDisconnected(
      disconnectedPlayer,
      created.roomId,
    );

    const scheduled = await database.query<{
      due_at: Date;
      target_seat_index: number;
    }>(
      "SELECT due_at, target_seat_index FROM room_automation_jobs WHERE room_id = $1 AND kind = 'TURN_TIMEOUT' AND state = 'pending'",
      [created.roomId],
    );
    expect(scheduled.rows).toEqual([
      expect.objectContaining({ target_seat_index: 0 }),
    ]);
    expect(scheduled.rows[0]?.due_at.getTime()).toBeGreaterThan(
      Date.now() + 18_000,
    );

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT' AND state = 'pending'",
      [created.roomId],
    );
    const timeoutOwner = randomUUID();
    const timeoutJob = (
      await store.claimDueAutomationJobs(
        timeoutOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "TURN_TIMEOUT",
    );
    if (!timeoutJob) throw new Error("Expected a hand-result timeout job");
    await automation(game).runAutomation(timeoutJob);
    await store.completeAutomationJob(timeoutJob.id, timeoutOwner);

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
      [created.roomId],
    );
    const botOwner = randomUUID();
    const botJob = (
      await store.claimDueAutomationJobs(
        botOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId && candidate.kind === "BOT_ACTION",
    );
    if (!botJob) throw new Error("Expected an acknowledgment bot job");
    await automation(game).runAutomation(botJob);
    await store.completeAutomationJob(botJob.id, botOwner);

    const room = await store.loadRoom(created.roomId);
    expect(room).toMatchObject({ status: "in_hand" });
    const events = await store.loadEventsAfter(
      created.roomId,
      started.eventVersion,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "AUTOPILOT_ENABLED" }),
        expect.objectContaining({
          eventType: "AUTOPILOT_ACTION",
          payload: expect.objectContaining({
            action: expect.objectContaining({ type: "ACK_RESULT" }),
          }),
        }),
      ]),
    );
  });

  it("persists a disconnect grace job and cancels it on timely reconnect", async () => {
    expect(connection(coordinator()).markRealtimeDisconnected).toBeTypeOf(
      "function",
    );
    const game = coordinator();
    const host = await sessions.create("Jaya");
    const created = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });
    const guests = await Promise.all(
      ["Kamal", "Latha", "Mani"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    let eventVersion = created.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, created.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    await game.startRoom(host, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });

    await connection(game).markRealtimeDisconnected(host, created.roomId);
    const graceJob = await database.query<{
      state: string;
      target_seat_index: number;
    }>(
      "SELECT state, target_seat_index FROM room_automation_jobs WHERE room_id = $1 AND kind = 'DISCONNECT_GRACE' ORDER BY created_at DESC LIMIT 1",
      [created.roomId],
    );
    expect(graceJob.rows).toEqual([{ state: "pending", target_seat_index: 0 }]);

    await presence(game).markRealtimePresence(host, created.roomId);
    const events = await store.loadEventsAfter(created.roomId, eventVersion);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "PLAYER_DISCONNECTED" }),
        expect.objectContaining({ eventType: "PLAYER_RECONNECTED" }),
      ]),
    );
    await expect(
      redis.get(
        `g304:presence:${encodeURIComponent(created.roomId)}:${encodeURIComponent(host.playerId)}`,
      ),
    ).resolves.toBe("1");
    const cancelledGraceJob = await database.query<{ state: string }>(
      "SELECT state FROM room_automation_jobs WHERE room_id = $1 AND kind = 'DISCONNECT_GRACE' ORDER BY created_at DESC LIMIT 1",
      [created.roomId],
    );
    expect(cancelledGraceJob.rows).toEqual([{ state: "cancelled" }]);
  });

  it("replays an automated action after its latest snapshot is removed", async () => {
    const game = coordinator();
    const host = await sessions.create("Nimal");
    const created = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });
    const guests = await Promise.all(
      ["Omal", "Piumi", "Ravi"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    const players = [host, ...guests];
    let eventVersion = created.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, created.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    await game.startRoom(host, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT'",
      [created.roomId],
    );
    const timeoutOwner = randomUUID();
    const timeoutJob = (
      await store.claimDueAutomationJobs(
        timeoutOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "TURN_TIMEOUT",
    );
    if (!timeoutJob) throw new Error("Expected a timeout job");
    await automation(game).runAutomation(timeoutJob);
    await store.completeAutomationJob(timeoutJob.id, timeoutOwner);

    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
      [created.roomId],
    );
    const botOwner = randomUUID();
    const botJob = (
      await store.claimDueAutomationJobs(
        botOwner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId && candidate.kind === "BOT_ACTION",
    );
    if (!botJob) throw new Error("Expected an autopilot bot job");
    await automation(game).runAutomation(botJob);
    await store.completeAutomationJob(botJob.id, botOwner);

    const currentRoom = await store.loadRoom(created.roomId);
    if (!currentRoom) throw new Error("Expected a durable room");
    await database.query(
      "DELETE FROM game_snapshots WHERE room_id = $1 AND event_version = $2",
      [created.roomId, currentRoom.eventVersion],
    );
    const viewer = players.find(
      (_player, seatIndex) => seatIndex !== timeoutJob.targetSeatIndex,
    );
    if (!viewer) throw new Error("Expected a non-autopilot viewer");
    const recovered = await coordinator().getSnapshot(viewer, created.roomId);
    expect(recovered.eventVersion).toBe(currentRoom.eventVersion);
    expect(recovered.status).toBe("in_hand");
  });

  it("enables autopilot after grace even when the disconnected seat is not active", async () => {
    const game = coordinator();
    const host = await sessions.create("Saman");
    const created = await game.createRoom(host, {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
    });
    const guests = await Promise.all(
      ["Thara", "Udeni", "Vimal"].map((displayName) =>
        sessions.create(displayName),
      ),
    );
    const players = [host, ...guests];
    let eventVersion = created.eventVersion;
    for (const guest of guests) {
      const joined = await game.joinRoom(guest, created.roomId, {
        commandId: randomUUID(),
        expectedVersion: eventVersion,
      });
      eventVersion = joined.eventVersion;
    }
    const started = await game.startRoom(host, created.roomId, {
      commandId: randomUUID(),
      expectedVersion: eventVersion,
    });
    const activeSeat = (started.view.publicState as { activeSeat: number })
      .activeSeat;
    const disconnectedSeat = players.findIndex(
      (_player, seatIndex) => seatIndex !== activeSeat,
    );
    const disconnectedPlayer = players[disconnectedSeat];
    if (!disconnectedPlayer) throw new Error("Expected an inactive player");

    await connection(game).markRealtimeDisconnected(
      disconnectedPlayer,
      created.roomId,
    );
    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'DISCONNECT_GRACE' AND target_seat_index = $2",
      [created.roomId, disconnectedSeat],
    );
    const owner = randomUUID();
    const graceJob = (
      await store.claimDueAutomationJobs(
        owner,
        new Date(),
        1_000,
        created.roomId,
      )
    ).find(
      (candidate) =>
        candidate.roomId === created.roomId &&
        candidate.kind === "DISCONNECT_GRACE" &&
        candidate.targetSeatIndex === disconnectedSeat,
    );
    if (!graceJob) throw new Error("Expected a disconnect grace job");
    expect(await automation(game).runAutomation(graceJob)).toBe("completed");
    await store.completeAutomationJob(graceJob.id, owner);

    const events = await store.loadEventsAfter(created.roomId, eventVersion);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "AUTOPILOT_ENABLED",
          payload: expect.objectContaining({ seatIndex: disconnectedSeat }),
        }),
      ]),
    );
  });

  it("keeps another disconnected human's grace deadline current after a reconnect", async () => {
    const game = coordinator();
    const { created, players } = await createStartedClassicRoom(game, "Maya", [
      "Nadee",
      "Oshan",
      "Pasan",
    ]);
    const firstDisconnected = players[0];
    const secondDisconnected = players[1];
    if (!firstDisconnected || !secondDisconnected) {
      throw new Error("Expected two human players");
    }

    await connection(game).markRealtimeDisconnected(
      firstDisconnected,
      created.roomId,
    );
    await connection(game).markRealtimeDisconnected(
      secondDisconnected,
      created.roomId,
    );
    await presence(game).markRealtimePresence(
      firstDisconnected,
      created.roomId,
    );

    const room = await store.loadRoom(created.roomId);
    if (!room) throw new Error("Expected a durable room");
    await expect(
      database.query<{
        expected_event_version: string;
        target_seat_index: number;
      }>(
        "SELECT expected_event_version::text, target_seat_index FROM room_automation_jobs WHERE room_id = $1 AND kind = 'DISCONNECT_GRACE' AND state = 'pending' ORDER BY target_seat_index",
        [created.roomId],
      ),
    ).resolves.toEqual({
      rows: [
        {
          expected_event_version: String(room.eventVersion),
          target_seat_index: 1,
        },
      ],
    });
  });

  it("lets two workers claim one due autopilot action exactly once", async () => {
    const game = coordinator();
    const { created } = await createStartedClassicRoom(game, "Ravi", [
      "Sachi",
      "Thilini",
      "Umesh",
    ]);
    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'TURN_TIMEOUT' AND state = 'pending'",
      [created.roomId],
    );
    const primingWorker = new AutomationWorker({
      store,
      coordinator: game,
      pollIntervalMs: 500,
      ownerId: randomUUID(),
      roomId: created.roomId,
    });
    await primingWorker.runOnce();
    await database.query(
      "UPDATE room_automation_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'BOT_ACTION' AND state = 'pending'",
      [created.roomId],
    );

    const outcomes: string[] = [];
    const first = new AutomationWorker({
      store,
      coordinator: game,
      pollIntervalMs: 500,
      ownerId: randomUUID(),
      roomId: created.roomId,
      onJob: (outcome) => outcomes.push(outcome),
    });
    const second = new AutomationWorker({
      store,
      coordinator: game,
      pollIntervalMs: 500,
      ownerId: randomUUID(),
      roomId: created.roomId,
      onJob: (outcome) => outcomes.push(outcome),
    });

    await Promise.all([first.runOnce(), second.runOnce()]);

    const events = await store.loadEventsAfter(created.roomId, 0);
    const autopilotEvents = events.filter(
      (event) => event.eventType === "AUTOPILOT_ACTION",
    );
    expect(autopilotEvents).toHaveLength(1);
    const autopilotEvent = autopilotEvents[0];
    if (!autopilotEvent) throw new Error("Expected an autopilot event");
    const room = await store.loadRoom(created.roomId);
    expect(room?.eventVersion).toBe(autopilotEvent.eventVersion);
    await expect(
      database.query<{ event_version: string }>(
        "SELECT event_version::text FROM room_outbox WHERE room_id = $1 AND event_version = $2",
        [created.roomId, autopilotEvent.eventVersion],
      ),
    ).resolves.toEqual({
      rows: [{ event_version: String(autopilotEvent.eventVersion) }],
    });
    expect(outcomes).toEqual(["completed"]);
  });
});
