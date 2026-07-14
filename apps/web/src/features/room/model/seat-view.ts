import {
  isRecord,
  nonNegativeInteger,
  nullableString,
} from "./projection-value";

export interface ProjectedSeat {
  autopilot: boolean;
  connectionStatus: string;
  difficulty: string | null;
  displayName: string;
  handSize: number;
  index: number;
  isMe: boolean;
  seatLabel: string;
  team: "A" | "B";
  trickPoints: number;
  type: "bot" | "human" | "empty";
}

export function readProjectedSeat(value: unknown): ProjectedSeat | null {
  if (!isRecord(value)) return null;
  const index = nonNegativeInteger(value.index);
  const handSize = nonNegativeInteger(value.handSize);
  const trickPoints = nonNegativeInteger(value.trickPoints);
  if (
    index === null ||
    handSize === null ||
    trickPoints === null ||
    typeof value.seatLabel !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.connectionStatus !== "string" ||
    typeof value.autopilot !== "boolean" ||
    typeof value.isMe !== "boolean" ||
    (value.team !== "A" && value.team !== "B") ||
    (value.type !== "human" && value.type !== "bot" && value.type !== "empty")
  ) {
    return null;
  }
  const difficulty = nullableString(value.difficulty);
  if (difficulty === undefined) return null;
  return {
    autopilot: value.autopilot,
    connectionStatus: value.connectionStatus,
    difficulty,
    displayName: value.displayName,
    handSize,
    index,
    isMe: value.isMe,
    seatLabel: value.seatLabel,
    team: value.team,
    trickPoints,
    type: value.type,
  };
}
