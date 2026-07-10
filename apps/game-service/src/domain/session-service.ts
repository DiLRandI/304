import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { QueryResultRow } from "pg";
import type { Database } from "../infra/database.js";
import { DomainError } from "./errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

function parseCookieValue(
  cookieValue: string | undefined,
): { sessionId: string; secret: string } | null {
  const parts = cookieValue?.split(".");
  if (parts?.length !== 2) return null;
  const [sessionId, secret] = parts;
  if (
    !sessionId ||
    !secret ||
    !UUID_PATTERN.test(sessionId) ||
    !SECRET_PATTERN.test(secret)
  ) {
    return null;
  }
  return { sessionId, secret };
}

function sessionRequired(): DomainError {
  return new DomainError(
    "SESSION_REQUIRED",
    401,
    "A guest session is required",
  );
}

export class SessionService {
  constructor(
    private readonly database: Database,
    private readonly options: SessionServiceOptions,
  ) {}

  private digest(secret: string): Buffer {
    return createHmac("sha256", this.options.pepper).update(secret).digest();
  }

  async create(displayName: string): Promise<CreatedSession> {
    const normalizedDisplayName = displayName.trim();
    if (!normalizedDisplayName || normalizedDisplayName.length > 48) {
      throw new DomainError(
        "INVALID_DISPLAY_NAME",
        400,
        "Display name is invalid",
      );
    }
    const playerId = randomUUID();
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const secretHash = this.digest(secret).toString("hex");
    const expiresAt = new Date(
      Date.now() + this.options.ttlDays * 24 * 60 * 60 * 1000,
    );

    await this.database.transaction(async (transaction) => {
      await transaction.query(
        "INSERT INTO players (id, display_name) VALUES ($1, $2)",
        [playerId, normalizedDisplayName],
      );
      await transaction.query(
        "INSERT INTO sessions (id, player_id, secret_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [sessionId, playerId, secretHash, expiresAt],
      );
    });

    return {
      sessionId,
      playerId,
      displayName: normalizedDisplayName,
      expiresAt,
      cookieValue: `${sessionId}.${secret}`,
    };
  }

  async require(
    cookieValue: string | undefined,
  ): Promise<AuthenticatedSession> {
    const parsed = parseCookieValue(cookieValue);
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
