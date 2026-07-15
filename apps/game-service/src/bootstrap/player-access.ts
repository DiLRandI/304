import { PlayerAccessService } from "../contexts/player-access/adapters/delivery/player-access-service.js";
import { PostgresPlayerSessionReader } from "../contexts/player-access/adapters/persistence/postgres-player-session-reader.js";
import { PostgresPlayerSessionWriter } from "../contexts/player-access/adapters/persistence/postgres-player-session-writer.js";
import {
  NodeSessionSecrets,
  UuidIdentityProvider,
} from "../contexts/player-access/adapters/security/node-player-access-security.js";
import { AuthenticateSession } from "../contexts/player-access/application/authenticate-session.js";
import { CreateGuestSession } from "../contexts/player-access/application/create-guest-session.js";
import type { Database } from "../infra/database.js";

export interface PlayerAccessBootstrapOptions {
  pepper: string;
  ttlDays: number;
}

export function createPlayerAccessService(
  database: Database,
  options: PlayerAccessBootstrapOptions,
): PlayerAccessService {
  const secrets = new NodeSessionSecrets(options.pepper);
  return new PlayerAccessService({
    authenticateSession: new AuthenticateSession({
      repository: new PostgresPlayerSessionReader(database),
      secrets,
    }),
    createGuestSession: new CreateGuestSession({
      clock: { now: () => new Date() },
      identities: new UuidIdentityProvider(),
      repository: new PostgresPlayerSessionWriter(database),
      secrets,
      ttlMs: options.ttlDays * 24 * 60 * 60 * 1000,
    }),
  });
}
