import { describe, expect, it } from "vitest";
import {
  bidAmount,
  buildDeck,
  type GameplayHand,
  gameplayPrompt,
  getRuleProfile,
  initialTokens,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

function start(): GameplayHand {
  return startGameplayHand({
    dealer: seatIndex(3, 4),
    deck: buildDeck(profile),
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
}

describe("gameplay prompt policy", () => {
  it("describes bidding, trump selection, and trump choice", () => {
    const hand = start();
    expect(gameplayPrompt(hand, null)).toBe(
      "Phase: Four-card bidding. Current bid 0.",
    );
    expect(
      gameplayPrompt(
        {
          ...hand,
          bidding: {
            ...hand.bidding,
            currentBid: bidAmount(160),
            round: "second",
          },
          phase: "second-bidding",
        },
        null,
      ),
    ).toBe("Second bidding. Current bid 160.");
    expect(
      gameplayPrompt(
        {
          ...hand,
          phase: "trump-selection",
          trump: { ...hand.trump, maker: seatIndex(0, 4) },
        },
        null,
      ),
    ).toBe("Trump maker: seat 1. Select a trump indicator card.");
    expect(gameplayPrompt({ ...hand, phase: "trump-choice" }, null)).toBe(
      "Choose trump mode.",
    );
  });

  it("personalizes active trick prompts without impersonating a viewer", () => {
    const leading: GameplayHand = {
      ...start(),
      activeSeat: seatIndex(0, 4),
      currentTrick: {
        activeSeat: seatIndex(0, 4),
        leaderSeat: seatIndex(0, 4),
        openedTrump: false,
        plays: [],
        points: 0,
        status: "active",
        winnerSeat: null,
      },
      phase: "trick-play",
    };

    expect(gameplayPrompt(leading, seatIndex(0, 4))).toBe(
      "Your turn. You lead the trick.",
    );
    expect(gameplayPrompt(leading, seatIndex(1, 4))).toBe(
      "Seat 1 leads the trick.",
    );
    expect(gameplayPrompt(leading, null)).toBe("Seat 1 leads the trick.");

    const currentTrick = leading.currentTrick;
    if (!currentTrick) throw new Error("Expected an active trick");
    const following: GameplayHand = {
      ...leading,
      activeSeat: seatIndex(1, 4),
      currentTrick: { ...currentTrick, activeSeat: seatIndex(1, 4) },
    };
    expect(gameplayPrompt(following, seatIndex(1, 4))).toBe(
      "Your turn. Play a legal card.",
    );
    expect(gameplayPrompt(following, seatIndex(0, 4))).toBe("Seat 2 to play.");
  });

  it("describes trick, hand, and match results", () => {
    const hand = start();
    const trickResult: GameplayHand = {
      ...hand,
      activeSeat: null,
      currentTrick: {
        activeSeat: null,
        leaderSeat: seatIndex(0, 4),
        openedTrump: false,
        plays: [],
        points: 0,
        status: "complete",
        winnerSeat: seatIndex(2, 4),
      },
      phase: "trick-result",
    };

    expect(gameplayPrompt(trickResult, null)).toBe(
      "Seat 3 wins the trick. Next trick starts shortly.",
    );
    expect(gameplayPrompt({ ...hand, phase: "hand-result" }, null)).toBe(
      "Hand complete. Continue to next hand.",
    );
    expect(gameplayPrompt({ ...hand, phase: "match-complete" }, null)).toBe(
      "Match complete.",
    );
  });
});
