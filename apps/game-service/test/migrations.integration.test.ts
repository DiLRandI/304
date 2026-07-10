import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../scripts/migrate.js";
import { createDatabase, type Database } from "../src/infra/database.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? "";
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/postgres/migrations",
);
const describeIntegration = databaseUrl ? describe : describe.skip;
let database: Database;

describeIntegration("foundation migrations", () => {
  beforeAll(async () => {
    database = createDatabase(databaseUrl);
    await runMigrations(database, migrationsDir);
  });

  afterAll(async () => database.close());

  it("records the exact digest for the foundational schema", async () => {
    const sql = await readFile(path.join(migrationsDir, "0001_foundation.sql"));
    const expected = createHash("sha256").update(sql).digest("hex");
    const result = await database.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE filename = $1",
      ["0001_foundation.sql"],
    );
    expect(result.rows).toEqual([{ checksum: expected }]);
  });

  it("is idempotent when migrations are invoked more than once", async () => {
    await runMigrations(database, migrationsDir);
    const result = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );
    expect(result.rows).toEqual([{ count: "2" }]);
  });

  it("creates durable identities, rooms, seats, events, snapshots, and command records", async () => {
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "command_deduplications",
        "game_events",
        "game_snapshots",
        "players",
        "room_seats",
        "rooms",
        "schema_migrations",
        "session_command_deduplications",
        "sessions",
      ]),
    );
  });
});
