import { describe, expect, it } from "vitest";
import {
  CreateTournamentRequestSchema,
  JoinTournamentInviteRequestSchema,
  PublicTournamentBoardSchema,
  TournamentCommandRequestSchema,
} from "../src/index.js";

const commandId = "9c9c7530-224f-4d5e-b354-1c78df2f063b";

describe("tournament contracts", () => {
  it("accepts a strict Classic tournament creation request", () => {
    expect(
      CreateTournamentRequestSchema.parse({
        commandId,
        name: "Colombo 304 Cup",
        profile: "classic_304_4p",
        teamCount: 8,
        seriesFormat: "bo3",
        bots: { allowed: true, difficulty: "normal" },
        thirdPlace: true,
      }),
    ).toMatchObject({ teamCount: 8, seriesFormat: "bo3" });
  });

  it("rejects odd team counts and unknown fields", () => {
    expect(() =>
      CreateTournamentRequestSchema.parse({
        commandId,
        name: "Odd Cup",
        profile: "classic_304_4p",
        teamCount: 7,
        seriesFormat: "bo1",
        bots: { allowed: false, difficulty: "easy" },
        thirdPlace: false,
        injected: true,
      }),
    ).toThrow();
  });

  it("requires raw invites only in the protected join body", () => {
    expect(
      JoinTournamentInviteRequestSchema.parse({
        commandId,
        token: "a".repeat(43),
        teamName: "Café Kings",
      }),
    ).toMatchObject({ teamName: "Café Kings" });
    expect(() =>
      JoinTournamentInviteRequestSchema.parse({
        commandId,
        token: "short",
        teamName: "Café Kings",
      }),
    ).toThrow();
  });

  it("parses versioned command variants and rejects actor identity", () => {
    expect(
      TournamentCommandRequestSchema.parse({
        commandId,
        expectedVersion: 4,
        action: { type: "OPEN_ROUND", roundId: commandId },
      }).action.type,
    ).toBe("OPEN_ROUND");
    expect(() =>
      TournamentCommandRequestSchema.parse({
        commandId,
        expectedVersion: 4,
        actorPlayerId: commandId,
        action: { type: "CANCEL", reason: "Weather" },
      }),
    ).toThrow();
  });

  it("public boards cannot carry player, invite, or room access data", () => {
    const board = {
      slug: "colombo-cup",
      name: "Colombo Cup",
      status: "group_stage",
      profile: "classic_304_4p",
      drawSeed: "published-seed",
      teams: [{ id: commandId, name: "Café Kings" }],
      rounds: [],
      standings: [],
      bracket: null,
      championTeamId: null,
      activity: [],
      updatedAt: "2026-07-26T10:00:00.000Z",
    };
    expect(PublicTournamentBoardSchema.parse(board)).toEqual(board);
    expect(() =>
      PublicTournamentBoardSchema.parse({ ...board, playerIds: [commandId] }),
    ).toThrow();
  });
});
