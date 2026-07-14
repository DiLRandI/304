import type { RuleProfileId } from "@three-zero-four/gameplay";
import type { QueryResultRow } from "pg";
import type { Database } from "../../../../infra/database.js";
import type {
  GameplaySnapshotReader,
  LoadedGameplaySnapshot,
} from "../../application/gameplay-snapshot-reader.js";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
} from "./gameplay-snapshot-codec.js";

interface SnapshotRow extends QueryResultRow {
  readonly event_version: number | string;
  readonly rule_profile_id: string;
  readonly schema_version: number;
  readonly state: unknown;
}

type Queryable = Pick<Database, "query">;

export class GameplaySnapshotReadError extends Error {
  constructor(
    readonly code: "INVALID_GAMEPLAY_SNAPSHOT_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "GameplaySnapshotReadError";
  }
}

function profileId(value: string): RuleProfileId {
  if (value === "classic_304_4p" || value === "six_304_36") return value;
  throw new GameplaySnapshotCodecError(
    "INVALID_GAMEPLAY_SNAPSHOT",
    "Gameplay snapshot state is invalid",
  );
}

export class PostgresGameplaySnapshotReader implements GameplaySnapshotReader {
  constructor(private readonly database: Queryable) {}

  async findLatest(roomId: string): Promise<LoadedGameplaySnapshot | null> {
    const result = await this.database.query<SnapshotRow>(
      "SELECT event_version, schema_version, rule_profile_id, state FROM game_snapshots WHERE room_id = $1 ORDER BY event_version DESC LIMIT 1",
      [roomId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const eventVersion = Number(row.event_version);
    if (!Number.isSafeInteger(eventVersion) || eventVersion < 0) {
      throw new GameplaySnapshotReadError(
        "INVALID_GAMEPLAY_SNAPSHOT_VERSION",
        "Gameplay snapshot event version is invalid",
      );
    }
    return {
      eventVersion,
      hand: hydrateGameplaySnapshot({
        ruleProfileId: profileId(row.rule_profile_id),
        schemaVersion: row.schema_version,
        state: row.state,
      }),
    };
  }
}
