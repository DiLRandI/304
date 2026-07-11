import assert from "node:assert/strict";
import test from "node:test";
import { GAME_PROFILES, GameEngine, getProfile } from "../src/index.js";

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
