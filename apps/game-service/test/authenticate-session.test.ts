import { describe, expect, it, vi } from "vitest";
import { AuthenticateSession } from "../src/contexts/player-access/application/authenticate-session.js";
import { SessionRequiredError } from "../src/contexts/player-access/domain/session-access.js";

const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";
const secret = "a".repeat(43);
const storedSession = {
  displayName: "Asha",
  expiresAt: new Date("2026-07-16T00:00:00.000Z"),
  playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
  secretHash: "stored-digest",
  sessionId,
};

describe("AuthenticateSession", () => {
  it("verifies an active credential and records last-seen activity", async () => {
    const findActive = vi.fn().mockResolvedValue(storedSession);
    const touch = vi.fn().mockResolvedValue(undefined);
    const matches = vi.fn().mockReturnValue(true);
    const useCase = new AuthenticateSession({
      repository: { findActive, touch },
      secrets: { matches },
    });

    await expect(useCase.execute(`${sessionId}.${secret}`)).resolves.toEqual({
      displayName: "Asha",
      expiresAt: new Date("2026-07-16T00:00:00.000Z"),
      playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      sessionId,
    });
    expect(findActive).toHaveBeenCalledWith(sessionId);
    expect(matches).toHaveBeenCalledWith(secret, "stored-digest");
    expect(touch).toHaveBeenCalledWith(sessionId);
  });

  it("rejects malformed credentials before invoking outward ports", async () => {
    const findActive = vi.fn();
    const touch = vi.fn();
    const matches = vi.fn();
    const useCase = new AuthenticateSession({
      repository: { findActive, touch },
      secrets: { matches },
    });

    await expect(useCase.execute("invalid")).rejects.toBeInstanceOf(
      SessionRequiredError,
    );
    expect(findActive).not.toHaveBeenCalled();
    expect(matches).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it.each([
    { activeSession: null, matchesSecret: true },
    { activeSession: storedSession, matchesSecret: false },
  ])("rejects missing or mismatched session state: %j", async ({
    activeSession,
    matchesSecret,
  }) => {
    const touch = vi.fn();
    const useCase = new AuthenticateSession({
      repository: {
        findActive: vi.fn().mockResolvedValue(activeSession),
        touch,
      },
      secrets: { matches: vi.fn().mockReturnValue(matchesSecret) },
    });

    await expect(
      useCase.execute(`${sessionId}.${secret}`),
    ).rejects.toBeInstanceOf(SessionRequiredError);
    expect(touch).not.toHaveBeenCalled();
  });
});
