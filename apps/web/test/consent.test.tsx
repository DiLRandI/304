/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_STORAGE_KEY,
  track,
} from "../src/features/consent/model/consent.js";
import { ConsentBanner } from "../src/features/consent/ui/consent-banner.js";

describe("public analytics consent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(cleanup);

  it("stores an explicit essential-only choice and keeps analytics disabled", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    const transport = vi.fn();

    render(<ConsentBanner onChoice={onChoice} />);

    await user.click(screen.getByRole("button", { name: "Essential only" }));

    expect(onChoice).toHaveBeenCalledWith("essential_only");
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("essential_only");
    expect(
      track(
        "page_view",
        { screen: "play" },
        { endpoint: "https://analytics.example.test/collect", transport },
      ),
    ).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends only allowlisted anonymous analytics after explicit opt-in", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, "optional_analytics");
    const transport = vi.fn();
    const options = {
      endpoint: "https://analytics.example.test/collect",
      transport,
    };

    expect(track("page_view", { screen: "play" }, options)).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      "https://analytics.example.test/collect",
      { event: "page_view", properties: { screen: "play" } },
    );
    expect(track("page_view", { cardId: "private-card" }, options)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("reflects consent changes made in another browser document", () => {
    render(<ConsentBanner />);

    expect(
      screen.getByRole("complementary", { name: "Privacy choices" }),
    ).toBeTruthy();

    localStorage.setItem(CONSENT_STORAGE_KEY, "essential_only");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CONSENT_STORAGE_KEY,
          newValue: "essential_only",
        }),
      );
    });

    expect(
      screen.queryByRole("complementary", { name: "Privacy choices" }),
    ).toBe(null);
  });

  it("keeps the choice usable when storage writes fail", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });

    try {
      render(<ConsentBanner onChoice={onChoice} />);
      await user.click(screen.getByRole("button", { name: "Essential only" }));

      expect(onChoice).toHaveBeenCalledWith("essential_only");
      expect(
        screen.queryByRole("complementary", { name: "Privacy choices" }),
      ).toBe(null);
    } finally {
      setItem.mockRestore();
    }
  });

  it("falls back to unknown consent when storage reads fail", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("Storage access denied", "SecurityError");
      });

    try {
      render(<ConsentBanner />);
      expect(
        screen.getByRole("complementary", { name: "Privacy choices" }),
      ).toBeTruthy();
      expect(
        track(
          "page_view",
          { screen: "play" },
          {
            endpoint: "https://analytics.example.test/collect",
          },
        ),
      ).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });
});
