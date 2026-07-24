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
import { legacyStartedGameplaySnapshot } from "./support/legacy-gameplay-snapshot-fixture.js";

function transition(
  source: LegacyGameplaySnapshotRecord,
  command: GameplayCommand,
) {
  const before = decodeGameplayHand(source);
  const decision = applyGameplayCommand(before, command);
  if (!decision.ok) throw new Error(decision.error.message);
  return {
    hand: decision.hand,
    snapshot: encodeGameplayHand(decision.hand, { command, source }),
  };
}

function startTrickPlay(
  trumpChoice: "TRUMP_CLOSE" | "TRUMP_OPEN",
  tokens?: readonly [number, number],
): LegacyGameplaySnapshotRecord {
  let snapshot = legacyStartedGameplaySnapshot({
    secondBiddingEnabled: false,
    tokens,
  });
  while (decodeGameplayHand(snapshot).phase === "four-bidding") {
    const before = decodeGameplayHand(snapshot);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    const command: GameplayCommand =
      before.bidding.currentBid === null
        ? { actor, amount: bidAmount(200), type: "BID" }
        : { actor, type: "PASS_BID" };
    snapshot = transition(snapshot, command).snapshot;
  }
  const selection = decodeGameplayHand(snapshot);
  const maker = selection.activeSeat;
  const indicator =
    maker === null ? null : selection.deal.firstHands[maker]?.[0];
  if (maker === null || !indicator) {
    throw new Error("Expected a trump indicator candidate");
  }
  snapshot = transition(snapshot, {
    actor: maker,
    cardId: indicator.id,
    type: "SELECT_TRUMP",
  }).snapshot;
  return transition(snapshot, { actor: maker, type: trumpChoice }).snapshot;
}

describe("legacy gameplay card play", () => {
  it.each([
    "TRUMP_OPEN",
    "TRUMP_CLOSE",
  ] as const)("encodes an in-progress card play after %s", (trumpChoice) => {
    const source = startTrickPlay(trumpChoice);
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

    const result = transition(source, command);
    const sourceState = source.state as {
      currentTrick: { plays: unknown[] } | null;
    };
    const state = result.snapshot.state as {
      activeSeat: number | null;
      currentLedSuit: string | null;
      currentTrick: {
        plays: Array<{
          card: { cardId: string };
          faceDown: boolean;
          fromIndicator: boolean;
          seatIndex: number;
        }>;
      } | null;
      phase: string;
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe("trick_play");
    expect(state.currentLedSuit).toBe(
      result.hand.currentTrick?.plays[0]?.card.suit,
    );
    expect(state.currentTrick?.plays).toHaveLength(1);
    expect(state.currentTrick?.plays[0]).toMatchObject({
      card: { cardId: command.cardId },
      faceDown: command.faceDown,
      fromIndicator: command.fromIndicator,
      seatIndex: actor,
    });
    expect(state.activeSeat).toBe(result.hand.activeSeat);
    expect(sourceState.currentTrick?.plays).toHaveLength(0);
  });

  it("encodes a completing card play into trick result", () => {
    let source = startTrickPlay("TRUMP_OPEN");
    while ((decodeGameplayHand(source).currentTrick?.plays.length ?? 0) < 3) {
      const before = decodeGameplayHand(source);
      const actor = before.activeSeat;
      const command =
        actor === null
          ? null
          : legalGameplayCommands(before, actor).find(
              (candidate) => candidate.type === "PLAY_CARD",
            );
      if (actor === null || !command || command.type !== "PLAY_CARD") {
        throw new Error("Expected an in-progress card play");
      }
      source = transition(source, command).snapshot;
    }
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

    const result = transition(source, command);
    const sourceState = source.state as { completedTricks: unknown[] };
    const state = result.snapshot.state as {
      activeSeat: number | null;
      completedTricks: unknown[];
      currentTrick: { winnerSeat?: number | null } | null;
      phase: string;
      seats: Array<{ wonCards: unknown[] }>;
    };

    expect(result.hand.phase).toBe("trick-result");
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(result.hand.activeSeat).toBeNull();
    expect(result.hand.currentTrick).toMatchObject({
      activeSeat: null,
      status: "complete",
      winnerSeat: state.currentTrick?.winnerSeat,
    });
    expect(result.hand.completedTricks).toHaveLength(1);
    expect(result.hand.capturedCards.map((cards) => cards.length)).toEqual(
      state.seats.map((seat) => seat.wonCards.length),
    );
    expect(state.phase).toBe("trick_result");
    expect(state.activeSeat).toBeNull();
    expect(state.currentTrick?.winnerSeat).toBe(
      result.hand.currentTrick?.winnerSeat,
    );
    expect(state.completedTricks).toHaveLength(1);
    expect(
      state.seats.reduce((total, seat) => total + seat.wonCards.length, 0),
    ).toBe(4);
    const advanced = applyGameplayCommand(result.hand, {
      actor: null,
      type: "ADVANCE_TRICK",
    });
    expect(advanced).toMatchObject({ hand: { phase: "trick-play" }, ok: true });
    expect(sourceState.completedTricks).toHaveLength(0);
  });

  it("encodes advancing a completed trick into the next trick", () => {
    let source = startTrickPlay("TRUMP_OPEN");
    while (decodeGameplayHand(source).phase === "trick-play") {
      const before = decodeGameplayHand(source);
      const actor = before.activeSeat;
      const command =
        actor === null
          ? null
          : legalGameplayCommands(before, actor).find(
              (candidate) => candidate.type === "PLAY_CARD",
            );
      if (actor === null || !command || command.type !== "PLAY_CARD") {
        throw new Error("Expected a legal card play");
      }
      source = transition(source, command).snapshot;
    }
    const before = decodeGameplayHand(source);
    const result = transition(source, { actor: null, type: "ADVANCE_TRICK" });
    const sourceState = source.state as { phase: string };
    const state = result.snapshot.state as {
      activeSeat: number | null;
      completedTricks: unknown[];
      currentLedSuit: string | null;
      currentTrick: {
        leaderSeat: number;
        plays: unknown[];
        points: number;
      } | null;
      phase: string;
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe("trick_play");
    expect(state.activeSeat).toBe(before.currentTrick?.winnerSeat);
    expect(state.completedTricks).toHaveLength(1);
    expect(state.currentTrick).toMatchObject({
      leaderSeat: before.currentTrick?.winnerSeat,
      plays: [],
      points: 0,
    });
    expect(state.currentLedSuit).toBeNull();
    const actor = result.hand.activeSeat;
    if (actor === null) throw new Error("Expected the next trick leader");
    expect(legalGameplayCommands(result.hand, actor)).toContainEqual(
      expect.objectContaining({ type: "PLAY_CARD" }),
    );
    expect(sourceState.phase).toBe("trick_result");
  });

  it.each([
    { phase: "hand-result", tokens: undefined },
    { phase: "match-complete", tokens: [1, 1] as const },
  ] as const)("encodes final trick advancement into $phase", (scenario) => {
    let source = startTrickPlay("TRUMP_OPEN", scenario.tokens);
    while (decodeGameplayHand(source).completedTricks.length < 8) {
      while (decodeGameplayHand(source).phase === "trick-play") {
        const before = decodeGameplayHand(source);
        const actor = before.activeSeat;
        const command =
          actor === null
            ? null
            : legalGameplayCommands(before, actor).find(
                (candidate) => candidate.type === "PLAY_CARD",
              );
        if (actor === null || !command || command.type !== "PLAY_CARD") {
          throw new Error("Expected a legal card play");
        }
        source = transition(source, command).snapshot;
      }
      if (decodeGameplayHand(source).completedTricks.length < 8) {
        source = transition(source, {
          actor: null,
          type: "ADVANCE_TRICK",
        }).snapshot;
      }
    }
    const before = decodeGameplayHand(source);
    const result = transition(source, { actor: null, type: "ADVANCE_TRICK" });
    const state = result.snapshot.state as {
      activeSeat: number | null;
      completedTricks: unknown[];
      handResult: {
        bid?: number;
        bidderTeam?: number;
        bidderTeamPoints?: number;
        winningTeam?: number;
      } | null;
      phase: string;
      tokens: [number, number];
    };

    expect(before.phase).toBe("trick-result");
    expect(result.hand.phase).toBe(scenario.phase);
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe(scenario.phase.replaceAll("-", "_"));
    expect(state.activeSeat).toBeNull();
    expect(state.handResult).not.toHaveProperty("settlementReason");
    expect(state.tokens).toEqual(result.hand.tokens);
    expect(state.completedTricks).toHaveLength(8);
    expect(result.hand.result).toMatchObject({
      bid: state.handResult?.bid,
      bidderTeam: state.handResult?.bidderTeam,
      bidderTeamPoints: state.handResult?.bidderTeamPoints,
      matchComplete: scenario.phase === "match-complete",
      tokens: state.tokens,
      winningTeam: state.handResult?.winningTeam,
    });
    const maker = result.hand.trump.maker;
    if (maker === null) throw new Error("Expected a trump maker");
    expect(legalGameplayCommands(result.hand, maker)).toContainEqual({
      actor: maker,
      type: "ACK_RESULT",
    });
    expect((source.state as { phase: string }).phase).toBe("trick_result");
  });
});
