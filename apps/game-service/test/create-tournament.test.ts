import { describe, expect, it } from "vitest";
import { CreateTournamentHandler } from "../src/contexts/tournaments/application/create-tournament.js";

describe("CreateTournamentHandler", () => {
  it("creates one secret invite per team without passing raw tokens to persistence", async () => {
    const commits: unknown[] = [];
    const handler = new CreateTournamentHandler({
      identities: {
        id: (() => {
          let value = 0;
          return () =>
            `10000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
        })(),
        slug: () => "colombo-cup-a1b2",
      },
      invites: {
        createToken: (() => {
          let value = 0;
          return () => `${String(++value).padStart(43, "a")}`;
        })(),
        digest: (token) => `digest:${token.slice(-1)}`,
        verify: () => false,
      },
      repository: { create: async (input) => commits.push(input) },
    });
    const result = await handler.execute({
      actorPlayerId: "10000000-0000-4000-8000-000000000099",
      commandId: "10000000-0000-4000-8000-000000000098",
      name: "Colombo Cup",
      profile: "classic_304_4p",
      teamCount: 6,
      seriesFormat: "bo1",
      bots: { allowed: false, difficulty: "easy" },
      thirdPlace: false,
    });
    expect(result.invites).toHaveLength(6);
    expect(result.invites.every((invite) => invite.token.length === 43)).toBe(
      true,
    );
    expect(JSON.stringify(commits)).not.toContain(result.invites[0]?.token);
    expect(JSON.stringify(commits)).toContain("digest:");
  });
});
