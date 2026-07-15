import { ServiceError } from "../../../../shared/service-error.js";
import type { AuthenticateSession } from "../../application/authenticate-session.js";
import type { CreateGuestSession } from "../../application/create-guest-session.js";
import type { PlayerAccess } from "../../application/player-access.js";
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

function sessionRequired(): ServiceError {
  return new ServiceError(
    "SESSION_REQUIRED",
    401,
    "A guest session is required",
  );
}

export class PlayerAccessService implements PlayerAccess {
  constructor(private readonly dependencies: PlayerAccessServiceDependencies) {}

  async create(displayName: string): Promise<CreatedSession> {
    try {
      return await this.dependencies.createGuestSession.execute(displayName);
    } catch (error) {
      if (!(error instanceof InvalidDisplayNameError)) throw error;
      throw new ServiceError(
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
      return await this.dependencies.authenticateSession.execute(cookieValue);
    } catch (error) {
      if (!(error instanceof SessionRequiredError)) throw error;
      throw sessionRequired();
    }
  }
}
