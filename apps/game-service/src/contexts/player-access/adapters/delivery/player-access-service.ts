import { DomainError } from "../../../../domain/errors.js";
import type { Database } from "../../../../infra/database.js";
import { AuthenticateSession } from "../../application/authenticate-session.js";
import { CreateGuestSession } from "../../application/create-guest-session.js";
import { InvalidDisplayNameError } from "../../domain/display-name.js";
import { SessionRequiredError } from "../../domain/session-access.js";
import { PostgresPlayerSessionReader } from "../persistence/postgres-player-session-reader.js";
import { PostgresPlayerSessionWriter } from "../persistence/postgres-player-session-writer.js";
import {
  NodeSessionSecrets,
  UuidIdentityProvider,
} from "../security/node-player-access-security.js";

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

function sessionRequired(): DomainError {
  return new DomainError(
    "SESSION_REQUIRED",
    401,
    "A guest session is required",
  );
}

export class SessionService {
  private readonly authenticateSession: AuthenticateSession;
  private readonly createGuestSession: CreateGuestSession;

  constructor(database: Database, options: SessionServiceOptions) {
    const secrets = new NodeSessionSecrets(options.pepper);
    this.authenticateSession = new AuthenticateSession({
      repository: new PostgresPlayerSessionReader(database),
      secrets,
    });
    this.createGuestSession = new CreateGuestSession({
      clock: { now: () => new Date() },
      identities: new UuidIdentityProvider(),
      repository: new PostgresPlayerSessionWriter(database),
      secrets,
      ttlMs: options.ttlDays * 24 * 60 * 60 * 1000,
    });
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
    try {
      return await this.authenticateSession.execute(cookieValue);
    } catch (error) {
      if (!(error instanceof SessionRequiredError)) throw error;
      throw sessionRequired();
    }
  }
}
