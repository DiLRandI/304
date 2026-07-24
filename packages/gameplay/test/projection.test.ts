import { describe, expect, it } from "vitest";
import {
  buildDeck,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  projectGameplayHand,
  seatIndex,
  startGameplayHand,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");

function hand(): GameplayHand {
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

describe("gameplay projections", () => {
  it("reveals only the viewer's private hand", () => {
    const state = hand();
    const anonymous = projectGameplayHand(state, null);
    const seatZero = projectGameplayHand(state, seatIndex(0, 4));

    expect(anonymous.seats[0]?.hand.every((card) => card.hidden)).toBe(true);
    expect(seatZero.seats[0]?.hand.every((card) => !card.hidden)).toBe(true);
    expect(seatZero.seats[1]?.hand.every((card) => card.hidden)).toBe(true);
    expect(seatZero.seats[0]?.isViewer).toBe(true);
    expect(seatZero.seats[1]?.isViewer).toBe(false);
  });

  it("reveals closed trump only to its maker", () => {
    const state: GameplayHand = {
      ...hand(),
      trump: {
        indicator: buildDeck(profile).find((card) => card.id === "S_J") ?? null,
        maker: seatIndex(0, 4),
        mode: "closed",
        open: false,
        suit: "spades",
      },
    };

    expect(projectGameplayHand(state, null).trump.suit).toBeNull();
    expect(projectGameplayHand(state, seatIndex(1, 4)).trump.suit).toBeNull();
    expect(projectGameplayHand(state, seatIndex(0, 4)).trump.suit).toBe(
      "spades",
    );
  });

  it("keeps concealed cards and trick points hidden until visibility rules allow them", () => {
    const deck = buildDeck(profile);
    const heartJack = deck.find((card) => card.id === "H_J");
    const spadeSeven = deck.find((card) => card.id === "S_7");
    if (!heartJack || !spadeSeven) throw new Error("Expected test cards");
    const state: GameplayHand = {
      ...hand(),
      currentTrick: {
        activeSeat: seatIndex(2, 4),
        leaderSeat: seatIndex(0, 4),
        openedTrump: false,
        plays: [
          {
            actor: seatIndex(0, 4),
            card: heartJack,
            faceDown: false,
            fromIndicator: false,
          },
          {
            actor: seatIndex(1, 4),
            card: spadeSeven,
            faceDown: true,
            fromIndicator: false,
          },
        ],
        points: 30,
        status: "active",
        winnerSeat: null,
      },
      phase: "trick-play",
      trump: {
        indicator: null,
        maker: seatIndex(0, 4),
        mode: "closed",
        open: false,
        suit: "spades",
      },
    };

    const closed = projectGameplayHand(state, seatIndex(0, 4));
    expect(closed.currentTrick?.plays[1]?.card).toEqual({ hidden: true });
    expect(closed.currentTrick?.points).toBeNull();

    const open = projectGameplayHand(
      { ...state, trump: { ...state.trump, open: true } },
      seatIndex(1, 4),
    );
    expect(open.currentTrick?.plays[1]?.card).toMatchObject({
      hidden: false,
      id: "S_7",
    });
    expect(open.currentTrick?.points).toBe(30);
  });

  it("reveals cut-trick cards without exposing the maker's concealed non-trump discard", () => {
    const deck = buildDeck(profile);
    const card = (id: string) => {
      const found = deck.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Expected ${id}`);
      return found;
    };
    const state: GameplayHand = {
      ...hand(),
      completedTricks: [
        {
          activeSeat: null,
          leaderSeat: seatIndex(1, 4),
          openedTrump: true,
          plays: [
            {
              actor: seatIndex(1, 4),
              card: card("H_J"),
              faceDown: false,
              fromIndicator: false,
            },
            {
              actor: seatIndex(2, 4),
              card: card("S_7"),
              faceDown: true,
              fromIndicator: false,
            },
            {
              actor: seatIndex(3, 4),
              card: card("C_9"),
              faceDown: true,
              fromIndicator: false,
            },
            {
              actor: seatIndex(0, 4),
              card: card("D_A"),
              faceDown: true,
              fromIndicator: false,
            },
          ],
          points: 61,
          status: "complete",
          trumpRevealReason: "face-down-trump-cut",
          winnerSeat: seatIndex(2, 4),
        },
      ],
      phase: "trick-result",
      trump: {
        indicator: null,
        maker: seatIndex(0, 4),
        mode: "closed",
        open: true,
        revealedIndicator: deck.find((card) => card.id === "S_J") ?? null,
        suit: "spades",
      },
    };

    const trick = projectGameplayHand(state, seatIndex(1, 4))
      .completedTricks[0];
    expect(trick?.trumpRevealReason).toBe("face-down-trump-cut");
    expect(trick?.plays[1]?.card).toMatchObject({ hidden: false, id: "S_7" });
    expect(trick?.plays[2]?.card).toMatchObject({ hidden: false, id: "C_9" });
    expect(trick?.plays[3]?.card).toEqual({ hidden: true });
    expect(trick?.points).toBeNull();
  });

  it("keeps unrelated face-down cards concealed after the automatic high-bid reveal", () => {
    const deck = buildDeck(profile);
    const heartJack = deck.find((card) => card.id === "H_J");
    const clubSeven = deck.find((card) => card.id === "C_7");
    if (!heartJack || !clubSeven) throw new Error("Expected test cards");
    const state: GameplayHand = {
      ...hand(),
      completedTricks: [
        {
          activeSeat: null,
          leaderSeat: seatIndex(0, 4),
          openedTrump: true,
          plays: [
            {
              actor: seatIndex(0, 4),
              card: heartJack,
              faceDown: false,
              fromIndicator: false,
            },
            {
              actor: seatIndex(1, 4),
              card: clubSeven,
              faceDown: true,
              fromIndicator: false,
            },
          ],
          points: 30,
          status: "complete",
          trumpRevealReason: "high-bid-after-first-trick",
          winnerSeat: seatIndex(0, 4),
        },
      ],
      phase: "trick-result",
      trump: {
        indicator: null,
        maker: seatIndex(0, 4),
        mode: "closed",
        open: true,
        revealedIndicator: deck.find((card) => card.id === "S_J") ?? null,
        suit: "spades",
      },
    };

    const trick = projectGameplayHand(state, seatIndex(1, 4))
      .completedTricks[0];
    expect(trick?.trumpRevealReason).toBe("high-bid-after-first-trick");
    expect(trick?.plays[1]?.card).toEqual({ hidden: true });
    expect(trick?.points).toBeNull();
    expect(
      projectGameplayHand(state, seatIndex(1, 4)).trump.indicator,
    ).toMatchObject({ hidden: false, id: "S_J" });
  });
});
