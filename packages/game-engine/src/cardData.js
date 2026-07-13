export const SUITS = [
  { id: "clubs", label: "Clubs", short: "C" },
  { id: "diamonds", label: "Diamonds", short: "D" },
  { id: "hearts", label: "Hearts", short: "H" },
  { id: "spades", label: "Spades", short: "S" },
];

export const CLASSIC_DECK_RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
export const CLASSIC_CARD_POINTS = {
  J: 30,
  9: 20,
  A: 11,
  10: 10,
  K: 3,
  Q: 2,
  8: 0,
  7: 0,
};

export function cardId(suit, rank) {
  return `${suit[0].toUpperCase()}_${rank}`;
}

export function generateShuffleSeed() {
  return `s_${randomBytes(32).toString("hex")}`;
}

function createSeededRandom(seed) {
  const key = Buffer.from(String(seed));
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset + 4 > block.length) {
      const nonce = Buffer.alloc(8);
      nonce.writeBigUInt64BE(BigInt(counter));
      counter += 1;
      block = createHmac("sha256", key).update(nonce).digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value / 4294967296;
  };
}

function secureCommit(seed, profileId, handNumber) {
  const source = `${String(seed)}|${profileId}|${String(handNumber)}`;
  return `c_${createHash("sha256").update(source).digest("hex")}`;
}

export function makeShuffleCommit(seed, profileId, handNumber) {
  return secureCommit(seed, profileId, handNumber);
}

export function formatCard(card) {
  return `${card.rank}${card.suit[0].toUpperCase()}`;
}

export function cloneCard(card) {
  return { ...card };
}

export function getRankPower(profile, rank) {
  return profile.rankOrderHighToLow.indexOf(rank);
}

export function compareRank(profile, a, b) {
  const pA = getRankPower(profile, a);
  const pB = getRankPower(profile, b);
  if (pA < pB) return 1;
  if (pA > pB) return -1;
  return 0;
}

export function compareCardsForTrick(
  profile,
  a,
  b,
  trumpSuit,
  ledSuit,
  trumpOpen,
) {
  const aIsTrump = trumpOpen && a.suit === trumpSuit;
  const bIsTrump = trumpOpen && b.suit === trumpSuit;
  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;
  if (aIsTrump && bIsTrump) return compareRank(profile, a.rank, b.rank);
  if (a.suit === ledSuit && b.suit !== ledSuit) return 1;
  if (a.suit !== ledSuit && b.suit === ledSuit) return -1;
  if (a.suit === b.suit) return compareRank(profile, a.rank, b.rank);
  return 0;
}

export function buildDeck(profile) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of profile.deckRanks) {
      cards.push({
        cardId: cardId(suit.id, rank),
        suit: suit.id,
        rank,
        points: profile.cardPoints[rank] || 0,
      });
    }
  }
  return cards;
}

export function shuffleDeck(cards, { seed = null } = {}) {
  const deck = cards.map(cloneCard);
  const random =
    seed != null
      ? createSeededRandom(seed)
      : () => randomBytes(4).readUInt32BE() / 4294967296;
  for (let i = deck.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(random() * (i + 1));
    const t = deck[i];
    deck[i] = deck[swapIndex];
    deck[swapIndex] = t;
  }
  return deck;
}
import { createHash, createHmac, randomBytes } from "node:crypto";
