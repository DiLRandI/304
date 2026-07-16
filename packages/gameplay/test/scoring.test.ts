import { describe, expect, it } from "vitest";
import {
  bidAmount,
  cancelHand,
  getRuleProfile,
  initialTokens,
  scoreHand,
  seatIndex,
  teamForSeat,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

describe("team and token rules", () => {
  it("assigns alternating seats to teams", () => {
    expect([0, 1, 2, 3].map((seat) => teamForSeat(seatIndex(seat, 4)))).toEqual(
      ["A", "B", "A", "B"],
    );
  });

  it("starts both teams with the profile token balance", () => {
    expect(initialTokens(profile)).toEqual([11, 11]);
  });

  it.each([
    {
      bid: 160,
      bidderPoints: 160,
      expectedMovement: 1,
      expectedTokens: [12, 10],
      success: true,
    },
    {
      bid: 160,
      bidderPoints: 159,
      expectedMovement: 2,
      expectedTokens: [9, 13],
      success: false,
    },
    {
      bid: 200,
      bidderPoints: 200,
      expectedMovement: 2,
      expectedTokens: [13, 9],
      success: true,
    },
    {
      bid: 250,
      bidderPoints: 249,
      expectedMovement: 4,
      expectedTokens: [7, 15],
      success: false,
    },
  ])("applies the token tier for a $bid bid", ({
    bid,
    bidderPoints,
    expectedMovement,
    expectedTokens,
    success,
  }) => {
    const result = scoreHand(profile, {
      bid: bidAmount(bid),
      bidderTeam: "A",
      teamPoints: { A: bidderPoints, B: 304 - bidderPoints },
      tokens: [11, 11],
    });

    expect(result.success).toBe(success);
    expect(result.movement).toBe(expectedMovement);
    expect(result.tokens).toEqual(expectedTokens);
  });

  it("clamps a losing balance to zero and completes the match", () => {
    const result = scoreHand(profile, {
      bid: bidAmount(250),
      bidderTeam: "A",
      teamPoints: { A: 200, B: 104 },
      tokens: [1, 11],
    });

    expect(result.tokens).toEqual([0, 15]);
    expect(result.matchComplete).toBe(true);
    expect(result.winningTeam).toBe("B");
  });

  it("preserves token balances for an all-pass hand", () => {
    expect(cancelHand([8, 14])).toEqual({
      noScore: true,
      reason: "All players passed. No score movement this hand.",
      tokens: [8, 14],
    });
  });
});
