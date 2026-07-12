/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibilityPreferences } from "../src/components/accessibility-preferences.js";
import { GameTable } from "../src/components/game-table.js";
import { activeProjection, jackOfSpades } from "./browser-fixtures.js";

describe("browser accessibility", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-card-size");
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.removeAttribute("data-reduced-motion");
    localStorage.clear();
  });

  it("announces the turn and supports keyboard submission of a legal action", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    render(
      <GameTable
        connection="live"
        projection={activeProjection()}
        submit={submit}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Your turn");
    expect(status.textContent).toContain("Live table");
    expect(status.textContent).toContain("Trump hidden");
    expect(status.textContent).toContain("0 cards in current trick");
    await user.tab();
    const card = screen.getByRole("button", {
      name: "Play Jack of Spades, 30 points",
    });
    expect(document.activeElement).toBe(card);
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledWith({
      cardId: jackOfSpades.cardId,
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD",
    });
  });

  it("keeps card-value help available without hiding the table", async () => {
    const user = userEvent.setup();

    render(
      <GameTable
        connection="live"
        projection={activeProjection()}
        submit={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Rules and card values" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Rules and card values" }),
    ).toBeTruthy();
    expect(screen.getByText("Jack · 30 points")).toBeTruthy();
  });

  it("applies explicit display preferences through document data attributes", async () => {
    const user = userEvent.setup();

    render(<AccessibilityPreferences />);

    await user.selectOptions(screen.getByLabelText("Card size"), "large");
    await user.click(screen.getByLabelText("High contrast"));
    await user.click(screen.getByLabelText("Reduce motion"));

    expect(document.documentElement.dataset.cardSize).toBe("large");
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
  });

  it("renders default preferences when storage access is denied", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });

    try {
      render(<AccessibilityPreferences />);

      expect(screen.getByLabelText("Card size")).toHaveProperty(
        "value",
        "normal",
      );
      expect(screen.getByLabelText("High contrast")).toHaveProperty(
        "checked",
        false,
      );
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });

  it("applies preference changes in memory when storage writes fail", async () => {
    const user = userEvent.setup();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });

    try {
      render(<AccessibilityPreferences />);

      await user.selectOptions(screen.getByLabelText("Card size"), "large");
      await user.click(screen.getByLabelText("High contrast"));
      await user.click(screen.getByLabelText("Reduce motion"));

      expect(screen.getByLabelText("Card size")).toHaveProperty(
        "value",
        "large",
      );
      expect(screen.getByLabelText("High contrast")).toHaveProperty(
        "checked",
        true,
      );
      expect(document.documentElement.dataset.cardSize).toBe("large");
      expect(document.documentElement.dataset.contrast).toBe("high");
      expect(document.documentElement.dataset.reducedMotion).toBe("true");
    } finally {
      setItem.mockRestore();
    }
  });
});
