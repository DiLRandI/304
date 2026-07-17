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

describe("legacy gameplay opening transitions", () => {
  it.each([
    { amount: 160, type: "BID" },
    { type: "PASS_BID" },
  ] as const)("encodes one opening $type transition as schema v1", (action) => {
    const source = legacyStartedGameplaySnapshot();
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    const command: GameplayCommand =
      action.type === "BID"
        ? { actor, amount: bidAmount(action.amount), type: "BID" }
        : { actor, type: "PASS_BID" };

    const result = transition(source, command);
    const state = result.snapshot.state as {
      activeSeat: number | null;
      bidding: { actions: unknown[]; currentBid: number };
    };

    expect(result.snapshot.schemaVersion).toBe(1);
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.activeSeat).toBe(result.hand.activeSeat);
    expect(state.bidding.currentBid).toBe(result.hand.bidding.currentBid ?? 0);
    expect(state.bidding.actions).toHaveLength(1);
    expect(
      (source.state as { bidding: { actions: unknown[] } }).bidding.actions,
    ).toHaveLength(0);
  });

  it("decodes an in-progress opening bid without engine internals", () => {
    const source = legacyStartedGameplaySnapshot();
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");

    const result = transition(source, {
      actor,
      amount: bidAmount(160),
      type: "BID",
    });

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(result.hand.activeSeat).toBe((actor + 1) % 4);
    expect(result.hand.bidding).toMatchObject({
      actionsTaken: 1,
      currentBid: 160,
      currentBidder: actor,
      round: "four",
      status: "active",
    });
    expect(result.hand.bidding.actedInRound[actor]).toBe(true);
  });

  it("encodes the final opening pass into trump selection", () => {
    let source = legacyStartedGameplaySnapshot();
    for (const type of ["BID", "PASS_BID", "PASS_BID"] as const) {
      const before = decodeGameplayHand(source);
      const actor = before.activeSeat;
      if (actor === null) throw new Error("Expected an active bidding seat");
      const command: GameplayCommand =
        type === "BID"
          ? { actor, amount: bidAmount(160), type }
          : { actor, type };
      source = transition(source, command).snapshot;
    }
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected the final bidding seat");
    const result = transition(source, { actor, type: "PASS_BID" });
    const state = result.snapshot.state as {
      phase: string;
      trump: { maker: number | null };
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe("trump_selection");
    expect(state.trump.maker).toBe(result.hand.trump.maker);
    expect(result.hand.activeSeat).toBe(result.hand.trump.maker);
    expect(result.hand.bidding).toMatchObject({
      activeSeat: null,
      currentBid: 160,
      currentBidder: result.hand.trump.maker,
      status: "complete",
    });
    expect(
      legalGameplayCommands(result.hand, result.hand.activeSeat ?? actor),
    ).toHaveLength(4);
  });
});
