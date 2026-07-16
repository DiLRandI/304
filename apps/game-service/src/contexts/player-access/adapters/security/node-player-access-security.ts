import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  PlayerIdentityProvider,
  SessionSecretProvider,
  SessionSecretVerifier,
} from "../../application/player-session-ports.js";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export class UuidIdentityProvider implements PlayerIdentityProvider {
  next(): string {
    return randomUUID();
  }
}

export class NodeSessionSecrets
  implements SessionSecretProvider, SessionSecretVerifier
{
  constructor(private readonly pepper: string) {}

  digest(secret: string): string {
    return createHmac("sha256", this.pepper).update(secret).digest("hex");
  }

  generate(): string {
    return randomBytes(32).toString("base64url");
  }

  matches(secret: string, digest: string): boolean {
    if (!SHA256_HEX_PATTERN.test(digest)) return false;
    const candidate = Buffer.from(this.digest(secret), "hex");
    const stored = Buffer.from(digest, "hex");
    return timingSafeEqual(stored, candidate);
  }
}
