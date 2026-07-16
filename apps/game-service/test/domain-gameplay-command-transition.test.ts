import type { GameAction } from "@three-zero-four/contracts";
import { buildDeck } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { transitionGameplayCommand } from "../src/contexts/gameplay/adapters/integration/domain-gameplay-command-transition.js";
import { hydrateGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import {
  cancelledGameplayHand,
  startedGameplayHand,
} from "./support/gameplay-hand-fixture.js";

const unexpectedShuffle = {
  prepare: () => {
    throw new Error("Did not expect a new hand");
  },
};

describe("transitionGameplayCommand", () => {
  it("persists an aggregate transition as schema v2", () => {
    const before = startedGameplayHand();
    if (before.activeSeat === null) throw new Error("Expected an active seat");

    const result = transitionGameplayCommand(
      before,
      { type: "PASS_BID" },
      before.activeSeat,
      unexpectedShuffle,
    );

    expect(result.snapshot.schemaVersion).toBe(2);
    expect(hydrateGameplaySnapshot(result.snapshot)).toEqual(result.hand);
    expect(before.bidding.actionsTaken).toBe(0);
  });

  it("applies a wire action through the Gameplay aggregate", () => {
    const before = startedGameplayHand();
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }

    const result = transitionGameplayCommand(
      before,
      { amount: 160, type: "BID" },
      before.activeSeat,
      unexpectedShuffle,
    );

    expect(result.command).toEqual({
      actor: before.activeSeat,
      amount: 160,
      type: "BID",
    });
    expect(result.hand.bidding.currentBid).toBe(160);
    expect(hydrateGameplaySnapshot(result.snapshot)).toEqual(result.hand);
    expect(before.bidding.currentBid).toBeNull();
  });

  it("reports a rejected domain decision as an application conflict", () => {
    const before = startedGameplayHand();
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }
    const inactiveSeat = (before.activeSeat + 1) % before.profile.seatCount;

    expect(() =>
      transitionGameplayCommand(
        before,
        { type: "PASS_BID" },
        inactiveSeat,
        unexpectedShuffle,
      ),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });

  it("rejects a malformed wire value before applying the aggregate", () => {
    expect(() =>
      transitionGameplayCommand(
        startedGameplayHand(),
        { cardId: "not-a-card", type: "SELECT_TRUMP" } as GameAction,
        0,
        unexpectedShuffle,
      ),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });

  it("acknowledges a result with an explicitly prepared next hand", () => {
    const before = cancelledGameplayHand();
    const nextDeck = buildDeck(before.profile).toReversed();

    const result = transitionGameplayCommand(
      before,
      { type: "ACK_RESULT" },
      0,
      {
        prepare: (profile, handNumber) => {
          expect(profile).toBe(before.profile);
          expect(handNumber).toBe(2);
          return {
            audit: {
              algorithm: "hmac-sha256-v1",
              commitment: "c_next-hand",
              seed: "s_next-hand",
            },
            deck: nextDeck,
          };
        },
      },
    );

    expect(result.command).toEqual({ actor: 0, type: "ACK_RESULT" });
    expect(result.hand).toMatchObject({ handNumber: 2, phase: "four-bidding" });
    expect(hydrateGameplaySnapshot(result.snapshot)).toEqual(result.hand);
    expect(result.nextHand).toEqual({
      audit: {
        algorithm: "hmac-sha256-v1",
        commitment: "c_next-hand",
        seed: "s_next-hand",
      },
      deck: nextDeck,
    });
  });
});
