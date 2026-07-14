import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeck, GameEngine, getProfile } from "../src/index.js";

const fixtureUrl = new URL(
  "./fixtures/gameplay-compatibility.json",
  import.meta.url,
);

function card(suit, rank, points) {
  return {
    cardId: `${suit[0].toUpperCase()}_${rank}`,
    points,
    rank,
    suit,
  };
}

function normalizeActions(actions) {
  return actions.map((action) => ({
    cardId: action.cardId,
    faceDown: action.faceDown,
    fromIndicator: Boolean(action.fromIndicator),
    type: action.type,
  }));
}

function characterize(profileId) {
  const profile = getProfile(profileId);
  const engine = new GameEngine({
    humanCount: profile.seatCount,
    ruleProfile: profileId,
    tableMode: profile.seatCount === 6 ? "six_6" : "classic_4",
  });
  const leadCard = card("clubs", "J", 30);
  const matchingCard = card("clubs", "9", 20);
  const offSuitCard = card("hearts", "A", 11);
  const indicator = card("spades", "9", 20);

  engine.state.phase = "trick_play";
  engine.state.activeSeat = 1;
  engine.state.currentLedSuit = "clubs";
  engine.state.currentTrick = {
    leaderSeat: 0,
    plays: [
      {
        card: leadCard,
        faceDown: false,
        fromIndicator: false,
        seatIndex: 0,
      },
    ],
    points: 30,
    trickIndex: 0,
  };
  engine.state.seats.forEach((seat) => {
    seat.hand = [];
    seat.firstHand = [];
    seat.wonCards = [];
    seat.trickPoints = 0;
  });
  engine.state.seats[0].hand = [card("diamonds", "7", 0)];
  engine.state.seats[1].hand = [matchingCard, offSuitCard];
  engine.state.trump = {
    card: indicator,
    indicatorVisible: false,
    isOpen: false,
    maker: 0,
    suit: "spades",
  };
  engine.state.trumpCard = indicator;
  engine.state.trumpClosed = true;
  engine.state.trumpSuit = "spades";

  const deck = buildDeck(profile);
  const opponentView = engine.getPublicState(1);
  const privateView = engine.getSeatView(1);
  const snapshot = engine.getSnapshot();
  const hydrated = GameEngine.hydrate(snapshot);

  return {
    deck: {
      cardCount: deck.length,
      points: deck.reduce((total, current) => total + current.points, 0),
      ranks: profile.deckRanks,
    },
    profile: {
      cardBatch: profile.cardBatch,
      id: profile.id,
      seatCount: profile.seatCount,
      teams: engine.state.seats.map((seat) => seat.team),
      tokens: engine.state.tokens,
    },
    projection: {
      activeSeat: opponentView.activeSeat,
      legalActions: normalizeActions(engine.getLegalActions(1)),
      opponentHand: privateView.hand.map((current) => current.cardId),
      opponentTrump: opponentView.trump,
      publicHandSizes: opponentView.seats.map((seat) => seat.handSize),
      publicTrickCard: opponentView.trick.plays[0].card.cardId,
      trumpMakerSuit: engine.getPublicState(0).trump.suit,
      viewerlessHasSeatIdentity: engine
        .getPublicState()
        .seats.some((seat) => seat.isMe),
      viewerlessTrumpSuit: engine.getPublicState().trump.suit,
    },
    roundTrip: {
      legalActions: normalizeActions(hydrated.getLegalActions(1)),
      opponentHand: hydrated
        .getSeatView(1)
        .hand.map((current) => current.cardId),
      opponentTrump: hydrated.getPublicState(1).trump,
    },
  };
}

test("matches the stable gameplay compatibility fixtures", async () => {
  const expected = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const actual = Object.fromEntries(
    ["classic_304_4p", "six_304_36"].map((profileId) => [
      profileId,
      characterize(profileId),
    ]),
  );

  assert.deepEqual(actual, expected);
});
