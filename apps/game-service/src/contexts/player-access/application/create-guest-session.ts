import { normalizeDisplayName } from "../domain/display-name.js";
import { formatSessionCredential } from "../domain/session-credential.js";
import type {
  CreatedSession,
  PlayerAccessClock,
  PlayerIdentityProvider,
  PlayerSessionWriter,
  SessionSecretProvider,
} from "./player-session-ports.js";

export interface CreateGuestSessionDependencies {
  readonly clock: PlayerAccessClock;
  readonly identities: PlayerIdentityProvider;
  readonly repository: PlayerSessionWriter;
  readonly secrets: SessionSecretProvider;
  readonly ttlMs: number;
}

export class CreateGuestSession {
  constructor(private readonly dependencies: CreateGuestSessionDependencies) {}

  async execute(displayName: string): Promise<CreatedSession> {
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const playerId = this.dependencies.identities.next();
    const sessionId = this.dependencies.identities.next();
    const secret = this.dependencies.secrets.generate();
    const expiresAt = new Date(
      this.dependencies.clock.now().getTime() + this.dependencies.ttlMs,
    );

    await this.dependencies.repository.create({
      displayName: normalizedDisplayName,
      expiresAt,
      playerId,
      secretHash: this.dependencies.secrets.digest(secret),
      sessionId,
    });

    return {
      cookieValue: formatSessionCredential({ secret, sessionId }),
      displayName: normalizedDisplayName,
      expiresAt,
      playerId,
      sessionId,
    };
  }
}
