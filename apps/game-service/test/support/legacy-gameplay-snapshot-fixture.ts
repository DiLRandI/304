import type { LegacyGameplaySnapshotRecord } from "../../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";

const openingHands = [
  [
    { cardId: "D_K", points: 3, rank: "K", suit: "diamonds" },
    { cardId: "H_Q", points: 2, rank: "Q", suit: "hearts" },
    { cardId: "C_K", points: 3, rank: "K", suit: "clubs" },
    { cardId: "S_10", points: 10, rank: "10", suit: "spades" },
  ],
  [
    { cardId: "S_Q", points: 2, rank: "Q", suit: "spades" },
    { cardId: "D_Q", points: 2, rank: "Q", suit: "diamonds" },
    { cardId: "S_8", points: 0, rank: "8", suit: "spades" },
    { cardId: "H_8", points: 0, rank: "8", suit: "hearts" },
  ],
  [
    { cardId: "D_8", points: 0, rank: "8", suit: "diamonds" },
    { cardId: "S_9", points: 20, rank: "9", suit: "spades" },
    { cardId: "S_K", points: 3, rank: "K", suit: "spades" },
    { cardId: "H_K", points: 3, rank: "K", suit: "hearts" },
  ],
  [
    { cardId: "S_7", points: 0, rank: "7", suit: "spades" },
    { cardId: "H_9", points: 20, rank: "9", suit: "hearts" },
    { cardId: "C_7", points: 0, rank: "7", suit: "clubs" },
    { cardId: "D_A", points: 11, rank: "A", suit: "diamonds" },
  ],
] as const;

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
    seats: openingHands.map((hand, index) => ({
      firstHand: hand,
      hand,
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

export function legacyAllPassGameplaySnapshot(): LegacyGameplaySnapshotRecord {
  const record = structuredClone(startedClassicSnapshot);
  const state = record.state as {
    activeSeat: number | null;
    bidding: {
      actedInRound: boolean[];
      actions: Array<{ seatIndex: number; type: "pass" }>;
      activeOrderIndex: number;
      noBidPasses: number;
    };
    handResult: unknown;
    phase: string;
  };
  state.activeSeat = null;
  state.bidding.actedInRound = [true, true, true, true];
  state.bidding.actions = [1, 2, 3, 0].map((seatIndex) => ({
    seatIndex,
    type: "pass",
  }));
  state.bidding.activeOrderIndex = 3;
  state.bidding.noBidPasses = 4;
  state.handResult = {
    noScore: true,
    reason: "All players passed. No score movement this hand.",
    tokens: [11, 11],
  };
  state.phase = "hand_result";
  return record;
}

export function legacyLobbyGameplaySnapshot(): LegacyGameplaySnapshotRecord {
  return {
    ruleProfileId: "classic_304_4p",
    schemaVersion: 1,
    state: { phase: "setup" },
  };
}
