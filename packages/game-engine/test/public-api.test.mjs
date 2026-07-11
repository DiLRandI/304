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
