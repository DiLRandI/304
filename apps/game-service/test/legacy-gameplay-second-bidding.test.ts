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

function startSecondBidding(): LegacyGameplaySnapshotRecord {
  let snapshot = legacyStartedGameplaySnapshot();
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
  const before = decodeGameplayHand(snapshot);
  const actor = before.activeSeat;
  const indicator = actor === null ? null : before.deal.firstHands[actor]?.[0];
  if (actor === null || !indicator) {
    throw new Error("Expected a trump indicator candidate");
  }
  return transition(snapshot, {
    actor,
    cardId: indicator.id,
    type: "SELECT_TRUMP",
  }).snapshot;
}

describe("legacy gameplay second bidding", () => {
  it("decodes the initial second-round state from a frozen transition", () => {
    const snapshot = startSecondBidding();
    const hand = decodeGameplayHand(snapshot);
    const maker = hand.activeSeat;
    if (maker === null || hand.trump.indicator === null) {
      throw new Error("Expected the opening maker and trump indicator");
    }

    expect(hand.phase).toBe("second-bidding");
    expect(hand.bidding).toMatchObject({
      actedInRound: [false, false, false, false],
      actionsTaken: 0,
      activeSeat: maker,
      currentBid: 200,
      currentBidder: maker,
      previousBid: 200,
      round: "second",
      status: "active",
    });
    expect(hand.trump).toMatchObject({
      maker,
      mode: null,
      open: false,
    });
    expect(hand.deal.hands.map((cards) => cards.length)).toEqual(
      Array.from({ length: 4 }, (_, seat) => (seat === maker ? 7 : 8)),
    );
  });

  it.each([
    { amount: 250, type: "BID" },
    { type: "PASS_BID" },
  ] as const)("encodes one second-round $type transition", (action) => {
    let source = startSecondBidding();
    if (action.type === "BID") {
      const before = decodeGameplayHand(source);
      const actor = before.activeSeat;
      if (actor === null) throw new Error("Expected an active second bidder");
      source = transition(source, { actor, type: "PASS_BID" }).snapshot;
    }
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active second bidder");
    const command: GameplayCommand =
      action.type === "BID"
        ? { actor, amount: bidAmount(action.amount), type: "BID" }
        : { actor, type: "PASS_BID" };
    const sourceState = source.state as {
      bidding: {
        actions: unknown[];
        secondRound: {
          actionsTaken: number;
          previousBidSeat: number | null;
        };
      };
    };

    const result = transition(source, command);
    const state = result.snapshot.state as {
      bidding: {
        actions: unknown[];
        secondRound: {
          actionsTaken: number;
          anyBid: boolean;
          previousBid: number;
          previousBidSeat: number | null;
        };
      };
      phase: string;
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe("second_bidding");
    expect(state.bidding.secondRound.actionsTaken).toBe(
      sourceState.bidding.secondRound.actionsTaken + 1,
    );
    expect(state.bidding.secondRound.anyBid).toBe(action.type === "BID");
    expect(state.bidding.secondRound.previousBid).toBe(
      result.hand.bidding.currentBid,
    );
    expect(state.bidding.secondRound.previousBidSeat).toBe(
      sourceState.bidding.secondRound.previousBidSeat,
    );
    expect(state.bidding.actions).toHaveLength(
      sourceState.bidding.actions.length + 1,
    );
    expect(sourceState.bidding.secondRound.actionsTaken).toBe(
      action.type === "BID" ? 1 : 0,
    );
  });
});
