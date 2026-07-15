import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresPlayerSessionWriter } from "../src/contexts/player-access/adapters/persistence/postgres-player-session-writer.js";
import type { Database } from "../src/platform/postgres/database.js";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class TransactionDatabase implements Pick<Database, "transaction"> {
  readonly calls: QueryCall[] = [];

  async transaction<T>(
    callback: (transaction: Pick<Database, "query">) => Promise<T>,
  ): Promise<T> {
    return callback({
      query: async <Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        this.calls.push({ text, values });
        return { rows: [] as Row[] };
      },
    });
  }
}

describe("PostgresPlayerSessionWriter", () => {
  it("atomically inserts a player and its session", async () => {
    const database = new TransactionDatabase();
    const writer = new PostgresPlayerSessionWriter(database);
    const expiresAt = new Date("2026-07-16T00:00:00.000Z");

    await writer.create({
      displayName: "Asha",
      expiresAt,
      playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      secretHash: "stored-digest",
      sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
    });

    expect(database.calls).toEqual([
      {
        text: "INSERT INTO players (id, display_name) VALUES ($1, $2)",
        values: ["5a8b3ca8-79b8-4470-a65c-0e064c22bd19", "Asha"],
      },
      {
        text: "INSERT INTO sessions (id, player_id, secret_hash, expires_at) VALUES ($1, $2, $3, $4)",
        values: [
          "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
          "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
          "stored-digest",
          expiresAt,
        ],
      },
    ]);
  });
});
