import {
  applyGameplayCommand,
  bidAmount,
  buildDeck,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
  type RuleProfileId,
  seatIndex,
  startGameplayHand,
} from "@three-zero-four/gameplay";

export function applyGameplayFixtureCommand(
  hand: GameplayHand,
  command: GameplayCommand,
): GameplayHand {
  const result = applyGameplayCommand(hand, command);
  if (!result.ok) {
    throw new Error(`Fixture command failed: ${result.error.code}`);
  }
  return result.hand;
}

export function startedGameplayHand(
  profileId: RuleProfileId = "classic_304_4p",
  secondBiddingEnabled = true,
): GameplayHand {
  const profile = getRuleProfile(profileId);
  return startGameplayHand({
    dealer: seatIndex(profile.seatCount - 1, profile.seatCount),
    deck: buildDeck(profile),
    handNumber: 1,
    profile,
    secondBiddingEnabled,
    tokens: initialTokens(profile),
  });
}

export function selectedTrumpGameplayHand(amount = 200): GameplayHand {
  let hand = startedGameplayHand("classic_304_4p", false);
  const bidder = hand.activeSeat;
  if (bidder === null) throw new Error("Expected an active bidding seat");
  hand = applyGameplayFixtureCommand(hand, {
    actor: bidder,
    amount: bidAmount(amount),
    type: "BID",
  });
  while (hand.phase === "four-bidding") {
    const actor = hand.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    hand = applyGameplayFixtureCommand(hand, { actor, type: "PASS_BID" });
  }
  const maker = hand.activeSeat;
  const indicator =
    maker === null ? undefined : hand.deal.firstHands[maker]?.[0];
  if (maker === null || !indicator) {
    throw new Error("Expected a trump indicator");
  }
  hand = applyGameplayFixtureCommand(hand, {
    actor: maker,
    cardId: indicator.id,
    type: "SELECT_TRUMP",
  });
  return hand;
}

export function pausedTrickGameplayHand(): GameplayHand {
  let hand = selectedTrumpGameplayHand(160);
  const maker = hand.trump.maker;
  if (maker === null) throw new Error("Expected a trump maker");
  hand = applyGameplayFixtureCommand(hand, {
    actor: maker,
    type: "TRUMP_OPEN",
  });
  while (hand.phase === "trick-play") {
    const actor = hand.activeSeat;
    if (actor === null) throw new Error("Expected an active playing seat");
    const command = legalGameplayCommands(hand, actor).find(
      (candidate) => candidate.type === "PLAY_CARD",
    );
    if (!command) throw new Error("Expected a playable card");
    hand = applyGameplayFixtureCommand(hand, command);
  }
  if (hand.phase !== "trick-result") {
    throw new Error("Expected a paused trick result");
  }
  return hand;
}

export function completedGameplayHand(): GameplayHand {
  let hand = selectedTrumpGameplayHand();
  const maker = hand.trump.maker;
  if (maker === null) throw new Error("Expected a trump maker");
  hand = applyGameplayFixtureCommand(hand, {
    actor: maker,
    type: "TRUMP_OPEN",
  });
  while (hand.phase === "trick-play" || hand.phase === "trick-result") {
    if (hand.phase === "trick-result") {
      hand = applyGameplayFixtureCommand(hand, {
        actor: null,
        type: "ADVANCE_TRICK",
      });
      continue;
    }
    const actor = hand.activeSeat;
    if (actor === null) throw new Error("Expected an active playing seat");
    const command = legalGameplayCommands(hand, actor).find(
      (candidate) => candidate.type === "PLAY_CARD",
    );
    if (!command) throw new Error("Expected a playable card");
    hand = applyGameplayFixtureCommand(hand, command);
  }
  if (hand.phase !== "hand-result" && hand.phase !== "match-complete") {
    throw new Error("Expected a completed hand");
  }
  return hand;
}
