import type { GameplayHand } from "./aggregate.js";
import type { Card } from "./card.js";
import type { CancelledHand, HandScore, TokenBalance } from "./scoring.js";
import { teamForSeat } from "./scoring.js";
import type { TrickPlay, TrickState } from "./trick.js";
import type { SeatIndex, Suit, Team } from "./values.js";

export type ProjectedCard =
  | { readonly hidden: true }
  | (Card & { readonly hidden: false });

export interface ProjectedSeat {
  readonly capturedCount: number;
  readonly hand: readonly ProjectedCard[];
  readonly handSize: number;
  readonly index: SeatIndex;
  readonly isViewer: boolean;
  readonly team: Team;
}

export interface ProjectedPlay {
  readonly actor: SeatIndex;
  readonly card: ProjectedCard;
  readonly faceDown: boolean;
  readonly fromIndicator: boolean;
}

export interface ProjectedTrick {
  readonly activeSeat: SeatIndex | null;
  readonly leaderSeat: SeatIndex;
  readonly openedTrump: boolean;
  readonly plays: readonly ProjectedPlay[];
  readonly points: number | null;
  readonly status: "active" | "complete";
  readonly trumpRevealReason:
    | "face-down-trump-cut"
    | "high-bid-after-first-trick"
    | null;
  readonly winnerSeat: SeatIndex | null;
}

export interface GameplayProjection {
  readonly activeSeat: SeatIndex | null;
  readonly bidding: GameplayHand["bidding"];
  readonly completedTricks: readonly ProjectedTrick[];
  readonly currentTrick: ProjectedTrick | null;
  readonly dealer: SeatIndex;
  readonly handNumber: number;
  readonly phase: GameplayHand["phase"];
  readonly profileId: GameplayHand["profile"]["id"];
  readonly result: CancelledHand | HandScore | null;
  readonly seats: readonly ProjectedSeat[];
  readonly tokens: TokenBalance;
  readonly trump: {
    readonly indicator: ProjectedCard | null;
    readonly maker: SeatIndex | null;
    readonly open: boolean;
    readonly suit: Suit | null;
  };
}

const hiddenCard = (): ProjectedCard => ({ hidden: true });
const visibleCard = (card: Card): ProjectedCard => ({ ...card, hidden: false });

function isPlayVisible(
  hand: GameplayHand,
  trick: TrickState,
  play: TrickPlay,
): boolean {
  if (!play.faceDown) return true;
  if (trick.trumpRevealReason === "face-down-trump-cut") {
    return (
      play.actor !== hand.trump.maker || play.card.suit === hand.trump.suit
    );
  }
  return Boolean(
    hand.trump.open &&
      hand.trump.suit !== null &&
      play.card.suit === hand.trump.suit,
  );
}

function projectTrick(
  hand: GameplayHand,
  trick: TrickState | null,
): ProjectedTrick | null {
  if (!trick) return null;
  const visibility = trick.plays.map((play) =>
    isPlayVisible(hand, trick, play),
  );
  return {
    activeSeat: trick.activeSeat,
    leaderSeat: trick.leaderSeat,
    openedTrump: trick.openedTrump,
    plays: trick.plays.map((play, index) => ({
      actor: play.actor,
      card: visibility[index] ? visibleCard(play.card) : hiddenCard(),
      faceDown: play.faceDown,
      fromIndicator: play.fromIndicator,
    })),
    points: visibility.every(Boolean) ? trick.points : null,
    status: trick.status,
    trumpRevealReason: trick.trumpRevealReason ?? null,
    winnerSeat: trick.winnerSeat,
  };
}

export function projectGameplayHand(
  hand: GameplayHand,
  viewer: SeatIndex | null,
): GameplayProjection {
  const viewerCanSeeTrump =
    hand.trump.open || (viewer !== null && viewer === hand.trump.maker);
  return {
    activeSeat: hand.activeSeat,
    bidding: hand.bidding,
    completedTricks: hand.completedTricks.map((trick) => {
      const projected = projectTrick(hand, trick);
      if (!projected) throw new Error("Completed trick projection is missing");
      return projected;
    }),
    currentTrick: projectTrick(hand, hand.currentTrick),
    dealer: hand.dealer,
    handNumber: hand.handNumber,
    phase: hand.phase,
    profileId: hand.profile.id,
    result: hand.result,
    seats: hand.deal.hands.map((cards, index) => {
      const actor = index as SeatIndex;
      const isViewer = viewer !== null && viewer === actor;
      return {
        capturedCount: hand.capturedCards[index]?.length ?? 0,
        hand: cards.map((card) =>
          isViewer ? visibleCard(card) : hiddenCard(),
        ),
        handSize: cards.length,
        index: actor,
        isViewer,
        team: teamForSeat(actor),
      };
    }),
    tokens: hand.tokens,
    trump: {
      indicator:
        viewerCanSeeTrump && hand.trump.revealedIndicator
          ? visibleCard(hand.trump.revealedIndicator)
          : null,
      maker: hand.trump.maker,
      open: viewerCanSeeTrump ? hand.trump.open : false,
      suit: viewerCanSeeTrump ? hand.trump.suit : null,
    },
  };
}
