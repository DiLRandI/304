import { isRecord } from "./projection-value";

export interface ProjectedCard {
  cardId: string;
  hidden: boolean;
  points: number | null;
  rank: string | null;
  suit: string | null;
}

export function readProjectedCard(value: unknown): ProjectedCard | null {
  if (!isRecord(value) || typeof value.cardId !== "string") return null;
  const hidden = value.hidden === true;
  if (hidden) {
    return {
      cardId: value.cardId,
      hidden: true,
      points: null,
      rank: null,
      suit: null,
    };
  }
  if (
    typeof value.rank !== "string" ||
    typeof value.suit !== "string" ||
    typeof value.points !== "number" ||
    !Number.isFinite(value.points)
  ) {
    return null;
  }
  return {
    cardId: value.cardId,
    hidden: false,
    points: value.points,
    rank: value.rank,
    suit: value.suit,
  };
}
