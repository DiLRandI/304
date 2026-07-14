import {
  type GameAction,
  GameActionSchema,
  type RoomProjection,
} from "@three-zero-four/contracts";
import { type ProjectedCard, readProjectedCard } from "./card-view";
import {
  type ProjectedHandResult,
  readProjectedHandResult,
} from "./hand-result-view";
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

export interface ProjectedTrickPlay {
  card: ProjectedCard;
  faceDown: boolean;
  seatIndex: number;
}

export interface GameRoomView {
  kind: "game";
  isHost: boolean;
  legalActions: GameAction[];
  privateSeat: {
    hand: ProjectedCard[];
    index: number;
  };
  prompt: string;
  publicState: {
    activeSeat: number | null;
    bid: number;
    bidderSeatIndex: number | null;
    handNumber: number;
    handResult: ProjectedHandResult | null;
    phase: string;
    profileId: string;
    seatCount: 4 | 6;
    seats: ProjectedSeat[];
    tokens: [number, number];
    trick: ProjectedTrickPlay[];
    trickPointsPartial: boolean;
    trump: {
      indicatorVisible: boolean;
      isOpen: boolean;
      maker: number | null;
      suit: string | null;
    };
  };
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return integer(value) ?? undefined;
}

function readSeat(value: unknown): ProjectedSeat | null {
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

function readTrick(value: unknown): ProjectedTrickPlay[] | null {
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

function readGameRoomView(projection: RoomProjection): GameRoomView | null {
  if (!isRecord(projection.view)) return null;
  const view = projection.view;
  const publicState = view.publicState;
  const privateSeat = view.privateSeat;
  if (!isRecord(publicState) || !isRecord(privateSeat)) return null;
  if (!Array.isArray(publicState.seats) || !Array.isArray(privateSeat.hand)) {
    return null;
  }
  if (
    !Array.isArray(view.legalActions) ||
    typeof view.isHost !== "boolean" ||
    typeof view.prompt !== "string"
  ) {
    return null;
  }

  const seatCount = publicState.seatCount;
  const handNumber = nonNegativeInteger(publicState.handNumber);
  const activeSeat = nullableInteger(publicState.activeSeat);
  const privateSeatIndex = nonNegativeInteger(privateSeat.index);
  const bidding = publicState.bidding;
  const handResult = readProjectedHandResult(publicState.handResult);
  const trump = publicState.trump;
  const trick = readTrick(publicState.trick);
  const trickPointsPartial = publicState.trickPointsPartial === true;
  if (
    (seatCount !== 4 && seatCount !== 6) ||
    handNumber === null ||
    activeSeat === undefined ||
    handResult === undefined ||
    privateSeatIndex === null ||
    !isRecord(bidding) ||
    typeof bidding.currentBid !== "number" ||
    !Number.isFinite(bidding.currentBid) ||
    !isRecord(trump) ||
    trick === null ||
    typeof publicState.profileId !== "string" ||
    typeof publicState.phase !== "string" ||
    !Array.isArray(publicState.tokens) ||
    publicState.tokens.length !== 2
  ) {
    return null;
  }
  const bidderSeatIndex = nullableInteger(bidding.currentBidSeat);
  const maker = nullableInteger(trump.maker);
  const suit = nullableString(trump.suit);
  const tokens = publicState.tokens.map((value) => nonNegativeInteger(value));
  const [teamATokens, teamBTokens] = tokens;
  if (
    bidderSeatIndex === undefined ||
    maker === undefined ||
    suit === undefined ||
    typeof trump.isOpen !== "boolean" ||
    typeof trump.indicatorVisible !== "boolean" ||
    teamATokens == null ||
    teamBTokens == null
  ) {
    return null;
  }

  const seats: ProjectedSeat[] = [];
  for (const item of publicState.seats) {
    const seat = readSeat(item);
    if (seat === null) return null;
    seats.push(seat);
  }
  if (seats.length !== seatCount) return null;

  const hand: ProjectedCard[] = [];
  for (const item of privateSeat.hand) {
    const card = readProjectedCard(item);
    if (card === null) return null;
    hand.push(card);
  }

  const legalActions: GameAction[] = [];
  for (const item of view.legalActions) {
    const parsed = GameActionSchema.safeParse(item);
    if (!parsed.success) return null;
    legalActions.push(parsed.data);
  }

  return {
    kind: "game",
    isHost: view.isHost,
    legalActions,
    privateSeat: { hand, index: privateSeatIndex },
    prompt: view.prompt,
    publicState: {
      activeSeat,
      bid: bidding.currentBid,
      bidderSeatIndex,
      handNumber,
      handResult,
      phase: publicState.phase,
      profileId: publicState.profileId,
      seatCount,
      seats,
      tokens: [teamATokens, teamBTokens],
      trick,
      trickPointsPartial,
      trump: {
        indicatorVisible: trump.indicatorVisible,
        isOpen: trump.isOpen,
        maker,
        suit,
      },
    },
  };
}

export function readActiveRoomView(
  projection: RoomProjection,
): GameRoomView | null {
  if (projection.status === "lobby") return null;
  return readGameRoomView(projection);
}
