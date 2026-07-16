import { describe, expect, it } from "vitest";
import { roomClosureReason } from "../src/maintenance.js";

const lobbyCutoff = new Date("2026-07-13T00:00:00.000Z");
const terminalCutoff = new Date("2026-06-30T00:00:00.000Z");

describe("room maintenance policy", () => {
  it("closes an idle lobby at the configured boundary", () => {
    expect(
      roomClosureReason(
        { status: "lobby", updatedAt: lobbyCutoff },
        { lobbyCutoff, terminalCutoff },
      ),
    ).toBe("LOBBY_IDLE");
  });

  it("closes a retained hand result at the configured boundary", () => {
    expect(
      roomClosureReason(
        { status: "hand_result", updatedAt: terminalCutoff },
        { lobbyCutoff, terminalCutoff },
      ),
    ).toBe("TERMINAL_RETENTION");
  });

  it.each([
    {
      status: "lobby" as const,
      updatedAt: new Date(lobbyCutoff.getTime() + 1),
    },
    {
      status: "hand_result" as const,
      updatedAt: new Date(terminalCutoff.getTime() + 1),
    },
    { status: "in_hand" as const, updatedAt: new Date(0) },
    { status: "closed" as const, updatedAt: new Date(0) },
    { status: "recovery_failed" as const, updatedAt: new Date(0) },
  ])("keeps a non-stale or ineligible room open: %j", (room) => {
    expect(roomClosureReason(room, { lobbyCutoff, terminalCutoff })).toBeNull();
  });
});
