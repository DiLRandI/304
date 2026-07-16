import type { QueryResultRow } from "pg";
import type { Database } from "../../../../platform/postgres/database.js";
import type {
  PlayerSessionReader,
  StoredPlayerSession,
} from "../../application/player-session-ports.js";

interface SessionRow extends QueryResultRow {
  readonly display_name: string;
  readonly expires_at: Date;
  readonly player_id: string;
  readonly secret_hash: string;
  readonly session_id: string;
}

export class PostgresPlayerSessionReader implements PlayerSessionReader {
  constructor(private readonly database: Pick<Database, "query">) {}

  async findActive(sessionId: string): Promise<StoredPlayerSession | null> {
    const result = await this.database.query<SessionRow>(
      "SELECT sessions.id AS session_id, sessions.player_id, players.display_name, sessions.secret_hash, sessions.expires_at FROM sessions JOIN players ON players.id = sessions.player_id WHERE sessions.id = $1 AND sessions.revoked_at IS NULL AND sessions.expires_at > now()",
      [sessionId],
    );
    const row = result.rows[0];
    return row
      ? {
          displayName: row.display_name,
          expiresAt: row.expires_at,
          playerId: row.player_id,
          secretHash: row.secret_hash,
          sessionId: row.session_id,
        }
      : null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.database.query(
      "UPDATE sessions SET last_seen_at = now() WHERE id = $1",
      [sessionId],
    );
  }
}
