/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HandResult } from "../src/features/room/ui/hand-result.js";

describe("HandResult", () => {
  afterEach(cleanup);

  it("labels early totals as captured when play stopped", () => {
    render(
      <HandResult
        bidderOwner={null}
        bidderSeatTeam="A"
        result={{
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
        }}
        trumpLabel="Spades"
      />,
    );

    expect(
      screen.getByText("Bidder points captured when play stopped"),
    ).toBeTruthy();
    expect(
      screen.getByText("Other team points captured when play stopped"),
    ).toBeTruthy();
    expect(screen.queryByText("Bidder points")).toBeNull();
    expect(screen.queryByText("Other team points")).toBeNull();
  });
});
