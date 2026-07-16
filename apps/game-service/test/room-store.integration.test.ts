import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "@three-zero-four/game-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import {
  PostgresRoomStore,
  type StoredSeat,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import {
  createDatabase,
  type Database,
} from "../src/platform/postgres/database.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const describeIntegration = databaseUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

let database: Database;
let store: PostgresRoomStore;

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

describeIntegration("durable room store", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    store = new PostgresRoomStore(database);
  });

  afterAll(async () => database.close());

  it("stores an immutable event, exact snapshot, and command result atomically", async () => {
    const hostPlayerId = await createPlayer("Asha");
    const roomId = randomUUID();
    const created = await store.createRoom({
      id: roomId,
      inviteCode: `304-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      hostPlayerId,
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
      settings: { botDifficulty: "easy", enableSecondBidding: true },
      seats: initialSeats(hostPlayerId),
    });

    expect(created).toMatchObject({
      id: roomId,
      eventVersion: 1,
      status: "lobby",
    });
    expect(await store.loadSnapshot(roomId)).toBeNull();

    const startedEngine = new GameEngine({
      playerName: "Asha",
      humanCount: 1,
      tableMode: "classic_4",
      ruleProfile: "classic_304_4p",
      initialSeats: initialSeats(hostPlayerId),
    });
    startedEngine.startMatch();
    const commandId = randomUUID();
    const eventVersion = await store.transaction((transaction) =>
      store.appendEventAndSnapshot(transaction, {
        roomId,
        expectedVersion: created.eventVersion,
        commandId,
        actorPlayerId: hostPlayerId,
        eventType: "ROOM_STARTED",
        payload: { ruleProfileId: "classic_304_4p" },
        snapshot: startedEngine.getSnapshot(),
        status: "in_hand",
        ruleProfileId: "classic_304_4p",
      }),
    );

    expect(eventVersion).toBe(2);
    expect(await store.loadEventsAfter(roomId, 0)).toMatchObject([
      { eventVersion: 1, eventType: "ROOM_CREATED" },
      { eventVersion: 2, eventType: "ROOM_STARTED", commandId },
    ]);
    expect(await store.loadSnapshot(roomId)).toMatchObject({
      eventVersion: 2,
      state: expect.objectContaining({ phase: "four_bidding" }),
    });
    expect(
      await store.findDuplicate(roomId, commandId, hostPlayerId),
    ).toMatchObject({ eventVersion: 2, eventType: "ROOM_STARTED" });
  });
});
