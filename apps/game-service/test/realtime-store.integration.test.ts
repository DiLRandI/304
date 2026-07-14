import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import {
  PostgresRoomStore,
  type StoredSeat,
} from "../src/domain/room-store.js";
import { createDatabase, type Database } from "../src/infra/database.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const describeIntegration = databaseUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

interface PendingRoomNotification {
  id: number;
  roomId: string;
  eventVersion: number;
}

interface ClaimedAutomationJob {
  id: string;
  roomId: string;
  expectedEventVersion: number;
  kind: "BOT_ACTION" | "TURN_TIMEOUT" | "DISCONNECT_GRACE" | "TRICK_ADVANCE";
  targetSeatIndex: number;
}

interface RealtimeStore {
  claimRoomNotifications(
    owner: string,
    limit: number,
    roomId?: string,
  ): Promise<PendingRoomNotification[]>;
  markRoomNotificationPublished(id: number, owner: string): Promise<void>;
  releaseRoomNotification(
    id: number,
    owner: string,
    error: string,
  ): Promise<void>;
  scheduleAutomation(
    transaction: { query: Database["query"] },
    job: {
      id: string;
      roomId: string;
      expectedEventVersion: number;
      kind: ClaimedAutomationJob["kind"];
      targetSeatIndex: number;
      dueAt: Date;
    },
  ): Promise<void>;
  claimDueAutomationJobs(
    owner: string,
    now: Date,
    limit: number,
    roomId?: string,
  ): Promise<ClaimedAutomationJob[]>;
  completeAutomationJob(id: string, owner: string): Promise<void>;
  markSeatOnline(
    transaction: { query: Database["query"] },
    roomId: string,
    playerId: string,
  ): Promise<number | null>;
}

let database: Database;
let store: PostgresRoomStore;

function realtimeStore(): RealtimeStore {
  return store as unknown as RealtimeStore;
}

async function createPlayer(displayName: string): Promise<string> {
  const id = randomUUID();
  await database.query(
    "INSERT INTO players (id, display_name) VALUES ($1, $2)",
    [id, displayName],
  );
  return id;
}

function initialSeats(hostPlayerId: string): StoredSeat[] {
  return [
    {
      seatIndex: 0,
      playerId: hostPlayerId,
      occupantType: "human",
      botDifficulty: null,
      displayName: "Asha",
    },
    ...[1, 2, 3].map((seatIndex) => ({
      seatIndex,
      playerId: null,
      occupantType: "empty" as const,
      botDifficulty: null,
      displayName: null,
    })),
  ];
}

async function createRoom(): Promise<{ roomId: string; hostPlayerId: string }> {
  const hostPlayerId = await createPlayer("Asha");
  const roomId = randomUUID();
  await store.createRoom({
    id: roomId,
    inviteCode: `304-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    hostPlayerId,
    commandId: randomUUID(),
    ruleProfileId: "classic_304_4p",
    settings: { botDifficulty: "easy", enableSecondBidding: true },
    seats: initialSeats(hostPlayerId),
    snapshot: { phase: "setup" },
  });
  return { roomId, hostPlayerId };
}

describeIntegration("realtime room store", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    store = new PostgresRoomStore(database);
  });

  afterAll(async () => database.close());

  it("leases each durable room notification until it is published", async () => {
    expect(realtimeStore().claimRoomNotifications).toBeTypeOf("function");
    const { roomId } = await createRoom();
    const firstOwner = randomUUID();
    const secondOwner = randomUUID();

    const notifications = await realtimeStore().claimRoomNotifications(
      firstOwner,
      1_000,
      roomId,
    );
    const notification = notifications.find(
      (candidate) => candidate.roomId === roomId,
    );
    expect(notification).toMatchObject({ roomId, eventVersion: 1 });
    expect(
      (
        await realtimeStore().claimRoomNotifications(secondOwner, 1_000, roomId)
      ).some((candidate) => candidate.roomId === roomId),
    ).toBe(false);

    await realtimeStore().releaseRoomNotification(
      notification?.id ?? 0,
      firstOwner,
      "publish unavailable",
    );
    const retriedNotifications = await realtimeStore().claimRoomNotifications(
      secondOwner,
      1_000,
      roomId,
    );
    const retried = retriedNotifications.find(
      (candidate) => candidate.roomId === roomId,
    );
    expect(retried).toMatchObject({ id: notification?.id, roomId });
    await realtimeStore().markRoomNotificationPublished(
      retried?.id ?? 0,
      secondOwner,
    );
    expect(
      (
        await realtimeStore().claimRoomNotifications(
          randomUUID(),
          1_000,
          roomId,
        )
      ).some((candidate) => candidate.roomId === roomId),
    ).toBe(false);
  });

  it("leases due automation once and records a connected human seat", async () => {
    expect(realtimeStore().scheduleAutomation).toBeTypeOf("function");
    const { roomId, hostPlayerId } = await createRoom();
    const jobId = randomUUID();
    const dueAt = new Date(Date.now() - 1_000);
    await store.transaction(async (transaction) => {
      await realtimeStore().scheduleAutomation(transaction, {
        id: jobId,
        roomId,
        expectedEventVersion: 1,
        kind: "BOT_ACTION",
        targetSeatIndex: 1,
        dueAt,
      });
      expect(
        await realtimeStore().markSeatOnline(transaction, roomId, hostPlayerId),
      ).toBe(0);
    });

    const firstOwner = randomUUID();
    const claimedJobs = await realtimeStore().claimDueAutomationJobs(
      firstOwner,
      new Date(),
      1_000,
      roomId,
    );
    const claimed = claimedJobs.find((candidate) => candidate.id === jobId);
    expect(claimed).toMatchObject({
      id: jobId,
      roomId,
      expectedEventVersion: 1,
      kind: "BOT_ACTION",
      targetSeatIndex: 1,
    });
    expect(
      (
        await realtimeStore().claimDueAutomationJobs(
          randomUUID(),
          new Date(),
          1_000,
          roomId,
        )
      ).some((candidate) => candidate.id === jobId),
    ).toBe(false);
    await realtimeStore().completeAutomationJob(claimed?.id ?? "", firstOwner);
    expect(
      (
        await realtimeStore().claimDueAutomationJobs(
          randomUUID(),
          new Date(),
          1_000,
          roomId,
        )
      ).some((candidate) => candidate.id === jobId),
    ).toBe(false);

    const seat = await database.query<{
      connection_status: string;
      last_presence_at: Date | null;
    }>(
      "SELECT connection_status, last_presence_at FROM room_seats WHERE room_id = $1 AND seat_index = 0",
      [roomId],
    );
    expect(seat.rows).toEqual([
      expect.objectContaining({
        connection_status: "online",
        last_presence_at: expect.any(Date),
      }),
    ]);
  });

  it("stores durable trick-advance automation jobs", async () => {
    const { roomId } = await createRoom();
    const jobId = randomUUID();
    await store.transaction((transaction) =>
      realtimeStore().scheduleAutomation(transaction, {
        id: jobId,
        roomId,
        expectedEventVersion: 1,
        kind: "TRICK_ADVANCE",
        targetSeatIndex: 2,
        dueAt: new Date(Date.now() - 1),
      }),
    );

    const jobs = await realtimeStore().claimDueAutomationJobs(
      randomUUID(),
      new Date(),
      1_000,
      roomId,
    );
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: jobId,
          kind: "TRICK_ADVANCE",
          targetSeatIndex: 2,
        }),
      ]),
    );
  });
});
