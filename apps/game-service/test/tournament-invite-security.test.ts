import { describe, expect, it } from "vitest";
import { NodeTournamentInviteSecurity } from "../src/contexts/tournaments/adapters/security/node-tournament-invite-security.js";

describe("tournament invite security", () => {
  it("creates URL-safe raw tokens and persists only deterministic HMAC digests", () => {
    const security = new NodeTournamentInviteSecurity("t".repeat(32));
    const token = security.createToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(security.digest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(security.digest(token)).toBe(security.digest(token));
    expect(security.digest(token)).not.toContain(token);
  });

  it("uses constant-time digest verification", () => {
    const security = new NodeTournamentInviteSecurity("s".repeat(32));
    const token = security.createToken();
    const digest = security.digest(token);
    expect(security.verify(token, digest)).toBe(true);
    expect(security.verify(`${token.slice(0, -1)}x`, digest)).toBe(false);
  });
});
