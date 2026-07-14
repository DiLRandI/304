import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type {
  PlayerIdentityProvider,
  SessionSecretProvider,
} from "../../application/player-session-ports.js";

export class UuidIdentityProvider implements PlayerIdentityProvider {
  next(): string {
    return randomUUID();
  }
}

export class NodeSessionSecrets implements SessionSecretProvider {
  constructor(private readonly pepper: string) {}

  digest(secret: string): string {
    return createHmac("sha256", this.pepper).update(secret).digest("hex");
  }

  generate(): string {
    return randomBytes(32).toString("base64url");
  }
}
