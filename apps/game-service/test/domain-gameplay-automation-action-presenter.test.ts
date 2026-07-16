import {
  bidAmount,
  cardId,
  type GameplayCommand,
  seatIndex,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { presentAutomatedGameplayAction } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-action-presenter.js";

describe("presentAutomatedGameplayAction", () => {
  it.each<readonly [GameplayCommand, object]>([
    [
      { actor: seatIndex(0, 4), amount: bidAmount(160), type: "BID" },
      { amount: 160, type: "BID" },
    ],
    [{ actor: seatIndex(1, 4), type: "PASS_BID" }, { type: "PASS_BID" }],
    [
      {
        actor: seatIndex(2, 4),
        cardId: cardId("H_J"),
        type: "SELECT_TRUMP",
      },
      { cardId: "H_J", type: "SELECT_TRUMP" },
    ],
    [{ actor: seatIndex(2, 4), type: "TRUMP_OPEN" }, { type: "TRUMP_OPEN" }],
    [{ actor: seatIndex(2, 4), type: "TRUMP_CLOSE" }, { type: "TRUMP_CLOSE" }],
    [
      {
        actor: seatIndex(3, 4),
        cardId: cardId("S_J"),
        faceDown: true,
        fromIndicator: true,
        type: "PLAY_CARD",
      },
      {
        cardId: "__trump_indicator__",
        faceDown: true,
        fromIndicator: true,
        type: "PLAY_CARD",
      },
    ],
    [{ actor: seatIndex(0, 4), type: "ACK_RESULT" }, { type: "ACK_RESULT" }],
  ])("maps %j to the replay-compatible wire action", (command, expected) => {
    expect(presentAutomatedGameplayAction(command)).toEqual(expected);
  });

  it("rejects an internal trick-advance command as a wire action", () => {
    expect(() =>
      presentAutomatedGameplayAction({ actor: null, type: "ADVANCE_TRICK" }),
    ).toThrow(expect.objectContaining({ code: "AUTOMATION_ACTION_REJECTED" }));
  });
});
