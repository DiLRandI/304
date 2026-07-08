export const PROFILE_DEFAULTS = {
  minFourCardBid: 160,
  fourCardBidStep: 10,
  minEightCardBid: 250,
  eightCardBidStep: 10,
  allowClosedTrump: true,
  allowOpenTrump: true,
  revealTrumpAfterFirstTrickAtBidAtLeast: 250,
  enableCaps: false,
  enablePartnerCloseCaps: false,
  enableSpoiltTrump: false,
  tokenProfile: [
    { minBidInclusive: 160, maxBidExclusive: 200, successTokens: 1, failureTokens: 2 },
    { minBidInclusive: 200, maxBidExclusive: 250, successTokens: 2, failureTokens: 3 },
    { minBidInclusive: 250, successTokens: 3, failureTokens: 4 },
  ],
  dealerRotateOnStart: true,
  matchStartTokens: 11,
};

export const GAME_PROFILES = {
  classic_304_4p: {
    id: "classic_304_4p",
    name: "Classic 304 (4-seat)",
    deckRanks: ["7", "8", "9", "10", "J", "Q", "K", "A"],
    rankOrderHighToLow: ["J", "9", "A", "10", "K", "Q", "8", "7"],
    cardPoints: {
      J: 30,
      "9": 20,
      A: 11,
      "10": 10,
      K: 3,
      Q: 2,
      "8": 0,
      "7": 0,
    },
    seatCount: 4,
    playersPerTeam: 2,
    tableModes: ["auto", "classic_4", "six_6"],
    cardBatch: [4, 4],
    ...PROFILE_DEFAULTS,
  },
  six_304_36: {
    id: "six_304_36",
    name: "Six-seat 304 variant",
    deckRanks: ["7", "8", "9", "10", "J", "Q", "K", "A", "6"],
    rankOrderHighToLow: ["J", "9", "A", "10", "K", "Q", "8", "7", "6"],
    cardPoints: {
      J: 30,
      "9": 20,
      A: 11,
      "10": 10,
      K: 3,
      Q: 2,
      "8": 0,
      "7": 0,
      6: 0,
    },
    seatCount: 6,
    playersPerTeam: 3,
    tableModes: ["auto", "six_6"],
    cardBatch: [4, 2],
    ...PROFILE_DEFAULTS,
  },
};

export const BOT_NAMES = [
  "Bot Nimal",
  "Bot Kavindi",
  "Bot Sahan",
  "Bot Amaya",
  "Bot Ruwan",
  "Bot Thara",
  "Bot Nayana",
  "Bot Dilan",
];

export function chooseTableSeatCount(humanCount, tableMode, profileHint) {
  if (tableMode === "classic_4") {
    return 4;
  }
  if (tableMode === "six_6") {
    return 6;
  }
  if (tableMode === "auto") {
    return humanCount <= 4 ? 4 : 6;
  }
  if (profileHint === "six_304_36") {
    return humanCount <= 4 ? 4 : 6;
  }
  return humanCount <= 4 ? 4 : 6;
}

export function getProfile(profileId) {
  return GAME_PROFILES[profileId] || GAME_PROFILES.classic_304_4p;
}
