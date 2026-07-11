/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentBanner } from "../src/components/consent-banner.js";
import { CONSENT_STORAGE_KEY, track } from "../src/lib/consent.js";

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
});
