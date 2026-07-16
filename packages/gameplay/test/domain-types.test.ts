import { describe, expect, it } from "vitest";
import {
  bidAmount,
  cardId,
  type GameplayCommand,
  type GameplayEvent,
  ruleProfileId,
  seatIndex,
} from "../src/index.js";

describe("gameplay domain values", () => {
  it("creates bounded seat indexes", () => {
    expect(seatIndex(0, 4)).toBe(0);
    expect(seatIndex(5, 6)).toBe(5);
    expect(() => seatIndex(-1, 4)).toThrowError("Invalid seat index");
    expect(() => seatIndex(4, 4)).toThrowError("Invalid seat index");
    expect(() => seatIndex(1.5, 4)).toThrowError("Invalid seat index");
  });

  it("creates canonical card, bid, and profile values", () => {
    expect(cardId("C_J")).toBe("C_J");
    expect(cardId("S_10")).toBe("S_10");
    expect(() => cardId("clubs-J")).toThrowError("Invalid card id");

    expect(bidAmount(160)).toBe(160);
    expect(bidAmount(304)).toBe(304);
    expect(() => bidAmount(159)).toThrowError("Invalid bid amount");
    expect(() => bidAmount(305)).toThrowError("Invalid bid amount");

    expect(ruleProfileId("classic_304_4p")).toBe("classic_304_4p");
    expect(ruleProfileId("six_304_36")).toBe("six_304_36");
    expect(() => ruleProfileId("unknown")).toThrowError("Invalid rule profile");
  });
});

describe("gameplay messages", () => {
  it("keeps actors inside domain commands and events", () => {
    const actor = seatIndex(2, 4);
    const command: GameplayCommand = {
      actor,
      amount: bidAmount(200),
      type: "BID",
    };
    const event: GameplayEvent = {
      actor,
      amount: bidAmount(200),
      type: "BID_PLACED",
    };

    expect(command).toEqual({ actor: 2, amount: 200, type: "BID" });
    expect(event).toEqual({ actor: 2, amount: 200, type: "BID_PLACED" });
  });
});
