import { describe, expect, it } from "vitest";
import {
  InvalidDisplayNameError,
  normalizeDisplayName,
} from "../src/contexts/player-access/domain/display-name.js";

describe("player display name", () => {
  it("normalizes surrounding whitespace", () => {
    expect(normalizeDisplayName("  Asha  ")).toBe("Asha");
  });

  it.each([
    "",
    "   ",
    "A".repeat(49),
  ])("rejects an invalid display name: %j", (value) => {
    expect(() => normalizeDisplayName(value)).toThrow(InvalidDisplayNameError);
  });

  it("accepts the 48-character boundary", () => {
    const value = "A".repeat(48);
    expect(normalizeDisplayName(value)).toBe(value);
  });
});
