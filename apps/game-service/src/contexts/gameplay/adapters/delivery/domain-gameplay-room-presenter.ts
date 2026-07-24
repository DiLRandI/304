import type { RoomProjection } from "@three-zero-four/contracts";
import {
  type GameplayHand,
  gameplayPrompt,
  legalGameplayCommands,
  type ProjectedCard,
  type ProjectedTrick,
  projectGameplayHand,
  seatIndex,
} from "@three-zero-four/gameplay";
import { GameplayApplicationError } from "../../application/gameplay-application-error.js";
import { presentGameAction } from "./game-action-presenter.js";

type ProjectableStatus = "lobby" | "in_hand" | "hand_result";

export interface GameplayRoomRecord {
  readonly eventVersion: number;
  readonly hostPlayerId: string;
  readonly id: string;
  readonly inviteCode: string;
  readonly status: ProjectableStatus | "closed" | "recovery_failed";
}

export interface DomainGameplayProjectionSeat {
  readonly botDifficulty: string | null;
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly disconnectedAt?: Date | null;
  readonly displayName: string | null;
  readonly occupantType: "bot" | "empty" | "human";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

function projectableStatus(
  status: GameplayRoomRecord["status"],
): ProjectableStatus {
  if (status === "lobby" || status === "in_hand" || status === "hand_result") {
    return status;
  }
  throw new GameplayApplicationError("ROOM_UNAVAILABLE", "Room is unavailable");
}

function wirePhase(hand: GameplayHand): string {
  return hand.phase.replaceAll("-", "_");
}

function visibleCard(card: Exclude<ProjectedCard, { hidden: true }>) {
  return {
    cardId: card.id,
    points: card.points,
    rank: card.rank,
    suit: card.suit,
  };
}

function projectedCard(card: ProjectedCard) {
  return card.hidden
    ? { cardId: "Card Back", hidden: true as const }
    : visibleCard(card);
}

function privateCard(card: GameplayHand["deal"]["deck"][number]) {
  return {
    cardId: card.id,
    points: card.points,
    rank: card.rank,
    suit: card.suit,
  };
}

function projectedTrick(trick: ProjectedTrick | null, trickIndex: number) {
  if (!trick) return null;
  return {
    leadSuit:
      trick.plays[0]?.card.hidden === false ? trick.plays[0].card.suit : null,
    leaderSeat: trick.leaderSeat,
    openedTrumpThisTrick: trick.openedTrump,
    plays: trick.plays.map((play) => ({
      card: projectedCard(play.card),
      cardId: play.card.hidden ? "Card Back" : play.card.id,
      faceDown: play.faceDown,
      fromIndicator: play.fromIndicator,
      seatIndex: play.actor,
      source: play.fromIndicator ? "indicator" : "hand",
    })),
    points: trick.points,
    pointValue: trick.status === "complete" ? trick.points : null,
    trumpRevealReason: trick.trumpRevealReason,
    trickIndex,
    winnerSeat: trick.winnerSeat,
  };
}

function publicTrickPoints(hand: GameplayHand): readonly number[] {
  const totals = Array.from({ length: hand.profile.seatCount }, () => 0);
  for (const trick of hand.completedTricks) {
    const pointsArePublic = trick.plays.every(
      (play) =>
        !play.faceDown ||
        (hand.trump.open && play.card.suit === hand.trump.suit),
    );
    if (pointsArePublic && trick.winnerSeat !== null) {
      totals[trick.winnerSeat] = (totals[trick.winnerSeat] ?? 0) + trick.points;
    }
  }
  return totals;
}

function publicHandResult(hand: GameplayHand) {
  if (!hand.result) return null;
  if ("noScore" in hand.result) {
    return {
      handNumber: hand.handNumber,
      noScore: true as const,
      reason: hand.result.reason,
      tokens: [...hand.result.tokens],
    };
  }
  return {
    bid: hand.result.bid,
    bidderTeam: hand.result.bidderTeam,
    bidderTeamPoints: hand.result.bidderTeamPoints,
    handNumber: hand.handNumber,
    matchComplete: hand.result.matchComplete,
    movement: hand.result.movement,
    otherTeamPoints: hand.result.otherTeamPoints,
    settlementReason: hand.result.settlementReason,
    success: hand.result.success,
    tokens: [...hand.result.tokens],
    trickCount: hand.completedTricks.length,
    winningTeam: hand.result.winningTeam,
  };
}

function gameMessage(hand: GameplayHand): string {
  if (hand.phase === "four-bidding") {
    return "Bidding: minimum 160. Pass or bid higher.";
  }
  return gameplayPrompt(hand, null);
}

function wireProfile(hand: GameplayHand) {
  return {
    ...hand.profile,
    dealerRotateOnStart: true,
    enableCaps: false,
    enablePartnerCloseCaps: false,
    enableSpoiltTrump: false,
    tableModes:
      hand.profile.seatCount === 4
        ? ["auto", "classic_4", "six_6"]
        : ["auto", "six_6"],
  };
}

export function projectDomainRoomForPlayer(
  room: GameplayRoomRecord,
  hand: GameplayHand,
  seats: readonly DomainGameplayProjectionSeat[],
  viewerSeatIndex: number,
): RoomProjection {
  const viewer = seatIndex(viewerSeatIndex, hand.profile.seatCount);
  const viewerSeat = seats.find((seat) => seat.seatIndex === viewer);
  if (!viewerSeat) {
    throw new GameplayApplicationError(
      "SEAT_REQUIRED",
      "You are not seated in this room",
    );
  }
  const projection = projectGameplayHand(hand, viewer);
  const trickPoints = publicTrickPoints(hand);
  const isHost = viewerSeat.playerId === room.hostPlayerId;
  const currentTrick = projectedTrick(
    projection.currentTrick,
    Math.max(
      0,
      hand.completedTricks.length - (hand.phase === "trick-result" ? 1 : 0),
    ),
  );
  const completedTricks = projection.completedTricks.map((trick, index) =>
    projectedTrick(trick, index),
  );
  const legalActions = legalGameplayCommands(hand, viewer)
    .filter((action) => action.type !== "ACK_RESULT" || isHost)
    .map((action) => presentGameAction({ ...action }));
  const privateHand = hand.deal.hands[viewer] ?? [];
  const firstHand = hand.deal.firstHands[viewer] ?? [];
  const capturedCards = hand.capturedCards[viewer] ?? [];

  return {
    eventVersion: room.eventVersion,
    inviteCode: room.inviteCode,
    roomId: room.id,
    status: projectableStatus(room.status),
    viewerSeatIndex: viewer,
    view: {
      isHost,
      legalActions,
      privateSeat: {
        autopilot: viewerSeat.connectionStatus === "autopilot",
        connectionStatus: viewerSeat.connectionStatus ?? "disconnected",
        difficulty: viewerSeat.botDifficulty,
        disconnectedAt: viewerSeat.disconnectedAt?.toISOString() ?? null,
        displayName: viewerSeat.displayName ?? "",
        firstHand: firstHand.map(privateCard),
        hand: privateHand.map(privateCard),
        index: viewer,
        reconnectSummary: [],
        seatLabel: `Seat ${viewer + 1}`,
        team: projection.seats[viewer]?.team ?? "A",
        trickPoints: trickPoints[viewer] ?? 0,
        type: viewerSeat.occupantType,
        wonCards: capturedCards.map(privateCard),
      },
      prompt: gameplayPrompt(hand, viewer),
      publicState: {
        activeSeat: hand.activeSeat,
        bidHistory: [],
        bidding: {
          actedInRound:
            hand.bidding.actionsTaken === 0
              ? []
              : [...hand.bidding.actedInRound],
          actions: [],
          activeOrderIndex: hand.bidding.activeOrderIndex,
          currentBid: hand.bidding.currentBid ?? 0,
          currentBidSeat: hand.bidding.currentBidder,
          initialMakerSeat: hand.trump.maker,
          noBidPasses: hand.bidding.noBidPasses,
          order: [...hand.bidding.order],
          passesAfterBid: hand.bidding.passesAfterBid,
          phase: hand.bidding.round,
          secondRound: {
            actionsTaken:
              hand.bidding.round === "second" ? hand.bidding.actionsTaken : 0,
            activeOrderIndex:
              hand.bidding.round === "second"
                ? hand.bidding.activeOrderIndex
                : 0,
            anyBid:
              hand.bidding.round === "second" &&
              hand.bidding.currentBid !== hand.bidding.previousBid,
            enabled: hand.bidding.secondBiddingEnabled,
            order:
              hand.bidding.round === "second" ? [...hand.bidding.order] : [],
            previousBid: hand.bidding.previousBid ?? 0,
            previousBidSeat:
              hand.bidding.round === "second"
                ? hand.bidding.currentBidder
                : null,
          },
        },
        completedTricks,
        dealerSeat: hand.dealer,
        gameMessage: gameMessage(hand),
        handNumber: hand.handNumber,
        handResult: publicHandResult(hand),
        inviteCode: room.inviteCode,
        latestTrick: completedTricks.at(-1) ?? null,
        phase: wirePhase(hand),
        profile: wireProfile(hand),
        profileId: hand.profile.id,
        seatCount: hand.profile.seatCount,
        seats: projection.seats.map((seat) => {
          const stored = seats.find(
            (candidate) => candidate.seatIndex === seat.index,
          );
          return {
            autopilot: stored?.connectionStatus === "autopilot",
            connectionStatus: stored?.connectionStatus ?? "disconnected",
            difficulty:
              stored?.occupantType === "bot"
                ? (stored.botDifficulty ?? "easy")
                : null,
            disconnectedAt: stored?.disconnectedAt?.toISOString() ?? null,
            displayName: stored?.displayName ?? "",
            handSize: seat.handSize,
            index: seat.index,
            isMe: seat.isViewer,
            reconnectSummary: [],
            seatLabel: `Seat ${seat.index + 1}`,
            team: seat.team,
            trickPoints: trickPoints[seat.index] ?? 0,
            type: stored?.occupantType ?? "empty",
          };
        }),
        tokens: [...hand.tokens],
        trick: currentTrick,
        trickPointsPartial: projection.completedTricks.some(
          (trick) => trick.points === null,
        ),
        trump: {
          indicator: projection.trump.indicator
            ? projectedCard(projection.trump.indicator)
            : null,
          indicatorVisible: projection.trump.open,
          isOpen: projection.trump.open,
          maker: projection.trump.maker,
          suit: projection.trump.suit,
        },
        version: room.eventVersion,
      },
    },
  };
}
