/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameTable } from "../src/components/game-table.js";
import {
  activeProjection,
  jackOfSpades,
  resultProjection,
} from "./browser-fixtures.js";

describe("GameTable", () => {
  afterEach(cleanup);

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
    expect(result.textContent).toContain("Winning team A");
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
