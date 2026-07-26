import { describe, expect, it } from "vitest";
import { NodeSessionSecrets } from "../src/contexts/player-access/adapters/security/node-player-access-security.js";
import {
  formatSessionCredential,
  parseSessionCredential,
} from "../src/contexts/player-access/domain/session-credential.js";

const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";
const secret = "a".repeat(43);

describe("session credential", () => {
  it("round-trips a valid opaque session credential", () => {
    const credential = { secret, sessionId };
    const cookieValue = formatSessionCredential(credential);

    expect(cookieValue).toBe(`${sessionId}.${secret}`);
    expect(parseSessionCredential(cookieValue)).toEqual(credential);
  });

  it.each([
    undefined,
    "",
    sessionId,
    `${sessionId}.${secret}.extra`,
    `not-a-uuid.${secret}`,
    `${sessionId}.too-short`,
    `${sessionId}.${"!".repeat(43)}`,
  ])("rejects a malformed credential: %j", (value) => {
    expect(parseSessionCredential(value)).toBeNull();
  });
});

describe("session-bound CSRF tokens", () => {
  it("accepts only the HMAC token issued for the presented session cookie", () => {
    const secrets = new NodeSessionSecrets("a".repeat(32));
    const cookie = `b8fc339d-ee47-45f9-826c-b3477bdb8d51.${"b".repeat(43)}`;
    const otherCookie = `5a8b3ca8-79b8-4470-a65c-0e064c22bd19.${"c".repeat(43)}`;

    const token = secrets.csrfToken(cookie);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.matchesCsrfToken(cookie, token)).toBe(true);
    expect(secrets.matchesCsrfToken(otherCookie, token)).toBe(false);
    expect(secrets.matchesCsrfToken(cookie, "forged")).toBe(false);
  });
});
