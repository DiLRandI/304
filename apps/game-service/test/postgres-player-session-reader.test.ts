import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresPlayerSessionReader } from "../src/contexts/player-access/adapters/persistence/postgres-player-session-reader.js";
import type { Database } from "../src/platform/postgres/database.js";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class QueryDatabase implements Pick<Database, "query"> {
  readonly calls: QueryCall[] = [];
  session: QueryResultRow | null = {
    display_name: "Asha",
    expires_at: new Date("2026-07-16T00:00:00.000Z"),
    player_id: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
    secret_hash: "stored-digest",
    session_id: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
  };

  async query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    return {
      rows:
        text.startsWith("SELECT") && this.session ? [this.session as Row] : [],
    };
  }
}

describe("PostgresPlayerSessionReader", () => {
  it("loads only the active session projection and touches last-seen state", async () => {
    const database = new QueryDatabase();
    const reader = new PostgresPlayerSessionReader(database);
    const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";

    await expect(reader.findActive(sessionId)).resolves.toEqual({
      displayName: "Asha",
      expiresAt: new Date("2026-07-16T00:00:00.000Z"),
      playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      secretHash: "stored-digest",
      sessionId,
    });
    await reader.touch(sessionId);

    expect(database.calls[0]?.text).toContain(
      "sessions.revoked_at IS NULL AND sessions.expires_at > now()",
    );
    expect(database.calls[0]?.values).toEqual([sessionId]);
    expect(database.calls[1]).toEqual({
      text: "UPDATE sessions SET last_seen_at = now() WHERE id = $1",
      values: [sessionId],
    });
  });

  it("returns null when no active session exists", async () => {
    const database = new QueryDatabase();
    database.session = null;

    await expect(
      new PostgresPlayerSessionReader(database).findActive(
        "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
      ),
    ).resolves.toBeNull();
  });
});
