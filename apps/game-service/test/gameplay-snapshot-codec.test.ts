import { describe, expect, it } from "vitest";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
  serializeGameplaySnapshot,
} from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import {
  completedGameplayHand,
  selectedTrumpGameplayHand,
  startedGameplayHand,
} from "./support/gameplay-hand-fixture.js";
import { legacyStartedGameplaySnapshot } from "./support/legacy-gameplay-snapshot-fixture.js";

describe("gameplay snapshot codec", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("round-trips a versioned %s aggregate snapshot", (profileId) => {
    const aggregate = startedGameplayHand(profileId, true, true);
    const record = serializeGameplaySnapshot(aggregate);

    expect(record).toMatchObject({
      ruleProfileId: profileId,
      schemaVersion: 3,
      state: {
        endHandWhenOutcomeCertain: true,
        handNumber: 1,
        phase: "four-bidding",
      },
    });
    expect(hydrateGameplaySnapshot(record)).toEqual(aggregate);
  });

  it("does not let hydrated mutations alter the persisted JSON value", () => {
    const record = serializeGameplaySnapshot(startedGameplayHand());
    const hydrated = hydrateGameplaySnapshot(record);
    const firstHand = hydrated.deal.hands[0] as unknown[];

    firstHand.pop();

    expect(hydrateGameplaySnapshot(record).deal.hands[0]).toHaveLength(4);
  });

  it("round-trips public trump reveal evidence for reconnect projections", () => {
    const completed = completedGameplayHand();
    expect(completed.trump.revealedIndicator).not.toBeNull();

    expect(
      hydrateGameplaySnapshot(serializeGameplaySnapshot(completed)),
    ).toEqual(completed);
  });

  it("hydrates a face-down indicator while the trick is still active", () => {
    const { indicator, record, state } = pendingIndicatorSnapshot(true);

    expect(
      hydrateGameplaySnapshot({ ...record, state }).trump.revealedIndicator,
    ).toEqual(indicator);
  });

  it("recovers a face-down indicator omitted by an older v3 writer", () => {
    const { indicator, record, state } = pendingIndicatorSnapshot(false);

    expect(
      hydrateGameplaySnapshot({ ...record, state }).trump.revealedIndicator,
    ).toEqual(indicator);
  });

  it.each([
    {
      name: "closed trump",
      mutate(state: MutableGameplayHandState) {
        state.trump.open = false;
      },
    },
    {
      name: "a mismatched trump suit",
      mutate(state: MutableGameplayHandState) {
        state.trump.suit =
          state.trump.revealedIndicator?.suit === "spades"
            ? "hearts"
            : "spades";
      },
    },
    {
      name: "an indicator missing from aggregate ownership",
      mutate(state: MutableGameplayHandState) {
        const id = state.trump.revealedIndicator?.id;
        if (!id) throw new Error("Expected a revealed indicator");
        state.deal.deck = state.deal.deck.filter((card) => card.id !== id);
        state.deal.hands = state.deal.hands.map((cards) =>
          cards.filter((card) => card.id !== id),
        );
        state.capturedCards = state.capturedCards.map((cards) =>
          cards.filter((card) => card.id !== id),
        );
        state.currentTrick =
          state.currentTrick === null
            ? null
            : {
                ...state.currentTrick,
                plays: state.currentTrick.plays.filter(
                  (play) => play.card.id !== id,
                ),
              };
      },
    },
    {
      name: "duplicate indicator ownership",
      mutate(state: MutableGameplayHandState) {
        const indicator = state.trump.revealedIndicator;
        if (!indicator) throw new Error("Expected a revealed indicator");
        state.deal.hands[0] = [
          ...(state.deal.hands[0] ?? []),
          structuredClone(indicator),
        ];
      },
    },
  ])("rejects revealed indicator evidence with $name", ({ mutate }) => {
    const record = serializeGameplaySnapshot(completedGameplayHand());
    const state = structuredClone(record.state) as MutableGameplayHandState;
    mutate(state);

    expect(() => hydrateGameplaySnapshot({ ...record, state })).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot state is invalid",
      ),
    );
  });

  it.each([
    {
      name: "a high-bid reason below 250",
      reason: "high-bid-after-first-trick" as const,
      bid: 200,
      faceDownTrump: false,
    },
    {
      name: "a high-bid reason when a face-down trump cut",
      reason: "high-bid-after-first-trick" as const,
      bid: 250,
      faceDownTrump: true,
    },
    {
      name: "a cut reason without a face-down trump",
      reason: "face-down-trump-cut" as const,
      bid: 250,
      faceDownTrump: false,
    },
  ])("rejects $name", ({ bid, faceDownTrump, reason }) => {
    const record = serializeGameplaySnapshot(completedGameplayHand());
    const state = structuredClone(record.state) as MutableGameplayHandState;
    const firstTrick = state.completedTricks[0];
    if (!firstTrick) throw new Error("Expected a first trick");
    const trumpPlay = firstTrick.plays.find(
      (play) => play.card.suit === state.trump.suit,
    );
    if (!trumpPlay) throw new Error("Expected a trump play");
    state.bidding.currentBid = bid;
    state.trump.mode = "closed";
    firstTrick.openedTrump = true;
    firstTrick.trumpRevealReason = reason;
    trumpPlay.faceDown = faceDownTrump;

    expect(() => hydrateGameplaySnapshot({ ...record, state })).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot state is invalid",
      ),
    );
  });

  it("hydrates older v3 snapshots without reveal evidence as unrevealed", () => {
    const current = serializeGameplaySnapshot(startedGameplayHand());
    const state = structuredClone(current.state) as GameplayHandState;
    const { revealedIndicator: _indicator, ...legacyTrump } = state.trump;

    expect(
      hydrateGameplaySnapshot({
        ...current,
        state: { ...state, trump: legacyTrump },
      }).trump.revealedIndicator,
    ).toBeNull();
  });

  it("rejects unsupported snapshot versions", () => {
    expect(() =>
      hydrateGameplaySnapshot({
        ...serializeGameplaySnapshot(startedGameplayHand()),
        schemaVersion: 4,
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot version is not supported",
      ),
    );
  });

  it("hydrates v1 and v2 snapshots with early settlement disabled", () => {
    const current = serializeGameplaySnapshot(
      startedGameplayHand("classic_304_4p", true, true),
    );

    expect(
      hydrateGameplaySnapshot({
        ...current,
        schemaVersion: 2,
        state: legacyV2State(current.state as GameplayHandState),
      }).endHandWhenOutcomeCertain,
    ).toBe(false);
    expect(
      hydrateGameplaySnapshot(legacyStartedGameplaySnapshot())
        .endHandWhenOutcomeCertain,
    ).toBe(false);
  });

  it.each([
    "revealed indicator",
    "trick reveal reason",
  ] as const)("rejects v3-only %s evidence in a v2 snapshot", (evidence) => {
    const current = serializeGameplaySnapshot(completedGameplayHand());
    const {
      endHandWhenOutcomeCertain: _setting,
      result,
      ...v2State
    } = structuredClone(current.state) as GameplayHandState;
    if (!result || "noScore" in result) {
      throw new Error("Expected a scored hand result");
    }
    const { settlementReason: _reason, ...v2Result } = result;
    const state = { ...v2State, result: v2Result };
    for (const trick of state.completedTricks) {
      delete (trick as { trumpRevealReason?: unknown }).trumpRevealReason;
    }
    if (state.currentTrick) {
      delete (state.currentTrick as { trumpRevealReason?: unknown })
        .trumpRevealReason;
    }
    delete (
      state.trump as GameplayHandState["trump"] & {
        revealedIndicator?: unknown;
      }
    ).revealedIndicator;

    if (evidence === "revealed indicator") {
      Object.assign(state.trump, { revealedIndicator: null });
    } else {
      Object.assign(state.completedTricks[0] ?? {}, {
        trumpRevealReason: null,
      });
    }

    expect(() =>
      hydrateGameplaySnapshot({
        ...current,
        schemaVersion: 2,
        state,
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot state is invalid",
      ),
    );
  });

  it("hydrates a scored v2 result as all tricks played", () => {
    const current = serializeGameplaySnapshot(completedGameplayHand());

    expect(
      hydrateGameplaySnapshot({
        ...current,
        schemaVersion: 2,
        state: legacyV2State(current.state as GameplayHandState),
      }).result,
    ).toMatchObject({ settlementReason: "all-tricks-played" });
  });

  it("rejects structurally invalid aggregate state", () => {
    const record = serializeGameplaySnapshot(startedGameplayHand());
    expect(() =>
      hydrateGameplaySnapshot({
        ...record,
        state: { ...(record.state as object), capturedCards: [] },
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot state is invalid",
      ),
    );
  });
});

type GameplayHandState = Omit<
  ReturnType<typeof completedGameplayHand>,
  "profile"
>;

type MutableGameplayHandState = {
  -readonly [Key in keyof GameplayHandState]: Mutable<GameplayHandState[Key]>;
};

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

function pendingIndicatorSnapshot(includeEvidence: boolean) {
  const selected = selectedTrumpGameplayHand(180);
  const record = serializeGameplaySnapshot(selected);
  const state = structuredClone(record.state) as MutableGameplayHandState;
  const indicator = state.trump.indicator;
  const maker = state.trump.maker;
  if (!indicator || maker === null) {
    throw new Error("Expected a selected trump indicator");
  }
  state.activeSeat = 1;
  state.currentTrick = {
    activeSeat: 1,
    leaderSeat: maker,
    openedTrump: false,
    plays: [
      {
        actor: maker,
        card: indicator,
        faceDown: true,
        fromIndicator: true,
      },
    ],
    points: indicator.points,
    status: "active",
    trumpRevealReason: null,
    winnerSeat: null,
  };
  state.phase = "trick-play";
  state.trump = {
    ...state.trump,
    indicator: null,
    mode: "closed",
    open: false,
    revealedIndicator: includeEvidence ? indicator : null,
  };
  return { indicator, record, state };
}

function legacyV2State(state: GameplayHandState): unknown {
  const legacy = structuredClone(state) as MutableGameplayHandState;
  delete (
    legacy as MutableGameplayHandState & {
      endHandWhenOutcomeCertain?: unknown;
    }
  ).endHandWhenOutcomeCertain;
  delete (
    legacy.trump as MutableGameplayHandState["trump"] & {
      revealedIndicator?: unknown;
    }
  ).revealedIndicator;
  for (const trick of [
    ...legacy.completedTricks,
    ...(legacy.currentTrick ? [legacy.currentTrick] : []),
  ]) {
    delete (trick as typeof trick & { trumpRevealReason?: unknown })
      .trumpRevealReason;
  }
  if (legacy.result && !("noScore" in legacy.result)) {
    delete (
      legacy.result as typeof legacy.result & {
        settlementReason?: unknown;
      }
    ).settlementReason;
  }
  return legacy;
}
