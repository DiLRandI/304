import { describe, expect, it } from "vitest";
import {
  automationSeatIndex,
  completedTrickWinner,
  phaseTimeoutMs,
} from "../src/contexts/automation/application/automation-policy.js";

describe("automation policy", () => {
  it("selects only an integer active seat outside result phases", () => {
    expect(
      automationSeatIndex({ phase: "trick_play", activeSeat: 2 } as never),
    ).toBe(2);
    expect(
      automationSeatIndex({ phase: "hand_result", activeSeat: 2 } as never),
    ).toBeNull();
    expect(
      automationSeatIndex({ phase: "trick_play", activeSeat: null } as never),
    ).toBeNull();
  });

  it("reads a completed trick winner defensively", () => {
    expect(
      completedTrickWinner({ currentTrick: { winnerSeat: 3 } } as never),
    ).toBe(3);
    expect(completedTrickWinner({ currentTrick: null } as never)).toBeNull();
  });

  it.each([
    ["trump_choice", 15_000],
    ["hand_result", 20_000],
    ["trick_play", 30_000],
  ])("sets the %s timeout to %d ms", (phase, expected) => {
    expect(phaseTimeoutMs({ phase } as never)).toBe(expected);
  });
});
