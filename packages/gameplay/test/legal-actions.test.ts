import { describe, expect, it } from "vitest";
import {
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
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

function apply(hand: GameplayHand, command: GameplayCommand): GameplayHand {
  const result = applyGameplayCommand(hand, command);
  expect(result.ok).toBe(true);
  if (!result.ok) return hand;
  return result.hand;
}

function finishOpeningBid(): GameplayHand {
  let hand = apply(start(), {
    actor: seatIndex(0, 4),
    amount: bidAmount(160),
    type: "BID",
  });
  for (const actor of [1, 2, 3]) {
    hand = apply(hand, {
      actor: seatIndex(actor, 4),
      type: "PASS_BID",
    });
  }
  return hand;
}

describe("legal gameplay commands", () => {
  it("offers bids and pass only to the active bidding seat", () => {
    const hand = start();

    expect(legalGameplayCommands(hand, seatIndex(0, 4))).toEqual([
      { actor: 0, amount: 160, type: "BID" },
      { actor: 0, amount: 170, type: "BID" },
      { actor: 0, amount: 180, type: "BID" },
      { actor: 0, amount: 190, type: "BID" },
      { actor: 0, amount: 200, type: "BID" },
      { actor: 0, amount: 210, type: "BID" },
      { actor: 0, type: "PASS_BID" },
    ]);
    expect(legalGameplayCommands(hand, seatIndex(1, 4))).toEqual([]);
  });

  it("offers each eligible indicator only to the trump maker", () => {
    const hand = finishOpeningBid();
    const expected = hand.deal.firstHands[0]?.map((card) => ({
      actor: 0,
      cardId: card.id,
      type: "SELECT_TRUMP",
    }));

    expect(legalGameplayCommands(hand, seatIndex(0, 4))).toEqual(expected);
    expect(legalGameplayCommands(hand, seatIndex(1, 4))).toEqual([]);
  });

  it("offers the profile-supported trump modes to the maker", () => {
    let hand = finishOpeningBid();
    const indicator = hand.deal.firstHands[0]?.[0];
    if (!indicator) throw new Error("Expected an indicator candidate");
    hand = apply(hand, {
      actor: seatIndex(0, 4),
      cardId: indicator.id,
      type: "SELECT_TRUMP",
    });
    for (const actor of [0, 1, 2, 3]) {
      hand = apply(hand, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }

    expect(legalGameplayCommands(hand, seatIndex(0, 4))).toEqual([
      { actor: 0, type: "TRUMP_OPEN" },
      { actor: 0, type: "TRUMP_CLOSE" },
    ]);
  });

  it("maps each legal trick selection to a gameplay command", () => {
    const deck = buildDeck(profile);
    const started = start();
    const actor = seatIndex(1, 4);
    const hand: GameplayHand = {
      ...started,
      activeSeat: actor,
      currentTrick: {
        activeSeat: actor,
        leaderSeat: seatIndex(0, 4),
        openedTrump: false,
        plays: [
          {
            actor: seatIndex(0, 4),
            card: deck.find((card) => card.id === "C_J") ?? deck[0],
            faceDown: false,
            fromIndicator: false,
          },
        ],
        points: 30,
        status: "active",
        winnerSeat: null,
      },
      deal: {
        ...started.deal,
        hands: [
          [],
          deck.filter((card) => card.id === "C_9" || card.id === "H_A"),
          [],
          [],
        ],
      },
      phase: "trick-play",
      trump: {
        indicator: deck.find((card) => card.id === "S_9") ?? null,
        maker: seatIndex(0, 4),
        mode: "closed",
        open: false,
        suit: "spades",
      },
    };

    expect(legalGameplayCommands(hand, actor)).toEqual([
      {
        actor: 1,
        cardId: "C_9",
        faceDown: false,
        fromIndicator: false,
        type: "PLAY_CARD",
      },
    ]);
  });

  it("offers result acknowledgement to every seat but no user trick advance", () => {
    const base = start();
    const resultHand: GameplayHand = {
      ...base,
      activeSeat: null,
      phase: "hand-result",
    };
    const trickResult: GameplayHand = {
      ...base,
      activeSeat: null,
      phase: "trick-result",
    };

    expect(legalGameplayCommands(resultHand, seatIndex(2, 4))).toEqual([
      { actor: 2, type: "ACK_RESULT" },
    ]);
    expect(legalGameplayCommands(trickResult, seatIndex(2, 4))).toEqual([]);
  });
});
