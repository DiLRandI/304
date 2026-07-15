import {
  buildDeck,
  getRuleProfile,
  initialTokens,
  seatIndex,
  startGameplayHand,
} from "@three-zero-four/gameplay";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { serializeGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import {
  GameplaySnapshotReadError,
  PostgresGameplaySnapshotReader,
} from "../src/contexts/gameplay/adapters/persistence/postgres-gameplay-snapshot-reader.js";
import type { Database } from "../src/platform/postgres/database.js";

const roomId = "12f8e3e8-6729-4c46-b78a-d1a0e804c55a";
const profile = getRuleProfile("classic_304_4p");
const hand = startGameplayHand({
  dealer: seatIndex(0, profile.seatCount),
  deck: buildDeck(profile),
  handNumber: 1,
  profile,
  secondBiddingEnabled: true,
  tokens: initialTokens(profile),
});
const snapshot = serializeGameplaySnapshot(hand);

class QueryDatabase implements Pick<Database, "query"> {
  readonly calls: { text: string; values: readonly unknown[] }[] = [];

  constructor(private readonly rows: QueryResultRow[]) {}

  async query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    return { rows: this.rows as Row[] };
  }
}

describe("PostgresGameplaySnapshotReader", () => {
  it("hydrates the latest persisted gameplay aggregate", async () => {
    const database = new QueryDatabase([
      {
        event_version: "7",
        rule_profile_id: snapshot.ruleProfileId,
        schema_version: snapshot.schemaVersion,
        state: snapshot.state,
      },
    ]);
    const reader = new PostgresGameplaySnapshotReader(database);

    await expect(reader.findLatest(roomId)).resolves.toEqual({
      eventVersion: 7,
      hand,
    });
    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]).toMatchObject({ values: [roomId] });
    expect(database.calls[0]?.text).toContain("ORDER BY event_version DESC");
  });

  it("returns null when the room has no gameplay snapshot", async () => {
    await expect(
      new PostgresGameplaySnapshotReader(new QueryDatabase([])).findLatest(
        roomId,
      ),
    ).resolves.toBeNull();
  });

  it("rejects an unsafe persisted event version", async () => {
    const reader = new PostgresGameplaySnapshotReader(
      new QueryDatabase([
        {
          event_version: "9007199254740992",
          rule_profile_id: snapshot.ruleProfileId,
          schema_version: snapshot.schemaVersion,
          state: snapshot.state,
        },
      ]),
    );

    await expect(reader.findLatest(roomId)).rejects.toEqual(
      new GameplaySnapshotReadError(
        "INVALID_GAMEPLAY_SNAPSHOT_VERSION",
        "Gameplay snapshot event version is invalid",
      ),
    );
  });
});
