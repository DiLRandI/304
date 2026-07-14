export interface AuthenticatedSession {
  readonly displayName: string;
  readonly expiresAt: Date;
  readonly playerId: string;
  readonly sessionId: string;
}

export interface CreatedSession extends AuthenticatedSession {
  readonly cookieValue: string;
}

export interface CreatePlayerSessionRecord extends AuthenticatedSession {
  readonly secretHash: string;
}

export interface PlayerSessionWriter {
  create(record: CreatePlayerSessionRecord): Promise<void>;
}

export interface PlayerAccessClock {
  now(): Date;
}

export interface PlayerIdentityProvider {
  next(): string;
}

export interface SessionSecretProvider {
  digest(secret: string): string;
  generate(): string;
}
