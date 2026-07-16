import { describe, expect, it } from "vitest";
import { readProjectedCard } from "../src/features/room/model/card-view.js";

describe("projected card view", () => {
  it("discards card identity fields when the server marks a card hidden", () => {
    expect(
      readProjectedCard({
        cardId: "hidden-1",
        hidden: true,
        points: 30,
        rank: "J",
        suit: "spades",
      }),
    ).toEqual({
      cardId: "hidden-1",
      hidden: true,
      points: null,
      rank: null,
      suit: null,
    });
  });

  it("rejects a visible card without its complete public identity", () => {
    expect(
      readProjectedCard({ cardId: "S_J", rank: "J", suit: "spades" }),
    ).toBeNull();
  });
});
