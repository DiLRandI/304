import { describe, expect, it } from "vitest";
import { activeRoomStatus } from "../src/contexts/gameplay/application/gameplay-room-status.js";

describe("gameplay room status", () => {
  it.each([
    ["setup", "lobby"],
    ["four_card_bidding", "in_hand"],
    ["hand_result", "hand_result"],
    ["match_complete", "hand_result"],
  ])("maps %s to room status %s", (phase, expected) => {
    expect(activeRoomStatus({ phase })).toBe(expected);
  });
});
