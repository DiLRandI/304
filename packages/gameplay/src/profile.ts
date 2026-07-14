import type { RuleProfileId } from "./values.js";

export type Rank = "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface TokenRule {
  readonly failureTokens: number;
  readonly maxBidExclusive?: number;
  readonly minBidInclusive: number;
  readonly successTokens: number;
}

export interface RuleProfile {
  readonly allowClosedTrump: boolean;
  readonly allowOpenTrump: boolean;
  readonly cardBatch: readonly [number, number];
  readonly cardPoints: Readonly<Partial<Record<Rank, number>>>;
  readonly deckRanks: readonly Rank[];
  readonly eightCardBidStep: number;
  readonly fourCardBidStep: number;
  readonly id: RuleProfileId;
  readonly matchStartTokens: number;
  readonly maxBid: number;
  readonly minEightCardBid: number;
  readonly minFourCardBid: number;
  readonly name: string;
  readonly playersPerTeam: number;
  readonly rankOrderHighToLow: readonly Rank[];
  readonly revealTrumpAfterFirstTrickAtBidAtLeast: number;
  readonly seatCount: 4 | 6;
  readonly tokenProfile: readonly TokenRule[];
}

const sharedRules = {
  allowClosedTrump: true,
  allowOpenTrump: true,
  eightCardBidStep: 10,
  fourCardBidStep: 10,
  matchStartTokens: 11,
  maxBid: 304,
  minEightCardBid: 250,
  minFourCardBid: 160,
  revealTrumpAfterFirstTrickAtBidAtLeast: 250,
  tokenProfile: [
    {
      failureTokens: 2,
      maxBidExclusive: 200,
      minBidInclusive: 160,
      successTokens: 1,
    },
    {
      failureTokens: 3,
      maxBidExclusive: 250,
      minBidInclusive: 200,
      successTokens: 2,
    },
    { failureTokens: 4, minBidInclusive: 250, successTokens: 3 },
  ],
} as const;

export const RULE_PROFILES: Readonly<Record<RuleProfileId, RuleProfile>> = {
  classic_304_4p: {
    ...sharedRules,
    cardBatch: [4, 4],
    cardPoints: { "10": 10, "7": 0, "8": 0, "9": 20, A: 11, J: 30, K: 3, Q: 2 },
    deckRanks: ["7", "8", "9", "10", "J", "Q", "K", "A"],
    id: "classic_304_4p",
    name: "Classic 304 (4-seat)",
    playersPerTeam: 2,
    rankOrderHighToLow: ["J", "9", "A", "10", "K", "Q", "8", "7"],
    seatCount: 4,
  },
  six_304_36: {
    ...sharedRules,
    cardBatch: [4, 2],
    cardPoints: {
      "10": 10,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 20,
      A: 11,
      J: 30,
      K: 3,
      Q: 2,
    },
    deckRanks: ["7", "8", "9", "10", "J", "Q", "K", "A", "6"],
    id: "six_304_36",
    name: "Six-seat 304 variant",
    playersPerTeam: 3,
    rankOrderHighToLow: ["J", "9", "A", "10", "K", "Q", "8", "7", "6"],
    seatCount: 6,
  },
};

export function getRuleProfile(profileId: RuleProfileId): RuleProfile {
  return RULE_PROFILES[profileId];
}
