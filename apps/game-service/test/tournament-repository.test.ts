import { describe, expect, it } from "vitest";
import { PostgresTournamentRepository } from "../src/contexts/tournaments/adapters/persistence/postgres-tournament-repository.js";
import type { Database } from "../src/platform/postgres/database.js";

describe("PostgresTournamentRepository", () => {
  it("creates tournament state, audited event, deduplication, and both outbox audiences atomically", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    let transactions = 0;
    const database = {
      async transaction<T>(
        callback: (database: Pick<Database, "query">) => Promise<T>,
      ): Promise<T> {
        transactions += 1;
        return callback({
          async query(text, values = []) {
            calls.push({ text, values });
            return { rows: [] };
          },
        });
      },
    } as Database;
    const repository = new PostgresTournamentRepository(database);
    await repository.create({
      tournament: {
        id: "10000000-0000-4000-8000-000000000001",
        publicSlug: "colombo-cup",
        organizerPlayerId: "10000000-0000-4000-8000-000000000002",
        name: "Colombo Cup",
        profile: "classic_304_4p",
        teamCount: 6,
        seriesFormat: "bo1",
        botsAllowed: false,
        botDifficulty: "easy",
        thirdPlace: false,
      },
      commandId: "10000000-0000-4000-8000-000000000003",
      inviteDigests: Array.from({ length: 6 }, (_, index) =>
        index.toString(16).repeat(64),
      ),
      response: { tournamentId: "10000000-0000-4000-8000-000000000001" },
    });

    expect(transactions).toBe(1);
    expect(calls.map((call) => call.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO tournaments"),
        expect.stringContaining("INSERT INTO tournament_events"),
        expect.stringContaining(
          "INSERT INTO tournament_command_deduplications",
        ),
        expect.stringContaining("INSERT INTO tournament_outbox"),
      ]),
    );
    expect(calls.flatMap((call) => call.values)).not.toContain(
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
  });
});
