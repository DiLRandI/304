import type { GameplayHand } from "./aggregate.js";
import type { SeatIndex } from "./values.js";

function formatSeat(
  seat: SeatIndex | null | undefined,
  capitalized = true,
): string {
  if (seat === null || seat === undefined) {
    return capitalized ? "Unknown seat" : "unknown seat";
  }
  return `${capitalized ? "Seat" : "seat"} ${seat + 1}`;
}

export function gameplayPrompt(
  hand: GameplayHand,
  viewer: SeatIndex | null,
): string {
  switch (hand.phase) {
    case "four-bidding":
      return `Phase: Four-card bidding. Current bid ${hand.bidding.currentBid ?? 0}.`;
    case "trump-selection":
      return `Trump maker: ${formatSeat(hand.trump.maker, false)}. Select a trump indicator card.`;
    case "second-bidding":
      return `Second bidding. Current bid ${hand.bidding.currentBid ?? 0}.`;
    case "trump-choice":
      return "Choose trump mode.";
    case "trick-play": {
      if (!hand.currentTrick) return "Preparing first trick.";
      if (viewer !== null && viewer === hand.activeSeat) {
        return hand.currentTrick.leaderSeat === hand.activeSeat
          ? "Your turn. You lead the trick."
          : "Your turn. Play a legal card.";
      }
      return hand.currentTrick.leaderSeat === hand.activeSeat
        ? `${formatSeat(hand.activeSeat)} leads the trick.`
        : `${formatSeat(hand.activeSeat)} to play.`;
    }
    case "trick-result":
      return `${formatSeat(hand.currentTrick?.winnerSeat)} wins the trick. Next trick starts shortly.`;
    case "hand-result":
      return "Hand complete. Continue to next hand.";
    case "match-complete":
      return "Match complete.";
  }
}
