import { pickBotAction } from "./bot.js";
import {
  buildDeck,
  cloneCard,
  compareCardsForTrick,
  formatCard,
  generateShuffleSeed,
  makeShuffleCommit,
  shuffleDeck,
} from "./cardData.js";
import { BOT_NAMES, chooseTableSeatCount, getProfile } from "./profiles.js";

const PHASE = {
  SETUP: "setup",
  FOUR_BIDDING: "four_bidding",
  TRUMP_SELECTION: "trump_selection",
  SECOND_BIDDING: "second_bidding",
  TRUMP_CHOICE: "trump_choice",
  TRICK_PLAY: "trick_play",
  HAND_RESULT: "hand_result",
  MATCH_COMPLETE: "match_complete",
};

const SEAT_DISPLAY_VERSION = 1;

function inviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "304-";
  const randomValues = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (const value of randomValues) {
      out += chars[value % chars.length];
    }
    return out;
  }
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function nextSeat(seatCount, index) {
  return (index + 1) % seatCount;
}

function formatSeat(index, capitalized = true) {
  if (!Number.isInteger(index) || index < 0) {
    return capitalized ? "Unknown seat" : "unknown seat";
  }
  return `${capitalized ? "Seat" : "seat"} ${index + 1}`;
}

function migrateZeroBasedSeatCopy(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    /\b(Seat|seat) (\d+)\b/g,
    (_match, prefix, index) => `${prefix} ${Number(index) + 1}`,
  );
}

function teamOf(index) {
  return index % 2 === 0 ? "A" : "B";
}

function toSeatIndex(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function cloneStateForBotsOnly(state) {
  return {
    profile: state.profile,
    profileId: state.profile.id,
    seats: [],
    seatCount: state.seatCount,
    bidding: state.bidding,
    phase: state.phase,
    trump: state.trump,
    currentTrick: state.currentTrick,
    currentLedSuit: state.currentLedSuit,
    trumpClosed: state.trumpClosed,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    completedTricks: state.completedTricks,
  };
}

function getTrumpPublicView(state, viewerSeatIndex = null) {
  const viewer = toSeatIndex(viewerSeatIndex);
  const viewerCanSeeTrump =
    state.trump.isOpen || (viewer != null && viewer === state.trump.maker);
  return {
    maker: state.trump.maker,
    suit: viewerCanSeeTrump ? state.trump.suit : null,
    isOpen: viewerCanSeeTrump ? state.trump.isOpen : false,
    indicatorVisible: viewerCanSeeTrump ? state.trump.indicatorVisible : false,
  };
}

function projectHandResultForPublic(result) {
  if (!result) return null;
  if (result.noScore === true) {
    return {
      handNumber: result.handNumber,
      noScore: true,
      reason: result.reason,
      tokens: [...result.tokens],
    };
  }
  return {
    bidderTeam: result.bidderTeam,
    bidderTeamPoints: result.bidderTeamPoints,
    bid: result.bid,
    handNumber: result.handNumber,
    matchComplete: result.matchComplete,
    movement: result.movement,
    otherTeamPoints: result.otherTeamPoints,
    success: result.success,
    tokens: [...result.tokens],
    trickCount: result.trickCount,
    winningTeam: result.winningTeam,
  };
}

function projectReconnectActionForPublic(action) {
  if (!action || typeof action !== "object") return null;
  const projected = {
    type: action.type,
    at: action.at,
    handNumber: action.handNumber,
    phase: action.phase,
  };
  if (action.type === "BID" && Number.isFinite(action.amount)) {
    projected.amount = action.amount;
  }
  if (action.type === "PLAY_CARD") {
    const concealed = action.faceDown === true || action.fromIndicator === true;
    if (concealed) {
      projected.faceDown = true;
    } else if (typeof action.cardId === "string" && action.cardId) {
      projected.cardId = action.cardId;
    }
  }
  return projected;
}

function projectReconnectSummaryForPublic(summary) {
  if (!Array.isArray(summary)) return [];
  return summary
    .slice(-12)
    .map(projectReconnectActionForPublic)
    .filter((action) => action !== null);
}

function cloneSeatsForBot(state, botSeatIndex) {
  return state.seats.map((seat, seatIndex) => {
    const isBotSeat = Number(seatIndex) === Number(botSeatIndex);
    return {
      ...seat,
      hand: isBotSeat ? seat.hand.map(cloneCard) : [],
      firstHand: isBotSeat ? seat.firstHand.map(cloneCard) : [],
      wonCards: isBotSeat ? seat.wonCards.map(cloneCard) : [],
      trickPoints: seat.trickPoints,
      handSize: seat.hand.length,
    };
  });
}

export class GameEngine {
  constructor({
    playerName = "You",
    humanCount = 1,
    tableMode = "auto",
    ruleProfile = "classic_304_4p",
    botDifficulty = "easy",
    enableSecondBidding = true,
    initialSeats = null,
  } = {}) {
    const profile = getProfile(ruleProfile);
    const seatCount = chooseTableSeatCount(humanCount, tableMode, profile.id);
    this.state = {
      seatDisplayVersion: SEAT_DISPLAY_VERSION,
      profile,
      profileId: profile.id,
      settings: {
        tableMode,
        botDifficulty,
        enableSecondBidding,
        tableVisible: true,
      },
      seatCount,
      humanCount: Math.min(humanCount, seatCount),
      inviteCode: inviteCode(),
      roomName: `${playerName}'s table`,
      deck: [],
      seats: [],
      dealerSeat: 0,
      activeSeat: null,
      phase: PHASE.SETUP,
      handNumber: 0,
      bidding: {
        phase: "four",
        currentBid: 0,
        currentBidSeat: null,
        order: [],
        activeOrderIndex: 0,
        noBidPasses: 0,
        passesAfterBid: 0,
        actions: [],
        actedInRound: [],
        secondRound: {
          enabled: enableSecondBidding && profile.cardBatch[1] > 0,
          order: [],
          activeOrderIndex: 0,
          anyBid: false,
          previousBid: 0,
          previousBidSeat: null,
          actionsTaken: 0,
        },
        initialMakerSeat: null,
      },
      trump: {
        maker: null,
        suit: null,
        card: null,
        isOpen: false,
        indicatorVisible: false,
      },
      currentTrick: null,
      currentLedSuit: null,
      trumpClosed: true,
      trumpSuit: null,
      trumpCard: null,
      completedTricks: [],
      tokens: [profile.matchStartTokens, profile.matchStartTokens],
      handResult: null,
      actionLog: [],
      version: 0,
      error: null,
      gameMessage: "Create or start a match from lobby.",
      handCards: [],
      handShuffle: {
        seed: null,
        seedCommit: null,
        deckVersion: "mulberry32-v1",
      },
    };
    this._buildSeats(profile, playerName, initialSeats);
  }

  _buildSeats(profile, playerName = "You", initialSeats = null) {
    this.state.seats = [];
    let botIndex = 0;
    let explicitHumanCount = 0;
    const layout =
      Array.isArray(initialSeats) &&
      initialSeats.length === this.state.seatCount
        ? initialSeats
        : null;

    const resolveSeatType = (seat) => {
      if (!seat || typeof seat !== "object") {
        return "empty";
      }
      if (seat.type === "human" || seat.occupantType === "human") {
        return "human";
      }
      if (seat.type === "bot" || seat.occupantType === "bot") {
        return "bot";
      }
      return "empty";
    };

    for (let i = 0; i < this.state.seatCount; i++) {
      const templateSeat = layout ? layout[i] : null;
      const seatType = layout
        ? resolveSeatType(templateSeat)
        : i < this.state.humanCount
          ? "human"
          : "bot";
      if (seatType === "human") {
        explicitHumanCount += 1;
      }
      const seat = {
        index: i,
        seatLabel: formatSeat(i),
        team: teamOf(i),
        type: seatType,
        connectionStatus:
          templateSeat?.connectionStatus ||
          (seatType === "human" ? "disconnected" : "online"),
        autopilot: Boolean(templateSeat?.autopilot),
        disconnectedAt: templateSeat?.disconnectedAt || null,
        reconnectSummary: Array.isArray(templateSeat?.reconnectSummary)
          ? [...templateSeat.reconnectSummary]
          : [],
        displayName:
          layout &&
          typeof templateSeat.displayName === "string" &&
          templateSeat.displayName.trim()
            ? templateSeat.displayName
            : seatType === "human"
              ? i === 0
                ? playerName
                : `Guest ${i + 1}`
              : BOT_NAMES[botIndex % BOT_NAMES.length],
        difficulty:
          seatType === "human" ? "human" : this.state.settings.botDifficulty,
        hand: [],
        firstHand: [],
        wonCards: [],
        trickPoints: 0,
      };
      if (templateSeat?.userId) {
        seat.userId = templateSeat.userId;
      }
      if (templateSeat?.botId) {
        seat.botId = templateSeat.botId;
      }
      if (templateSeat?.difficulty && seatType === "bot") {
        seat.difficulty = templateSeat.difficulty;
      }
      if (seatType !== "human") {
        botIndex += 1;
      }
      this.state.seats.push(seat);
    }
    if (explicitHumanCount > 0) {
      this.state.humanCount = explicitHumanCount;
    }
    if (profile.id === "six_304_36") {
      // keep alternating seating with A/B teams.
      this.state.seats.forEach((seat) => {
        seat.team = teamOf(seat.index);
      });
    }
  }

  getProfile() {
    return this.state.profile;
  }

  startMatch() {
    if (this.state.phase === PHASE.MATCH_COMPLETE) {
      this.state.tokens = [
        this.state.profile.matchStartTokens,
        this.state.profile.matchStartTokens,
      ];
      this.state.bidding.secondRound.anyBid = false;
    }
    this._startHand();
  }

  _startHand() {
    this.state.handNumber += 1;
    this.state.handResult = null;
    this.state.currentTrick = null;
    this.state.currentLedSuit = null;
    this.state.completedTricks = [];
    this.state.trump = {
      maker: null,
      suit: null,
      card: null,
      isOpen: false,
      indicatorVisible: false,
    };
    this.state.trumpClosed = true;
    this.state.trumpSuit = null;
    this.state.trumpCard = null;
    this.state.error = null;
    const shuffleSeed = generateShuffleSeed();
    this.state.handShuffle = {
      seed: shuffleSeed,
      seedCommit: makeShuffleCommit(
        shuffleSeed,
        this.state.profile.id,
        this.state.handNumber,
      ),
      deckVersion: "mulberry32-v1",
      seatCount: this.state.seatCount,
    };
    this.state.deck = shuffleDeck(buildDeck(this.state.profile), {
      seed: shuffleSeed,
    });
    this.state.dealerSeat =
      this.state.handNumber === 1
        ? Math.floor(Math.random() * this.state.seatCount)
        : nextSeat(this.state.seatCount, this.state.dealerSeat);
    for (const seat of this.state.seats) {
      seat.hand = [];
      seat.firstHand = [];
      seat.wonCards = [];
      seat.trickPoints = 0;
    }
    this.state.gameMessage = `Hand ${this.state.handNumber}. Dealer is ${formatSeat(this.state.dealerSeat, false)}.`;
    this._dealCards(this.state.profile.cardBatch[0], true);
    this._startFourCardBidding();
  }

  _dealCards(countEach, markFirstBatch) {
    const count = countEach;
    for (let round = 0; round < count; round++) {
      for (let i = 0; i < this.state.seatCount; i++) {
        const seatIndex =
          (this.state.dealerSeat + 1 + i + round * this.state.seatCount) %
          this.state.seatCount;
        const card = this.state.deck.pop();
        if (!card) {
          continue;
        }
        this.state.seats[seatIndex].hand.push(card);
        if (markFirstBatch) {
          this.state.seats[seatIndex].firstHand.push(card);
        }
      }
    }
  }

  _startFourCardBidding() {
    this.state.bidding.phase = "four";
    this.state.bidding.currentBid = 0;
    this.state.bidding.currentBidSeat = null;
    this.state.bidding.order = [];
    this.state.bidding.actions = [];
    this.state.bidding.actedInRound = [];
    this.state.bidding.noBidPasses = 0;
    this.state.bidding.passesAfterBid = 0;
    this.state.bidding.secondRound.enabled =
      this.state.settings.enableSecondBidding &&
      this.state.profile.cardBatch[1] > 0;
    this.state.bidding.secondRound.actionsTaken = 0;
    this.state.bidding.secondRound.anyBid = false;
    this.state.bidding.secondRound.order = [];
    this.state.bidding.secondRound.previousBid = 0;
    this.state.bidding.secondRound.previousBidSeat = null;
    for (let i = 1; i <= this.state.seatCount; i++) {
      this.state.bidding.order.push(
        (this.state.dealerSeat + i) % this.state.seatCount,
      );
    }
    this.state.bidding.activeOrderIndex = 0;
    this.state.activeSeat = this.state.bidding.order[0];
    this.state.phase = PHASE.FOUR_BIDDING;
    this.state.gameMessage = "Bidding: minimum 160. Pass or bid higher.";
    this.state.bidding.initialMakerSeat = null;
    this._appendLog("HAND_START");
  }

  _startSecondBidding(previousMakerSeat, previousBid, previousBidSeat) {
    const state = this.state;
    state.bidding.phase = "second";
    state.bidding.secondRound.previousBid = previousBid;
    state.bidding.secondRound.previousBidSeat = previousBidSeat;
    state.bidding.currentBid = previousBid;
    state.bidding.currentBidSeat = previousBidSeat;
    state.bidding.secondRound.order = [];
    for (let i = 1; i <= state.seatCount; i++) {
      state.bidding.secondRound.order.push(
        (previousMakerSeat + i - 1) % state.seatCount,
      );
    }
    state.bidding.secondRound.actionsTaken = 0;
    state.bidding.secondRound.anyBid = false;
    state.bidding.secondRound.activeOrderIndex = 0;
    state.activeSeat = state.bidding.secondRound.order[0];
    state.phase = PHASE.SECOND_BIDDING;
    state.gameMessage =
      "Eight-card bidding: bids must be >= 250 and higher than existing.";
  }

  _startTrumpChoice() {
    if (
      !this.state.profile.allowOpenTrump &&
      !this.state.profile.allowClosedTrump
    ) {
      this._forceTrumpClose();
      return;
    }
    this.state.phase = PHASE.TRUMP_CHOICE;
    this.state.activeSeat = this.state.trump.maker;
    if (!this.state.profile.allowOpenTrump) {
      this._forceTrumpClose();
      return;
    }
    this.state.gameMessage = "Trump maker, choose closed or open trump.";
    this.state.trumpClosed = !this.state.trump.isOpen;
    this._appendLog("TRUMP_CHOICE_STARTED");
  }

  _forceTrumpClose() {
    this.state.trumpClosed = true;
    this.state.trump.isOpen = false;
    this.state.activeSeat = null;
    this._startTrickPhase();
  }

  _startTrickPhase() {
    this.state.phase = PHASE.TRICK_PLAY;
    this.state.currentTrick = {
      trickIndex: this.state.completedTricks.length,
      leaderSeat: this.state.trump.maker,
      plays: [],
      points: 0,
    };
    this.state.currentLedSuit = null;
    this.state.activeSeat = this.state.currentTrick.leaderSeat;
    this.state.gameMessage = `Trick ${this.state.currentTrick.trickIndex + 1} start.`;
    this.state.trumpSuit = this.state.trump.suit;
    this.state.trumpCard = this.state.trump.card;
    this._appendLog("TRICK_STARTED");
  }

  _appendLog(type, payload = {}) {
    this.state.version += 1;
    this.state.actionLog.push({
      id: `evt_${this.state.actionLog.length + 1}`,
      type,
      payload,
      seat: this.state.activeSeat,
      atHand: this.state.handNumber,
      phase: this.state.phase,
      profile: this.state.profile.id,
      createdAt: new Date().toISOString(),
      version: this.state.version,
    });
    if (this.state.actionLog.length > 400) {
      this.state.actionLog.shift();
    }
  }

  _isPlayPubliclyVisible(play) {
    if (!play?.faceDown) return true;
    if (
      this.state.phase === PHASE.HAND_RESULT ||
      this.state.phase === PHASE.MATCH_COMPLETE
    ) {
      return true;
    }
    return Boolean(
      this.state.trump?.isOpen &&
        play.card?.suit &&
        play.card.suit === this.state.trump.suit,
    );
  }

  _completedPlayForCard(cardId) {
    for (const trick of this.state.completedTricks) {
      const play = trick.plays?.find((item) => item.card?.cardId === cardId);
      if (play) return play;
    }
    return null;
  }

  _projectWonCardForViewer(card, viewerSeatIndex) {
    const play = this._completedPlayForCard(card.cardId);
    const viewerPlayedCard =
      play && Number(play.seatIndex) === Number(viewerSeatIndex);
    if (
      play?.faceDown &&
      !viewerPlayedCard &&
      !this._isPlayPubliclyVisible(play)
    ) {
      return { cardId: "Card Back", hidden: true };
    }
    return cloneCard(card);
  }

  getPublicState(viewerSeatIndex = null) {
    const viewer = toSeatIndex(viewerSeatIndex);
    const viewerSeat = viewer != null ? this.state.seats[viewer] : null;
    const projectedTrick = this._projectTrickForPublic(this.state.currentTrick);
    const projectedCompleted = this.state.completedTricks.map(
      (trick) => this._projectTrickForPublic(trick).current,
    );
    const latestTrick = this.state.completedTricks.length
      ? this._projectTrickForPublic(
          this.state.completedTricks[this.state.completedTricks.length - 1],
        ).current
      : null;
    const trump = getTrumpPublicView(this.state, viewer);
    return {
      inviteCode: this.state.inviteCode,
      profile: this.state.profile,
      profileId: this.state.profile.id,
      seatCount: this.state.seatCount,
      handNumber: this.state.handNumber,
      phase: this.state.phase,
      activeSeat: this.state.activeSeat,
      seats: this.state.seats.map((seat) => ({
        index: seat.index,
        seatLabel: seat.seatLabel,
        team: seat.team,
        type: seat.type,
        displayName: seat.displayName,
        difficulty: seat.type === "bot" ? seat.difficulty || "easy" : null,
        connectionStatus: seat.connectionStatus || "disconnected",
        autopilot: !!seat.autopilot,
        disconnectedAt: seat.disconnectedAt || null,
        reconnectSummary: projectReconnectSummaryForPublic(
          seat.reconnectSummary,
        ),
        handSize: seat.hand.length,
        trickPoints: seat.trickPoints,
        isMe: viewerSeat != null ? viewerSeat.index === seat.index : false,
      })),
      dealerSeat: this.state.dealerSeat,
      bidding: this.state.bidding,
      trump,
      trick: projectedTrick.current,
      completedTricks: projectedCompleted,
      latestTrick,
      bidHistory: this.state.bidding.actions,
      tokens: this.state.tokens,
      handResult: projectHandResultForPublic(this.state.handResult),
      gameMessage: this.state.gameMessage,
      version: this.state.version,
    };
  }

  getSeatView(viewerSeatIndex, seatIndex = viewerSeatIndex) {
    const seat = this.state.seats[seatIndex];
    if (!seat || viewerSeatIndex == null) return null;
    const isMySeat = Number(viewerSeatIndex) === Number(seatIndex);
    return {
      index: seat.index,
      seatLabel: seat.seatLabel,
      team: seat.team,
      type: seat.type,
      displayName: seat.displayName,
      connectionStatus: seat.connectionStatus || "disconnected",
      autopilot: !!seat.autopilot,
      disconnectedAt: seat.disconnectedAt || null,
      reconnectSummary: Array.isArray(seat.reconnectSummary)
        ? seat.reconnectSummary.slice(-12)
        : [],
      difficulty: seat.difficulty,
      trickPoints: seat.trickPoints,
      hand: isMySeat
        ? seat.hand.map(cloneCard)
        : seat.hand.map(() => ({ cardId: "Card Back", hidden: true })),
      firstHand: isMySeat ? seat.firstHand.map(cloneCard) : [],
      wonCards: isMySeat
        ? seat.wonCards.map((card) =>
            this._projectWonCardForViewer(card, viewerSeatIndex),
          )
        : [],
    };
  }

  getPrompt(viewerSeatIndex = null) {
    const state = this.state;
    const viewer =
      viewerSeatIndex == null ? null : toSeatIndex(viewerSeatIndex);
    switch (state.phase) {
      case PHASE.SETUP:
        return "Create and start a hand.";
      case PHASE.FOUR_BIDDING:
        return `Phase: Four-card bidding. Current bid ${state.bidding.currentBid || 0}.`;
      case PHASE.TRUMP_SELECTION:
        return `Trump maker: ${formatSeat(state.trump.maker, false)}. Select a trump indicator card.`;
      case PHASE.SECOND_BIDDING:
        return `Second bidding. Current bid ${state.bidding.currentBid}.`;
      case PHASE.TRUMP_CHOICE:
        return "Choose trump mode.";
      case PHASE.TRICK_PLAY:
        if (state.currentTrick == null) return "Preparing first trick.";
        if (viewer != null && viewer === state.activeSeat) {
          return state.currentTrick.leaderSeat === state.activeSeat
            ? "Your turn. You lead the trick."
            : "Your turn. Play a legal card.";
        }
        return state.currentTrick.leaderSeat === state.activeSeat
          ? `${formatSeat(state.activeSeat)} leads the trick.`
          : `${formatSeat(state.activeSeat)} to play.`;
      case PHASE.HAND_RESULT:
        return "Hand complete. Continue to next hand.";
      case PHASE.MATCH_COMPLETE:
        return "Match complete.";
      default:
        return "";
    }
  }

  _legalBidValues() {
    const profile = this.state.profile;
    const currentBid = this.state.bidding.currentBid;
    const step =
      this.state.bidding.phase === "four"
        ? profile.fourCardBidStep
        : profile.eightCardBidStep;
    const minRoundBid =
      this.state.bidding.phase === "four"
        ? profile.minFourCardBid
        : profile.minEightCardBid;
    const nextMin =
      currentBid > 0 ? Math.max(currentBid + step, minRoundBid) : minRoundBid;
    return [
      nextMin,
      nextMin + step,
      nextMin + 2 * step,
      nextMin + 3 * step,
      nextMin + 4 * step,
      nextMin + 5 * step,
    ];
  }

  _getLegalBidsForSeat(seatIndex) {
    const values = this._legalBidValues();
    const actedAlready = this.state.bidding.actedInRound[seatIndex] || false;
    const partnerSeat = (seatIndex + 2) % this.state.seatCount;
    const currentHighSeat = this.state.bidding.currentBidSeat;
    const minForRound =
      this.state.bidding.phase === "four"
        ? this.state.profile.minFourCardBid
        : this.state.profile.minEightCardBid;
    const step =
      this.state.bidding.phase === "four"
        ? this.state.profile.fourCardBidStep
        : this.state.profile.eightCardBidStep;
    const legal = [];
    for (const amount of values) {
      if (amount % step !== 0) continue;
      if (amount < minForRound) continue;
      if (amount > this.state.profile.maxBid) continue;
      if (this.state.bidding.phase === "four" && actedAlready && amount < 200)
        continue;
      if (
        this.state.bidding.phase === "four" &&
        this.state.bidding.currentBid > 0 &&
        partnerSeat === currentHighSeat &&
        amount < 200
      )
        continue;
      legal.push(amount);
    }
    return legal.filter((value) => value > this.state.bidding.currentBid);
  }

  getLegalActions(seatIndex) {
    const legal = [];
    const seat = this.state.seats[seatIndex];
    if (!seat) return legal;
    const isActiveSeat = this.state.activeSeat === seatIndex;
    if (
      this.state.phase === PHASE.FOUR_BIDDING ||
      this.state.phase === PHASE.SECOND_BIDDING
    ) {
      if (!isActiveSeat) return [];
      const bids = this._getLegalBidsForSeat(seatIndex);
      for (const amount of bids) {
        legal.push({
          type: "BID",
          amount,
          label: `Bid ${amount}`,
          ariaLabel: `Bid ${amount}`,
        });
      }
      legal.push({ type: "PASS_BID", label: "Pass", ariaLabel: "Pass bid" });
      return legal;
    }
    if (this.state.phase === PHASE.TRUMP_SELECTION) {
      if (!isActiveSeat) return [];
      const trumpCandidateCards =
        this.state.bidding.phase === "four"
          ? this.state.seats[seatIndex].firstHand
          : this.state.seats[seatIndex].hand;
      const used = new Set();
      for (const card of trumpCandidateCards) {
        if (used.has(card.cardId)) continue;
        used.add(card.cardId);
        legal.push({
          type: "SELECT_TRUMP",
          cardId: card.cardId,
          card,
          label: `Trump card: ${formatCard(card)}`,
          ariaLabel: `Choose trump card ${formatCard(card)}`,
        });
      }
      return legal;
    }
    if (this.state.phase === PHASE.TRUMP_CHOICE) {
      if (!isActiveSeat) return [];
      if (this.state.profile.allowOpenTrump)
        legal.push({
          type: "TRUMP_OPEN",
          label: "Open trump",
          ariaLabel: "Open trump",
        });
      if (this.state.profile.allowClosedTrump)
        legal.push({
          type: "TRUMP_CLOSE",
          label: "Closed trump",
          ariaLabel: "Closed trump",
        });
      return legal;
    }
    if (this.state.phase === PHASE.TRICK_PLAY && isActiveSeat) {
      return this._getLegalCardActions(seatIndex);
    }
    if (
      this.state.phase === PHASE.HAND_RESULT ||
      this.state.phase === PHASE.MATCH_COMPLETE
    ) {
      legal.push({
        type: "ACK_RESULT",
        label:
          this.state.phase === PHASE.MATCH_COMPLETE
            ? "Play another match"
            : "Next hand",
        ariaLabel:
          this.state.phase === PHASE.MATCH_COMPLETE
            ? "Play another match"
            : "Continue to next hand",
      });
      return legal;
    }
    return legal;
  }

  _getLegalCardActions(seatIndex) {
    const seat = this.state.seats[seatIndex];
    if (!seat || !this.state.currentTrick) return [];
    const legal = [];
    const isLeader = this.state.currentTrick.plays.length === 0;
    const leadSuit = this.state.currentLedSuit;
    const hand = seat.hand;
    const hasLeadSuit = leadSuit
      ? hand.some((card) => card.suit === leadSuit)
      : false;
    const includeTrumpIndicator =
      this.state.trump.card &&
      this.state.trumpClosed &&
      this.state.trump.maker === seatIndex &&
      !isLeader &&
      !!leadSuit &&
      leadSuit !== this.state.trump.suit &&
      !hand.some((card) => card.suit === leadSuit);

    for (const card of hand) {
      if (isLeader) {
        legal.push({
          type: "PLAY_CARD",
          seatIndex,
          cardId: card.cardId,
          card,
          faceDown: false,
          label: `Play ${formatCard(card)}`,
          ariaLabel: `Play ${formatCard(card)} from hand`,
        });
      } else if (hasLeadSuit && card.suit === leadSuit) {
        legal.push({
          type: "PLAY_CARD",
          seatIndex,
          cardId: card.cardId,
          card,
          faceDown: false,
          label: `Play ${formatCard(card)}`,
          ariaLabel: `Play ${formatCard(card)}`,
        });
      } else if (!hasLeadSuit) {
        if (this.state.trumpClosed) {
          legal.push({
            type: "PLAY_CARD",
            seatIndex,
            cardId: card.cardId,
            card,
            faceDown: false,
            label: `Play ${formatCard(card)}`,
            ariaLabel: `Play ${formatCard(card)}`,
          });
          legal.push({
            type: "PLAY_CARD",
            seatIndex,
            cardId: card.cardId,
            card,
            faceDown: true,
            label: `Play ${formatCard(card)} face down`,
            ariaLabel: `Play ${formatCard(card)} face down`,
          });
        } else {
          legal.push({
            type: "PLAY_CARD",
            seatIndex,
            cardId: card.cardId,
            card,
            faceDown: false,
            label: `Play ${formatCard(card)}`,
            ariaLabel: `Play ${formatCard(card)}`,
          });
        }
      }
    }

    if (includeTrumpIndicator && this.state.phase === PHASE.TRICK_PLAY) {
      legal.push({
        type: "PLAY_CARD",
        seatIndex,
        cardId: "__trump_indicator__",
        card: this.state.trump.card,
        faceDown: true,
        fromIndicator: true,
        label: "Play hidden trump indicator face down",
        ariaLabel: "Play hidden trump indicator face down",
      });
    }

    return legal;
  }

  getBotAction(seatIndex) {
    if (!this.state.seats[seatIndex] || this.state.phase === PHASE.SETUP) {
      return null;
    }
    if (
      this.state.seats[seatIndex].type !== "bot" &&
      !this.state.seats[seatIndex].autopilot
    )
      return null;
    if (
      this.state.phase !== PHASE.HAND_RESULT &&
      this.state.phase !== PHASE.MATCH_COMPLETE &&
      this.state.activeSeat !== seatIndex
    ) {
      return null;
    }
    const stateForBot = cloneStateForBotsOnly(this.state);
    stateForBot.seats = cloneSeatsForBot(this.state, seatIndex);
    const isTrumpMaker = this.state.trump.maker === seatIndex;
    const canSeeTrump = this.state.trump.isOpen || isTrumpMaker;
    if (stateForBot.trump) {
      stateForBot.trump = {
        ...getTrumpPublicView(this.state, seatIndex),
        card:
          canSeeTrump && this.state.trump.card
            ? cloneCard(this.state.trump.card)
            : null,
      };
    }
    if (stateForBot.currentTrick?.plays) {
      stateForBot.currentTrick = {
        ...stateForBot.currentTrick,
        plays: stateForBot.currentTrick.plays.map((play) =>
          play.faceDown && !stateForBot.trump.isOpen
            ? { ...play, card: { cardId: "Card Back", hidden: true } }
            : play,
        ),
      };
    }
    stateForBot.getLegalActions = (index) => this.getLegalActions(index);
    stateForBot.currentLedSuit = this.state.currentLedSuit;
    stateForBot.trumpClosed = this.state.trumpClosed;
    stateForBot.trumpSuit = canSeeTrump ? this.state.trumpSuit : null;
    stateForBot.trumpCard =
      canSeeTrump && this.state.trumpCard
        ? cloneCard(this.state.trumpCard)
        : null;
    stateForBot.leadingSeat = this.state.currentTrick
      ? this.state.currentTrick.leaderSeat
      : null;
    return pickBotAction(stateForBot, seatIndex);
  }

  applyAutomationAction(rawAction, seatIndex) {
    const resolvedSeatIndex = toSeatIndex(seatIndex);
    const isHandResultAcknowledgement =
      (this.state.phase === PHASE.HAND_RESULT ||
        this.state.phase === PHASE.MATCH_COMPLETE) &&
      this.state.activeSeat == null &&
      rawAction?.type === "ACK_RESULT";
    if (
      resolvedSeatIndex == null ||
      (!isHandResultAcknowledgement &&
        resolvedSeatIndex !== this.state.activeSeat)
    ) {
      this.state.error = "Automation action is not for the active seat.";
      return { ok: false, reason: this.state.error };
    }
    const seat = this.state.seats[resolvedSeatIndex];
    if (!seat || (seat.type !== "bot" && !seat.autopilot)) {
      this.state.error = "Automation action is not allowed for this seat.";
      return { ok: false, reason: this.state.error };
    }
    const wasAutopilot = Boolean(seat.autopilot);
    if (wasAutopilot) seat.autopilot = false;
    try {
      return this.applyAction({
        ...rawAction,
        seatIndex: resolvedSeatIndex,
        actorSeatIndex: resolvedSeatIndex,
      });
    } finally {
      if (wasAutopilot) seat.autopilot = true;
    }
  }

  applyAction(rawAction) {
    const action = { ...rawAction };
    const clientKnownVersion =
      action.clientKnownVersion != null
        ? Number(action.clientKnownVersion)
        : action.clientVersion != null
          ? Number(action.clientVersion)
          : null;
    if (
      typeof clientKnownVersion === "number" &&
      Number.isFinite(clientKnownVersion) &&
      clientKnownVersion !== this.state.version
    ) {
      this.state.error = "State version mismatch. Please refresh.";
      return { ok: false, reason: this.state.error };
    }
    if (action.type === "ACK_RESULT") {
      const acknowledgedSeat =
        action.actorSeatIndex != null
          ? toSeatIndex(action.actorSeatIndex)
          : action.seatIndex != null
            ? toSeatIndex(action.seatIndex)
            : null;
      if (
        acknowledgedSeat != null &&
        this.state.seats[acknowledgedSeat]?.autopilot
      ) {
        this.state.error = "Seat is currently under autopilot.";
        return { ok: false, reason: this.state.error };
      }
      this.state.error = null;
      if (this.state.phase === PHASE.MATCH_COMPLETE) {
        this.startMatch();
        return { ok: true };
      }
      if (this.state.phase !== PHASE.HAND_RESULT) {
        this.state.error = "Not valid now.";
        return { ok: false, reason: this.state.error };
      }
      this._startHand();
      return { ok: true };
    }
    const seatIndex =
      action.seatIndex != null
        ? toSeatIndex(action.seatIndex)
        : this.state.activeSeat;
    const actorSeat =
      action.actorSeatIndex != null
        ? toSeatIndex(action.actorSeatIndex)
        : seatIndex;
    if (actorSeat == null) {
      this.state.error = "No actor seat.";
      return { ok: false, reason: this.state.error };
    }
    if (this.state.seats[actorSeat]?.autopilot) {
      this.state.error = "Seat is currently under autopilot.";
      return { ok: false, reason: this.state.error };
    }
    if (seatIndex !== actorSeat) {
      this.state.error = "Action actor does not match seat.";
      return { ok: false, reason: this.state.error };
    }
    this.state.error = null;
    if (seatIndex == null && action.type !== "ACK_RESULT") {
      this.state.error = "No active seat.";
      return { ok: false, reason: this.state.error };
    }
    if (action.type === "BID" || action.type === "PASS_BID") {
      if (!this._isHumanActionAllowed(seatIndex)) {
        this.state.error = "Not your turn.";
        return { ok: false, reason: this.state.error };
      }
      if (action.type === "PASS_BID") {
        return this._handlePass(seatIndex);
      }
      if (!Number.isInteger(action.amount)) {
        this.state.error = "Invalid bid amount.";
        return { ok: false, reason: this.state.error };
      }
      return this._handleBid(seatIndex, action.amount);
    }
    if (action.type === "SELECT_TRUMP") {
      if (
        this.state.activeSeat !== seatIndex ||
        this.state.phase !== PHASE.TRUMP_SELECTION
      ) {
        this.state.error = "Not the trump turn.";
        return { ok: false, reason: this.state.error };
      }
      return this._handleTrumpSelection(seatIndex, action.cardId);
    }
    if (action.type === "TRUMP_OPEN" || action.type === "TRUMP_CLOSE") {
      if (
        this.state.activeSeat !== seatIndex ||
        this.state.phase !== PHASE.TRUMP_CHOICE
      ) {
        this.state.error = "Not trump choice turn.";
        return { ok: false, reason: this.state.error };
      }
      return this._handleTrumpChoice(seatIndex, action.type === "TRUMP_OPEN");
    }
    if (action.type === "PLAY_CARD") {
      if (
        this.state.phase !== PHASE.TRICK_PLAY ||
        this.state.activeSeat !== seatIndex
      ) {
        this.state.error = "Not your play turn.";
        return { ok: false, reason: this.state.error };
      }
      return this._handlePlay(seatIndex, action);
    }
    this.state.error = "Unknown action.";
    return { ok: false, reason: this.state.error };
  }

  _isHumanActionAllowed(seatIndex) {
    if (this.state.activeSeat !== seatIndex) return false;
    if (this.state.seats[seatIndex]?.autopilot) return false;
    return (
      this.state.phase === PHASE.FOUR_BIDDING ||
      this.state.phase === PHASE.SECOND_BIDDING
    );
  }

  _handleBid(seatIndex, amount) {
    const legal = this._getLegalBidsForSeat(seatIndex);
    if (!legal.includes(amount)) {
      this.state.error = "That bid is not legal.";
      return { ok: false, reason: this.state.error };
    }
    this.state.bidding.currentBid = amount;
    this.state.bidding.currentBidSeat = seatIndex;
    this.state.bidding.actions.push({ seatIndex, type: "bid", amount });
    this.state.bidding.actedInRound[seatIndex] = true;
    if (this.state.bidding.phase === "four") {
      this.state.bidding.passesAfterBid = 0;
      this.state.gameMessage = `${formatSeat(seatIndex)} bids ${amount}.`;
      this._appendLog("BID", { seat: seatIndex, amount, phase: "four" });
      this._advanceBidTurn();
      return { ok: true };
    }
    if (this.state.bidding.phase === "second") {
      if (amount > this.state.bidding.secondRound.previousBid) {
        this.state.bidding.secondRound.previousBid = amount;
      }
      this.state.bidding.secondRound.anyBid = true;
      this.state.bidding.secondRound.actionsTaken += 1;
      this.state.gameMessage = `${formatSeat(seatIndex)} bids ${amount} in second round.`;
      this._appendLog("BID", { seat: seatIndex, amount, phase: "second" });
      return this._advanceSecondBiddingTurn();
    }
    return { ok: false, reason: "Invalid bid phase." };
  }

  _handlePass(seatIndex) {
    this.state.bidding.actions.push({ seatIndex, type: "pass" });
    this.state.bidding.actedInRound[seatIndex] = true;
    if (this.state.bidding.phase === "four") {
      if (this.state.bidding.currentBid > 0) {
        this.state.bidding.passesAfterBid += 1;
        this._appendLog("PASS", { seat: seatIndex, phase: "four" });
        if (this.state.bidding.passesAfterBid >= this.state.seatCount - 1) {
          const winnerSeat = this.state.bidding.currentBidSeat;
          const finalBid = this.state.bidding.currentBid;
          this._appendLog("FOUR_BID_END", { winnerSeat, finalBid });
          this.state.trump.maker = winnerSeat;
          this.state.bidding.initialMakerSeat = winnerSeat;
          this.state.phase = PHASE.TRUMP_SELECTION;
          this.state.activeSeat = winnerSeat;
          this.state.gameMessage = `Four-card bidding done. Winner is ${formatSeat(winnerSeat, false)}. Select trump indicator.`;
          return { ok: true };
        }
      } else {
        this.state.bidding.noBidPasses += 1;
        this._appendLog("PASS", { seat: seatIndex, phase: "four_no_bid" });
        if (this.state.bidding.noBidPasses >= this.state.seatCount) {
          this._finishCancelledHand();
          return { ok: true };
        }
      }
      this._appendLog("PASS", { seat: seatIndex, phase: "four" });
      return this._advanceBidTurn();
    }
    if (this.state.bidding.phase === "second") {
      this.state.bidding.secondRound.actionsTaken += 1;
      this._appendLog("PASS", { seat: seatIndex, phase: "second" });
      return this._advanceSecondBiddingTurn();
    }
    this.state.error = "Cannot pass now.";
    return { ok: false, reason: this.state.error };
  }

  _advanceBidTurn() {
    const order = this.state.bidding.order;
    this.state.bidding.activeOrderIndex =
      (this.state.bidding.activeOrderIndex + 1) % order.length;
    this.state.activeSeat = order[this.state.bidding.activeOrderIndex];
    return { ok: true };
  }

  _finishCancelledHand() {
    this.state.phase = PHASE.HAND_RESULT;
    this.state.handResult = {
      noScore: true,
      handNumber: this.state.handNumber,
      reason: "All players passed. No score movement this hand.",
      tokens: [...this.state.tokens],
    };
    this.state.gameMessage = this.state.handResult.reason;
    this._appendLog("HAND_CANCELLED", { handNumber: this.state.handNumber });
  }

  _handleTrumpSelection(seatIndex, cardId) {
    const seat = this.state.seats[seatIndex];
    const source = this.state.bidding.phase === "four" ? "first" : "second";
    const allowedCards = source === "first" ? seat.firstHand : seat.hand;
    const chosen = allowedCards.find((card) => card.cardId === cardId);
    if (!chosen) {
      this.state.error = "Indicator card is not eligible.";
      return { ok: false, reason: this.state.error };
    }
    const idx = seat.hand.findIndex((card) => card.cardId === cardId);
    if (idx >= 0) {
      seat.hand.splice(idx, 1);
    }
    this.state.trump = {
      ...this.state.trump,
      maker: seatIndex,
      card: cloneCard(chosen),
      suit: chosen.suit,
      isOpen: false,
      indicatorVisible: false,
    };
    this.state.trumpSuit = chosen.suit;
    this.state.trumpCard = this.state.trump.card;
    this.state.gameMessage = `${formatSeat(seatIndex)} selected indicator ${formatCard(chosen)}.`;
    this._appendLog("TRUMP_SELECTED", { seat: seatIndex, cardId, source });

    if (source === "first") {
      this._dealCards(this.state.profile.cardBatch[1], false);
      if (this.state.bidding.secondRound.enabled) {
        const highBid = this.state.bidding.currentBid;
        const maker = this.state.trump.maker;
        const currentBidSeat = this.state.bidding.currentBidSeat;
        this._startSecondBidding(maker, highBid, currentBidSeat);
        return { ok: true };
      }
      this._startTrumpChoice();
      return { ok: true };
    }

    this._startTrumpChoice();
    return { ok: true };
  }

  _returnIndicatorToMaker() {
    const maker = this.state.trump.maker;
    if (maker == null || !this.state.trump.card) return;
    this.state.seats[maker].hand.push(this.state.trump.card);
    this.state.trump = {
      maker,
      suit: null,
      card: null,
      isOpen: false,
      indicatorVisible: false,
    };
    this.state.trumpSuit = null;
    this.state.trumpCard = null;
  }

  _releaseOpenTrumpIndicator() {
    const maker = this.state.trump.maker;
    const indicator = this.state.trump.card;
    const makerSeat = maker == null ? null : this.state.seats[maker];
    if (!indicator || !makerSeat) return;
    if (!makerSeat.hand.some((card) => card.cardId === indicator.cardId)) {
      makerSeat.hand.push(indicator);
    }
    this.state.trump = {
      ...this.state.trump,
      card: null,
      indicatorVisible: true,
    };
    this.state.trumpCard = null;
  }

  _advanceSecondBiddingTurn() {
    const order = this.state.bidding.secondRound.order;
    this.state.bidding.secondRound.activeOrderIndex += 1;
    if (this.state.bidding.secondRound.activeOrderIndex >= order.length) {
      const hadSecondBid = this.state.bidding.secondRound.anyBid;
      const winningSeat = this.state.bidding.currentBidSeat;
      const originalMaker = this.state.trump.maker;
      if (hadSecondBid) {
        this.state.bidding.phase = "second";
        const secondRoundWonByDifferentMaker = winningSeat !== originalMaker;
        if (secondRoundWonByDifferentMaker) {
          this._returnIndicatorToMaker();
          this.state.trump.maker = winningSeat;
          this.state.phase = PHASE.TRUMP_SELECTION;
          this.state.activeSeat = winningSeat;
          this.state.gameMessage = `${formatSeat(winningSeat)} won second bidding. Re-select indicator from full hand.`;
          return { ok: true };
        }
      }
      this.state.phase = PHASE.TRUMP_CHOICE;
      this.state.trump.maker = winningSeat;
      this._startTrumpChoice();
      return { ok: true };
    }
    this.state.activeSeat =
      order[this.state.bidding.secondRound.activeOrderIndex];
    return { ok: true };
  }

  _handleTrumpChoice(seatIndex, open) {
    if (seatIndex !== this.state.trump.maker) {
      this.state.error = "Only trump maker can choose trump mode.";
      return { ok: false, reason: this.state.error };
    }
    if (open) {
      this.state.trump.isOpen = true;
      this.state.trumpClosed = false;
      this.state.trump.indicatorVisible = true;
      this._releaseOpenTrumpIndicator();
      this.state.trumpSuit = this.state.trump.suit;
      this.state.gameMessage = `Trump is open: ${this.state.trump.suit}.`;
      this._appendLog("TRUMP_OPEN", { seat: seatIndex });
    } else {
      this.state.trump.isOpen = false;
      this.state.trumpClosed = true;
      this.state.gameMessage = "Trump is closed.";
      this._appendLog("TRUMP_CLOSE", { seat: seatIndex });
    }
    this.state.activeSeat = null;
    this._startTrickPhase();
    return { ok: true };
  }

  _getLegalTurnSeat() {
    const turnAfter =
      this.state.currentTrick.plays.length === 0
        ? this.state.currentTrick.leaderSeat
        : nextSeat(
            this.state.seatCount,
            this.state.currentTrick.plays[
              this.state.currentTrick.plays.length - 1
            ].seatIndex,
          );
    return turnAfter;
  }

  _handlePlay(seatIndex, action) {
    if (this.state.activeSeat !== seatIndex) {
      this.state.error = "Wrong turn.";
      return { ok: false, reason: this.state.error };
    }
    const legal = this._getLegalCardActions(seatIndex).some((candidate) => {
      if (candidate.type !== "PLAY_CARD") return false;
      if (candidate.cardId !== action.cardId) return false;
      if (candidate.faceDown !== !!action.faceDown) return false;
      if (!!candidate.fromIndicator !== !!action.fromIndicator) return false;
      return true;
    });
    if (!legal) {
      this.state.error = "Illegal card play.";
      return { ok: false, reason: this.state.error };
    }

    const seat = this.state.seats[seatIndex];
    let card;
    let source = "hand";
    if (action.fromIndicator) {
      card = this.state.trump.card;
      source = "indicator";
      this.state.trump.card = null;
      this.state.trump.indicatorVisible = false;
      this.state.trumpSuit = this.state.trump.suit;
    } else {
      const idx = seat.hand.findIndex((c) => c.cardId === action.cardId);
      if (idx < 0) {
        this.state.error = "Card not in hand.";
        return { ok: false, reason: this.state.error };
      }
      card = seat.hand.splice(idx, 1)[0];
    }
    const faceDown = !!action.faceDown;
    if (!this.state.currentTrick) {
      this.state.currentTrick = {
        trickIndex: this.state.completedTricks.length,
        leaderSeat: seatIndex,
        plays: [],
      };
      this.state.currentLedSuit = null;
    }
    if (this.state.currentTrick.plays.length === 0) {
      this.state.currentLedSuit = card.suit;
    }
    const play = {
      seatIndex,
      card,
      source,
      faceDown,
      fromIndicator: action.fromIndicator || false,
      when: new Date().toISOString(),
    };
    this.state.currentTrick.plays.push(play);
    this.state.currentTrick.points =
      (this.state.currentTrick.points || 0) + (card.points || 0);
    this._appendLog("PLAY", {
      seat: seatIndex,
      cardId: card.cardId,
      faceDown,
      source,
    });
    if (this.state.currentTrick.plays.length >= this.state.seatCount) {
      this._resolveTrick();
      return { ok: true };
    }
    this.state.activeSeat = this._getLegalTurnSeat();
    this.state.gameMessage = `${formatSeat(this.state.activeSeat)} to play.`;
    return { ok: true };
  }

  currentTrickLeads() {
    return this.state.currentTrick
      ? {
          seatIndex: this.state.currentTrick.leaderSeat,
          card: this.state.currentTrick.plays[0]?.card,
        }
      : null;
  }

  _nextTrickSeat(playsPlayed) {
    if (!this.state.currentTrick) return null;
    let leader = this.state.currentTrick.plays[0]?.seatIndex;
    if (leader == null) {
      leader = this.state.currentTrick.leaderSeat;
    }
    return (leader + playsPlayed + 1) % this.state.seatCount;
  }

  _resolveTrick() {
    const trick = this.state.currentTrick;
    const first = trick.plays[0];
    const ledSuit = first.card.suit;
    let shouldOpen = false;
    if (!this.state.trump.isOpen) {
      const hiddenTrumpPlayed = trick.plays.some(
        (play) => play.faceDown && play.card.suit === this.state.trump.suit,
      );
      if (hiddenTrumpPlayed) {
        shouldOpen = true;
      }
      if (
        !shouldOpen &&
        this.state.profile.revealTrumpAfterFirstTrickAtBidAtLeast &&
        this.state.bidding.currentBid >=
          this.state.profile.revealTrumpAfterFirstTrickAtBidAtLeast &&
        this.state.completedTricks.length === 0
      ) {
        shouldOpen = true;
      }
    }
    if (shouldOpen) {
      this._releaseOpenTrumpIndicator();
      this.state.trump.isOpen = true;
      this.state.trumpClosed = false;
      this.state.gameMessage = `Trump ${this.state.trump.suit} opened.`;
      this._appendLog("TRUMP_OPEN_BY_RULE", {
        reason: "cut_or_high_bid",
        suit: this.state.trump.suit,
      });
    }
    const winner = this._resolveTrickWinner(
      trick.plays,
      ledSuit,
      this.state.trump.isOpen,
    );
    trick.winnerSeat = winner.seatIndex;
    trick.leadSuit = ledSuit;
    trick.openedTrumpThisTrick = shouldOpen;
    trick.pointValue = trick.plays.reduce(
      (sum, item) => sum + (item.card.points || 0),
      0,
    );
    for (const play of trick.plays) {
      this.state.seats[winner.seatIndex].wonCards.push(play.card);
    }
    this.state.seats[winner.seatIndex].trickPoints += trick.pointValue;
    this.state.completedTricks.push(trick);
    const expectedLeader = winner.seatIndex;
    this._appendLog("TRICK_END", {
      winner: winner.seatIndex,
      points: trick.pointValue,
      openTrump: shouldOpen,
    });
    if (
      this.state.seats.every((seat) => seat.hand.length === 0) ||
      this.state.completedTricks.length >=
        this.state.profile.cardBatch[0] + this.state.profile.cardBatch[1]
    ) {
      this._finishHand();
      return;
    }
    this.state.currentTrick = {
      trickIndex: this.state.completedTricks.length,
      leaderSeat: expectedLeader,
      plays: [],
      points: 0,
    };
    this.state.currentLedSuit = null;
    this.state.activeSeat = expectedLeader;
    this.state.gameMessage = `Trick ${trick.trickIndex + 1} done. Next trick led by ${formatSeat(expectedLeader, false)}.`;
  }

  _resolveTrickWinner(plays, ledSuit, trumpOpen) {
    let winner = plays[0];
    for (const play of plays) {
      if (play.seatIndex === winner.seatIndex) {
        continue;
      }
      const a = play.card;
      const b = winner.card;
      if (
        compareCardsForTrick(
          this.state.profile,
          a,
          b,
          this.state.trump.suit,
          ledSuit,
          trumpOpen,
        ) > 0
      ) {
        winner = play;
      }
    }
    return winner;
  }

  _finishHand() {
    const teamPoints = { A: 0, B: 0 };
    for (const seat of this.state.seats) {
      for (const card of seat.wonCards) {
        teamPoints[seat.team] += card.points || 0;
      }
    }
    const trumpMakerTeam =
      this.state.seats[this.state.trump.maker]?.team || "A";
    const bidderPoints = teamPoints[trumpMakerTeam];
    const required = this.state.bidding.currentBid;
    const success = bidderPoints >= required && required > 0;
    const tier =
      this.state.profile.tokenProfile.find(
        (entry) => !entry.maxBidExclusive || required < entry.maxBidExclusive,
      ) || this.state.profile.tokenProfile[0];
    const bidderIndex = trumpMakerTeam === "A" ? 0 : 1;
    const oppIndex = 1 - bidderIndex;
    const movement = success ? tier.successTokens : tier.failureTokens;
    if (success) {
      this.state.tokens[bidderIndex] += movement;
      this.state.tokens[oppIndex] -= movement;
    } else {
      this.state.tokens[bidderIndex] -= movement;
      this.state.tokens[oppIndex] += movement;
    }
    this.state.tokens = this.state.tokens.map((value) => Math.max(0, value));
    const matchComplete = this.state.tokens.includes(0);
    this.state.handResult = {
      handNumber: this.state.handNumber,
      bidderTeam: trumpMakerTeam,
      bid: required,
      bidderTeamPoints: bidderPoints,
      otherTeamPoints: teamPoints[trumpMakerTeam === "A" ? "B" : "A"],
      success,
      movement,
      matchComplete,
      winningTeam: success
        ? trumpMakerTeam
        : trumpMakerTeam === "A"
          ? "B"
          : "A",
      tokens: [...this.state.tokens],
      firstSeatCards: this.state.seats.map((seat) => ({
        seat: seat.index,
        won: seat.wonCards.length,
      })),
      trickCount: this.state.completedTricks.length,
      shuffleSeed: this.state.handShuffle.seed,
      seedCommit: this.state.handShuffle.seedCommit,
      deckVersion: this.state.handShuffle.deckVersion,
    };
    this.state.phase = matchComplete ? PHASE.MATCH_COMPLETE : PHASE.HAND_RESULT;
    this.state.activeSeat = null;
    this.state.gameMessage = matchComplete
      ? "Match complete."
      : "Hand complete. Acknowledge to continue.";
    this._appendLog("HAND_COMPLETE", {
      handNumber: this.state.handNumber,
      bid: required,
      success,
      bidderTeam: trumpMakerTeam,
      tokens: [...this.state.tokens],
    });
  }

  isComplete() {
    return this.state.phase === PHASE.MATCH_COMPLETE;
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  static hydrate(snapshot) {
    const engine = Object.create(GameEngine.prototype);
    if (!snapshot || typeof snapshot !== "object") {
      throw new TypeError("Invalid engine snapshot.");
    }
    const hasSeatDisplayVersion = Object.hasOwn(snapshot, "seatDisplayVersion");
    if (hasSeatDisplayVersion) {
      if (snapshot.seatDisplayVersion !== SEAT_DISPLAY_VERSION) {
        throw new Error(
          `Unsupported seat display version: ${String(snapshot.seatDisplayVersion)}.`,
        );
      }
      engine.state = snapshot;
      return engine;
    }
    engine.state = {
      ...snapshot,
      seatDisplayVersion: SEAT_DISPLAY_VERSION,
      seats: Array.isArray(snapshot?.seats)
        ? snapshot.seats.map((seat) => ({
            ...seat,
            seatLabel: formatSeat(seat?.index),
          }))
        : [],
      gameMessage: migrateZeroBasedSeatCopy(snapshot?.gameMessage),
    };
    return engine;
  }

  _projectTrickForPublic(trick) {
    if (!trick) {
      return { current: null };
    }
    const projectPlay = (play) => {
      const cardVisible = this._isPlayPubliclyVisible(play);
      return {
        seatIndex: play.seatIndex,
        source: play.source,
        faceDown: play.faceDown,
        fromIndicator: play.fromIndicator,
        when: play.when,
        card: cardVisible
          ? cloneCard(play.card)
          : { cardId: "Card Back", hidden: true },
        cardId: cardVisible ? play.card?.cardId : "Card Back",
      };
    };
    return {
      current: {
        ...trick,
        plays: trick.plays.map(projectPlay),
      },
    };
  }
}
