import type { AuthenticateSession } from "../../application/authenticate-session.js";
import type { CreateGuestSession } from "../../application/create-guest-session.js";
import {
  type PlayerAccess,
  PlayerAccessError,
} from "../../application/player-access.js";
import type {
  AuthenticatedSession,
  CreatedSession,
} from "../../application/player-session-ports.js";
import { InvalidDisplayNameError } from "../../domain/display-name.js";
import { SessionRequiredError } from "../../domain/session-access.js";
export interface PlayerAccessServiceDependencies {
  readonly authenticateSession: Pick<AuthenticateSession, "execute">;
  readonly createGuestSession: Pick<CreateGuestSession, "execute">;
}

export class PlayerAccessService implements PlayerAccess {
  constructor(private readonly dependencies: PlayerAccessServiceDependencies) {}

  async create(displayName: string): Promise<CreatedSession> {
    try {
      return await this.dependencies.createGuestSession.execute(displayName);
    } catch (error) {
      if (!(error instanceof InvalidDisplayNameError)) throw error;
      throw new PlayerAccessError("INVALID_DISPLAY_NAME");
    }
  }

  async require(
    cookieValue: string | undefined,
  ): Promise<AuthenticatedSession> {
    try {
      return await this.dependencies.authenticateSession.execute(cookieValue);
    } catch (error) {
      if (!(error instanceof SessionRequiredError)) throw error;
      throw new PlayerAccessError("SESSION_REQUIRED");
    }
  }
}
