import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
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
