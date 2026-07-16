import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import {
  applyGameplayCommand,
  bidAmount,
  type GameplayCommand,
  legalGameplayCommands,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

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
    { amount: 250, type: "BID" },
    { type: "PASS_BID" },
  ] as const)("encodes one second-round $type transition", (action) => {
    const engine = new GameEngine({
      enableSecondBidding: true,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    if (action.type === "BID") {
      applyLegacy({ type: "PASS_BID" });
    }
    const secondRoundBefore = structuredClone(
      engine.getSnapshot().bidding.secondRound,
    );
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active second bidder");
    const command: GameplayCommand =
      action.type === "BID"
        ? { actor, amount: bidAmount(action.amount), type: "BID" }
        : { actor, type: "PASS_BID" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected a legal second-round command");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe("second_bidding");
    expect(legacy.bidding.secondRound.actionsTaken).toBe(
      secondRoundBefore.actionsTaken + 1,
    );
    expect(legacy.bidding.secondRound.anyBid).toBe(action.type === "BID");
    expect(legacy.bidding.secondRound.previousBid).toBe(
      applied.hand.bidding.currentBid,
    );
    expect(legacy.bidding.secondRound.previousBidSeat).toBe(
      secondRoundBefore.previousBidSeat,
    );
    expect(legacy.bidding.actions).toHaveLength(
      engine.getSnapshot().bidding.actions.length + 1,
    );
    expect(engine.getSnapshot().bidding.secondRound.actionsTaken).toBe(
      secondRoundBefore.actionsTaken,
    );
  });

  it.each([
    { newMaker: false, phase: "trump-choice" },
    { newMaker: true, phase: "trump-selection" },
  ] as const)("encodes second bidding completion into $phase", (scenario) => {
    const engine = new GameEngine({
      enableSecondBidding: true,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const originalMaker = engine.getSnapshot().activeSeat;
    const indicator =
      originalMaker === null
        ? null
        : engine
            .getLegalActions(originalMaker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (
      originalMaker === null ||
      !indicator ||
      typeof indicator.cardId !== "string"
    ) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    applyLegacy({ type: "PASS_BID" });
    applyLegacy(
      scenario.newMaker ? { amount: 250, type: "BID" } : { type: "PASS_BID" },
    );
    applyLegacy({ type: "PASS_BID" });
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected the final second bidder");
    const command: GameplayCommand = { actor, type: "PASS_BID" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected second bidding to complete");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(applied.hand.phase).toBe(scenario.phase);
    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe(scenario.phase.replaceAll("-", "_"));
    expect(legacy.bidding.initialMakerSeat).toBe(originalMaker);
    expect(legacy.bidding.secondRound.actionsTaken).toBe(4);
    if (scenario.newMaker) {
      expect(legacy.trump.card).toBeNull();
      expect(
        legacy.seats[originalMaker]?.hand.some(
          (card) => card.cardId === indicator.cardId,
        ),
      ).toBe(true);
    } else {
      expect(legacy.trump.card?.cardId).toBe(indicator.cardId);
      expect(legacy.trump.maker).toBe(originalMaker);
    }
  });

  it.each([
    { commandType: "TRUMP_OPEN", mode: "open" },
    { commandType: "TRUMP_CLOSE", mode: "closed" },
  ] as const)("encodes $mode trump choice into trick play", (scenario) => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator || typeof indicator.cardId !== "string") {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const command: GameplayCommand = {
      actor: maker,
      type: scenario.commandType,
    };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected a legal trump choice");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe("trick_play");
    expect(legacy.activeSeat).toBe(maker);
    expect(legacy.currentTrick).toMatchObject({
      leaderSeat: maker,
      plays: [],
      points: 0,
    });
    expect(legacy.trumpClosed).toBe(scenario.mode === "closed");
    expect(legacy.trump.card?.cardId ?? null).toBe(
      scenario.mode === "closed" ? indicator.cardId : null,
    );
    expect(
      legacy.seats[maker]?.hand.some(
        (card) => card.cardId === indicator.cardId,
      ),
    ).toBe(scenario.mode === "open");
    expect(
      GameEngine.hydrate(encoded.state as EngineState).getLegalActions(maker),
    ).toContainEqual(expect.objectContaining({ type: "PLAY_CARD" }));
  });

  it.each([
    "TRUMP_OPEN",
    "TRUMP_CLOSE",
  ] as const)("encodes an in-progress card play after %s", (trumpChoice) => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    applyLegacy({ type: trumpChoice });
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    const command =
      actor === null
        ? null
        : legalGameplayCommands(before, actor).find(
            (candidate) => candidate.type === "PLAY_CARD",
          );
    if (actor === null || !command || command.type !== "PLAY_CARD") {
      throw new Error("Expected a legal opening card play");
    }
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected an in-progress trick");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe("trick_play");
    expect(legacy.currentLedSuit).toBe(
      applied.hand.currentTrick?.plays[0]?.card.suit,
    );
    expect(legacy.currentTrick?.plays).toHaveLength(1);
    expect(legacy.currentTrick?.plays[0]).toMatchObject({
      card: { cardId: command.cardId },
      faceDown: command.faceDown,
      fromIndicator: command.fromIndicator,
      seatIndex: actor,
    });
    expect(legacy.activeSeat).toBe(applied.hand.activeSeat);
    expect(engine.getSnapshot().currentTrick?.plays).toHaveLength(0);
  });

  it("encodes a completing card play into trick result", () => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    applyLegacy({ type: "TRUMP_OPEN" });
    while ((engine.getSnapshot().currentTrick?.plays.length ?? 0) < 3) {
      const actor = engine.getSnapshot().activeSeat;
      const play =
        actor === null
          ? null
          : engine
              .getLegalActions(actor)
              .find((candidate) => candidate.type === "PLAY_CARD");
      if (!play) throw new Error("Expected an in-progress legacy card play");
      applyLegacy(play);
    }
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    const command =
      actor === null
        ? null
        : legalGameplayCommands(before, actor).find(
            (candidate) => candidate.type === "PLAY_CARD",
          );
    if (actor === null || !command || command.type !== "PLAY_CARD") {
      throw new Error("Expected the completing card play");
    }
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected a completed trick");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(applied.hand.phase).toBe("trick-result");
    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const hydrated = GameEngine.hydrate(encoded.state as EngineState);
    const legacy = hydrated.getSnapshot();
    expect(legacy.phase).toBe("trick_result");
    expect(legacy.activeSeat).toBeNull();
    expect(legacy.currentTrick?.winnerSeat).toBe(
      applied.hand.currentTrick?.winnerSeat,
    );
    expect(legacy.completedTricks).toHaveLength(1);
    expect(
      legacy.seats.reduce((total, seat) => total + seat.wonCards.length, 0),
    ).toBe(4);
    expect(hydrated.advanceTrick()).toEqual({ ok: true });
    expect(hydrated.getSnapshot().phase).toBe("trick_play");
    expect(engine.getSnapshot().completedTricks).toHaveLength(0);
  });

  it("encodes advancing a completed trick into the next trick", () => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    applyLegacy({ type: "TRUMP_OPEN" });
    while (engine.getSnapshot().phase === "trick_play") {
      const actor = engine.getSnapshot().activeSeat;
      const play =
        actor === null
          ? null
          : engine
              .getLegalActions(actor)
              .find((candidate) => candidate.type === "PLAY_CARD");
      if (!play) throw new Error("Expected a legal legacy card play");
      applyLegacy(play);
    }
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const command: GameplayCommand = { actor: null, type: "ADVANCE_TRICK" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected the next trick to start");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe("trick_play");
    expect(legacy.activeSeat).toBe(before.currentTrick?.winnerSeat);
    expect(legacy.completedTricks).toHaveLength(1);
    expect(legacy.currentTrick).toMatchObject({
      leaderSeat: before.currentTrick?.winnerSeat,
      plays: [],
      points: 0,
    });
    expect(legacy.currentLedSuit).toBeNull();
    expect(
      GameEngine.hydrate(encoded.state as EngineState).getLegalActions(
        legacy.activeSeat ?? -1,
      ),
    ).toContainEqual(expect.objectContaining({ type: "PLAY_CARD" }));
    expect(engine.getSnapshot().phase).toBe("trick_result");
  });

  it.each([
    { phase: "hand-result", tokens: null },
    { phase: "match-complete", tokens: [1, 1] as [number, number] },
  ] as const)("encodes final trick advancement into $phase", (scenario) => {
    const engine = new GameEngine({
      enableSecondBidding: false,
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    if (scenario.tokens) {
      engine.state.tokens = [...scenario.tokens];
    }
    const applyLegacy = (legacyAction: Record<string, unknown>) => {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active gameplay seat");
      expect(
        engine.applyAction({
          ...legacyAction,
          actorSeatIndex: actor,
          seatIndex: actor,
        }),
      ).toEqual({ ok: true });
    };
    applyLegacy({ amount: 200, type: "BID" });
    while (engine.getSnapshot().phase === "four_bidding") {
      applyLegacy({ type: "PASS_BID" });
    }
    const maker = engine.getSnapshot().activeSeat;
    const indicator =
      maker === null
        ? null
        : engine
            .getLegalActions(maker)
            .find((candidate) => candidate.type === "SELECT_TRUMP");
    if (maker === null || !indicator) {
      throw new Error("Expected a trump indicator action");
    }
    applyLegacy(indicator);
    applyLegacy({ type: "TRUMP_OPEN" });
    while (engine.getSnapshot().completedTricks.length < 8) {
      while (engine.getSnapshot().phase === "trick_play") {
        const actor = engine.getSnapshot().activeSeat;
        const play =
          actor === null
            ? null
            : engine
                .getLegalActions(actor)
                .find((candidate) => candidate.type === "PLAY_CARD");
        if (!play) throw new Error("Expected a legal legacy card play");
        applyLegacy(play);
      }
      if (engine.getSnapshot().completedTricks.length < 8) {
        expect(engine.advanceTrick()).toEqual({ ok: true });
      }
    }
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const command: GameplayCommand = { actor: null, type: "ADVANCE_TRICK" };
    const applied = applyGameplayCommand(before, command);
    if (!applied.ok) throw new Error("Expected the hand to score");

    const encoded = encodeGameplayHand(applied.hand, { command, source });

    expect(applied.hand.phase).toBe(scenario.phase);
    expect(decodeGameplayHand(encoded)).toEqual(applied.hand);
    const legacy = GameEngine.hydrate(
      encoded.state as EngineState,
    ).getSnapshot();
    expect(legacy.phase).toBe(scenario.phase.replaceAll("-", "_"));
    expect(legacy.activeSeat).toBeNull();
    expect(legacy.handResult).toMatchObject(applied.hand.result ?? {});
    expect(legacy.tokens).toEqual(applied.hand.tokens);
    expect(legacy.completedTricks).toHaveLength(8);
    expect(
      GameEngine.hydrate(encoded.state as EngineState).getLegalActions(maker),
    ).toContainEqual(expect.objectContaining({ type: "ACK_RESULT" }));
    expect(engine.getSnapshot().phase).toBe("trick_result");
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
});
