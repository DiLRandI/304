import { buildDeck, nextDealer } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { replayDomainGameplayEvent } from "../src/contexts/gameplay/adapters/integration/domain-gameplay-event-replayer.js";
import {
  cancelledGameplayHand,
  startedGameplayHand,
} from "./support/gameplay-hand-fixture.js";

describe("replayDomainGameplayEvent", () => {
  it("replays a human wire action through the Gameplay aggregate", () => {
    const hand = startedGameplayHand();
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
    const hand = cancelledGameplayHand();
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
    expect(() =>
      replayDomainGameplayEvent(
        "room-1",
        cancelledGameplayHand(),
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
