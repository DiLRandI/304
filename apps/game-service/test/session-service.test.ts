import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { PlayerAccessService } from "../src/contexts/player-access/adapters/delivery/player-access-service.js";
import { createDatabase, type Database } from "../src/infra/database.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const describeIntegration = databaseUrl ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);

let database: Database;
let sessions: PlayerAccessService;

describeIntegration("durable guest sessions", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
    sessions = new PlayerAccessService(database, {
      pepper: "test-only-session-pepper-must-be-at-least-32-characters",
      ttlDays: 30,
    });
  });

  afterAll(async () => database.close());

  it("stores only a peppered session-secret digest and authenticates the opaque cookie", async () => {
    const created = await sessions.create("Asha");
    const stored = await database.query<{ secret_hash: string }>(
      "SELECT secret_hash FROM sessions WHERE id = $1",
      [created.sessionId],
    );

    expect(stored.rows).toEqual([
      { secret_hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(created.cookieValue).not.toContain(
      stored.rows[0]?.secret_hash ?? "",
    );
    await expect(sessions.require(created.cookieValue)).resolves.toMatchObject({
      sessionId: created.sessionId,
      playerId: created.playerId,
      displayName: "Asha",
    });
    await expect(
      sessions.require(`${created.sessionId}.not-the-secret`),
    ).rejects.toMatchObject({
      code: "SESSION_REQUIRED",
      statusCode: 401,
    });
  });
});
