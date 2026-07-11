import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/index.js";

function apply(engine, action) {
  const seatIndex = action.seatIndex ?? engine.state.activeSeat;
  const result = engine.applyAction({
    ...action,
    actorSeatIndex: seatIndex,
    seatIndex,
  });
  assert.deepEqual(result, { ok: true }, JSON.stringify({ action, result }));
}

function reachSecondBidding({
  enableSecondBidding = true,
  openingBid = 200,
} = {}) {
  const engine = new GameEngine({
    enableSecondBidding,
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();

  const originalMaker = engine.state.activeSeat;
  apply(engine, { seatIndex: originalMaker, type: "BID", amount: openingBid });
  while (engine.state.phase === "four_bidding") {
    apply(engine, { type: "PASS_BID" });
  }

  assert.equal(engine.state.phase, "trump_selection");
  const originalIndicatorAction = engine
    .getLegalActions(originalMaker)
    .find((action) => action.type === "SELECT_TRUMP");
  assert.ok(originalIndicatorAction);
  apply(engine, originalIndicatorAction);

  return {
    engine,
    originalIndicatorId: originalIndicatorAction.cardId,
    originalMaker,
  };
}

function passUntilSecondBiddingEnds(engine) {
  let passes = 0;
  while (engine.state.phase === "second_bidding" && passes < 8) {
    apply(engine, { type: "PASS_BID" });
    passes += 1;
  }
  assert.notEqual(engine.state.phase, "second_bidding");
}

test("offers the 250 minimum when second bidding follows a 160 opening", () => {
  const { engine } = reachSecondBidding({ openingBid: 160 });

  assert.equal(engine.state.phase, "second_bidding");
  assert.deepEqual(
    engine
      .getLegalActions(engine.state.activeSeat)
      .filter((action) => action.type === "BID")
      .map((action) => action.amount),
    [250, 260, 270, 280, 290, 300],
  );
});

test("a new second-round winner reselects trump and completes all eight tricks", () => {
  const { engine, originalIndicatorId, originalMaker } = reachSecondBidding();

  assert.equal(engine.state.activeSeat, originalMaker);
  apply(engine, { type: "PASS_BID" });
  const secondWinner = engine.state.activeSeat;
  assert.notEqual(secondWinner, originalMaker);
  const secondBid = engine
    .getLegalActions(secondWinner)
    .find((action) => action.type === "BID" && action.amount === 250);
  assert.ok(secondBid);
  apply(engine, secondBid);
  assert.equal(engine.state.bidding.secondRound.anyBid, true);
  passUntilSecondBiddingEnds(engine);

  assert.equal(engine.state.phase, "trump_selection");
  assert.equal(engine.state.trump.maker, secondWinner);
  assert.equal(engine.state.trump.card, null);
  assert.equal(
    engine.state.seats[originalMaker].hand.some(
      (card) => card.cardId === originalIndicatorId,
    ),
    true,
  );
  assert.deepEqual(
    engine.state.seats.map((seat) => seat.hand.length),
    [8, 8, 8, 8],
  );

  const reselectionActions = engine
    .getLegalActions(secondWinner)
    .filter((action) => action.type === "SELECT_TRUMP");
  assert.equal(reselectionActions.length, 8);
  apply(engine, reselectionActions[0]);
  assert.equal(engine.state.phase, "trump_choice");
  assert.deepEqual(
    engine.state.seats.map((seat) => seat.hand.length),
    engine.state.seats.map((seat) => (seat.index === secondWinner ? 7 : 8)),
  );

  const openTrump = engine
    .getLegalActions(secondWinner)
    .find((action) => action.type === "TRUMP_OPEN");
  assert.ok(openTrump);
  apply(engine, openTrump);
  assert.equal(engine.state.phase, "trick_play");
  assert.deepEqual(
    engine.state.seats.map((seat) => seat.hand.length),
    [8, 8, 8, 8],
  );

  let plays = 0;
  while (engine.state.phase === "trick_play" && plays < 40) {
    const action = engine
      .getLegalActions(engine.state.activeSeat)
      .find((candidate) => candidate.type === "PLAY_CARD");
    assert.ok(
      action,
      `expected a legal play for seat ${engine.state.activeSeat}`,
    );
    apply(engine, action);
    plays += 1;
  }

  assert.equal(plays, 32);
  assert.equal(engine.state.phase, "hand_result");
  assert.equal(engine.state.completedTricks.length, 8);
  assert.deepEqual(
    engine.state.seats.map((seat) => seat.hand.length),
    [0, 0, 0, 0],
  );
});

test("same-winner, all-pass, and disabled second bidding preserve the indicator", () => {
  const sameWinner = reachSecondBidding();
  const sameWinnerBid = sameWinner.engine
    .getLegalActions(sameWinner.originalMaker)
    .find((action) => action.type === "BID" && action.amount === 250);
  assert.ok(sameWinnerBid);
  apply(sameWinner.engine, sameWinnerBid);
  assert.equal(sameWinner.engine.state.bidding.secondRound.anyBid, true);
  passUntilSecondBiddingEnds(sameWinner.engine);
  assert.equal(sameWinner.engine.state.phase, "trump_choice");
  assert.equal(sameWinner.engine.state.trump.maker, sameWinner.originalMaker);
  assert.equal(
    sameWinner.engine.state.trump.card?.cardId,
    sameWinner.originalIndicatorId,
  );

  const allPass = reachSecondBidding();
  passUntilSecondBiddingEnds(allPass.engine);
  assert.equal(allPass.engine.state.phase, "trump_choice");
  assert.equal(allPass.engine.state.trump.maker, allPass.originalMaker);
  assert.equal(
    allPass.engine.state.trump.card?.cardId,
    allPass.originalIndicatorId,
  );

  const disabled = reachSecondBidding({ enableSecondBidding: false });
  assert.equal(disabled.engine.state.phase, "trump_choice");
  assert.equal(disabled.engine.state.trump.maker, disabled.originalMaker);
  assert.equal(
    disabled.engine.state.trump.card?.cardId,
    disabled.originalIndicatorId,
  );
});
