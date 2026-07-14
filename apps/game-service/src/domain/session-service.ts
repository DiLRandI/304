import { createHmac, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { PostgresPlayerSessionWriter } from "../contexts/player-access/adapters/persistence/postgres-player-session-writer.js";
import {
  NodeSessionSecrets,
  UuidIdentityProvider,
} from "../contexts/player-access/adapters/security/node-player-access-security.js";
import { CreateGuestSession } from "../contexts/player-access/application/create-guest-session.js";
import { InvalidDisplayNameError } from "../contexts/player-access/domain/display-name.js";
import { parseSessionCredential } from "../contexts/player-access/domain/session-credential.js";
import type { Database } from "../infra/database.js";
import { DomainError } from "./errors.js";

export interface AuthenticatedSession {
  sessionId: string;
  playerId: string;
  displayName: string;
  expiresAt: Date;
}

export interface CreatedSession extends AuthenticatedSession {
  cookieValue: string;
}

export interface SessionServiceOptions {
  pepper: string;
  ttlDays: number;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  player_id: string;
  display_name: string;
  secret_hash: string;
  expires_at: Date;
}

function sessionRequired(): DomainError {
  return new DomainError(
    "SESSION_REQUIRED",
    401,
    "A guest session is required",
  );
}

export class SessionService {
  private readonly createGuestSession: CreateGuestSession;

  constructor(
    private readonly database: Database,
    private readonly options: SessionServiceOptions,
  ) {
    this.createGuestSession = new CreateGuestSession({
      clock: { now: () => new Date() },
      identities: new UuidIdentityProvider(),
      repository: new PostgresPlayerSessionWriter(database),
      secrets: new NodeSessionSecrets(options.pepper),
      ttlMs: options.ttlDays * 24 * 60 * 60 * 1000,
    });
  }

  private digest(secret: string): Buffer {
    return createHmac("sha256", this.options.pepper).update(secret).digest();
  }

  async create(displayName: string): Promise<CreatedSession> {
    try {
      return await this.createGuestSession.execute(displayName);
    } catch (error) {
      if (!(error instanceof InvalidDisplayNameError)) throw error;
      throw new DomainError(
        "INVALID_DISPLAY_NAME",
        400,
        "Display name is invalid",
      );
    }
  }

  async require(
    cookieValue: string | undefined,
  ): Promise<AuthenticatedSession> {
    const parsed = parseSessionCredential(cookieValue);
    if (!parsed) throw sessionRequired();
    const result = await this.database.query<SessionRow>(
      "SELECT sessions.id AS session_id, sessions.player_id, players.display_name, sessions.secret_hash, sessions.expires_at FROM sessions JOIN players ON players.id = sessions.player_id WHERE sessions.id = $1 AND sessions.revoked_at IS NULL AND sessions.expires_at > now()",
      [parsed.sessionId],
    );
    const session = result.rows[0];
    const candidate = this.digest(parsed.secret);
    const stored = Buffer.from(session?.secret_hash ?? "", "hex");
    if (
      !session ||
      stored.length !== candidate.length ||
      !timingSafeEqual(stored, candidate)
    ) {
      throw sessionRequired();
    }
    await this.database.query(
      "UPDATE sessions SET last_seen_at = now() WHERE id = $1",
      [session.session_id],
    );
    return {
      sessionId: session.session_id,
      playerId: session.player_id,
      displayName: session.display_name,
      expiresAt: session.expires_at,
    };
  }
}
