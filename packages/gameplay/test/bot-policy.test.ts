import { describe, expect, it } from "vitest";
import {
  bidAmount,
  buildDeck,
  type Card,
  chooseGameplayBotCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");
const deck = buildDeck(profile);

function start(): GameplayHand {
  return startGameplayHand({
    dealer: seatIndex(3, 4),
    deck,
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
}

function card(id: string): Card {
  const selected = deck.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Missing test card ${id}`);
  return selected;
}

function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

const random = (value: number) => ({ next: () => value });

describe("gameplay bot policy", () => {
  it("passes a weak opening hand but opens on the table's last chance", () => {
    const actor = seatIndex(0, 4);
    const weak: GameplayHand = {
      ...start(),
      deal: {
        ...start().deal,
        hands: [cards("C_7", "D_7", "H_7", "S_7"), [], [], []],
      },
    };

    for (const difficulty of ["easy", "normal", "strong"] as const) {
      expect(
        chooseGameplayBotCommand(weak, actor, {
          difficulty,
          random: random(0),
        }),
      ).toEqual({
        actor: 0,
        type: "PASS_BID",
      });
    }

    const lastChance: GameplayHand = {
      ...weak,
      bidding: {
        ...weak.bidding,
        noBidPasses: 3,
      },
    };
    expect(
      chooseGameplayBotCommand(lastChance, actor, {
        difficulty: "normal",
        random: random(0),
      }),
    ).toEqual({
      actor: 0,
      amount: 180,
      type: "BID",
    });
  });

  it("chooses the strongest trump suit from legal indicator cards", () => {
    const actor = seatIndex(0, 4);
    const hand: GameplayHand = {
      ...start(),
      activeSeat: actor,
      bidding: { ...start().bidding, currentBidder: actor, status: "complete" },
      deal: {
        ...start().deal,
        firstHands: [cards("C_J", "C_9", "H_A", "H_K"), [], [], []],
      },
      phase: "trump-selection",
      trump: { ...start().trump, maker: actor },
    };

    expect(
      chooseGameplayBotCommand(hand, actor, {
        difficulty: "normal",
        random: random(0),
      }),
    ).toEqual({
      actor: 0,
      cardId: "C_J",
      type: "SELECT_TRUMP",
    });
  });

  it("uses injected randomness for high-bid trump mode choice", () => {
    const actor = seatIndex(0, 4);
    const hand: GameplayHand = {
      ...start(),
      activeSeat: actor,
      bidding: { ...start().bidding, currentBid: bidAmount(250) },
      phase: "trump-choice",
      trump: { ...start().trump, maker: actor },
    };

    expect(
      chooseGameplayBotCommand(hand, actor, {
        difficulty: "strong",
        random: random(0.8),
      }),
    ).toEqual({
      actor: 0,
      type: "TRUMP_CLOSE",
    });
    expect(
      chooseGameplayBotCommand(hand, actor, {
        difficulty: "easy",
        random: random(0.2),
      }),
    ).toEqual({
      actor: 0,
      type: "TRUMP_OPEN",
    });
  });

  it("does not let a non-maker choice depend on hidden trump identity", () => {
    const actor = seatIndex(1, 4);
    const probe = (indicatorId: "D_9" | "H_9"): GameplayHand => ({
      ...start(),
      activeSeat: actor,
      currentTrick: {
        activeSeat: actor,
        leaderSeat: seatIndex(0, 4),
        openedTrump: false,
        plays: [
          {
            actor: seatIndex(0, 4),
            card: card("C_8"),
            faceDown: false,
            fromIndicator: false,
          },
        ],
        points: 0,
        status: "active",
        winnerSeat: null,
      },
      deal: {
        ...start().deal,
        hands: [[], cards("H_J", "S_7"), [], []],
      },
      phase: "trick-play",
      trump: {
        indicator: card(indicatorId),
        maker: seatIndex(0, 4),
        mode: "closed",
        open: false,
        suit: indicatorId === "D_9" ? "diamonds" : "hearts",
      },
    });
    const diamonds = probe("D_9");
    const hearts = probe("H_9");

    expect(legalGameplayCommands(diamonds, actor)).toEqual(
      legalGameplayCommands(hearts, actor),
    );
    expect(
      chooseGameplayBotCommand(diamonds, actor, {
        difficulty: "strong",
        random: random(0.9),
      }),
    ).toEqual(
      chooseGameplayBotCommand(hearts, actor, {
        difficulty: "strong",
        random: random(0.9),
      }),
    );
  });

  it("returns only legal commands and acknowledges results", () => {
    const actor = seatIndex(2, 4);
    const resultHand: GameplayHand = {
      ...start(),
      activeSeat: null,
      phase: "hand-result",
    };
    const choice = chooseGameplayBotCommand(resultHand, actor, {
      difficulty: "normal",
      random: random(0),
    });

    expect(legalGameplayCommands(resultHand, actor)).toContainEqual(choice);
    expect(choice).toEqual({ actor: 2, type: "ACK_RESULT" });
    expect(
      chooseGameplayBotCommand(start(), seatIndex(1, 4), {
        difficulty: "normal",
        random: random(0),
      }),
    ).toBeNull();
  });
});
