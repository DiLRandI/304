import type { RuleProfile, TokenRule } from "./profile.js";
import type { BidAmount, SeatIndex, Team } from "./values.js";

export type TokenBalance = readonly [number, number];

export interface ScoreHandInput {
  readonly bid: BidAmount;
  readonly bidderTeam: Team;
  readonly teamPoints: Readonly<Record<Team, number>>;
  readonly tokens: TokenBalance;
}

export interface HandScore {
  readonly bid: BidAmount;
  readonly bidderTeam: Team;
  readonly bidderTeamPoints: number;
  readonly matchComplete: boolean;
  readonly movement: number;
  readonly otherTeamPoints: number;
  readonly success: boolean;
  readonly tokens: TokenBalance;
  readonly winningTeam: Team;
}

export interface CancelledHand {
  readonly noScore: true;
  readonly reason: "All players passed. No score movement this hand.";
  readonly tokens: TokenBalance;
}

export function teamForSeat(seat: SeatIndex): Team {
  return seat % 2 === 0 ? "A" : "B";
}

export function initialTokens(profile: RuleProfile): TokenBalance {
  return [profile.matchStartTokens, profile.matchStartTokens];
}

function scoringTier(profile: RuleProfile, bid: BidAmount): TokenRule {
  const tier = profile.tokenProfile.find(
    (candidate) =>
      candidate.maxBidExclusive === undefined ||
      bid < candidate.maxBidExclusive,
  );
  if (!tier) throw new Error("Rule profile does not define a scoring tier");
  return tier;
}

function opposingTeam(team: Team): Team {
  return team === "A" ? "B" : "A";
}

export function scoreHand(
  profile: RuleProfile,
  input: ScoreHandInput,
): HandScore {
  const otherTeam = opposingTeam(input.bidderTeam);
  const bidderTeamPoints = input.teamPoints[input.bidderTeam];
  const success = bidderTeamPoints >= input.bid;
  const tier = scoringTier(profile, input.bid);
  const movement = success ? tier.successTokens : tier.failureTokens;
  const bidderIndex = input.bidderTeam === "A" ? 0 : 1;
  const otherIndex = bidderIndex === 0 ? 1 : 0;
  const tokens: [number, number] = [...input.tokens];
  tokens[bidderIndex] = Math.max(
    0,
    tokens[bidderIndex] + (success ? movement : -movement),
  );
  tokens[otherIndex] = Math.max(
    0,
    tokens[otherIndex] + (success ? -movement : movement),
  );

  return {
    bid: input.bid,
    bidderTeam: input.bidderTeam,
    bidderTeamPoints,
    matchComplete: tokens.includes(0),
    movement,
    otherTeamPoints: input.teamPoints[otherTeam],
    success,
    tokens,
    winningTeam: success ? input.bidderTeam : otherTeam,
  };
}

export function cancelHand(tokens: TokenBalance): CancelledHand {
  return {
    noScore: true,
    reason: "All players passed. No score movement this hand.",
    tokens: [...tokens],
  };
}
