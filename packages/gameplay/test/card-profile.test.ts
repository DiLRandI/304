import { describe, expect, it } from "vitest";
import {
  buildDeck,
  compareCardsForTrick,
  compareRank,
  getRuleProfile,
  shuffleDeck,
} from "../src/index.js";

describe("gameplay rule profiles", () => {
  it.each([
    ["classic_304_4p", 4, 32, [4, 4]],
    ["six_304_36", 6, 36, [4, 2]],
  ] as const)("defines the %s deck and seating contract", (profileId, seatCount, cardCount, cardBatch) => {
    const profile = getRuleProfile(profileId);
    const deck = buildDeck(profile);

    expect(profile.seatCount).toBe(seatCount);
    expect(profile.cardBatch).toEqual(cardBatch);
    expect(deck).toHaveLength(cardCount);
    expect(new Set(deck.map((card) => card.id)).size).toBe(cardCount);
    expect(deck.reduce((total, card) => total + card.points, 0)).toBe(304);
  });
});

describe("card rules", () => {
  const profile = getRuleProfile("classic_304_4p");
  const jack = { id: "C_J", points: 30, rank: "J", suit: "clubs" } as const;
  const nine = { id: "C_9", points: 20, rank: "9", suit: "clubs" } as const;
  const heartJack = {
    id: "H_J",
    points: 30,
    rank: "J",
    suit: "hearts",
  } as const;

  it("orders ranks and resolves led and trump suits", () => {
    expect(compareRank(profile, jack.rank, nine.rank)).toBeGreaterThan(0);
    expect(
      compareCardsForTrick(profile, heartJack, jack, "hearts", "clubs", true),
    ).toBeGreaterThan(0);
    expect(
      compareCardsForTrick(profile, heartJack, jack, "hearts", "clubs", false),
    ).toBeLessThan(0);
  });

  it("shuffles from injected entropy without mutating the source deck", () => {
    const deck = buildDeck(profile).slice(0, 4);
    const sourceOrder = deck.map((card) => card.id);
    const values = [0.75, 0.5, 0.25];
    let index = 0;

    const shuffled = shuffleDeck(deck, {
      next: () => values[index++] ?? 0,
    });

    expect(deck.map((card) => card.id)).toEqual(sourceOrder);
    expect(shuffled.map((card) => card.id)).toEqual([
      sourceOrder[2],
      sourceOrder[0],
      sourceOrder[1],
      sourceOrder[3],
    ]);
  });

  it("rejects entropy outside the unit interval", () => {
    expect(() =>
      shuffleDeck([jack, nine], {
        next: () => 1,
      }),
    ).toThrowError("Invalid random value");
  });
});
