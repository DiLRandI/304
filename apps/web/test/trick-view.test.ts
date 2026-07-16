import { describe, expect, it } from "vitest";
import { readProjectedTrick } from "../src/features/room/model/trick-view.js";

describe("projected trick view", () => {
  it("reads each play through the card privacy boundary", () => {
    expect(
      readProjectedTrick({
        plays: [
          {
            card: { cardId: "hidden-1", hidden: true, rank: "J" },
            faceDown: true,
            seatIndex: 2,
          },
        ],
      }),
    ).toEqual([
      {
        card: {
          cardId: "hidden-1",
          hidden: true,
          points: null,
          rank: null,
          suit: null,
        },
        faceDown: true,
        seatIndex: 2,
      },
    ]);
  });

  it("rejects plays without a valid seat or face-down flag", () => {
    expect(
      readProjectedTrick({
        plays: [
          {
            card: { cardId: "S_J", points: 30, rank: "J", suit: "spades" },
            seatIndex: -1,
          },
        ],
      }),
    ).toBeNull();
  });
});
