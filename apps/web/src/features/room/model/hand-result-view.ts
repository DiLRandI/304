import { isRecord, nonNegativeInteger } from "./projection-value";

export type ProjectedHandResult =
  | {
      handNumber: number;
      noScore: true;
      reason: string;
      tokens: [number, number];
    }
  | {
      bidderTeam: "A" | "B";
      bidderTeamPoints: number;
      bid: number;
      handNumber: number;
      matchComplete: boolean;
      movement: number;
      otherTeamPoints: number;
      settlementReason: "all-tricks-played" | "bid-reached" | "bid-unreachable";
      success: boolean;
      tokens: [number, number];
      trickCount: number;
      winningTeam: "A" | "B";
    };

function team(value: unknown): "A" | "B" | null {
  return value === "A" || value === "B" ? value : null;
}

function tokenPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const teamA = nonNegativeInteger(value[0]);
  const teamB = nonNegativeInteger(value[1]);
  if (teamA === null || teamB === null) return null;
  return [teamA, teamB];
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

export function readProjectedHandResult(
  value: unknown,
): ProjectedHandResult | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.noScore === true) {
    if (!hasExactKeys(value, ["handNumber", "noScore", "reason", "tokens"])) {
      return undefined;
    }
    const handNumber = nonNegativeInteger(value.handNumber);
    const tokens = tokenPair(value.tokens);
    if (
      handNumber === null ||
      tokens === null ||
      typeof value.reason !== "string" ||
      value.reason.trim().length === 0
    ) {
      return undefined;
    }
    return {
      handNumber,
      noScore: true,
      reason: value.reason,
      tokens,
    };
  }
  if (
    !hasExactKeys(value, [
      "bidderTeam",
      "bidderTeamPoints",
      "bid",
      "handNumber",
      "matchComplete",
      "movement",
      "otherTeamPoints",
      "settlementReason",
      "success",
      "tokens",
      "trickCount",
      "winningTeam",
    ])
  ) {
    return undefined;
  }
  const bidderTeam = team(value.bidderTeam);
  const winningTeam = team(value.winningTeam);
  const bid = nonNegativeInteger(value.bid);
  const bidderTeamPoints = nonNegativeInteger(value.bidderTeamPoints);
  const handNumber = nonNegativeInteger(value.handNumber);
  const movement = nonNegativeInteger(value.movement);
  const otherTeamPoints = nonNegativeInteger(value.otherTeamPoints);
  const settlementReason =
    value.settlementReason === "all-tricks-played" ||
    value.settlementReason === "bid-reached" ||
    value.settlementReason === "bid-unreachable"
      ? value.settlementReason
      : null;
  const tokens = tokenPair(value.tokens);
  const trickCount = nonNegativeInteger(value.trickCount);
  if (
    bidderTeam === null ||
    winningTeam === null ||
    bid === null ||
    bidderTeamPoints === null ||
    handNumber === null ||
    movement === null ||
    otherTeamPoints === null ||
    settlementReason === null ||
    tokens === null ||
    trickCount === null ||
    typeof value.matchComplete !== "boolean" ||
    typeof value.success !== "boolean"
  ) {
    return undefined;
  }
  return {
    bidderTeam,
    bidderTeamPoints,
    bid,
    handNumber,
    matchComplete: value.matchComplete,
    movement,
    otherTeamPoints,
    settlementReason,
    success: value.success,
    tokens,
    trickCount,
    winningTeam,
  };
}
