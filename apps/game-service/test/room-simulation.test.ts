import {
  applyGameplayCommand,
  buildDeck,
  chooseGameplayBotCommand,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  legalGameplayCommands,
  projectGameplayHand,
  type RandomSource,
  type RuleProfileId,
  seatIndex,
  startGameplayHand,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";

const deterministicRandom: RandomSource = { next: () => 0.125 };

function startSimulation(ruleProfileId: RuleProfileId): GameplayHand {
  const profile = getRuleProfile(ruleProfileId);
  return startGameplayHand({
    dealer: seatIndex(profile.seatCount - 1, profile.seatCount),
    deck: buildDeck(profile),
    endHandWhenOutcomeCertain: false,
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
}

function assertNoPrivateCardLeaks(hand: GameplayHand): void {
  for (
    let viewerSeatIndex = 0;
    viewerSeatIndex < hand.profile.seatCount;
    viewerSeatIndex += 1
  ) {
    const viewer = seatIndex(viewerSeatIndex, hand.profile.seatCount);
    const payload = JSON.stringify(projectGameplayHand(hand, viewer));
    for (
      let privateSeatIndex = 0;
      privateSeatIndex < hand.profile.seatCount;
      privateSeatIndex += 1
    ) {
      if (privateSeatIndex === viewerSeatIndex) continue;
      for (const card of hand.deal.hands[privateSeatIndex] ?? []) {
        expect(payload).not.toContain(card.id);
      }
    }
    const hiddenTrump = hand.trump.indicator;
    if (hiddenTrump && !hand.trump.open && hand.trump.maker !== viewer) {
      expect(payload).not.toContain(hiddenTrump.id);
    }
    if (hand.phase !== "hand-result" && hand.phase !== "match-complete") {
      for (const trick of hand.completedTricks) {
        for (const play of trick.plays) {
          const publiclyRevealedTrump =
            hand.trump.open && play.card.suit === hand.trump.suit;
          if (play.faceDown && !publiclyRevealedTrump) {
            expect(payload).not.toContain(play.card.id);
          }
        }
      }
    }
  }
}

function applySimulationCommand(
  hand: GameplayHand,
  command: GameplayCommand,
): GameplayHand {
  const decision = applyGameplayCommand(hand, command);
  expect(decision).toMatchObject({ ok: true });
  if (!decision.ok) throw new Error(decision.error.message);
  return decision.hand;
}

describe("full-hand automated rule-profile simulations", () => {
  for (const ruleProfileId of ["classic_304_4p", "six_304_36"] as const) {
    it(`completes a ${ruleProfileId} hand with domain-selected legal commands and private projections`, () => {
      let hand = startSimulation(ruleProfileId);
      let commandsApplied = 0;

      while (hand.phase !== "hand-result" && commandsApplied < 1_000) {
        let command: GameplayCommand;
        if (hand.phase === "trick-result") {
          command = { actor: null, type: "ADVANCE_TRICK" };
        } else {
          const actor = hand.activeSeat;
          expect(
            actor,
            `missing active seat during ${hand.phase}`,
          ).not.toBeNull();
          if (actor === null) throw new Error("Expected an active seat");
          const legalCommands = legalGameplayCommands(hand, actor);
          const selected = chooseGameplayBotCommand(
            hand,
            actor,
            deterministicRandom,
          );
          expect(
            selected,
            `missing bot command during ${hand.phase}`,
          ).not.toBeNull();
          if (!selected) throw new Error("Expected a bot command");
          expect(legalCommands).toContainEqual(selected);
          command = selected;
        }

        hand = applySimulationCommand(hand, command);
        assertNoPrivateCardLeaks(hand);
        commandsApplied += 1;
      }

      expect(commandsApplied).toBeLessThan(1_000);
      expect(hand.phase).toBe("hand-result");
      expect(hand.completedTricks).toHaveLength(
        ruleProfileId === "six_304_36" ? 6 : 8,
      );
      expect(
        hand.capturedCards
          .flat()
          .reduce((total, card) => total + card.points, 0),
      ).toBe(304);
    });
  }
});
