import { describe, expect, it } from "vitest";
import {
  activeRoomStatus,
  automationSeatIndex,
  completedTrickWinner,
  phaseTimeoutMs,
} from "../src/contexts/gameplay/application/gameplay-automation-policy.js";

describe("gameplay automation policy", () => {
  it.each([
    ["setup", "lobby"],
    ["four_card_bidding", "in_hand"],
    ["hand_result", "hand_result"],
    ["match_complete", "hand_result"],
  ])("maps %s to room status %s", (phase, expected) => {
    expect(activeRoomStatus({ phase } as never)).toBe(expected);
  });

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
