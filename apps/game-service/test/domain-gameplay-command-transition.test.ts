import type { GameAction } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import { buildDeck } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  transitionGameplayCommand,
  transitionHydratedGameplayCommand,
} from "../src/contexts/gameplay/adapters/integration/domain-gameplay-command-transition.js";
import {
  decodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";
import { hydrateGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";

function startedSnapshot(): LegacyGameplaySnapshotRecord {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  return {
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: engine.getSnapshot(),
  };
}

const unexpectedShuffle = {
  prepare: () => {
    throw new Error("Did not expect a new hand");
  },
};

describe("transitionGameplayCommand", () => {
  it("persists a hydrated aggregate transition as schema v2", () => {
    const before = decodeGameplayHand(startedSnapshot());
    if (before.activeSeat === null) throw new Error("Expected an active seat");

    const result = transitionHydratedGameplayCommand(
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
    const source = startedSnapshot();
    const before = decodeGameplayHand(source);
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }

    const result = transitionGameplayCommand(
      source,
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
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(decodeGameplayHand(source)).toEqual(before);
  });

  it("reports a rejected domain decision as an application conflict", () => {
    const source = startedSnapshot();
    const before = decodeGameplayHand(source);
    if (before.activeSeat === null) {
      throw new Error("Expected an active bidding seat");
    }
    const inactiveSeat = (before.activeSeat + 1) % before.profile.seatCount;

    expect(() =>
      transitionGameplayCommand(
        source,
        { type: "PASS_BID" },
        inactiveSeat,
        unexpectedShuffle,
      ),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });

  it("rejects a malformed wire value before applying the aggregate", () => {
    const source = startedSnapshot();

    expect(() =>
      transitionGameplayCommand(
        source,
        { cardId: "not-a-card", type: "SELECT_TRUMP" } as GameAction,
        0,
        unexpectedShuffle,
      ),
    ).toThrow(
      expect.objectContaining({ code: "ACTION_REJECTED", kind: "conflict" }),
    );
  });

  it("acknowledges a result with an explicitly prepared next hand", () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
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
    const source: LegacyGameplaySnapshotRecord = {
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    };
    const before = decodeGameplayHand(source);
    const nextDeck = buildDeck(before.profile).toReversed();

    const result = transitionGameplayCommand(
      source,
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
    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
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
