import { describe, expect, it } from "vitest";
import {
  evaluateFourCardBidHand,
  fourCardBidCeiling,
} from "../src/bot-policy.js";
import {
  acknowledgeGameplayResult,
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type Card,
  chooseGameplayBotCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
  seatIndex,
  shuffleDeck,
  startGameplayHand,
  startSecondBidding,
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
  const openingHand = (
    handCards: Card[],
    bidding: Partial<GameplayHand["bidding"]> = {},
  ): GameplayHand => {
    const actor = seatIndex(0, 4);
    return {
      ...start(),
      activeSeat: actor,
      bidding: {
        ...start().bidding,
        activeSeat: actor,
        ...bidding,
      },
      deal: {
        ...start().deal,
        firstHands: [handCards, [], [], []],
        hands: [handCards, [], [], []],
      },
    };
  };

  const secondBiddingHand = (
    handCards: Card[],
    bidding: Partial<GameplayHand["bidding"]> = {},
  ): GameplayHand => {
    const actor = seatIndex(0, 4);
    const secondBidding = startSecondBidding(
      profile,
      actor,
      bidAmount(160),
      actor,
    );
    return {
      ...start(),
      activeSeat: actor,
      bidding: { ...secondBidding, ...bidding },
      deal: {
        ...start().deal,
        firstHands: [handCards.slice(0, 4), [], [], []],
        hands: [handCards, [], [], []],
      },
      phase: "second-bidding",
      trump: {
        indicator: card("S_7"),
        maker: seatIndex(2, 4),
        mode: null,
        open: false,
        suit: "spades",
      },
    };
  };

  it("scores weak, average, and elite first hands exactly", () => {
    expect(evaluateFourCardBidHand(cards("C_7", "D_7", "H_8", "S_8"))).toBe(8);
    expect(evaluateFourCardBidHand(cards("C_J", "C_9", "D_A", "S_7"))).toBe(
      103,
    );
    expect(evaluateFourCardBidHand(cards("C_J", "D_J", "H_J", "S_J"))).toBe(
      188,
    );
  });

  it.each([
    ["easy", 54, null],
    ["easy", 55, 160],
    ["easy", 74, 160],
    ["easy", 75, 170],
    ["easy", 94, 170],
    ["easy", 95, 180],
    ["normal", 44, null],
    ["normal", 45, 160],
    ["normal", 59, 160],
    ["normal", 60, 170],
    ["normal", 74, 170],
    ["normal", 75, 180],
    ["normal", 89, 180],
    ["normal", 90, 190],
    ["normal", 104, 190],
    ["normal", 105, 200],
    ["strong", 39, null],
    ["strong", 40, 160],
    ["strong", 54, 160],
    ["strong", 55, 170],
    ["strong", 69, 170],
    ["strong", 70, 180],
    ["strong", 84, 180],
    ["strong", 85, 190],
    ["strong", 99, 190],
    ["strong", 100, 200],
    ["strong", 114, 200],
    ["strong", 115, 210],
    ["strong", 124, 210],
    ["strong", 125, 220],
  ] as const)("maps %s score %i to ceiling %s", (difficulty, score, ceiling) => {
    expect(fourCardBidCeiling(difficulty, score)).toBe(ceiling);
  });

  it("passes weak opening hands even after every other player passed", () => {
    const actor = seatIndex(0, 4);
    const weak = openingHand(cards("C_7", "D_7", "H_7", "S_7"));

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
      type: "PASS_BID",
    });

    const cancelled = applyGameplayCommand(lastChance, {
      actor,
      type: "PASS_BID",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.hand.result).toMatchObject({ noScore: true });
    const redealt = acknowledgeGameplayResult(cancelled.hand, deck);
    expect(redealt.ok).toBe(true);
    if (!redealt.ok) return;
    expect(redealt.hand.phase).toBe("four-bidding");
  });

  it("bids only the smallest legal raise within the first-hand ceiling", () => {
    const average = cards("C_J", "C_9", "D_A", "S_7");
    expect(
      chooseGameplayBotCommand(openingHand(average), seatIndex(0, 4), {
        difficulty: "normal",
        random: random(0),
      }),
    ).toEqual({ actor: 0, amount: 160, type: "BID" });

    expect(
      chooseGameplayBotCommand(
        openingHand(average, {
          currentBid: bidAmount(180),
          currentBidder: seatIndex(1, 4),
        }),
        seatIndex(0, 4),
        { difficulty: "normal", random: random(0) },
      ),
    ).toEqual({ actor: 0, amount: 190, type: "BID" });

    expect(
      chooseGameplayBotCommand(
        openingHand(average, {
          currentBid: bidAmount(190),
          currentBidder: seatIndex(1, 4),
        }),
        seatIndex(0, 4),
        { difficulty: "normal", random: random(0) },
      ),
    ).toEqual({ actor: 0, type: "PASS_BID" });
  });

  it("passes in either bidding stage while a partner is highest", () => {
    const actor = seatIndex(0, 4);
    const elite = cards("C_J", "D_J", "H_J", "S_J");
    const partner = seatIndex(2, 4);
    expect(
      chooseGameplayBotCommand(
        openingHand(elite, {
          currentBid: bidAmount(190),
          currentBidder: partner,
        }),
        actor,
        { difficulty: "strong", random: random(0) },
      ),
    ).toEqual({ actor: 0, type: "PASS_BID" });

    expect(
      chooseGameplayBotCommand(
        secondBiddingHand(
          cards("C_J", "C_9", "C_A", "C_10", "D_J", "H_J", "S_J", "D_9"),
          { currentBid: bidAmount(250), currentBidder: partner },
        ),
        actor,
        { difficulty: "strong", random: random(0) },
      ),
    ).toEqual({ actor: 0, type: "PASS_BID" });
  });

  it("keeps Easy out of second bidding and gates Normal at exactly 250", () => {
    const actor = seatIndex(0, 4);
    const exceptional = cards(
      "C_J",
      "C_9",
      "C_A",
      "C_10",
      "D_J",
      "D_9",
      "H_A",
      "S_A",
    );
    expect(
      chooseGameplayBotCommand(secondBiddingHand(exceptional), actor, {
        difficulty: "easy",
        random: random(0),
      }),
    ).toEqual({ actor: 0, type: "PASS_BID" });
    expect(
      chooseGameplayBotCommand(secondBiddingHand(exceptional), actor, {
        difficulty: "normal",
        random: random(0),
      }),
    ).toEqual({ actor: 0, amount: 250, type: "BID" });
    expect(
      chooseGameplayBotCommand(
        secondBiddingHand(exceptional, {
          currentBid: bidAmount(250),
          currentBidder: seatIndex(1, 4),
        }),
        actor,
        { difficulty: "normal", random: random(0) },
      ),
    ).toEqual({ actor: 0, type: "PASS_BID" });
  });

  it("requires Normal's candidate trump to hold J+9 and 100 card points", () => {
    const actor = seatIndex(0, 4);
    const belowPoints = cards(
      "C_J",
      "C_9",
      "C_7",
      "C_8",
      "D_A",
      "H_A",
      "S_A",
      "D_10",
    );
    const splitTopTrumps = cards(
      "C_J",
      "D_9",
      "C_A",
      "C_10",
      "H_J",
      "S_J",
      "D_10",
      "H_A",
    );
    for (const handCards of [belowPoints, splitTopTrumps]) {
      expect(
        chooseGameplayBotCommand(secondBiddingHand(handCards), actor, {
          difficulty: "normal",
          random: random(0),
        }),
      ).toEqual({ actor: 0, type: "PASS_BID" });
    }
  });

  it.each([
    [cards("C_J", "C_9", "D_J", "D_9", "H_A", "H_10", "S_A", "S_10"), 250],
    [cards("C_J", "C_9", "C_A", "D_J", "D_9", "H_A", "S_A", "S_10"), 260],
    [cards("C_J", "C_9", "C_A", "C_10", "D_J", "D_9", "H_A", "S_A"), 270],
    [cards("C_J", "C_9", "C_A", "C_10", "C_K", "D_J", "H_J", "S_A"), 280],
    [cards("C_J", "C_9", "C_A", "C_10", "C_K", "C_Q", "D_J", "H_J"), 290],
  ] as const)("maps Strong exceptional candidate control to a %i ceiling", (handCards, expectedCeiling) => {
    const actor = seatIndex(0, 4);
    expect(
      chooseGameplayBotCommand(
        secondBiddingHand(handCards, {
          currentBid: bidAmount(expectedCeiling - 10),
          currentBidder: seatIndex(1, 4),
        }),
        actor,
        { difficulty: "strong", random: random(0) },
      ),
    ).toEqual({ actor: 0, amount: expectedCeiling, type: "BID" });
    expect(
      chooseGameplayBotCommand(
        secondBiddingHand(handCards, {
          currentBid: bidAmount(expectedCeiling),
          currentBidder: seatIndex(1, 4),
        }),
        actor,
        { difficulty: "strong", random: random(0) },
      ),
    ).toEqual({ actor: 0, type: "PASS_BID" });
  });

  it("includes a maker's visible indicator in second-bid points and candidate control", () => {
    const actor = seatIndex(0, 4);
    const hand = secondBiddingHand(
      cards("C_9", "C_A", "C_10", "D_J", "D_9", "H_A", "S_A"),
    );
    const makerHand: GameplayHand = {
      ...hand,
      trump: {
        ...hand.trump,
        indicator: card("C_J"),
        maker: actor,
        suit: "clubs",
      },
    };

    expect(
      chooseGameplayBotCommand(makerHand, actor, {
        difficulty: "normal",
        random: random(0),
      }),
    ).toEqual({ actor: 0, amount: 250, type: "BID" });
  });

  it("allows Strong to bid 300 only with four Jacks, candidate Nine, and 140 points", () => {
    const actor = seatIndex(0, 4);
    const eligible = cards(
      "C_J",
      "D_J",
      "H_J",
      "S_J",
      "C_9",
      "D_7",
      "H_7",
      "S_7",
    );
    const noCandidateNine = cards(
      "C_J",
      "D_J",
      "H_J",
      "S_J",
      "C_A",
      "D_10",
      "H_7",
      "S_7",
    );
    const belowPoints = eligible.map((candidate) =>
      candidate.id === "C_9" ? { ...candidate, points: 19 } : candidate,
    );
    const at290 = {
      currentBid: bidAmount(290),
      currentBidder: seatIndex(1, 4),
    };

    expect(
      chooseGameplayBotCommand(secondBiddingHand(eligible, at290), actor, {
        difficulty: "strong",
        random: random(0),
      }),
    ).toEqual({ actor: 0, amount: 300, type: "BID" });
    for (const handCards of [noCandidateNine, belowPoints]) {
      expect(
        chooseGameplayBotCommand(secondBiddingHand(handCards, at290), actor, {
          difficulty: "strong",
          random: random(0),
        }),
      ).toEqual({ actor: 0, type: "PASS_BID" });
    }
  });

  it("does not consume randomness while making deterministic bids", () => {
    const actor = seatIndex(0, 4);
    const explodingRandom = {
      next: () => {
        throw new Error("bidding must not consume randomness");
      },
    };
    expect(
      chooseGameplayBotCommand(
        openingHand(cards("C_J", "C_9", "D_A", "S_7")),
        actor,
        { difficulty: "normal", random: explodingRandom },
      ),
    ).toEqual({ actor: 0, amount: 160, type: "BID" });
  });

  it("keeps second bids invariant under other seats and hidden indicator changes", () => {
    const actor = seatIndex(0, 4);
    const ownCards = cards(
      "C_J",
      "C_9",
      "C_A",
      "C_10",
      "D_J",
      "D_9",
      "H_A",
      "S_A",
    );
    const probe = (hiddenIndicator: "H_J" | "S_7"): GameplayHand => {
      const base = secondBiddingHand(ownCards);
      return {
        ...base,
        deal: {
          ...base.deal,
          hands: [
            ownCards,
            cards(hiddenIndicator, "D_7"),
            cards("H_9", "S_J"),
            cards("D_J", "H_10"),
          ],
        },
        trump: {
          ...base.trump,
          indicator: card(hiddenIndicator),
          maker: seatIndex(2, 4),
          suit: hiddenIndicator === "H_J" ? "hearts" : "spades",
        },
      };
    };
    expect(
      chooseGameplayBotCommand(probe("H_J"), actor, {
        difficulty: "strong",
        random: random(0),
      }),
    ).toEqual(
      chooseGameplayBotCommand(probe("S_7"), actor, {
        difficulty: "strong",
        random: random(0),
      }),
    );
  });

  it("keeps seeded ordinary second-round high bids below a stable calibration bound", () => {
    let state = 0x304_2026;
    const seeded = {
      next: () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
      },
    };
    let highBids = 0;
    const samples = 1_000;
    for (let index = 0; index < samples; index += 1) {
      const handCards = shuffleDeck(deck, seeded).slice(0, 8);
      const command = chooseGameplayBotCommand(
        secondBiddingHand(handCards),
        seatIndex(0, 4),
        { difficulty: "strong", random: seeded },
      );
      if (command?.type === "BID" && command.amount >= 250) highBids += 1;
    }

    // Seed 0x3042026 currently produces 212/1,000 exceptional bids. The fixed
    // 25% bound leaves stable headroom while proving 250-300 does not cluster.
    expect(highBids).toBeGreaterThan(0);
    expect(highBids).toBeLessThanOrEqual(250);
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
