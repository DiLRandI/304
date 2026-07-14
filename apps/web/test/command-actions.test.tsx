/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActions } from "../src/features/room/ui/command-actions.js";
import { jackOfSpades } from "./browser-fixtures.js";

describe("CommandActions", () => {
  afterEach(cleanup);

  it("labels and submits projected non-card actions", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const bid = { amount: 200, type: "BID" } as const;

    render(
      <CommandActions
        actions={[bid]}
        hand={[jackOfSpades]}
        handResult={null}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Bid 200" }));

    expect(onSelect).toHaveBeenCalledWith(bid);
  });

  it("renders nothing when no command is available", () => {
    const { container } = render(
      <CommandActions
        actions={[]}
        hand={[jackOfSpades]}
        handResult={null}
        onSelect={vi.fn()}
      />,
    );

    expect(container.childElementCount).toBe(0);
  });
});
