/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HomePage from "../src/app/page.js";
import PrivacyPage from "../src/app/privacy/page.js";
import RulesPage from "../src/app/rules/page.js";
import TermsPage from "../src/app/terms/page.js";

describe("public release pages", () => {
  afterEach(cleanup);

  it("links a player to the public policies without wagering language", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
    ).toBe("/privacy");
    expect(
      screen.getByRole("link", { name: "Terms" }).getAttribute("href"),
    ).toBe("/terms");
    expect(
      screen.getByText("Casual play only. No money, prizes, or wagering."),
    ).toBeTruthy();
  });

  it("documents only the shipped 304 profiles and card values", () => {
    render(<RulesPage />);

    expect(screen.getByText("Classic four-seat 304")).toBeTruthy();
    expect(screen.getByText("Six-seat 304-36")).toBeTruthy();
    expect(screen.getByText("Jack · 30 points")).toBeTruthy();
    expect(screen.getByText("Nine · 20 points")).toBeTruthy();
  });

  it("states the actual casual data and no-wagering boundaries", () => {
    const { unmount } = render(<PrivacyPage />);

    expect(
      screen.getByText("No payment, location, or contact data is collected."),
    ).toBeTruthy();
    unmount();

    render(<TermsPage />);
    expect(screen.getByText("No money, prizes, or wagering.")).toBeTruthy();
  });
});
