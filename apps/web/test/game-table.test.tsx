/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GameTable } from "../src/components/game-table.js";
import { activeProjection, jackOfSpades } from "./browser-fixtures.js";

describe("GameTable", () => {
  it("enables only a legal projected card and submits its server action", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    render(
      <GameTable
        connection="live"
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
      <GameTable connection="live" projection={projection} submit={vi.fn()} />,
    );

    expect(
      screen.getByText("This table update could not be displayed safely."),
    ).toBeTruthy();
  });
});
