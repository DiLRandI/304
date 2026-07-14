import { type ProjectedCard, readProjectedCard } from "./card-view";
import { isRecord, nonNegativeInteger } from "./projection-value";

export interface ProjectedTrickPlay {
  card: ProjectedCard;
  faceDown: boolean;
  seatIndex: number;
}

export function readProjectedTrick(
  value: unknown,
): ProjectedTrickPlay[] | null {
  if (value === null) return [];
  if (!isRecord(value) || !Array.isArray(value.plays)) return null;
  const plays: ProjectedTrickPlay[] = [];
  for (const item of value.plays) {
    if (!isRecord(item)) return null;
    const seatIndex = nonNegativeInteger(item.seatIndex);
    const card = readProjectedCard(item.card);
    if (
      seatIndex === null ||
      card === null ||
      typeof item.faceDown !== "boolean"
    ) {
      return null;
    }
    plays.push({ card, faceDown: item.faceDown, seatIndex });
  }
  return plays;
}
