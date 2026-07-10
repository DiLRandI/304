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
