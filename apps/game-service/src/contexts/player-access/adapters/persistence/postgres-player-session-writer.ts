import type { Database } from "../../../../platform/postgres/database.js";
import type { PlayerSessionWriter } from "../../application/player-session-ports.js";

export class PostgresPlayerSessionWriter implements PlayerSessionWriter {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async create(
    record: Parameters<PlayerSessionWriter["create"]>[0],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        "INSERT INTO players (id, display_name) VALUES ($1, $2)",
        [record.playerId, record.displayName],
      );
      await transaction.query(
        "INSERT INTO sessions (id, player_id, secret_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [
          record.sessionId,
          record.playerId,
          record.secretHash,
          record.expiresAt,
        ],
      );
    });
  }
}
