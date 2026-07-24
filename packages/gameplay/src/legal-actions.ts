import type { GameplayHand } from "./aggregate.js";
import { legalBidAmounts } from "./bidding.js";
import type { GameplayCommand } from "./messages.js";
import {
  exhaustedTrumpLeadRequired,
  legalCardPlays,
  type TrickContext,
} from "./trick.js";
import { canChooseClosedTrump } from "./trump.js";
import type { SeatIndex } from "./values.js";

function trickContext(hand: GameplayHand): TrickContext | null {
  const { maker, suit } = hand.trump;
  if (maker === null || suit === null) return null;
  return {
    completedTrickCount: hand.completedTricks.length,
    forceOpenOnCompletion:
      !hand.trump.open &&
      hand.completedTricks.length === 0 &&
      (hand.bidding.currentBid ?? 0) >=
        hand.profile.revealTrumpAfterFirstTrickAtBidAtLeast,
    indicator: hand.trump.indicator,
    maker,
    mustLeadRemainingTrumps: exhaustedTrumpLeadRequired(
      hand.completedTricks,
      maker,
      suit,
    ),
    profile: hand.profile,
    trumpOpen: hand.trump.open,
    trumpSuit: suit,
  };
}

export function legalGameplayCommands(
  hand: GameplayHand,
  actor: SeatIndex,
): readonly GameplayCommand[] {
  if (!hand.deal.hands[actor]) return [];

  if (hand.phase === "four-bidding" || hand.phase === "second-bidding") {
    if (hand.activeSeat !== actor) return [];
    return [
      ...legalBidAmounts(hand.profile, hand.bidding, actor).map(
        (amount): GameplayCommand => ({ actor, amount, type: "BID" }),
      ),
      { actor, type: "PASS_BID" },
    ];
  }

  if (hand.phase === "trump-selection") {
    if (hand.activeSeat !== actor || hand.trump.maker !== actor) return [];
    const candidates =
      hand.bidding.round === "four"
        ? (hand.deal.firstHands[actor] ?? [])
        : (hand.deal.hands[actor] ?? []);
    const used = new Set<string>();
    return candidates.flatMap((card): readonly GameplayCommand[] => {
      if (used.has(card.id)) return [];
      used.add(card.id);
      return [{ actor, cardId: card.id, type: "SELECT_TRUMP" }];
    });
  }

  if (hand.phase === "trump-choice") {
    if (hand.activeSeat !== actor || hand.trump.maker !== actor) return [];
    const commands: GameplayCommand[] = [];
    if (hand.profile.allowOpenTrump) {
      commands.push({ actor, type: "TRUMP_OPEN" });
    }
    if (
      hand.profile.allowClosedTrump &&
      hand.trump.suit !== null &&
      canChooseClosedTrump({
        dealer: hand.dealer,
        hand: hand.deal.hands[actor] ?? [],
        maker: actor,
        profile: hand.profile,
        trumpSuit: hand.trump.suit,
      })
    ) {
      commands.push({ actor, type: "TRUMP_CLOSE" });
    }
    return commands;
  }

  if (hand.phase === "trick-play") {
    const context = trickContext(hand);
    if (!context || !hand.currentTrick) return [];
    return legalCardPlays(
      context,
      hand.currentTrick,
      hand.deal.hands[actor] ?? [],
      actor,
    ).map(
      (selection): GameplayCommand => ({
        actor,
        ...selection,
        type: "PLAY_CARD",
      }),
    );
  }

  if (hand.phase === "hand-result" || hand.phase === "match-complete") {
    return [{ actor, type: "ACK_RESULT" }];
  }

  return [];
}
