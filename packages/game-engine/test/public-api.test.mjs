import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeck,
  GAME_PROFILES,
  GameEngine,
  generateShuffleSeed,
  getProfile,
  makeShuffleCommit,
  shuffleDeck,
} from "../src/index.js";

test("exports the established 304 engine through one package boundary", () => {
  assert.equal(getProfile("classic_304_4p").seatCount, 4);
  assert.equal(GAME_PROFILES.six_304_36.seatCount, 6);

  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  assert.equal(engine.getSnapshot().phase, "four_bidding");
  assert.equal(engine.getSnapshot().seats[0].hand.length, 4);
});

test("shuffle seeds retain entropy beyond a 32-bit state", () => {
  const deck = buildDeck(getProfile("classic_304_4p"));
  const first = shuffleDeck(deck, { seed: 1 }).map((card) => card.cardId);
  const second = shuffleDeck(deck, { seed: 4_294_967_297 }).map(
    (card) => card.cardId,
  );

  assert.notDeepEqual(first, second);
  assert.match(generateShuffleSeed(), /^s_[0-9a-f]{64}$/);
  assert.match(
    makeShuffleCommit("seed-for-commit", "classic_304_4p", 1),
    /^c_[0-9a-f]{64}$/,
  );
});

test("keeps seat indexes zero-based while displaying one-based seat numbers", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });

  const publicSeats = engine.getPublicState(0).seats;
  assert.deepEqual(
    publicSeats.map(({ index }) => index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    publicSeats.map(({ seatLabel }) => seatLabel),
    ["Seat 1", "Seat 2", "Seat 3", "Seat 4"],
  );

  engine.state.phase = "trump_selection";
  engine.state.trump.maker = 0;
  assert.equal(
    engine.getPrompt(),
    "Trump maker: seat 1. Select a trump indicator card.",
  );

  engine.state.trump.maker = null;
  assert.equal(
    engine.getPrompt(),
    "Trump maker: unknown seat. Select a trump indicator card.",
  );

  engine.state.phase = "trick_play";
  engine.state.activeSeat = 0;
  engine.state.currentTrick = {
    leaderSeat: 1,
    plays: [{ seatIndex: 1 }, { seatIndex: 2 }, { seatIndex: 3 }],
    trickIndex: 0,
  };
  assert.equal(engine.getPrompt(), "Seat 1 to play.");

  const sixSeatEngine = new GameEngine({
    humanCount: 6,
    ruleProfile: "six_304_36",
  });
  assert.deepEqual(
    sixSeatEngine.getPublicState(0).seats.map(({ seatLabel }) => seatLabel),
    ["Seat 1", "Seat 2", "Seat 3", "Seat 4", "Seat 5", "Seat 6"],
  );
});

test("personalizes trick prompts only for the active viewer", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.state.phase = "trick_play";
  engine.state.activeSeat = 0;
  engine.state.currentTrick = { leaderSeat: 0, plays: [], trickIndex: 0 };

  assert.equal(engine.getPrompt(0), "Your turn. You lead the trick.");
  assert.equal(engine.getPrompt(1), "Seat 1 leads the trick.");
  assert.equal(engine.getPrompt(), "Seat 1 leads the trick.");

  engine.state.activeSeat = 1;
  engine.state.currentTrick.plays.push({ seatIndex: 0 });
  assert.equal(engine.getPrompt(1), "Your turn. Play a legal card.");
  assert.equal(engine.getPrompt(0), "Seat 2 to play.");
});

test("viewerless public state does not impersonate seat zero or reveal closed trump", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.state.trump = {
    card: { cardId: "hearts-J", points: 30, rank: "J", suit: "hearts" },
    indicatorVisible: false,
    isOpen: false,
    maker: 0,
    suit: "hearts",
  };

  for (const viewerless of [
    engine.getPublicState(),
    engine.getPublicState(null),
  ]) {
    assert.equal(
      viewerless.seats.some((seat) => seat.isMe),
      false,
    );
    assert.deepEqual(viewerless.trump, {
      indicatorVisible: false,
      isOpen: false,
      maker: 0,
      suit: null,
    });
  }

  const makerView = engine.getPublicState(0);
  assert.equal(makerView.seats[0].isMe, true);
  assert.equal(makerView.trump.suit, "hearts");
  assert.equal(engine.getPublicState(1).trump.suit, null);
});

test("a non-maker bot choice cannot depend on hidden trump identity", () => {
  function probe(hiddenTrumpSuit) {
    const engine = new GameEngine({
      botDifficulty: "strong",
      humanCount: 1,
      ruleProfile: "classic_304_4p",
    });
    const heartsJack = {
      cardId: "hearts-J",
      points: 30,
      rank: "J",
      suit: "hearts",
    };
    const spadesSeven = {
      cardId: "spades-7",
      points: 0,
      rank: "7",
      suit: "spades",
    };
    const indicator = {
      cardId: `${hiddenTrumpSuit}-9`,
      points: 20,
      rank: "9",
      suit: hiddenTrumpSuit,
    };
    engine.state.phase = "trick_play";
    engine.state.activeSeat = 1;
    engine.state.seats[1].difficulty = "strong";
    engine.state.seats[1].hand = [heartsJack, spadesSeven];
    engine.state.currentLedSuit = "clubs";
    engine.state.currentTrick = {
      leaderSeat: 0,
      plays: [
        {
          card: {
            cardId: "clubs-8",
            points: 0,
            rank: "8",
            suit: "clubs",
          },
          faceDown: false,
          fromIndicator: false,
          seatIndex: 0,
        },
      ],
      trickIndex: 0,
    };
    engine.state.trump = {
      card: indicator,
      indicatorVisible: false,
      isOpen: false,
      maker: 0,
      suit: hiddenTrumpSuit,
    };
    engine.state.trumpCard = indicator;
    engine.state.trumpClosed = true;
    engine.state.trumpSuit = hiddenTrumpSuit;

    return {
      action: engine.getBotAction(1),
      legalActions: engine.getLegalActions(1).map((action) => ({
        cardId: action.cardId,
        faceDown: action.faceDown,
        fromIndicator: Boolean(action.fromIndicator),
        type: action.type,
      })),
      publicTrump: engine.getPublicState(1).trump,
    };
  }

  const hearts = probe("hearts");
  const diamonds = probe("diamonds");
  assert.deepEqual(hearts.publicTrump, diamonds.publicTrump);
  assert.equal(hearts.publicTrump.suit, null);
  assert.deepEqual(hearts.legalActions, diamonds.legalActions);
  assert.deepEqual(hearts.action, diamonds.action);
});

test("a closed-trump maker can lead the final trick with only the indicator", () => {
  const engine = new GameEngine({
    botDifficulty: "strong",
    humanCount: 1,
    ruleProfile: "classic_304_4p",
  });
  const indicator = {
    cardId: "diamonds-J",
    points: 30,
    rank: "J",
    suit: "diamonds",
  };
  engine.state.phase = "trick_play";
  engine.state.activeSeat = 3;
  engine.state.completedTricks = Array.from({ length: 7 }, (_, trickIndex) => ({
    leaderSeat: 0,
    plays: [],
    trickIndex,
    winnerSeat: 0,
  }));
  engine.state.currentLedSuit = null;
  engine.state.currentTrick = {
    leaderSeat: 3,
    plays: [],
    points: 0,
    trickIndex: 7,
  };
  engine.state.seats[3].hand = [];
  engine.state.trump = {
    card: indicator,
    indicatorVisible: false,
    isOpen: false,
    maker: 3,
    suit: "diamonds",
  };
  engine.state.trumpCard = indicator;
  engine.state.trumpClosed = true;
  engine.state.trumpSuit = "diamonds";

  const action = engine.getBotAction(3);
  assert.deepEqual(action, {
    type: "PLAY_CARD",
    seatIndex: 3,
    cardId: "__trump_indicator__",
    card: indicator,
    faceDown: true,
    fromIndicator: true,
    label: "Play hidden trump indicator face down",
    ariaLabel: "Play hidden trump indicator face down",
  });

  assert.deepEqual(engine.applyAutomationAction(action, 3), { ok: true });
  assert.equal(
    engine.state.currentTrick.plays[0].card.cardId,
    indicator.cardId,
  );
  assert.equal(engine.state.currentTrick.plays[0].fromIndicator, true);
  assert.equal(engine.state.trump.card, null);
  assert.equal(engine.state.activeSeat, 0);
});

function engineAwaitingCompletedTrick({ final = false } = {}) {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  const cards = [
    { cardId: "clubs-J", points: 30, rank: "J", suit: "clubs" },
    { cardId: "clubs-9", points: 20, rank: "9", suit: "clubs" },
    { cardId: "clubs-7", points: 0, rank: "7", suit: "clubs" },
    { cardId: "clubs-Q", points: 2, rank: "Q", suit: "clubs" },
  ];
  engine.state.phase = "trick_play";
  engine.state.activeSeat = 3;
  engine.state.currentLedSuit = "clubs";
  engine.state.completedTricks = final
    ? Array.from({ length: 7 }, (_, trickIndex) => ({
        leaderSeat: 0,
        plays: [],
        pointValue: 0,
        trickIndex,
        winnerSeat: 0,
      }))
    : [];
  engine.state.currentTrick = {
    leaderSeat: 0,
    plays: cards.slice(0, 3).map((card, seatIndex) => ({
      card,
      faceDown: false,
      fromIndicator: false,
      seatIndex,
      source: "hand",
    })),
    points: 50,
    trickIndex: final ? 7 : 0,
  };
  engine.state.seats.forEach((seat, seatIndex) => {
    seat.hand =
      seatIndex === 3
        ? [cards[3]]
        : final
          ? []
          : [
              {
                cardId: `spades-${seatIndex + 6}`,
                points: 0,
                rank: String(seatIndex + 6),
                suit: "spades",
              },
            ];
    seat.wonCards = [];
    seat.trickPoints = 0;
  });
  engine.state.trump = {
    card: null,
    indicatorVisible: true,
    isOpen: true,
    maker: 0,
    suit: "hearts",
  };
  engine.state.trumpClosed = false;
  engine.state.trumpSuit = "hearts";
  engine.state.bidding.currentBid = 160;
  engine.state.bidding.currentBidSeat = 0;
  return { card: cards[3], engine };
}

test("a completed trick pauses with every played card before the next trick", () => {
  const { card, engine } = engineAwaitingCompletedTrick();

  assert.deepEqual(
    engine.applyAction({
      actorSeatIndex: 3,
      cardId: card.cardId,
      faceDown: false,
      fromIndicator: false,
      seatIndex: 3,
      type: "PLAY_CARD",
    }),
    { ok: true },
  );

  assert.equal(engine.state.phase, "trick_result");
  assert.equal(engine.state.activeSeat, null);
  assert.equal(engine.state.currentTrick.plays.length, 4);
  assert.equal(engine.state.currentTrick.winnerSeat, 0);
  assert.deepEqual(engine.getLegalActions(0), []);
  assert.match(engine.getPrompt(0), /Seat 1 wins the trick/i);

  assert.deepEqual(engine.advanceTrick(), { ok: true });
  assert.equal(engine.state.phase, "trick_play");
  assert.equal(engine.state.currentTrick.plays.length, 0);
  assert.equal(engine.state.currentTrick.leaderSeat, 0);
  assert.equal(engine.state.activeSeat, 0);
});

test("the final completed trick pauses before hand scoring", () => {
  const { card, engine } = engineAwaitingCompletedTrick({ final: true });

  assert.deepEqual(
    engine.applyAction({
      actorSeatIndex: 3,
      cardId: card.cardId,
      faceDown: false,
      fromIndicator: false,
      seatIndex: 3,
      type: "PLAY_CARD",
    }),
    { ok: true },
  );

  assert.equal(engine.state.phase, "trick_result");
  assert.equal(engine.state.currentTrick.plays.length, 4);
  assert.equal(engine.state.handResult, null);

  assert.deepEqual(engine.advanceTrick(), { ok: true });
  assert.ok(["hand_result", "match_complete"].includes(engine.state.phase));
  assert.equal(engine.state.handResult.trickCount, 8);
  const result = engine.state.handResult;
  assert.equal(engine.advanceTrick().ok, false);
  assert.equal(engine.state.handResult, result);
});

function faceDownPrivacyEngine() {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  const clubsJack = {
    cardId: "clubs-J",
    points: 30,
    rank: "J",
    suit: "clubs",
  };
  const spadesSeven = {
    cardId: "spades-7",
    points: 0,
    rank: "7",
    suit: "spades",
  };
  engine.state.phase = "trick_play";
  engine.state.trump = {
    card: null,
    indicatorVisible: true,
    isOpen: false,
    maker: 2,
    suit: "hearts",
  };
  engine.state.trumpCard = null;
  engine.state.trumpClosed = true;
  engine.state.trumpSuit = "hearts";
  engine.state.completedTricks = [
    {
      leaderSeat: 0,
      plays: [
        {
          card: clubsJack,
          faceDown: false,
          fromIndicator: false,
          seatIndex: 0,
        },
        {
          card: spadesSeven,
          faceDown: true,
          fromIndicator: false,
          seatIndex: 1,
        },
      ],
      trickIndex: 0,
      winnerSeat: 0,
    },
  ];
  engine.state.seats[0].wonCards = [clubsJack, spadesSeven];
  return { engine, spadesSeven };
}

test("captured face-down cards stay hidden from the winner's seat view", () => {
  const { engine, spadesSeven } = faceDownPrivacyEngine();
  const seatView = engine.getSeatView(0);

  assert.ok(seatView);
  assert.equal(JSON.stringify(seatView).includes(spadesSeven.cardId), false);
  assert.deepEqual(seatView.wonCards[1], {
    cardId: "Card Back",
    hidden: true,
  });
});

test("opening trump does not reveal an earlier face-down non-trump card", () => {
  const { engine, spadesSeven } = faceDownPrivacyEngine();
  const heartsNine = {
    cardId: "hearts-9",
    points: 20,
    rank: "9",
    suit: "hearts",
  };
  engine.state.completedTricks.push({
    leaderSeat: 2,
    plays: [
      {
        card: heartsNine,
        faceDown: true,
        fromIndicator: false,
        seatIndex: 2,
      },
    ],
    trickIndex: 1,
    winnerSeat: 2,
  });
  engine.state.seats[2].wonCards = [heartsNine];
  engine.state.trump.isOpen = true;
  engine.state.trumpClosed = false;

  const publicState = engine.getPublicState(0);
  assert.equal(JSON.stringify(publicState).includes(spadesSeven.cardId), false);
  assert.deepEqual(publicState.completedTricks[0].plays[1].card, {
    cardId: "Card Back",
    hidden: true,
  });
  assert.equal(
    publicState.completedTricks[1].plays[0].card.cardId,
    heartsNine.cardId,
  );
  assert.equal(
    JSON.stringify(engine.getSeatView(0)).includes(spadesSeven.cardId),
    false,
  );
});

test("concealed face-down cards and points stay hidden through results", () => {
  const { engine } = faceDownPrivacyEngine();
  const hiddenNine = {
    cardId: "spades-9",
    points: 20,
    rank: "9",
    suit: "spades",
  };
  const trick = engine.state.completedTricks[0];
  trick.plays[1].card = hiddenNine;
  trick.points = 50;
  trick.pointValue = 50;
  engine.state.seats[0].wonCards = [trick.plays[0].card, hiddenNine];
  engine.state.seats[0].trickPoints = 50;

  const publicState = engine.getPublicState(0);
  assert.equal(publicState.trickPointsPartial, true);
  assert.equal(publicState.completedTricks[0].points, null);
  assert.equal(publicState.completedTricks[0].pointValue, null);
  assert.equal(publicState.seats[0].trickPoints, 0);
  assert.equal(engine.getSeatView(0).trickPoints, 0);

  engine.state.phase = "hand_result";
  const handResult = engine.getPublicState(0);
  assert.equal(handResult.trickPointsPartial, true);
  assert.equal(handResult.completedTricks[0].points, null);
  assert.equal(handResult.completedTricks[0].pointValue, null);
  assert.equal(handResult.seats[0].trickPoints, 0);
  assert.deepEqual(handResult.completedTricks[0].plays[1].card, {
    cardId: "Card Back",
    hidden: true,
  });

  engine.state.phase = "match_complete";
  const matchResult = engine.getPublicState(0);
  assert.equal(matchResult.trickPointsPartial, true);
  assert.equal(matchResult.completedTricks[0].points, null);
  assert.equal(matchResult.completedTricks[0].pointValue, null);
  assert.equal(matchResult.seats[0].trickPoints, 0);
  assert.deepEqual(matchResult.completedTricks[0].plays[1].card, {
    cardId: "Card Back",
    hidden: true,
  });
});

test("public reconnect summaries omit hidden autopilot card identities", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  engine.state.seats[1].reconnectSummary = [
    {
      type: "SELECT_TRUMP",
      at: "2026-07-12T00:00:00.000Z",
      handNumber: 1,
      phase: "trump_selection",
      cardId: "hearts-J",
      indicatorCardId: "hearts-J",
      rank: "J",
      suit: "hearts",
    },
    {
      type: "PLAY_CARD",
      at: "2026-07-12T00:00:01.000Z",
      handNumber: 1,
      phase: "trick_play",
      cardId: "spades-9",
      faceDown: true,
      fromIndicator: false,
      rank: "9",
      suit: "spades",
    },
    {
      type: "PLAY_CARD",
      at: "2026-07-12T00:00:02.000Z",
      handNumber: 1,
      phase: "trick_play",
      cardId: "clubs-7",
      faceDown: false,
      fromIndicator: false,
    },
  ];

  const publicSummary = engine.getPublicState(0).seats[1].reconnectSummary;
  assert.deepEqual(publicSummary, [
    {
      type: "SELECT_TRUMP",
      at: "2026-07-12T00:00:00.000Z",
      handNumber: 1,
      phase: "trump_selection",
    },
    {
      type: "PLAY_CARD",
      at: "2026-07-12T00:00:01.000Z",
      handNumber: 1,
      phase: "trick_play",
      faceDown: true,
    },
    {
      type: "PLAY_CARD",
      at: "2026-07-12T00:00:02.000Z",
      handNumber: 1,
      phase: "trick_play",
      cardId: "clubs-7",
    },
  ]);
  assert.equal(JSON.stringify(publicSummary).includes("hearts-J"), false);
  assert.equal(JSON.stringify(publicSummary).includes("spades-9"), false);

  const privateSummary = engine.getSeatView(1).reconnectSummary;
  assert.equal(privateSummary[0].cardId, "hearts-J");
  assert.equal(privateSummary[1].cardId, "spades-9");
});

test("formats seat references in public game messages as one-based", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();

  engine.state.phase = "four_bidding";
  engine.state.activeSeat = 0;
  engine.state.bidding.phase = "four";
  engine.state.bidding.currentBid = 0;
  engine.state.bidding.currentBidSeat = null;
  engine.state.bidding.order = [0, 1, 2, 3];
  engine.state.bidding.activeOrderIndex = 0;
  engine.state.bidding.actedInRound = [];
  assert.deepEqual(engine._handleBid(0, 160), { ok: true });
  assert.equal(engine.getPublicState(0).gameMessage, "Seat 1 bids 160.");

  engine.state.phase = "four_bidding";
  engine.state.activeSeat = 1;
  engine.state.bidding.currentBid = 160;
  engine.state.bidding.currentBidSeat = 0;
  engine.state.bidding.passesAfterBid = 2;
  engine.state.bidding.actedInRound = [];
  assert.deepEqual(engine._handlePass(1), { ok: true });
  assert.equal(
    engine.getPublicState(0).gameMessage,
    "Four-card bidding done. Winner is seat 1. Select trump indicator.",
  );

  engine.state.phase = "second_bidding";
  engine.state.activeSeat = 3;
  engine.state.bidding.phase = "second";
  engine.state.bidding.currentBid = 240;
  engine.state.bidding.currentBidSeat = 0;
  engine.state.bidding.actedInRound = [];
  engine.state.bidding.secondRound.order = [3, 0, 1, 2];
  engine.state.bidding.secondRound.activeOrderIndex = 0;
  engine.state.bidding.secondRound.actionsTaken = 0;
  engine.state.bidding.secondRound.anyBid = false;
  engine.state.bidding.secondRound.previousBid = 240;
  assert.deepEqual(engine._handleBid(3, 250), { ok: true });
  assert.equal(
    engine.getPublicState(0).gameMessage,
    "Seat 4 bids 250 in second round.",
  );
});

test("normalizes legacy zero-based seat copy while hydrating durable state", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.state.seats.forEach((seat, index) => {
    seat.seatLabel = `Seat ${index}`;
  });
  delete engine.state.seatDisplayVersion;
  engine.state.gameMessage = "Trick 3 done. Next trick led by seat 0.";

  const hydrated = GameEngine.hydrate(engine.getSnapshot());
  const publicState = hydrated.getPublicState(0);

  assert.deepEqual(
    publicState.seats.map(({ index }) => index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    publicState.seats.map(({ seatLabel }) => seatLabel),
    ["Seat 1", "Seat 2", "Seat 3", "Seat 4"],
  );
  assert.equal(
    publicState.gameMessage,
    "Trick 3 done. Next trick led by seat 1.",
  );

  const rehydrated = GameEngine.hydrate(hydrated.getSnapshot());
  assert.equal(
    rehydrated.getPublicState(0).gameMessage,
    "Trick 3 done. Next trick led by seat 1.",
  );
});

test("rejects unsupported seat display versions during hydration", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  const snapshot = engine.getSnapshot();

  assert.throws(
    () => GameEngine.hydrate({ ...snapshot, seatDisplayVersion: 2 }),
    /Unsupported seat display version/,
  );
  assert.throws(
    () => GameEngine.hydrate({ ...snapshot, seatDisplayVersion: "1" }),
    /Unsupported seat display version/,
  );
});

test("projects a scored hand result without internal shuffle material", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  engine.state.bidding.currentBid = 160;
  engine.state.trump.maker = 0;
  engine.state.handShuffle = {
    ...engine.state.handShuffle,
    deckVersion: "private-deck-version",
    seed: "private-shuffle-seed",
    seedCommit: "private-seed-commit",
  };
  for (const seat of engine.state.seats) seat.wonCards = [];
  engine.state.seats[0].wonCards = [{ points: 200 }];
  engine.state.seats[1].wonCards = [{ points: 104 }];
  engine.state.completedTricks = Array.from({ length: 8 }, () => ({
    plays: [],
  }));

  engine._finishHand();

  const publicState = engine.getPublicState(0);
  assert.deepEqual(publicState.handResult, {
    bidderTeam: "A",
    bidderTeamPoints: 200,
    bid: 160,
    handNumber: 1,
    matchComplete: false,
    movement: 1,
    otherTeamPoints: 104,
    success: true,
    tokens: [12, 10],
    trickCount: 8,
    winningTeam: "A",
  });
  assert.equal(
    JSON.stringify(publicState).includes("private-shuffle-seed"),
    false,
  );
  assert.equal(
    JSON.stringify(publicState).includes("private-seed-commit"),
    false,
  );
  assert.equal(
    JSON.stringify(publicState).includes("private-deck-version"),
    false,
  );
});

test("projects an all-pass result with only its no-score fields", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  engine._finishCancelledHand();

  assert.deepEqual(engine.getPublicState(0).handResult, {
    handNumber: 1,
    noScore: true,
    reason: "All players passed. No score movement this hand.",
    tokens: [11, 11],
  });
});

test("never offers a bid above the profile's 304-point deck total", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  const activeSeat = engine.state.activeSeat;
  engine.state.bidding.currentBid = 300;
  engine.state.bidding.currentBidSeat = (activeSeat + 1) % 4;

  const bids = engine
    .getLegalActions(activeSeat)
    .filter((action) => action.type === "BID");

  assert.deepEqual(bids, []);
});

test("a maximum four-card bid closes bidding and skips a pass-only second round", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  const maximumBidder = engine.state.activeSeat;
  engine.state.bidding.currentBid = 290;
  engine.state.bidding.currentBidSeat = (maximumBidder + 3) % 4;

  assert.deepEqual(
    engine.applyAction({
      actorSeatIndex: maximumBidder,
      amount: 300,
      seatIndex: maximumBidder,
      type: "BID",
    }),
    { ok: true },
  );
  assert.equal(engine.state.phase, "trump_selection");
  assert.equal(engine.state.activeSeat, maximumBidder);

  const indicator = engine
    .getLegalActions(maximumBidder)
    .find((action) => action.type === "SELECT_TRUMP");
  assert.ok(indicator);
  assert.deepEqual(
    engine.applyAction({
      ...indicator,
      actorSeatIndex: maximumBidder,
      seatIndex: maximumBidder,
    }),
    { ok: true },
  );
  assert.equal(engine.state.phase, "trump_choice");
  assert.equal(
    engine
      .getLegalActions(maximumBidder)
      .some((action) => action.type === "PASS_BID"),
    false,
  );
});

test("offers an acknowledgement that starts another match after match completion", () => {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  engine.state.tokens = [1, 11];
  engine.state.bidding.currentBid = 160;
  engine.state.trump.maker = 0;
  for (const seat of engine.state.seats) seat.wonCards = [];

  engine._finishHand();

  assert.equal(engine.state.phase, "match_complete");
  assert.deepEqual(engine.getLegalActions(0), [
    {
      ariaLabel: "Play another match",
      label: "Play another match",
      type: "ACK_RESULT",
    },
  ]);
  assert.deepEqual(
    engine.applyAction({
      actorSeatIndex: 0,
      seatIndex: 0,
      type: "ACK_RESULT",
    }),
    { ok: true },
  );
  assert.equal(engine.state.phase, "four_bidding");
  assert.deepEqual(engine.state.tokens, [11, 11]);
});
