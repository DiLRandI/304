import { formatCard, compareRank } from "./cardData.js";

function suitCount(hand) {
  const bySuit = { clubs: 0, diamonds: 0, hearts: 0, spades: 0 };
  for (const card of hand) {
    bySuit[card.suit] = (bySuit[card.suit] || 0) + 1;
  }
  return bySuit;
}

function countPoints(hand) {
  return hand.reduce((sum, card) => sum + (card.points || 0), 0);
}

function legalBids(legalActions, fallbackMin, step) {
  const bids = legalActions
    .filter((action) => action.type === "BID")
    .map((action) => action.amount)
    .sort((a, b) => a - b);
  const list = [];
  let current = fallbackMin;
  while (current <= 420) {
    if (bids.includes(current)) {
      list.push(current);
    }
    current += step;
  }
  return list;
}

function chooseBidFromHand(state, seat, legalActions, phase) {
  const hand = state.seats[seat].hand;
  const handScore = countPoints(hand) + Object.values(suitCount(hand)).reduce((s, v) => s + Math.max(0, v - 2), 0) * 4;
  if (phase === "four") {
    if (handScore < 140) return null;
    const options = legalBids(legalActions, 160, state.profile.fourCardBidStep);
    if (state.profileId === "six_304_36") {
      for (let option of options.reverse()) {
        if (option <= 190 + Math.floor(handScore / 5) && option >= 160) {
          return option;
        }
      }
    }
    return options.length ? options[Math.min(2, options.length - 1)] : null;
  }
  if (phase === "second") {
    const options = legalBids(legalActions, state.profile.minEightCardBid, state.profile.eightCardBidStep);
    if (!options.length || state.profileId === "classic_304_4p" && countPoints(hand) < 100) {
      return null;
    }
    for (const option of options.reverse()) {
      if (option >= 250 && option <= state.bidding.currentBid + 20 + Math.floor(handScore / 4)) {
        return option;
      }
    }
  }
  return null;
}

function chooseTrumpSeatChoice(state, seat) {
  const hand = state.seats[seat].hand;
  const bySuit = suitCount(hand);
  const rankValue = (card, profile) => -compareRank(profile, card.rank, "7");
  let best = { suit: null, score: -1 };
  for (const [suit, c] of Object.entries(bySuit)) {
    const cards = hand.filter((c2) => c2.suit === suit);
    const raw = cards.length * 9 + cards.reduce((sum, card) => sum + (card.points || 0), 0);
    const score = raw + cards.reduce((sum, card) => sum + (card.rank === "J" ? 50 : card.rank === "9" ? 30 : 0), 0);
    if (score > best.score) best = { suit, score };
  }
  if (!best.suit) {
    return null;
  }
  const preferred = hand.find((card) => card.suit === best.suit) || hand[0];
  return preferred.cardId;
}

function chooseTrumpOpen(state, seat, legalActions) {
  const choose = legalActions.find((a) => a.type === "TRUMP_OPEN");
  const keepClosed = legalActions.find((a) => a.type === "TRUMP_CLOSE");
  if (!choose) return keepClosed;
  if (!keepClosed) return choose;
  if (state.bidding.currentBid >= 250 && Math.random() > 0.4) {
    return keepClosed;
  }
  return choose; // easy style defaults to open for readability only when not forced.
}

function choosePlay(state, seat, legalActions) {
  const profile = state.profile;
  const hand = state.seats[seat].hand;
  const follows = legalActions.filter((a) => a.type === "PLAY_CARD" && !a.faceDown);
  const anyFaceDown = legalActions.filter((a) => a.type === "PLAY_CARD" && a.faceDown);
  if (legalActions.length === 0) {
    return null;
  }

  if (follows.length === 0) {
    if (anyFaceDown.length > 0 && state.trumpClosed && Math.random() > 0.2) {
      return anyFaceDown[0];
    }
    if (anyFaceDown.length > 0 && state.trumpCard && state.trumpCard.suit === state.trumpSuit) {
      return anyFaceDown.find((action) => action.card.rank === "J") || anyFaceDown[anyFaceDown.length - 1];
    }
  }

  if (follows.length === 0) {
    follows.push(...anyFaceDown);
  }
  const lead = legalActions.find((action) => action.card && action.card.cardId && action.card.suit === state.currentLedSuit);
  const sorted = follows.slice().sort((a, b) => {
    const ar = compareRank(profile, a.card.rank, b.card.rank);
    if (ar === 0) return 0;
    return ar;
  });
  if (state.trumpClosed && anyFaceDown.length > 0 && state.trumpCard) {
    const trumpCards = follows.filter((action) => action.card.suit === state.trumpSuit);
    if (trumpCards.length) {
      return trumpCards[0];
    }
  }
  if (state.leadingSeat === seat && hand.length > 1 && state.trumpCard && state.trumpCard.suit === state.currentLedSuit) {
    return sorted[sorted.length - 1];
  }
  return sorted[0];
}

export function pickBotAction(state, seatIndex) {
  const difficulty = state.seats[seatIndex]?.difficulty || "easy";
  const legalActions = state.getLegalActions(seatIndex);
  if (!legalActions.length) return null;

  const phase = state.phase;
  if (phase === "four_bidding" || phase === "second_bidding") {
    const round = phase === "four_bidding" ? "four" : "second";
    const bid = chooseBidFromHand(state, seatIndex, legalActions, round);
    if (bid !== null) {
      const exact = legalActions.find((a) => a.type === "BID" && a.amount === bid);
      if (exact) {
        return exact;
      }
    }
    const pass = legalActions.find((a) => a.type === "PASS_BID");
    return pass || legalActions[0];
  }

  if (phase === "trump_selection") {
    const selected = chooseTrumpSeatChoice(state, seatIndex);
    if (selected) {
      const exact = legalActions.find((a) => a.type === "SELECT_TRUMP" && a.cardId === selected);
      if (exact) return exact;
    }
    return legalActions[0];
  }

  if (phase === "trump_choice") {
    const choice = chooseTrumpOpen(state, seatIndex, legalActions);
    if (difficulty === "easy") {
      return choice || legalActions.find((a) => a.type === "TRUMP_CLOSE");
    }
    return legalActions.find((a) => a.type === "TRUMP_CLOSE") || choice;
  }

  if (phase === "trick_play") {
    if (difficulty === "strong") {
      const strong = choosePlay(state, seatIndex, legalActions);
      if (strong) return strong;
    }
    if (difficulty === "normal") {
      const strong = choosePlay(state, seatIndex, legalActions);
      if (strong && Math.random() > 0.25) return strong;
    }
    const sorted = legalActions
      .filter((action) => action.type === "PLAY_CARD")
      .sort((a, b) => {
        const ar = compareRank(state.profile, a.card.rank, b.card.rank);
        if (a.faceDown && !b.faceDown) return 1;
        if (!a.faceDown && b.faceDown) return -1;
        return ar;
      });
    return sorted[0] || legalActions[0];
  }

  return legalActions.find((a) => a.type === "ACK_RESULT") || legalActions[0];
}
