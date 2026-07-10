export const SUITS = [
  { id: "clubs", label: "Clubs", short: "C" },
  { id: "diamonds", label: "Diamonds", short: "D" },
  { id: "hearts", label: "Hearts", short: "H" },
  { id: "spades", label: "Spades", short: "S" },
];

export const CLASSIC_DECK_RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
export const CLASSIC_CARD_POINTS = {
  J: 30,
  "9": 20,
  A: 11,
  "10": 10,
  K: 3,
  Q: 2,
  "8": 0,
  "7": 0,
};

export function cardId(suit, rank) {
  return `${suit[0].toUpperCase()}_${rank}`;
}

function toSeedInt(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.abs(Math.floor(seed)) >>> 0;
  }
  if (typeof seed !== "string" && typeof seed !== "number") {
    return 0;
  }
  let hash = 2166136261 >>> 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    hash >>>= 0;
  }
  return hash >>> 0;
}

export function generateShuffleSeed() {
  const now = Date.now().toString(36);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buffer = new Uint32Array(2);
    crypto.getRandomValues(buffer);
    return `s_${buffer[0].toString(16)}${buffer[1].toString(16)}_${now}`;
  }
  const randomPart = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `s_${randomPart}_${now}`;
}

function createSeededRandom(seed) {
  let state = toSeedInt(seed) || 0x9e3779b9;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state >>>= 0;
    return state / 4294967296;
  };
}

function simpleCommit(seed, profileId, handNumber) {
  const source = `${String(seed)}|${profileId}|${String(handNumber)}`;
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    h1 = (h1 + code * (i + 1)) % 2147483647;
    h2 = (h2 * 31 + code) % 2147483647;
  }
  const combined = (h1.toString(16) + h2.toString(16)).padStart(12, "0");
  return `c_${combined}`;
}

export function makeShuffleCommit(seed, profileId, handNumber) {
  return simpleCommit(seed, profileId, handNumber);
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

export function compareCardsForTrick(profile, a, b, trumpSuit, ledSuit, trumpOpen) {
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
      : typeof crypto !== "undefined" && crypto.getRandomValues
      ? () => {
          const buf = new Uint32Array(1);
          crypto.getRandomValues(buf);
          return buf[0] / 4294967296;
        }
      : () => Math.random();
  for (let i = deck.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(random() * (i + 1));
    const t = deck[i];
    deck[i] = deck[swapIndex];
    deck[swapIndex] = t;
  }
  return deck;
}
