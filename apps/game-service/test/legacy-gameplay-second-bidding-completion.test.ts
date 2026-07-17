import {
  applyGameplayCommand,
  bidAmount,
  type GameplayCommand,
  type SeatIndex,
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

function startSecondBidding(): {
  readonly indicatorId: string;
  readonly originalMaker: SeatIndex;
  readonly snapshot: LegacyGameplaySnapshotRecord;
} {
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
  const originalMaker = before.activeSeat;
  const indicator =
    originalMaker === null ? null : before.deal.firstHands[originalMaker]?.[0];
  if (originalMaker === null || !indicator) {
    throw new Error("Expected a trump indicator candidate");
  }
  return {
    indicatorId: indicator.id,
    originalMaker,
    snapshot: transition(snapshot, {
      actor: originalMaker,
      cardId: indicator.id,
      type: "SELECT_TRUMP",
    }).snapshot,
  };
}

describe("legacy gameplay second bidding completion", () => {
  it.each([
    { newMaker: false, phase: "trump-choice" },
    { newMaker: true, phase: "trump-selection" },
  ] as const)("encodes completion into $phase", (scenario) => {
    const started = startSecondBidding();
    let source = started.snapshot;
    for (const commandType of [
      "PASS_BID",
      scenario.newMaker ? "BID" : "PASS_BID",
      "PASS_BID",
    ] as const) {
      const before = decodeGameplayHand(source);
      const actor = before.activeSeat;
      if (actor === null) throw new Error("Expected an active second bidder");
      const command: GameplayCommand =
        commandType === "BID"
          ? { actor, amount: bidAmount(250), type: "BID" }
          : { actor, type: "PASS_BID" };
      source = transition(source, command).snapshot;
    }
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected the final second bidder");

    const result = transition(source, { actor, type: "PASS_BID" });
    const state = result.snapshot.state as {
      bidding: {
        initialMakerSeat: number | null;
        secondRound: { actionsTaken: number };
      };
      phase: string;
      seats: Array<{ hand: Array<{ cardId: string }> }>;
      trump: {
        card: { cardId: string } | null;
        maker: number | null;
      };
    };

    expect(result.hand.phase).toBe(scenario.phase);
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe(scenario.phase.replaceAll("-", "_"));
    expect(state.bidding.initialMakerSeat).toBe(started.originalMaker);
    expect(state.bidding.secondRound.actionsTaken).toBe(4);
    if (scenario.newMaker) {
      expect(state.trump.card).toBeNull();
      expect(
        state.seats[started.originalMaker]?.hand.some(
          (card) => card.cardId === started.indicatorId,
        ),
      ).toBe(true);
    } else {
      expect(state.trump.card?.cardId).toBe(started.indicatorId);
      expect(state.trump.maker).toBe(started.originalMaker);
    }
  });
});
