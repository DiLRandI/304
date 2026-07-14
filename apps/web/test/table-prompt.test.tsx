/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TablePrompt } from "../src/features/room/ui/table-prompt.js";

describe("TablePrompt", () => {
  afterEach(cleanup);

  it("announces connection, turn, trump, trick, and projected prompt state", () => {
    render(
      <TablePrompt
        connection="reconnecting"
        isPlayersTurn={false}
        prompt="Waiting for Seat 2."
        trickCardCount={1}
        trump={{ isOpen: true, suit: "hearts" }}
      />,
    );

    expect(screen.getByText("Table update")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "reconnecting connection. Waiting for the table. Trump open to hearts. 1 card in current trick. Waiting for Seat 2.",
    );
  });
});
