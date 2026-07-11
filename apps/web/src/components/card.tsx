"use client";

import type { GameAction } from "@three-zero-four/contracts";
import type { ProjectedCard } from "../lib/room-view";

const SUIT_SYMBOLS: Record<string, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const RANK_NAMES: Record<string, string> = {
  "10": "Ten",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  A: "Ace",
  J: "Jack",
  K: "King",
  Q: "Queen",
};

function rankName(rank: string): string {
  return RANK_NAMES[rank] ?? rank;
}

function suitName(suit: string): string {
  return suit.slice(0, 1).toUpperCase() + suit.slice(1);
}

export function cardLabel(card: ProjectedCard): string {
  if (card.hidden || !card.rank || !card.suit || card.points === null) {
    return "Hidden card";
  }
  return `${rankName(card.rank)} of ${suitName(card.suit)}, ${card.points} points`;
}

export function CardButton({
  action,
  card,
  onSelect,
}: {
  action: GameAction | null;
  card: ProjectedCard;
  onSelect(action: GameAction): void;
}) {
  const label = cardLabel(card);
  const isHidden = card.hidden || !card.rank || !card.suit;
  const actionVerb = action?.type === "SELECT_TRUMP" ? "Choose" : "Play";

  return (
    <button
      aria-label={isHidden ? label : `${actionVerb} ${label}`}
      className="card-button"
      data-hidden={isHidden || undefined}
      data-suit={card.suit ?? undefined}
      disabled={!action || isHidden}
      onClick={() => {
        if (action) onSelect(action);
      }}
      type="button"
    >
      {isHidden ? (
        <span aria-hidden="true" className="card-back">
          304
        </span>
      ) : (
        <>
          <span aria-hidden="true" className="card-rank">
            {card.rank}
          </span>
          <span aria-hidden="true" className="card-suit">
            {SUIT_SYMBOLS[card.suit ?? ""] ?? "?"}
          </span>
          <span className="sr-only">{label}</span>
        </>
      )}
    </button>
  );
}
