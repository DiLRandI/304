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
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

  csrfToken(cookieValue: string): string {
    return createHmac("sha256", this.pepper)
      .update("csrf:")
      .update(cookieValue)
      .digest("base64url");
  }

  generate(): string {
    return randomBytes(32).toString("base64url");
  }

  matchesCsrfToken(cookieValue: string, token: string): boolean {
    if (!SHA256_BASE64URL_PATTERN.test(token)) return false;
    const expected = Buffer.from(this.csrfToken(cookieValue));
    const candidate = Buffer.from(token);
    return timingSafeEqual(expected, candidate);
  }

  matches(secret: string, digest: string): boolean {
    if (!SHA256_HEX_PATTERN.test(digest)) return false;
    const candidate = Buffer.from(this.digest(secret), "hex");
    const stored = Buffer.from(digest, "hex");
    return timingSafeEqual(stored, candidate);
  }
}
