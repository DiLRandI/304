import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { serializeGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import {
  PostgresRoomStore,
  type StoredSeat,
} from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import {
  createDatabase,
  type Database,
} from "../src/platform/postgres/database.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

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
      settings: {
        botDifficulty: "easy",
        enableSecondBidding: true,
        endHandWhenOutcomeCertain: true,
      },
      seats: initialSeats(hostPlayerId),
    });

    expect(created).toMatchObject({
      id: roomId,
      eventVersion: 1,
      status: "lobby",
    });
    expect(await store.loadSnapshot(roomId)).toBeNull();

    const started = serializeGameplaySnapshot(startedGameplayHand());
    const commandId = randomUUID();
    const eventVersion = await store.transaction((transaction) =>
      store.appendEventAndSnapshot(transaction, {
        roomId,
        expectedVersion: created.eventVersion,
        commandId,
        actorPlayerId: hostPlayerId,
        eventType: "ROOM_STARTED",
        payload: started,
        snapshot: started.state,
        snapshotSchemaVersion: 3,
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
      schemaVersion: 3,
      state: expect.objectContaining({ phase: "four-bidding" }),
    });
    expect(
      await store.findDuplicate(roomId, commandId, hostPlayerId),
    ).toMatchObject({ eventVersion: 2, eventType: "ROOM_STARTED" });
  });
});
