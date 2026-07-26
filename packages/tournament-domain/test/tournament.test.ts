import { describe, expect, it } from "vitest";
import {
  applyForfeit,
  canExecuteTournamentAction,
  createBalancedGroups,
  createKnockoutBracket,
  createRoundRobinSchedule,
  createSeries,
  normalizeTeamName,
  rankGroup,
  recordSeriesWin,
  type StandingInput,
} from "../src/index.js";

function teamIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `team-${index + 1}`);
}

describe("team names", () => {
  it("normalizes Unicode and whitespace before uniqueness comparison", () => {
    expect(normalizeTeamName("  Café   Kings  ")).toEqual({
      display: "Café Kings",
      comparisonKey: "café kings",
    });
    expect(normalizeTeamName("Cafe\u0301 Kings").comparisonKey).toBe(
      "café kings",
    );
  });

  it.each([
    "A",
    " ".repeat(5),
    "x".repeat(33),
  ])("rejects names outside the 2-32 character boundary", (name) => {
    expect(() => normalizeTeamName(name)).toThrowError(
      "Team name must contain 2-32 characters",
    );
  });
});

describe("seeded group draw and schedule", () => {
  for (let count = 6; count <= 32; count += 2) {
    it(`creates balanced deterministic groups and unique rounds for ${count} teams`, () => {
      const teams = teamIds(count);
      const first = createBalancedGroups(teams, "published-seed");
      const second = createBalancedGroups(teams, "published-seed");
      expect(first).toEqual(second);
      expect(first.flat().sort()).toEqual([...teams].sort());
      expect(
        Math.max(...first.map((group) => group.length)),
      ).toBeLessThanOrEqual(5);
      expect(
        Math.min(...first.map((group) => group.length)),
      ).toBeGreaterThanOrEqual(3);
      expect(
        Math.max(...first.map((group) => group.length)) -
          Math.min(...first.map((group) => group.length)),
      ).toBeLessThanOrEqual(1);

      for (const group of first) {
        const rounds = createRoundRobinSchedule(group);
        const pairings = rounds.flat();
        expect(
          rounds.every(
            (round) =>
              new Set(round.flatMap((fixture) => [fixture.home, fixture.away]))
                .size ===
              round.length * 2,
          ),
        ).toBe(true);
        expect(
          new Set(
            pairings.map((fixture) =>
              [fixture.home, fixture.away].sort().join(":"),
            ),
          ).size,
        ).toBe((group.length * (group.length - 1)) / 2);
      }
    });
  }

  it("changes the draw when the published seed changes", () => {
    expect(createBalancedGroups(teamIds(12), "seed-one")).not.toEqual(
      createBalancedGroups(teamIds(12), "seed-two"),
    );
  });
});

describe("series and forfeits", () => {
  it("clinches BO3 at two wins and blocks a further match", () => {
    const once = recordSeriesWin(createSeries("bo3"), "A");
    const clinched = recordSeriesWin(once, "A");
    expect(clinched).toMatchObject({
      winsA: 2,
      winsB: 0,
      winner: "A",
      complete: true,
    });
    expect(() => recordSeriesWin(clinched, "B")).toThrowError(
      "Series is already complete",
    );
  });

  it("records single and double forfeits without token margin", () => {
    expect(applyForfeit(createSeries("bo3"), "A")).toMatchObject({
      winsA: 0,
      winsB: 2,
      winner: "B",
      complete: true,
      forfeit: "A",
    });
    expect(applyForfeit(createSeries("bo1"), "both")).toMatchObject({
      winsA: 0,
      winsB: 0,
      complete: true,
      forfeit: "both",
    });
  });
});

describe("standings", () => {
  const tied: StandingInput[] = [
    {
      teamId: "a",
      drawOrder: 2,
      results: [
        {
          opponentId: "b",
          winsFor: 2,
          winsAgainst: 1,
          finalTokenDifferential: 5,
        },
        {
          opponentId: "c",
          winsFor: 1,
          winsAgainst: 0,
          finalTokenDifferential: -4,
        },
      ],
    },
    {
      teamId: "b",
      drawOrder: 1,
      results: [
        {
          opponentId: "a",
          winsFor: 1,
          winsAgainst: 2,
          finalTokenDifferential: -5,
        },
        {
          opponentId: "c",
          winsFor: 2,
          winsAgainst: 0,
          finalTokenDifferential: 8,
        },
      ],
    },
    {
      teamId: "c",
      drawOrder: 3,
      results: [
        {
          opponentId: "a",
          winsFor: 0,
          winsAgainst: 1,
          finalTokenDifferential: 4,
        },
        {
          opponentId: "b",
          winsFor: 0,
          winsAgainst: 2,
          finalTokenDifferential: -8,
        },
      ],
    },
  ];

  it("uses a head-to-head mini-table before overall differential", () => {
    expect(rankGroup(tied).map((standing) => standing.teamId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("excludes forfeits from token differential", () => {
    const ranked = rankGroup([
      {
        teamId: "a",
        drawOrder: 1,
        results: [
          {
            opponentId: "b",
            winsFor: 1,
            winsAgainst: 0,
            finalTokenDifferential: null,
          },
        ],
      },
      {
        teamId: "b",
        drawOrder: 2,
        results: [
          {
            opponentId: "a",
            winsFor: 0,
            winsAgainst: 1,
            finalTokenDifferential: null,
          },
        ],
      },
    ]);
    expect(ranked[0]).toMatchObject({ teamId: "a", tokenDifferential: 0 });
  });
});

describe("knockout bracket", () => {
  it("gives byes to top seeds and avoids an avoidable same-group rematch", () => {
    const bracket = createKnockoutBracket(
      [
        {
          teamId: "a1",
          groupId: "a",
          groupRank: 1,
          normalizedWinRate: 1,
          normalizedDifferential: 2,
        },
        {
          teamId: "b1",
          groupId: "b",
          groupRank: 1,
          normalizedWinRate: 1,
          normalizedDifferential: 1,
        },
        {
          teamId: "c1",
          groupId: "c",
          groupRank: 1,
          normalizedWinRate: 0.8,
          normalizedDifferential: 1,
        },
        {
          teamId: "a2",
          groupId: "a",
          groupRank: 2,
          normalizedWinRate: 0.7,
          normalizedDifferential: 1,
        },
        {
          teamId: "b2",
          groupId: "b",
          groupRank: 2,
          normalizedWinRate: 0.6,
          normalizedDifferential: 0,
        },
        {
          teamId: "c2",
          groupId: "c",
          groupRank: 2,
          normalizedWinRate: 0.5,
          normalizedDifferential: 0,
        },
      ],
      true,
    );
    expect(bracket.size).toBe(8);
    expect(
      bracket.firstRound
        .filter((fixture) => fixture.away === null)
        .map((fixture) => fixture.home),
    ).toEqual(["a1", "b1"]);
    expect(
      bracket.firstRound
        .filter((fixture) => fixture.away !== null)
        .every((fixture) => fixture.homeGroupId !== fixture.awayGroupId),
    ).toBe(true);
    expect(bracket.thirdPlace).toBe(true);
  });
});

describe("permissions", () => {
  it("keeps post-lock names immutable but permits between-fixture captain transfer", () => {
    expect(
      canExecuteTournamentAction(
        "captain",
        "rename_team",
        "registration",
        false,
      ),
    ).toBe(true);
    expect(
      canExecuteTournamentAction(
        "captain",
        "rename_team",
        "group_stage",
        false,
      ),
    ).toBe(false);
    expect(
      canExecuteTournamentAction(
        "captain",
        "transfer_captain",
        "group_stage",
        false,
      ),
    ).toBe(true);
    expect(
      canExecuteTournamentAction(
        "captain",
        "transfer_captain",
        "group_stage",
        true,
      ),
    ).toBe(false);
  });

  it("reserves administrative actions for organizers", () => {
    expect(
      canExecuteTournamentAction(
        "organizer",
        "open_round",
        "group_stage",
        false,
      ),
    ).toBe(true);
    expect(
      canExecuteTournamentAction("captain", "open_round", "group_stage", false),
    ).toBe(false);
  });
});
