import type { GameAction } from "@three-zero-four/contracts";
import { cardId } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { toGameplayCommand } from "../src/contexts/gameplay/adapters/integration/wire-gameplay-command-mapper.js";

describe("toGameplayCommand", () => {
  it.each([
    [
      { amount: 160, type: "BID" },
      { actor: 1, amount: 160, type: "BID" },
    ],
    [{ type: "PASS_BID" }, { actor: 1, type: "PASS_BID" }],
    [
      { cardId: "S_J", type: "SELECT_TRUMP" },
      { actor: 1, cardId: "S_J", type: "SELECT_TRUMP" },
    ],
    [{ type: "TRUMP_OPEN" }, { actor: 1, type: "TRUMP_OPEN" }],
    [{ type: "TRUMP_CLOSE" }, { actor: 1, type: "TRUMP_CLOSE" }],
    [
      {
        cardId: "C_7",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      },
      {
        actor: 1,
        cardId: "C_7",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      },
    ],
    [{ type: "ACK_RESULT" }, { actor: 1, type: "ACK_RESULT" }],
  ] as const)("maps %j into a domain command", (action, expected) => {
    expect(
      toGameplayCommand(action as GameAction, 1, 4, cardId("S_J")),
    ).toEqual(expected);
  });

  it("restores the concealed indicator card identity", () => {
    expect(
      toGameplayCommand(
        {
          cardId: "__trump_indicator__",
          faceDown: true,
          fromIndicator: true,
          type: "PLAY_CARD",
        },
        0,
        4,
        cardId("H_9"),
      ),
    ).toEqual({
      actor: 0,
      cardId: "H_9",
      faceDown: true,
      fromIndicator: true,
      type: "PLAY_CARD",
    });
  });

  it.each([
    {
      action: {
        cardId: "invalid",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      } as GameAction,
      indicator: cardId("S_J"),
    },
    {
      action: {
        cardId: "__trump_indicator__",
        faceDown: true,
        fromIndicator: true,
        type: "PLAY_CARD",
      } as GameAction,
      indicator: null,
    },
  ])("rejects invalid wire card identity", ({ action, indicator }) => {
    expect(() => toGameplayCommand(action, 0, 4, indicator)).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });
});
