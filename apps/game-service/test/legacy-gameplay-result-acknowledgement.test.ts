import {
  acknowledgeGameplayResult,
  buildDeck,
  type GameplayCommand,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
  encodeGameplayHand,
} from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";
import { legacyAllPassGameplaySnapshot } from "./support/legacy-gameplay-snapshot-fixture.js";

describe("legacy gameplay result acknowledgement", () => {
  it("encodes a new audited hand", () => {
    const source = legacyAllPassGameplaySnapshot();
    const before = decodeGameplayHand(source);
    const nextDeck = buildDeck(before.profile).toReversed();
    const acknowledged = acknowledgeGameplayResult(before, nextDeck);
    if (!acknowledged.ok) throw new Error(acknowledged.error.message);
    const command: GameplayCommand = { actor: null, type: "ACK_RESULT" };

    const encoded = encodeGameplayHand(acknowledged.hand, {
      command,
      nextHand: {
        audit: {
          algorithm: "hmac-sha256-v1",
          commitment: "c_next-hand",
          seed: "s_next-hand",
        },
        deck: nextDeck,
      },
      source,
    });

    expect(decodeGameplayHand(encoded)).toEqual(acknowledged.hand);
    expect(encoded.state).toMatchObject({
      bidding: {
        actions: [],
        currentBid: 0,
        currentBidSeat: null,
        initialMakerSeat: null,
        secondRound: {
          actionsTaken: 0,
          anyBid: false,
          order: [],
          previousBid: 0,
          previousBidSeat: null,
        },
      },
      handNumber: 2,
      handResult: null,
      handShuffle: {
        deckVersion: "hmac-sha256-v1",
        seed: "s_next-hand",
        seedCommit: "c_next-hand",
      },
      phase: "four_bidding",
    });
  });
});
