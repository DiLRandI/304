import { describe, expect, it, vi } from "vitest";
import { NodeAutomationRandomSource } from "../src/contexts/automation/adapters/entropy/node-automation-random-source.js";

describe("NodeAutomationRandomSource", () => {
  it("normalizes an injected unsigned integer into the domain range", () => {
    const randomInteger = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(2 ** 32 - 1);
    const random = new NodeAutomationRandomSource(randomInteger);

    expect(random.next()).toBe(0);
    expect(random.next()).toBe((2 ** 32 - 1) / 2 ** 32);
    expect(randomInteger).toHaveBeenNthCalledWith(1, 2 ** 32);
    expect(randomInteger).toHaveBeenNthCalledWith(2, 2 ** 32);
  });

  it("uses Node entropy to produce values inside the domain range", () => {
    const random = new NodeAutomationRandomSource();

    for (let sample = 0; sample < 32; sample += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
