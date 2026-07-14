/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameTable } from "../src/components/game-table.js";
import {
  activeProjection,
  jackOfSpades,
  resultProjection,
  sevenOfClubs,
} from "./browser-fixtures.js";

describe("GameTable", () => {
  afterEach(cleanup);

  it("offers table exit only after the active hand finishes", async () => {
    const activeRender = render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={activeProjection()}
        submit={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Leave table" })).toBeNull();
    expect(
      screen.getByText("You can leave after this hand finishes."),
    ).toBeTruthy();
    activeRender.unmount();

    const user = userEvent.setup();
    const leave = vi.fn();
    render(
      <GameTable
        connection="live"
        leave={leave}
        projection={resultProjection()}
        submit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Leave table" }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it("enables only a legal projected card and submits its server action", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={activeProjection()}
        submit={submit}
      />,
    );

    const playable = screen.getByRole("button", {
      name: "Play Jack of Spades, 30 points",
    }) as HTMLButtonElement;
    const illegal = screen.getByRole("button", {
      name: "Play Seven of Clubs, 0 points",
    }) as HTMLButtonElement;

    expect(playable.disabled).toBe(false);
    expect(illegal.disabled).toBe(true);
    expect(illegal.getAttribute("aria-describedby")).toBe("card-legality-note");
    expect(
      screen.getByText("This card is not legal for this turn.", {
        exact: false,
      }),
    ).toBeTruthy();
    await user.click(playable);
    expect(submit).toHaveBeenCalledWith({
      cardId: jackOfSpades.cardId,
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    });
  });

  it("renders the reserved closed-trump indicator as a legal action", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const projection = activeProjection();
    const indicatorAction = {
      cardId: "__trump_indicator__",
      faceDown: true,
      fromIndicator: true,
      type: "PLAY_CARD" as const,
    };
    projection.view.legalActions = [indicatorAction];

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={submit}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Play hidden trump indicator face down",
      }),
    );
    expect(submit).toHaveBeenCalledWith(indicatorAction);
  });

  it("keeps both face-up and face-down legal plays reachable", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const projection = activeProjection();
    const faceUpAction = projection.view.legalActions[0];
    const faceDownAction = {
      cardId: jackOfSpades.cardId,
      faceDown: true,
      fromIndicator: false,
      type: "PLAY_CARD" as const,
    };
    projection.view.legalActions = [faceUpAction, faceDownAction];

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={submit}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Play Jack of Spades, 30 points face down",
      }),
    );
    expect(submit).toHaveBeenCalledWith(faceDownAction);

    await user.click(
      screen.getByRole("button", {
        name: "Play Jack of Spades, 30 points",
      }),
    );
    expect(submit).toHaveBeenCalledWith(faceUpAction);
  });

  it("keeps malformed private view data out of the table", () => {
    const projection = activeProjection();
    projection.view = { publicState: { seats: "not-a-seat-list" } };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("This table update could not be displayed safely."),
    ).toBeTruthy();
  });

  it("does not present partial trick points as a complete score", () => {
    const projection = activeProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.trickPointsPartial = true;

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Hidden until face-down cards are revealed"),
    ).toBeTruthy();
  });

  it("names the bidding team, player, and seat beside the live bid", () => {
    const projection = activeProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.bidding = { currentBid: 300, currentBidSeat: 0 };
    const seats = publicState.seats as Array<Record<string, unknown>>;
    seats[0] = {
      ...seats[0],
      displayName: "dd",
      seatLabel: "Seat 1",
      team: "A",
    };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("Team A · dd (Seat 1)")).toBeTruthy();
  });

  it("renders played cards as accessible visuals at their player seats", () => {
    const projection = activeProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.trick = {
      plays: [
        { card: sevenOfClubs, faceDown: false, seatIndex: 2 },
        {
          card: { cardId: "hidden-indicator", hidden: true },
          faceDown: true,
          seatIndex: 3,
        },
      ],
    };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    const trick = screen.getByRole("region", { name: "Current trick" });
    const visibleCard = within(trick).getByRole("img", {
      name: "Seven of Clubs, 0 points, played by Seat 3",
    });
    expect(
      visibleCard.closest(".trick-card")?.getAttribute("data-seat-index"),
    ).toBe("2");
    expect(trick.textContent).not.toContain("Seven of Clubs");

    const hiddenCard = within(trick).getByRole("img", {
      name: "Hidden card, played by Seat 4",
    });
    expect(hiddenCard.closest(".trick-card")?.getAttribute("data-hidden")).toBe(
      "true",
    );
    expect(
      trick.querySelector(".trick-cards")?.getAttribute("data-seat-count"),
    ).toBe("4");
  });

  it("announces only the server-projected result and labels continuation precisely", () => {
    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={resultProjection()}
        submit={vi.fn()}
      />,
    );

    const result = screen.getByRole("region", { name: "Hand result" });
    expect(result.textContent).toContain("Team A wins the hand");
    expect(result.textContent).toContain("Bid160");
    expect(result.textContent).toContain("Bid met");
    expect(result.textContent).toContain("TrumpHidden");
    expect(screen.getByRole("button", { name: "Next hand" })).toBeTruthy();
    expect(screen.getByLabelText("Seat 1").getAttribute("data-seat-type")).toBe(
      "human",
    );
    expect(screen.getByLabelText("Seat 1").getAttribute("data-hand-size")).toBe(
      "8",
    );
  });

  it("explains who owned a missed bid and why the other team won", () => {
    const projection = resultProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.bidding = { currentBid: 300, currentBidSeat: 0 };
    const seats = publicState.seats as Array<Record<string, unknown>>;
    seats[0] = {
      ...seats[0],
      displayName: "dd",
      seatLabel: "Seat 1",
      team: "A",
    };
    publicState.handResult = {
      bidderTeam: "A",
      bidderTeamPoints: 223,
      bid: 300,
      handNumber: 2,
      matchComplete: false,
      movement: 4,
      otherTeamPoints: 81,
      success: false,
      tokens: [11, 11],
      trickCount: 8,
      winningTeam: "B",
    };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Team B wins the hand" }),
    ).toBeTruthy();
    expect(screen.getByText("Team A · dd (Seat 1) bid 300")).toBeTruthy();
    expect(screen.getByText("Team A scored 223 and missed by 77")).toBeTruthy();
  });

  it("falls back to the bidding team when the bidder seat is unavailable", () => {
    const projection = resultProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.bidding = { currentBid: 160, currentBidSeat: 99 };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    expect(screen.getByText("Team A bid 160")).toBeTruthy();
    expect(screen.getByText("Team A met the 160 bid by 36")).toBeTruthy();
  });

  it("uses the rematch label only for a completed match and rejects overbroad result data", () => {
    const completed = resultProjection(true);
    const completedRender = render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={completed}
        submit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Play another match" }),
    ).toBeTruthy();
    completedRender.unmount();

    const overbroad = resultProjection();
    const publicState = overbroad.view.publicState as Record<string, unknown>;
    publicState.handResult = {
      ...(publicState.handResult as Record<string, unknown>),
      shuffleSeed: 42,
    };
    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={overbroad}
        submit={vi.fn()}
      />,
    );
    expect(
      screen.getByText("This table update could not be displayed safely."),
    ).toBeTruthy();
  });

  it("renders a strictly projected no-score result without inventing a winner", () => {
    const projection = resultProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.handResult = {
      handNumber: 1,
      noScore: true,
      reason: "All players passed. No score movement this hand.",
      tokens: [11, 11],
    };

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={vi.fn()}
      />,
    );

    const result = screen.getByRole("region", { name: "Hand result" });
    expect(result.textContent).toContain("No score movement");
    expect(result.textContent).toContain("All players passed");
    expect(result.textContent).not.toContain("Winning team");
  });

  it("opens profile-appropriate rule help without creating a game action", async () => {
    const user = userEvent.setup();
    const projection = activeProjection();
    const publicState = projection.view.publicState as Record<string, unknown>;
    publicState.profileId = "six_304_36";
    const submit = vi.fn();

    render(
      <GameTable
        connection="live"
        leave={vi.fn()}
        projection={projection}
        submit={submit}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Rules and card values" }),
    );

    expect(
      screen.getByRole("heading", { name: "How bidding works" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Trump and cutting" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Scoring tokens" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Six-seat 304-36" }),
    ).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
});
