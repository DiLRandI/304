import { describe, expect, it, vi } from "vitest";
import { CreateGuestSession } from "../src/contexts/player-access/application/create-guest-session.js";
import { InvalidDisplayNameError } from "../src/contexts/player-access/domain/display-name.js";

describe("CreateGuestSession", () => {
  it("creates a normalized durable session through application ports", async () => {
    const create = vi.fn();
    const ids = [
      "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
    ];
    const useCase = new CreateGuestSession({
      clock: { now: () => new Date("2026-07-14T00:00:00.000Z") },
      identities: { next: () => ids.shift() ?? "unexpected-id" },
      repository: { create },
      secrets: {
        digest: (secret) => `digest:${secret}`,
        generate: () => "a".repeat(43),
      },
      ttlMs: 2 * 24 * 60 * 60 * 1000,
    });

    const session = await useCase.execute("  Asha  ");

    expect(create).toHaveBeenCalledWith({
      displayName: "Asha",
      expiresAt: new Date("2026-07-16T00:00:00.000Z"),
      playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      secretHash: `digest:${"a".repeat(43)}`,
      sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
    });
    expect(session).toEqual({
      cookieValue: `b8fc339d-ee47-45f9-826c-b3477bdb8d51.${"a".repeat(43)}`,
      displayName: "Asha",
      expiresAt: new Date("2026-07-16T00:00:00.000Z"),
      playerId: "5a8b3ca8-79b8-4470-a65c-0e064c22bd19",
      sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
    });
  });

  it("rejects an invalid name before invoking outward ports", async () => {
    const create = vi.fn();
    const next = vi.fn();
    const generate = vi.fn();
    const useCase = new CreateGuestSession({
      clock: { now: vi.fn() },
      identities: { next },
      repository: { create },
      secrets: { digest: vi.fn(), generate },
      ttlMs: 1,
    });

    await expect(useCase.execute("   ")).rejects.toBeInstanceOf(
      InvalidDisplayNameError,
    );
    expect(create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
