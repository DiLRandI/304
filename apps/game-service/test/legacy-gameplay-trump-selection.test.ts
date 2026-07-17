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

function trumpSelectionSnapshot(
  secondBiddingEnabled: boolean,
): LegacyGameplaySnapshotRecord {
  let snapshot = legacyStartedGameplaySnapshot({ secondBiddingEnabled });
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
  return snapshot;
}

describe("legacy gameplay trump selection", () => {
  it.each([
    { enableSecondBidding: true, phase: "second-bidding" },
    { enableSecondBidding: false, phase: "trump-choice" },
  ] as const)("encodes indicator selection into $phase", (scenario) => {
    const source = trumpSelectionSnapshot(scenario.enableSecondBidding);
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    const indicator =
      actor === null ? null : before.deal.firstHands[actor]?.[0];
    if (actor === null || !indicator) {
      throw new Error("Expected a trump indicator candidate");
    }
    const openingState = source.state as {
      bidding: Record<string, unknown>;
    };
    const command: GameplayCommand = {
      actor,
      cardId: indicator.id,
      type: "SELECT_TRUMP",
    };

    const result = transition(source, command);
    const state = result.snapshot.state as {
      bidding: Record<string, unknown>;
      phase: string;
      seats: Array<{ hand: unknown[] }>;
      trump: { card: { cardId: string } | null };
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(result.hand.phase).toBe(scenario.phase);
    expect(state.phase).toBe(scenario.phase.replaceAll("-", "_"));
    expect(state.trump.card?.cardId).toBe(indicator.id);
    expect(state.bidding.actions).toEqual(openingState.bidding.actions);
    expect(state.bidding.actedInRound).toEqual(
      openingState.bidding.actedInRound,
    );
    expect(state.bidding.noBidPasses).toBe(openingState.bidding.noBidPasses);
    expect(state.bidding.order).toEqual(openingState.bidding.order);
    expect(state.bidding.passesAfterBid).toBe(
      openingState.bidding.passesAfterBid,
    );
    expect(state.seats.map((seat) => seat.hand.length)).toEqual(
      result.hand.deal.hands.map((cards) => cards.length),
    );
  });
});
