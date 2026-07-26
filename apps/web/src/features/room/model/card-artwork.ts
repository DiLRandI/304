import type { ProjectedCard } from "./card-view";

export interface CardArtwork {
  kind: "artwork";
  src: string;
}

const ARTWORK_ROOT = "/generated/card-art";
const BACK_ARTWORK: CardArtwork = {
  kind: "artwork",
  src: `${ARTWORK_ROOT}/backs/svg/card_back_304_ceylon.svg`,
};

const RANK_FILE_NAMES: Readonly<Record<string, string>> = {
  "10": "ten",
  "2": "two",
  "3": "three",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  A: "ace",
  J: "jack",
  K: "king",
  Q: "queen",
};

const SUIT_FILE_NAMES: Readonly<Record<string, string>> = {
  C: "clubs",
  D: "diamonds",
  H: "hearts",
  S: "spades",
};

const STANDARD_RANKS = new Set(["7", "8", "9", "10", "J", "Q", "K", "A"]);
const EXTRA_RANKS = new Set(["2", "3", "6"]);

export function resolveCardArtwork(card: ProjectedCard): CardArtwork | null {
  if (card.hidden || !card.rank || !card.suit) return BACK_ARTWORK;

  const [suitCode, rank] = card.cardId.split("_");
  const suitName = SUIT_FILE_NAMES[suitCode ?? ""];
  const rankName = RANK_FILE_NAMES[rank ?? ""];
  const collection = STANDARD_RANKS.has(rank ?? "")
    ? "standard_304"
    : EXTRA_RANKS.has(rank ?? "")
      ? "variant_extras"
      : null;

  if (
    !collection ||
    !suitName ||
    !rankName ||
    rank !== card.rank ||
    suitName !== card.suit
  ) {
    return null;
  }

  return {
    kind: "artwork",
    src: `${ARTWORK_ROOT}/cards/${collection}/svg/${card.cardId}_${suitName}_${rankName}.svg`,
  };
}
