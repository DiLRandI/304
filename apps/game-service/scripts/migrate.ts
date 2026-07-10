import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, type Database } from "../src/infra/database.js";

function defaultMigrationsDir(): string {
  return path.resolve(
    process.env.MIGRATIONS_DIR ??
      path.join(process.cwd(), "infra/postgres/migrations"),
  );
}

export async function runMigrations(
  database: Database,
  directory = defaultMigrationsDir(),
): Promise<void> {
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const filename of files) {
    const source = await readFile(path.join(directory, filename));
    const checksum = createHash("sha256").update(source).digest("hex");

    await database.transaction(async (transaction) => {
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "three-zero-four:migrations",
      ]);
      await transaction.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const applied = await transaction.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (applied.rows[0] && applied.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed: ${filename}`);
      }
      if (!applied.rows[0]) {
        await transaction.query(source.toString());
        await transaction.query(
          "INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)",
          [filename, checksum],
        );
      }
    });
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for migrations");
  }
  const database = createDatabase(connectionString);
  try {
    await runMigrations(database);
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
