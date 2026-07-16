import { describe, expect, it } from "vitest";
import { presentGameAction } from "../src/contexts/gameplay/adapters/delivery/game-action-presenter.js";

describe("presentGameAction", () => {
  it.each([
    [
      { type: "BID", amount: 160 },
      { type: "BID", amount: 160 },
    ],
    [{ type: "PASS_BID" }, { type: "PASS_BID" }],
    [
      { type: "SELECT_TRUMP", cardId: "7H" },
      { type: "SELECT_TRUMP", cardId: "7H" },
    ],
    [{ type: "TRUMP_OPEN" }, { type: "TRUMP_OPEN" }],
    [{ type: "TRUMP_CLOSE" }, { type: "TRUMP_CLOSE" }],
    [
      { type: "PLAY_CARD", cardId: "AS", faceDown: true },
      {
        type: "PLAY_CARD",
        cardId: "AS",
        faceDown: true,
        fromIndicator: false,
      },
    ],
    [
      {
        type: "PLAY_CARD",
        cardId: "S_J",
        faceDown: true,
        fromIndicator: true,
      },
      {
        type: "PLAY_CARD",
        cardId: "__trump_indicator__",
        faceDown: true,
        fromIndicator: true,
      },
    ],
    [{ type: "ACK_RESULT" }, { type: "ACK_RESULT" }],
  ])("maps %j to its wire action", (engineAction, expected) => {
    expect(presentGameAction(engineAction)).toEqual(expected);
  });

  it("rejects malformed engine actions at the delivery boundary", () => {
    expect(() => presentGameAction({ type: "BID", amount: "160" })).toThrow(
      expect.objectContaining({ code: "ROOM_DATA_INVALID", kind: "internal" }),
    );
  });
});
