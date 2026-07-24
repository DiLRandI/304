import { describe, expect, it } from "vitest";
import { readProjectedHandResult } from "../src/features/room/model/hand-result-view.js";

describe("projected hand result", () => {
  it("reads an all-pass result without inventing score fields", () => {
    expect(
      readProjectedHandResult({
        handNumber: 2,
        noScore: true,
        reason: "all_passed",
        tokens: [11, 11],
      }),
    ).toEqual({
      handNumber: 2,
      noScore: true,
      reason: "all_passed",
      tokens: [11, 11],
    });
  });

  it("rejects overbroad scored results", () => {
    expect(
      readProjectedHandResult({
        bidderTeam: "A",
        bidderTeamPoints: 196,
        bid: 160,
        handNumber: 1,
        internalSeed: "must-not-cross-boundary",
        matchComplete: false,
        movement: 1,
        otherTeamPoints: 108,
        settlementReason: "all-tricks-played",
        success: true,
        tokens: [12, 10],
        trickCount: 8,
        winningTeam: "A",
      }),
    ).toBeUndefined();
  });

  it("reads early captured-at-stop totals and their settlement reason", () => {
    expect(
      readProjectedHandResult({
        bidderTeam: "A",
        bidderTeamPoints: 160,
        bid: 160,
        handNumber: 1,
        matchComplete: false,
        movement: 1,
        otherTeamPoints: 42,
        settlementReason: "bid-reached",
        success: true,
        tokens: [12, 10],
        trickCount: 5,
        winningTeam: "A",
      }),
    ).toMatchObject({
      bidderTeamPoints: 160,
      otherTeamPoints: 42,
      settlementReason: "bid-reached",
    });
  });
});
