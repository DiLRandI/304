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

export interface StoredPlayerSession extends AuthenticatedSession {
  readonly secretHash: string;
}

export interface PlayerSessionReader {
  findActive(sessionId: string): Promise<StoredPlayerSession | null>;
  touch(sessionId: string): Promise<void>;
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

export interface SessionSecretVerifier {
  matches(secret: string, digest: string): boolean;
}
