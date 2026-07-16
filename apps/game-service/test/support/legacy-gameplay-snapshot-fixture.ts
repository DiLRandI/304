import type { LegacyGameplaySnapshotRecord } from "../../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

const startedClassicSnapshot: LegacyGameplaySnapshotRecord = {
  ruleProfileId: "classic_304_4p",
  schemaVersion: 1,
  state: {
    activeSeat: 1,
    bidding: {
      actedInRound: [],
      actions: [],
      activeOrderIndex: 0,
      currentBid: 0,
      currentBidSeat: null,
      initialMakerSeat: null,
      noBidPasses: 0,
      order: [1, 2, 3, 0],
      passesAfterBid: 0,
      phase: "four",
      secondRound: {
        actionsTaken: 0,
        activeOrderIndex: 0,
        enabled: true,
        order: [],
        previousBid: 0,
        previousBidSeat: null,
      },
    },
    completedTricks: [],
    currentTrick: null,
    dealerSeat: 0,
    deck: [],
    handNumber: 1,
    handResult: null,
    phase: "four_bidding",
    profile: { id: "classic_304_4p" },
    profileId: "classic_304_4p",
    seatCount: 4,
    seats: Array.from({ length: 4 }, (_, index) => ({
      firstHand: [],
      hand: [],
      index,
      wonCards: [],
    })),
    tokens: [11, 11],
    trump: { card: null, isOpen: false, maker: null, suit: null },
    trumpClosed: true,
  },
};

export function legacyStartedGameplaySnapshot(): LegacyGameplaySnapshotRecord {
  return structuredClone(startedClassicSnapshot);
}

export function legacyLobbyGameplaySnapshot(): LegacyGameplaySnapshotRecord {
  return {
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: { phase: "setup" },
  };
}
