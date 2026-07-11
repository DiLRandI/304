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
  engine.state.completedTricks = Array.from({ length: 8 }, () => ({ plays: [] }));

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
  assert.equal(JSON.stringify(publicState).includes("private-shuffle-seed"), false);
  assert.equal(JSON.stringify(publicState).includes("private-seed-commit"), false);
  assert.equal(JSON.stringify(publicState).includes("private-deck-version"), false);
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
