import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TournamentInviteSecurity } from "../../application/create-tournament.js";

export class NodeTournamentInviteSecurity implements TournamentInviteSecurity {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error(
        "Tournament invite HMAC secret must be at least 32 bytes",
      );
    }
  }

  createToken(): string {
    return randomBytes(32).toString("base64url");
  }

  digest(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("hex");
  }

  verify(token: string, digest: string): boolean {
    const actual = Buffer.from(this.digest(token), "hex");
    const expected = Buffer.from(digest, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
