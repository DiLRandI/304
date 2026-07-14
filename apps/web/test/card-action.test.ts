import { describe, expect, it } from "vitest";
import {
  cardAction,
  partitionCardActions,
} from "../src/features/room/model/card-action.js";
import { jackOfSpades, sevenOfClubs } from "./browser-fixtures.js";

describe("projected card actions", () => {
  it("prefers the face-up action while keeping alternate and reserved commands", () => {
    const faceDown = {
      cardId: jackOfSpades.cardId,
      faceDown: true,
      fromIndicator: false,
      type: "PLAY_CARD" as const,
    };
    const faceUp = {
      cardId: jackOfSpades.cardId,
      faceDown: false,
      fromIndicator: false,
      type: "PLAY_CARD" as const,
    };
    const indicator = {
      cardId: "__trump_indicator__",
      faceDown: true,
      fromIndicator: true,
      type: "PLAY_CARD" as const,
    };

    expect(cardAction(jackOfSpades, [faceDown, faceUp, indicator])).toBe(
      faceUp,
    );
    expect(
      partitionCardActions(
        [jackOfSpades, sevenOfClubs],
        [faceDown, faceUp, indicator],
      ),
    ).toEqual({ cardActions: [faceUp], commandActions: [faceDown, indicator] });
  });
});
