import { buildDeck, seatIndex } from "@three-zero-four/gameplay";
import {
  createLobby,
  inviteCode,
  playerId,
  roomId,
  startRoom,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import { hydrateGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { DomainStartedRoomSnapshotFactory } from "../src/contexts/rooms/adapters/integration/domain-started-room-snapshot-factory.js";

describe("DomainStartedRoomSnapshotFactory", () => {
  it("starts and serializes a schema-v2 domain Gameplay hand", () => {
    const host = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
    const lobby = createLobby({
      host: { displayName: "Asha", playerId: host },
      id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: {
        botDifficulty: "normal",
        enableSecondBidding: true,
        endHandWhenOutcomeCertain: true,
      },
    });
    const started = startRoom(lobby, host);
    if (!started.ok) throw new Error("Expected room start to succeed");
    const snapshot = new DomainStartedRoomSnapshotFactory(
      {
        select: (profile) =>
          seatIndex(profile.seatCount - 1, profile.seatCount),
      },
      {
        prepare: (profile) => ({
          audit: {
            algorithm: "hmac-sha256-v1",
            commitment: "commitment",
            seed: "seed",
          },
          deck: buildDeck(profile),
        }),
      },
    ).create(started.room);
    const hand = hydrateGameplaySnapshot({
      ruleProfileId: started.room.profileId,
      schemaVersion: snapshot.schemaVersion,
      state: snapshot.state,
    });

    expect(snapshot.schemaVersion).toBe(2);
    expect(hand).toMatchObject({
      activeSeat: 0,
      dealer: 3,
      handNumber: 1,
      phase: "four-bidding",
    });
    expect(hand.deal.hands).toHaveLength(4);
    expect(hand.deal.hands).toEqual(
      expect.arrayContaining([expect.any(Array)]),
    );
    expect(hand.deal.hands.every((cards) => cards.length === 4)).toBe(true);
  });
});
