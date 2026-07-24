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

  it("requires every void follower's in-hand card to be face down while trump is closed", () => {
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
        [card("C_J"), card("S_7")],
        seatIndex(1, 4),
      ),
    ).toEqual([
      { cardId: "C_J", faceDown: true, fromIndicator: false },
      { cardId: "S_7", faceDown: true, fromIndicator: false },
    ]);
  });

  it("makes the closed maker cut with the indicator instead of an in-hand trump", () => {
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
      legalCardPlays(
        context(),
        trick,
        [card("C_J"), card("S_9")],
        seatIndex(0, 4),
      ),
    ).toEqual([
      { cardId: "C_J", faceDown: true, fromIndicator: false },
      { cardId: "S_J", faceDown: true, fromIndicator: true },
    ]);
  });

  it("prevents the closed maker from leading an in-hand trump on trick one", () => {
    const trick = createTrick(seatIndex(0, 4));

    expect(
      legalCardPlays(
        context(),
        trick,
        [card("S_9"), card("H_J")],
        seatIndex(0, 4),
      ),
    ).toEqual([{ cardId: "H_J", faceDown: false, fromIndicator: false }]);
    expect(
      legalCardPlays(
        context({ completedTrickCount: 1 }),
        trick,
        [card("S_9"), card("H_J")],
        seatIndex(0, 4),
      ),
    ).toEqual([
      { cardId: "S_9", faceDown: false, fromIndicator: false },
      { cardId: "H_J", faceDown: false, fromIndicator: false },
    ]);
    expect(
      legalCardPlays(
        context({ trumpOpen: true }),
        trick,
        [card("S_9"), card("H_J")],
        seatIndex(0, 4),
      ),
    ).toEqual([
      { cardId: "S_9", faceDown: false, fromIndicator: false },
      { cardId: "H_J", faceDown: false, fromIndicator: false },
    ]);
  });

  it.each([
    ["classic_304_4p", 7, 4],
    ["six_304_36", 5, 6],
  ] as const)("restricts the retained indicator in %s to a legal cut or the final trick", (profileId, penultimateTrick, seatCount) => {
    const variant = getRuleProfile(profileId);
    const variantDeck = buildDeck(variant);
    const indicator = variantDeck.find((candidate) => candidate.id === "S_J");
    const ledTrump = variantDeck.find((candidate) => candidate.id === "S_7");
    const ledNonTrump = variantDeck.find((candidate) => candidate.id === "H_7");
    if (!indicator || !ledTrump || !ledNonTrump) {
      throw new Error("Expected indicator restriction fixtures");
    }
    const maker = seatIndex(1, variant.seatCount);
    const variantContext: TrickContext = {
      completedTrickCount: 0,
      indicator,
      maker,
      profile: variant,
      trumpOpen: false,
      trumpSuit: "spades",
    };
    const followingTrump: TrickState = {
      ...createTrick(seatIndex(0, variant.seatCount)),
      activeSeat: maker,
      plays: [
        {
          actor: seatIndex(0, variant.seatCount),
          card: ledTrump,
          faceDown: false,
          fromIndicator: false,
        },
      ],
    };
    expect(legalCardPlays(variantContext, followingTrump, [], maker)).toEqual(
      [],
    );

    const cuttingNonTrump: TrickState = {
      ...followingTrump,
      plays: [
        {
          actor: seatIndex(0, variant.seatCount),
          card: ledNonTrump,
          faceDown: false,
          fromIndicator: false,
        },
      ],
    };
    expect(legalCardPlays(variantContext, cuttingNonTrump, [], maker)).toEqual([
      { cardId: "S_J", faceDown: true, fromIndicator: true },
    ]);

    const finalContext = {
      ...variantContext,
      completedTrickCount: penultimateTrick,
    };
    const finalTrick = createTrick(maker);
    expect(legalCardPlays(finalContext, finalTrick, [], maker)).toEqual([
      { cardId: "S_J", faceDown: true, fromIndicator: true },
    ]);
    expect(variant.seatCount).toBe(seatCount);
  });

  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("forces the closed maker's exhausted-trump lead sequence in %s", (profileId) => {
    const variant = getRuleProfile(profileId);
    const variantDeck = buildDeck(variant);
    const maker = seatIndex(0, variant.seatCount);
    const trumpNine = variantDeck.find((candidate) => candidate.id === "S_9");
    const trumpAce = variantDeck.find((candidate) => candidate.id === "S_A");
    const heartJack = variantDeck.find((candidate) => candidate.id === "H_J");
    if (!trumpNine || !trumpAce || !heartJack) {
      throw new Error("Expected exhausted-trump fixtures");
    }
    const variantContext: TrickContext = {
      completedTrickCount: 2,
      indicator:
        variantDeck.find((candidate) => candidate.id === "S_J") ?? null,
      maker,
      mustLeadRemainingTrumps: true,
      profile: variant,
      trumpOpen: false,
      trumpSuit: "spades",
    };

    expect(
      legalCardPlays(
        variantContext,
        createTrick(maker),
        [trumpNine, trumpAce, heartJack],
        maker,
      ),
    ).toEqual([
      { cardId: "S_9", faceDown: false, fromIndicator: false },
      { cardId: "S_A", faceDown: false, fromIndicator: false },
    ]);
  });

  it("allows the maker to leave an exhausted-trump sequence after in-hand trumps run out", () => {
    expect(
      legalCardPlays(
        context({
          completedTrickCount: 2,
          mustLeadRemainingTrumps: true,
        }),
        createTrick(seatIndex(0, 4)),
        [card("H_J")],
        seatIndex(0, 4),
      ),
    ).toEqual([{ cardId: "H_J", faceDown: false, fromIndicator: false }]);
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
    expect(trick.trumpRevealReason).toBe("face-down-trump-cut");
  });

  it("keeps a below-250 closed first trick closed unless a face-down trump cuts", () => {
    let trick = createTrick(seatIndex(0, 4));
    const hands = [[card("H_J")], [card("C_7")], [card("H_9")], [card("H_A")]];
    let trumpOpen = false;
    for (const actor of [0, 1, 2, 3]) {
      const played = playCard(
        context({ forceOpenOnCompletion: false, trumpOpen }),
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

    expect(trick.openedTrump).toBe(false);
    expect(trick.trumpRevealReason).toBeNull();
    expect(trumpOpen).toBe(false);
  });

  it("keeps the automatic 250-plus reveal after the closed first trick", () => {
    let trick = createTrick(seatIndex(0, 4));
    const hands = [[card("H_J")], [card("C_7")], [card("H_9")], [card("H_A")]];
    let trumpOpen = false;
    for (const actor of [0, 1, 2, 3]) {
      const played = playCard(
        context({ forceOpenOnCompletion: true, trumpOpen }),
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

    expect(trick.openedTrump).toBe(true);
    expect(trick.trumpRevealReason).toBe("high-bid-after-first-trick");
    expect(trumpOpen).toBe(true);
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
