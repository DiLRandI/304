import { GameEngine } from "@three-zero-four/game-engine";
import { buildDeck, nextDealer } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { replayDomainGameplayEvent } from "../src/contexts/gameplay/adapters/integration/domain-gameplay-event-replayer.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

function engineAtStart(): GameEngine {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  return engine;
}

function handFrom(engine: GameEngine) {
  return decodeGameplayHand({
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: engine.getSnapshot(),
  });
}

describe("replayDomainGameplayEvent", () => {
  it("replays a human wire action through the Gameplay aggregate", () => {
    const hand = handFrom(engineAtStart());
    if (hand.activeSeat === null) throw new Error("Expected an active seat");

    const replayed = replayDomainGameplayEvent(
      "room-1",
      hand,
      {
        actorPlayerId: "player-1",
        eventType: "GAME_ACTION",
        payload: { action: { type: "PASS_BID" }, seatIndex: hand.activeSeat },
      },
      null,
    );

    expect(replayed.bidding.actionsTaken).toBe(hand.bidding.actionsTaken + 1);
    expect(hand.bidding.actionsTaken).toBe(0);
  });

  it("replays result acknowledgement with the persisted next-hand deck", () => {
    const engine = engineAtStart();
    while (engine.getSnapshot().phase === "four_bidding") {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active seat");
      expect(
        engine.applyAction({
          actorSeatIndex: actor,
          seatIndex: actor,
          type: "PASS_BID",
        }),
      ).toEqual({ ok: true });
    }
    const hand = handFrom(engine);
    const deck = buildDeck(hand.profile).toReversed();

    const replayed = replayDomainGameplayEvent(
      "room-1",
      hand,
      {
        actorPlayerId: "player-1",
        eventType: "GAME_ACTION",
        payload: {
          action: { type: "ACK_RESULT" },
          nextHand: {
            audit: {
              algorithm: "hmac-sha256-v1",
              commitment: "commitment",
              seed: "seed",
            },
            deck,
          },
        },
      },
      0,
    );

    expect(replayed).toMatchObject({
      dealer: nextDealer(hand.dealer, hand.profile.seatCount),
      handNumber: 2,
      phase: "four-bidding",
    });
    expect(replayed.deal.deck).toEqual(deck.slice(0, 16));
    expect(replayed.deal.firstHands.flat()).toEqual(
      expect.arrayContaining(deck.slice(16)),
    );
  });

  it("rejects an acknowledgement without deterministic replay material", () => {
    const engine = engineAtStart();
    while (engine.getSnapshot().phase === "four_bidding") {
      const actor = engine.getSnapshot().activeSeat;
      if (actor === null) throw new Error("Expected an active seat");
      expect(
        engine.applyAction({
          actorSeatIndex: actor,
          seatIndex: actor,
          type: "PASS_BID",
        }),
      ).toEqual({ ok: true });
    }

    expect(() =>
      replayDomainGameplayEvent(
        "room-1",
        handFrom(engine),
        {
          actorPlayerId: "player-1",
          eventType: "GAME_ACTION",
          payload: { action: { type: "ACK_RESULT" } },
        },
        0,
      ),
    ).toThrow(expect.objectContaining({ roomId: "room-1" }));
  });
});
