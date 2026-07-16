import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import {
  applyGameplayCommand,
  bidAmount,
  type GameplayCommand,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";
import { GameplaySnapshotCodecError } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";

function snapshot(profileId: "classic_304_4p" | "six_304_36"): {
  engine: GameEngine;
  record: LegacyGameplaySnapshotRecord;
} {
  const engine = new GameEngine({
    humanCount: profileId === "classic_304_4p" ? 4 : 6,
    ruleProfile: profileId,
  });
  engine.startMatch();
  return {
    engine,
    record: {
      ruleProfileId: profileId,
      schemaVersion: 1,
      state: engine.getSnapshot(),
    },
  };
}

describe("domain gameplay compatibility snapshot decoder", () => {
  it.each([
    { amount: 160, type: "BID" },
    { type: "PASS_BID" },
  ] as const)("encodes one opening $type transition as schema v1", (action) => {
    const { engine, record } = snapshot("classic_304_4p");
    const before = decodeGameplayHand(record);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    const command: GameplayCommand =
      action.type === "BID"
        ? { actor, amount: bidAmount(action.amount), type: "BID" }
        : { actor, type: "PASS_BID" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected a legal opening command");

    const encoded = encodeGameplayHand(applied.hand, {
      command,
      source: record,
    });

    expect(encoded.schemaVersion).toBe(1);
    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.activeSeat).toBe(applied.hand.activeSeat);
    expect(legacy.bidding.currentBid).toBe(
      applied.hand.bidding.currentBid ?? 0,
    );
    expect(legacy.bidding.actions).toHaveLength(1);
    expect(engine.getSnapshot().bidding.actions).toHaveLength(0);
  });

  it("encodes the final opening pass into trump selection", () => {
    const { engine, record } = snapshot("classic_304_4p");
    const applyLegacy = (action: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active bidding seat");
      expect(
        engine.applyAction({
          ...action,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 160, type: "BID" });
    while (engine.getSnapshot().bidding.passesAfterBid < 2) {
      applyLegacy({ type: "PASS_BID" });
    }
    const source: LegacyGameplaySnapshotRecord = {
      ...record,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    const command: GameplayCommand = { actor, type: "PASS_BID" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected a legal final pass");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe("trump_selection");
    expect(legacy.trump.maker).toBe(applied.hand.trump.maker);
    expect(
      GameEngine.hydrate(encoded.state as EngineState).getLegalActions(
        legacy.activeSeat ?? -1,
      ),
    ).toHaveLength(4);
  });

  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("decodes a started %s four-card bidding snapshot", (profileId) => {
    const { engine, record } = snapshot(profileId);
    const legacy = engine.getSnapshot();

    const hand = decodeGameplayHand(record);

    expect(hand.profile.id).toBe(profileId);
    expect(hand.phase).toBe("four-bidding");
    expect(hand.dealer).toBe(legacy.dealerSeat);
    expect(hand.activeSeat).toBe(legacy.activeSeat);
    expect(hand.handNumber).toBe(1);
    expect(hand.deal.deck.map((card) => card.id)).toEqual(
      legacy.deck.map((card) => card.cardId),
    );
    expect(
      hand.deal.hands.map((cards) => cards.map((card) => card.id)),
    ).toEqual(legacy.seats.map((seat) => seat.hand.map((card) => card.cardId)));
    expect(hand.tokens).toEqual([11, 11]);
  });

  it("maps in-progress opening bids without preserving engine internals", () => {
    const { engine, record } = snapshot("classic_304_4p");
    const actor = engine.getSnapshot().activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    expect(
      engine.applyAction({
        actorSeatIndex: actor,
        amount: 160,
        seatIndex: actor,
        type: "BID",
      }),
    ).toEqual({ ok: true });
    const progressed: LegacyGameplaySnapshotRecord = {
      ...record,
      state: engine.getSnapshot(),
    };

    const hand = decodeGameplayHand(progressed);

    expect(hand.activeSeat).toBe((actor + 1) % 4);
    expect(hand.bidding).toMatchObject({
      actionsTaken: 1,
      currentBid: 160,
      currentBidder: actor,
      round: "four",
      status: "active",
    });
    expect(hand.bidding.actedInRound[actor]).toBe(true);
  });

  it("decodes completed opening bidding into trump selection", () => {
    const { engine, record } = snapshot("classic_304_4p");
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an active bidding seat");
    expect(
      engine.applyAction({
        actorSeatIndex: maker,
        amount: 160,
        seatIndex: maker,
        type: "BID",
      }),
    ).toEqual({ ok: true });
    while (engine.getSnapshot().phase === "four_bidding") {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active bidding seat");
      expect(
        engine.applyAction({
          actorSeatIndex: actor,
          seatIndex: actor,
          type: "PASS_BID",
        }),
      ).toEqual({ ok: true });
    }

    const hand = decodeGameplayHand({
      ...record,
      state: engine.getSnapshot(),
    });

    expect(hand.phase).toBe("trump-selection");
    expect(hand.activeSeat).toBe(maker);
    expect(hand.trump).toEqual({
      indicator: null,
      maker,
      mode: null,
      open: false,
      suit: null,
    });
    expect(hand.bidding).toMatchObject({
      activeSeat: null,
      currentBid: 160,
      currentBidder: maker,
      status: "complete",
    });
  });

  it("decodes second bidding and the following trump choice", () => {
    const { engine, record } = snapshot("classic_304_4p");
    const apply = (action: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...action,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an active bidding seat");
    apply({ amount: 160, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      apply({ type: "PASS_BID" });
    }
    const indicator = engine
      .getLegalActions(maker)
      .find((action) => action.type === "SELECT_TRUMP");
    if (!indicator) throw new Error("Expected a trump indicator action");
    apply(indicator);

    const secondBidding = decodeGameplayHand({
      ...record,
      state: engine.getSnapshot(),
    });
    expect(secondBidding.phase).toBe("second-bidding");
    expect(secondBidding.bidding).toMatchObject({
      actedInRound: [false, false, false, false],
      actionsTaken: 0,
      activeSeat: maker,
      currentBid: 160,
      currentBidder: maker,
      previousBid: 160,
      round: "second",
      status: "active",
    });
    expect(secondBidding.trump).toMatchObject({
      indicator: { id: indicator.cardId },
      maker,
      mode: null,
      open: false,
    });
    expect(secondBidding.deal.hands.map((cards) => cards.length)).toEqual(
      Array.from({ length: 4 }, (_, seat) => (seat === maker ? 7 : 8)),
    );

    while (engine.getSnapshot().phase === "second_bidding") {
      apply({ type: "PASS_BID" });
    }
    const trumpChoice = decodeGameplayHand({
      ...record,
      state: engine.getSnapshot(),
    });
    expect(trumpChoice.phase).toBe("trump-choice");
    expect(trumpChoice.activeSeat).toBe(maker);
    expect(trumpChoice.bidding).toMatchObject({
      actedInRound: [true, true, true, true],
      actionsTaken: 4,
      activeSeat: null,
      round: "second",
      status: "complete",
    });
  });

  it("decodes active and completed trick snapshots", () => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const apply = (action: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...action,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an active bidding seat");
    apply({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      apply({ type: "PASS_BID" });
    }
    const indicator = engine
      .getLegalActions(maker)
      .find((action) => action.type === "SELECT_TRUMP");
    if (!indicator) throw new Error("Expected a trump indicator action");
    apply(indicator);
    apply({ type: "TRUMP_CLOSE" });
    const record = (state: EngineState): LegacyGameplaySnapshotRecord => ({
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state,
    });

    const started = decodeGameplayHand(record(engine.getSnapshot()));
    expect(started.phase).toBe("trick-play");
    expect(started.currentTrick).toMatchObject({
      activeSeat: maker,
      leaderSeat: maker,
      plays: [],
      status: "active",
    });
    expect(started.trump).toMatchObject({ maker, mode: "closed", open: false });

    const firstPlay = engine
      .getLegalActions(maker)
      .find((action) => action.type === "PLAY_CARD");
    if (!firstPlay) throw new Error("Expected a legal card play");
    apply(firstPlay);
    const progressed = decodeGameplayHand(record(engine.getSnapshot()));
    expect(progressed.currentTrick?.plays).toHaveLength(1);
    expect(progressed.currentTrick?.plays[0]).toMatchObject({ actor: maker });

    while (engine.getSnapshot().phase === "trick_play") {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active trick seat");
      const action = engine
        .getLegalActions(actor)
        .find((candidate) => candidate.type === "PLAY_CARD");
      if (!action) throw new Error("Expected a legal card play");
      apply(action);
    }
    const legacy = engine.getSnapshot();
    const completed = decodeGameplayHand(record(legacy));
    expect(completed.phase).toBe("trick-result");
    expect(completed.activeSeat).toBeNull();
    expect(completed.currentTrick).toMatchObject({
      activeSeat: null,
      status: "complete",
      winnerSeat: legacy.currentTrick?.winnerSeat,
    });
    expect(completed.completedTricks).toHaveLength(1);
    expect(completed.capturedCards.map((cards) => cards.length)).toEqual(
      legacy.seats.map((seat) => seat.wonCards.length),
    );
  });

  it("decodes an all-pass hand result", () => {
    const { engine, record } = snapshot("classic_304_4p");
    while (engine.getSnapshot().phase === "four_bidding") {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active bidding seat");
      expect(
        engine.applyAction({
          actorSeatIndex: actor,
          seatIndex: actor,
          type: "PASS_BID",
        }),
      ).toEqual({ ok: true });
    }

    const hand = decodeGameplayHand({
      ...record,
      state: engine.getSnapshot(),
    });

    expect(hand.phase).toBe("hand-result");
    expect(hand.activeSeat).toBeNull();
    expect(hand.bidding.status).toBe("cancelled");
    expect(hand.result).toEqual({
      noScore: true,
      reason: "All players passed. No score movement this hand.",
      tokens: [11, 11],
    });
  });

  it.each([
    { matchTokens: null, phase: "hand-result" },
    { matchTokens: [1, 1], phase: "match-complete" },
  ] as const)("decodes a scored $phase snapshot", ({ matchTokens, phase }) => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    if (matchTokens) {
      (engine.state as unknown as { tokens: [number, number] }).tokens = [
        ...matchTokens,
      ];
    }
    const apply = (action: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...action,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    const maker = engine.getSnapshot().activeSeat;
    if (maker === null) throw new Error("Expected an active bidding seat");
    apply({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      apply({ type: "PASS_BID" });
    }
    const indicator = engine
      .getLegalActions(maker)
      .find((action) => action.type === "SELECT_TRUMP");
    if (!indicator) throw new Error("Expected a trump indicator action");
    apply(indicator);
    apply({ type: "TRUMP_OPEN" });
    let actions = 0;
    while (
      engine.getSnapshot().phase !== "hand_result" &&
      engine.getSnapshot().phase !== "match_complete" &&
      actions < 64
    ) {
      if (engine.getSnapshot().phase === "trick_result") {
        expect(engine.advanceTrick()).toEqual({ ok: true });
      } else {
        const actor = engine.getSnapshot().activeSeat;
        if (actor === null) throw new Error("Expected an active trick seat");
        const action = engine
          .getLegalActions(actor)
          .find((candidate) => candidate.type === "PLAY_CARD");
        if (!action) throw new Error("Expected a legal card play");
        apply(action);
      }
      actions += 1;
    }
    const legacy = engine.getSnapshot();

    const hand = decodeGameplayHand({
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: legacy,
    });

    expect(hand.phase).toBe(phase);
    expect(hand.result).toMatchObject({
      bid: legacy.handResult?.bid,
      bidderTeam: legacy.handResult?.bidderTeam,
      bidderTeamPoints: legacy.handResult?.bidderTeamPoints,
      matchComplete: phase === "match-complete",
      tokens: legacy.tokens,
      winningTeam: legacy.handResult?.winningTeam,
    });
    expect(hand.completedTricks).toHaveLength(8);
  });

  it("rejects lobby snapshots because Room Management owns the lobby", () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });

    expect(() =>
      decodeGameplayHand({
        ruleProfileId: "classic_304_4p",
        schemaVersion: 1,
        state: engine.getSnapshot(),
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Lobby snapshots do not contain a gameplay hand",
      ),
    );
  });

  it("rejects non-production snapshot versions", () => {
    const { record } = snapshot("classic_304_4p");

    expect(() =>
      decodeGameplayHand({ ...record, schemaVersion: 2 }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Gameplay compatibility snapshot version is not supported",
      ),
    );
  });

  it("rejects a profile mismatch", () => {
    const { record } = snapshot("classic_304_4p");
    const state = record.state as EngineState;

    expect(() =>
      decodeGameplayHand({
        ...record,
        ruleProfileId: "six_304_36",
        state,
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay compatibility snapshot state is invalid",
      ),
    );
  });
});
