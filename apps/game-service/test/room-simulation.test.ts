import { GameEngine } from "@three-zero-four/game-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

type RuleProfileId = "classic_304_4p" | "six_304_36";

interface SimulationCard {
  cardId: string;
  suit?: string;
}

interface SimulationState {
  activeSeat: number | null;
  completedTricks: Array<{
    plays: Array<{
      card: SimulationCard;
      faceDown: boolean;
      seatIndex: number;
    }>;
  }>;
  phase: string;
  seats: Array<{
    hand: SimulationCard[];
    trickPoints: number;
  }>;
  trump: {
    card: SimulationCard | null;
    isOpen: boolean;
    maker: number | null;
    suit?: string | null;
  };
}

function stateOf(engine: GameEngine): SimulationState {
  return engine.state as unknown as SimulationState;
}

function createAutomatedEngine(ruleProfileId: RuleProfileId): GameEngine {
  const seatCount = ruleProfileId === "six_304_36" ? 6 : 4;
  return new GameEngine({
    botDifficulty: "strong",
    initialSeats: Array.from({ length: seatCount }, (_, index) => ({
      displayName: `Simulation bot ${index + 1}`,
      index,
      type: "bot" as const,
    })),
    ruleProfile: ruleProfileId,
    tableMode: ruleProfileId === "six_304_36" ? "six_6" : "classic_4",
  });
}

function useDeterministicEntropy(): void {
  let handEntropy = 0;
  vi.stubGlobal("crypto", {
    getRandomValues(values: Uint32Array): Uint32Array {
      handEntropy += 1;
      values[0] = handEntropy;
      values[1] = handEntropy * 17;
      return values;
    },
  });
  vi.spyOn(Date, "now").mockReturnValue(1_704_067_200_000);
  vi.spyOn(Math, "random").mockReturnValue(0.125);
}

function assertNoPrivateCardLeaks(engine: GameEngine): void {
  const state = stateOf(engine);
  for (
    let viewerSeatIndex = 0;
    viewerSeatIndex < state.seats.length;
    viewerSeatIndex += 1
  ) {
    const payload = JSON.stringify({
      privateSeat: engine.getSeatView(viewerSeatIndex),
      publicState: engine.getPublicState(viewerSeatIndex),
    });
    for (let seatIndex = 0; seatIndex < state.seats.length; seatIndex += 1) {
      if (seatIndex === viewerSeatIndex) continue;
      for (const card of state.seats[seatIndex]?.hand ?? []) {
        expect(payload).not.toContain(card.cardId);
      }
    }
    const hiddenTrump = state.trump.card;
    if (
      hiddenTrump &&
      !state.trump.isOpen &&
      state.trump.maker !== viewerSeatIndex
    ) {
      expect(payload).not.toContain(hiddenTrump.cardId);
    }
    if (state.phase !== "hand_result" && state.phase !== "match_complete") {
      for (const trick of state.completedTricks) {
        for (const play of trick.plays) {
          const publiclyRevealedTrump =
            state.trump.isOpen && play.card.suit === state.trump.suit;
          if (
            play.faceDown &&
            !publiclyRevealedTrump &&
            play.seatIndex !== viewerSeatIndex
          ) {
            expect(payload).not.toContain(play.card.cardId);
          }
        }
      }
    }
  }
}

describe("full-hand automated rule-profile simulations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const ruleProfileId of ["classic_304_4p", "six_304_36"] as const) {
    it(`completes a ${ruleProfileId} hand with server-selected legal actions and private views`, () => {
      useDeterministicEntropy();
      const engine = createAutomatedEngine(ruleProfileId);
      engine.startMatch();

      let actionsApplied = 0;
      while (
        stateOf(engine).phase !== "hand_result" &&
        stateOf(engine).phase !== "match_complete" &&
        actionsApplied < 1_000
      ) {
        const state = stateOf(engine);
        expect(state.phase).not.toBe("match_complete");
        if (state.phase === "trick_result") {
          expect(engine.advanceTrick()).toEqual({ ok: true });
          assertNoPrivateCardLeaks(engine);
          actionsApplied += 1;
          continue;
        }
        const seatIndex = state.activeSeat ?? 0;
        if (state.phase !== "hand_result") {
          expect(
            state.activeSeat,
            `missing active seat during ${state.phase}`,
          ).not.toBeNull();
        }
        const legalActions = engine.getLegalActions(seatIndex);
        const action = engine.getBotAction(seatIndex);
        expect(
          action,
          `missing bot action during ${state.phase}`,
        ).not.toBeNull();
        if (!action) break;
        expect(legalActions).toContainEqual(action);

        const result = engine.applyAutomationAction(action, seatIndex);
        expect(result).toEqual({ ok: true });
        assertNoPrivateCardLeaks(engine);
        actionsApplied += 1;
      }

      const completed = stateOf(engine);
      expect(actionsApplied).toBeLessThan(1_000);
      expect(completed.phase).toBe("hand_result");
      expect(completed.completedTricks).toHaveLength(
        ruleProfileId === "six_304_36" ? 6 : 8,
      );
      expect(
        completed.seats.reduce((total, seat) => total + seat.trickPoints, 0),
      ).toBe(304);
    });
  }
});
