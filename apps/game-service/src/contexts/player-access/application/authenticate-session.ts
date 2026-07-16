import { SessionRequiredError } from "../domain/session-access.js";
import { parseSessionCredential } from "../domain/session-credential.js";
import type {
  AuthenticatedSession,
  PlayerSessionReader,
  SessionSecretVerifier,
} from "./player-session-ports.js";

export interface AuthenticateSessionDependencies {
  readonly repository: PlayerSessionReader;
  readonly secrets: SessionSecretVerifier;
}

export class AuthenticateSession {
  constructor(private readonly dependencies: AuthenticateSessionDependencies) {}

  async execute(
    cookieValue: string | undefined,
  ): Promise<AuthenticatedSession> {
    const credential = parseSessionCredential(cookieValue);
    if (!credential) throw new SessionRequiredError();

    const session = await this.dependencies.repository.findActive(
      credential.sessionId,
    );
    if (
      !session ||
      !this.dependencies.secrets.matches(credential.secret, session.secretHash)
    ) {
      throw new SessionRequiredError();
    }

    await this.dependencies.repository.touch(session.sessionId);
    return {
      displayName: session.displayName,
      expiresAt: session.expiresAt,
      playerId: session.playerId,
      sessionId: session.sessionId,
    };
  }
}
