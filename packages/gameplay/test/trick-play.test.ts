import { describe, expect, it } from "vitest";
import {
  buildDeck,
  type Card,
  createTrick,
  getRuleProfile,
  legalCardPlays,
  playCard,
  resolveTrick,
  seatIndex,
  type TrickContext,
  type TrickState,
} from "../src/index.js";

const profile = getRuleProfile("classic_304_4p");
const deck = buildDeck(profile);

function card(id: string): Card {
  const found = deck.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing test card ${id}`);
  return found;
}

function context(overrides: Partial<TrickContext> = {}): TrickContext {
  return {
    completedTrickCount: 0,
    indicator: card("S_J"),
    maker: seatIndex(0, 4),
    profile,
    trumpOpen: false,
    trumpSuit: "spades",
    ...overrides,
  };
}

describe("trick play legality", () => {
  it("allows a leader to play any hand card face up", () => {
    const trick = createTrick(seatIndex(1, 4));
    expect(
      legalCardPlays(
        context(),
        trick,
        [card("H_9"), card("C_J")],
        seatIndex(1, 4),
      ),
    ).toEqual([
      { cardId: "H_9", faceDown: false, fromIndicator: false },
      { cardId: "C_J", faceDown: false, fromIndicator: false },
    ]);
  });

  it("requires followers to follow the led suit", () => {
    const trick: TrickState = {
      ...createTrick(seatIndex(0, 4)),
      activeSeat: seatIndex(1, 4),
      plays: [
        {
          actor: seatIndex(0, 4),
          card: card("H_7"),
          faceDown: false,
          fromIndicator: false,
        },
      ],
    };
    expect(
      legalCardPlays(
        context(),
        trick,
        [card("H_J"), card("C_J")],
        seatIndex(1, 4),
      ),
    ).toEqual([{ cardId: "H_J", faceDown: false, fromIndicator: false }]);
  });

  it("offers face-down cuts and the maker's closed indicator when void", () => {
    const trick: TrickState = {
      ...createTrick(seatIndex(3, 4)),
      activeSeat: seatIndex(0, 4),
      plays: [
        {
          actor: seatIndex(3, 4),
          card: card("H_7"),
          faceDown: false,
          fromIndicator: false,
        },
      ],
    };
    expect(
      legalCardPlays(context(), trick, [card("C_J")], seatIndex(0, 4)),
    ).toEqual([
      { cardId: "C_J", faceDown: false, fromIndicator: false },
      { cardId: "C_J", faceDown: true, fromIndicator: false },
      { cardId: "S_J", faceDown: true, fromIndicator: true },
    ]);
  });

  it("allows the retained indicator as the maker's final card", () => {
    const trick = createTrick(seatIndex(0, 4));
    expect(
      legalCardPlays(
        context({ completedTrickCount: 7 }),
        trick,
        [],
        seatIndex(0, 4),
      ),
    ).toEqual([{ cardId: "S_J", faceDown: true, fromIndicator: true }]);
  });
});

describe("trick resolution", () => {
  it("opens a closed trump when a trump card is cut face down", () => {
    let trick = createTrick(seatIndex(0, 4));
    const hands = [[card("H_J")], [card("S_7")], [card("H_9")], [card("H_A")]];
    let trumpOpen = false;
    for (const actor of [0, 1, 2, 3]) {
      const played = playCard(
        context({ trumpOpen }),
        trick,
        hands[actor] ?? [],
        seatIndex(actor, 4),
        {
          cardId: hands[actor]?.[0]?.id,
          faceDown: actor === 1,
          fromIndicator: false,
        },
      );
      expect(played.ok).toBe(true);
      if (!played.ok) continue;
      trick = played.trick;
      trumpOpen = played.trumpOpen;
    }

    expect(trick.status).toBe("complete");
    expect(trick.winnerSeat).toBe(1);
    expect(trick.points).toBe(61);
    expect(trick.openedTrump).toBe(true);
  });

  it("keeps trump closed for a concealed non-trump card", () => {
    const plays = [
      {
        actor: seatIndex(0, 4),
        card: card("H_9"),
        faceDown: false,
        fromIndicator: false,
      },
      {
        actor: seatIndex(1, 4),
        card: card("C_J"),
        faceDown: true,
        fromIndicator: false,
      },
      {
        actor: seatIndex(2, 4),
        card: card("H_A"),
        faceDown: false,
        fromIndicator: false,
      },
      {
        actor: seatIndex(3, 4),
        card: card("D_J"),
        faceDown: false,
        fromIndicator: false,
      },
    ] as const;
    expect(resolveTrick(profile, plays, "spades", false)).toMatchObject({
      openedTrump: false,
      winnerSeat: 0,
    });
  });
});
