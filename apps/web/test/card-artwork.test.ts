import { describe, expect, it } from "vitest";
import { resolveCardArtwork } from "../src/features/room/model/card-artwork.js";

const SUITS = [
  ["S", "spades"],
  ["C", "clubs"],
  ["D", "diamonds"],
  ["H", "hearts"],
] as const;
const STANDARD_RANKS = ["J", "9", "A", "10", "K", "Q", "8", "7"] as const;
const EXTRA_RANKS = ["2", "3", "6"] as const;

describe("classic card artwork", () => {
  it("resolves every Classic and six-seat card ID to the correct generated SVG collection", () => {
    for (const [suitCode, suit] of SUITS) {
      for (const rank of [...STANDARD_RANKS, ...EXTRA_RANKS]) {
        const cardId = `${suitCode}_${rank}`;
        const collection = STANDARD_RANKS.includes(
          rank as (typeof STANDARD_RANKS)[number],
        )
          ? "standard_304"
          : "variant_extras";
        const artwork = resolveCardArtwork({
          cardId,
          hidden: false,
          points: 0,
          rank,
          suit,
        });

        expect(artwork?.src, cardId).toMatch(
          new RegExp(
            `/generated/card-art/cards/${collection}/svg/${cardId}_.+\\.svg$`,
          ),
        );
        expect(artwork?.src, cardId).not.toContain("/png/");
      }
    }
  });

  it("uses only the shared back for hidden cards and a semantic fallback for unknown visible cards", () => {
    expect(
      resolveCardArtwork({
        cardId: "private-S_J",
        hidden: true,
        points: null,
        rank: null,
        suit: null,
      }),
    ).toEqual({
      kind: "artwork",
      src: "/generated/card-art/backs/svg/card_back_304_ceylon.svg",
    });
    expect(
      resolveCardArtwork({
        cardId: "unknown",
        hidden: false,
        points: 0,
        rank: "4",
        suit: "clubs",
      }),
    ).toBeNull();
  });
});
