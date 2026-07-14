import {
  type GameAction,
  GameActionSchema,
  type RoomProjection,
} from "@three-zero-four/contracts";

export interface ProjectedCard {
  cardId: string;
  hidden: boolean;
  points: number | null;
  rank: string | null;
  suit: string | null;
}

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
      success: boolean;
      tokens: [number, number];
      trickCount: number;
      winningTeam: "A" | "B";
    };

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

export interface LobbyRoomView {
  kind: "lobby";
  isHost: boolean;
  lobby: {
    ruleProfileId: string;
    seats: Array<{
      botDifficulty: string | null;
      displayName: string | null;
      occupantType: "bot" | "empty" | "human";
      seatIndex: number;
    }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return integer(value) ?? undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

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

function readHandResult(
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
    success: value.success,
    tokens,
    trickCount,
    winningTeam,
  };
}

function readCard(value: unknown): ProjectedCard | null {
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
    const card = readCard(item.card);
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
  const handResult = readHandResult(publicState.handResult);
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
    const card = readCard(item);
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

export function readLobbyRoomView(
  projection: RoomProjection,
): LobbyRoomView | null {
  if (projection.status !== "lobby" || !isRecord(projection.view)) return null;
  const lobby = projection.view.lobby;
  if (
    !isRecord(lobby) ||
    typeof lobby.ruleProfileId !== "string" ||
    typeof projection.view.isHost !== "boolean"
  ) {
    return null;
  }
  if (!Array.isArray(lobby.seats)) return null;
  const seats: LobbyRoomView["lobby"]["seats"] = [];
  for (const item of lobby.seats) {
    if (!isRecord(item)) return null;
    const seatIndex = nonNegativeInteger(item.seatIndex);
    const displayName = nullableString(item.displayName);
    const botDifficulty = nullableString(item.botDifficulty);
    if (
      seatIndex === null ||
      displayName === undefined ||
      botDifficulty === undefined ||
      (item.occupantType !== "human" &&
        item.occupantType !== "bot" &&
        item.occupantType !== "empty")
    ) {
      return null;
    }
    seats.push({
      botDifficulty,
      displayName,
      occupantType: item.occupantType,
      seatIndex,
    });
  }
  return {
    kind: "lobby",
    isHost: projection.view.isHost,
    lobby: { ruleProfileId: lobby.ruleProfileId, seats },
  };
}

export function readActiveRoomView(
  projection: RoomProjection,
): GameRoomView | null {
  if (projection.status === "lobby") return null;
  return readGameRoomView(projection);
}
