import { describe, expect, it } from "vitest";
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
