import assert from "node:assert/strict";
import test from "node:test";
import { buildDeck } from "../src/engine/cardData.js";
import { GameEngine } from "../src/engine/engine.js";
import { getProfile } from "../src/engine/profiles.js";

test("classic deck has 32 unique cards worth 304 points", () => {
  const deck = buildDeck(getProfile("classic_304_4p"));

  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map((card) => card.cardId)).size, 32);
  assert.equal(deck.reduce((total, card) => total + card.points, 0), 304);
});

test("starting a classic hand deals four private cards per seat", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  assert.equal(engine.state.phase, "four_bidding");
  assert.ok(Number.isInteger(engine.state.activeSeat));
  for (const seat of engine.state.seats) {
    assert.equal(seat.hand.length, 4);
    assert.equal(seat.firstHand.length, 4);
  }
});

test("selecting trump after four-card bidding deals the second batch before second bidding", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  const winningSeat = engine.state.activeSeat;
  assert.equal(
    engine.applyAction({ type: "BID", seatIndex: winningSeat, actorSeatIndex: winningSeat, amount: 160 }).ok,
    true,
  );
  while (engine.state.phase === "four_bidding") {
    const seatIndex = engine.state.activeSeat;
    assert.equal(
      engine.applyAction({ type: "PASS_BID", seatIndex, actorSeatIndex: seatIndex }).ok,
      true,
    );
  }

  assert.equal(engine.state.phase, "trump_selection");
  const trumpAction = engine
    .getLegalActions(winningSeat)
    .find((action) => action.type === "SELECT_TRUMP");
  assert.ok(trumpAction);
  assert.equal(
    engine.applyAction({ ...trumpAction, actorSeatIndex: winningSeat }).ok,
    true,
  );

  assert.equal(engine.state.phase, "second_bidding");
  assert.deepEqual(
    engine.state.seats.map((seat) => seat.hand.length),
    engine.state.seats.map((seat) => (seat.index === winningSeat ? 7 : 8)),
  );
});

test("a complete classic hand resolves eight tricks and all 304 card points", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  let actionsApplied = 0;
  while (engine.state.phase !== "hand_result" && actionsApplied < 80) {
    const seatIndex = engine.state.activeSeat;
    const legalActions = engine.getLegalActions(seatIndex);
    let action;

    if (engine.state.phase === "four_bidding") {
      action =
        engine.state.bidding.currentBid === 0
          ? legalActions.find((candidate) => candidate.type === "BID" && candidate.amount === 160)
          : legalActions.find((candidate) => candidate.type === "PASS_BID");
    } else if (engine.state.phase === "second_bidding") {
      action = legalActions.find((candidate) => candidate.type === "PASS_BID");
    } else if (engine.state.phase === "trump_selection") {
      action = legalActions.find((candidate) => candidate.type === "SELECT_TRUMP");
    } else if (engine.state.phase === "trump_choice") {
      action = legalActions.find((candidate) => candidate.type === "TRUMP_OPEN");
    } else if (engine.state.phase === "trick_play") {
      action = legalActions.find((candidate) => candidate.type === "PLAY_CARD");
    }

    assert.ok(action, `expected a legal action during ${engine.state.phase}`);
    assert.equal(
      engine.applyAction({ ...action, actorSeatIndex: seatIndex }).ok,
      true,
    );
    actionsApplied += 1;
  }

  assert.equal(engine.state.phase, "hand_result");
  assert.equal(engine.state.completedTricks.length, 8);
  assert.equal(
    engine.state.seats.reduce((total, seat) => total + seat.trickPoints, 0),
    304,
  );
});

test("a viewer receives only their own card identities", () => {
  const engine = new GameEngine({ humanCount: 4, ruleProfile: "classic_304_4p" });
  engine.startMatch();

  const self = engine.getSeatView(0, 0);
  const opponent = engine.getSeatView(0, 1);
  const publicPayload = JSON.stringify(engine.getPublicState(0));

  assert.equal(self.hand.some((card) => card.hidden), false);
  assert.equal(opponent.hand.every((card) => card.hidden === true), true);
  assert.equal(publicPayload.includes(self.hand[0].cardId), false);
  assert.equal(publicPayload.includes(opponent.hand[0].cardId), false);
});

test("a bot action is always one of its server-provided legal actions", () => {
  const engine = new GameEngine({
    ruleProfile: "classic_304_4p",
    initialSeats: Array.from({ length: 4 }, (_, index) => ({
      index,
      type: "bot",
      displayName: `Bot ${index + 1}`,
    })),
  });
  engine.startMatch();

  const seatIndex = engine.state.activeSeat;
  const action = engine.getBotAction(seatIndex);
  const legal = engine.getLegalActions(seatIndex);

  assert.ok(action);
  assert.ok(legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)));
});
