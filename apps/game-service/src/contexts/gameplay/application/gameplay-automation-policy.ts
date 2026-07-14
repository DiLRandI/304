export type ActiveRoomStatus = "lobby" | "in_hand" | "hand_result";

interface GameplayPhaseState {
  readonly phase: unknown;
}

type GameplayDynamicState = Readonly<Record<string, unknown>>;
type GameplayTurnState = GameplayPhaseState & GameplayDynamicState;

export function activeRoomStatus(state: GameplayPhaseState): ActiveRoomStatus {
  if (state.phase === "setup") return "lobby";
  if (state.phase === "hand_result" || state.phase === "match_complete") {
    return "hand_result";
  }
  return "in_hand";
}

export function activeSeatIndex(state: GameplayDynamicState): number | null {
  const activeSeat = state.activeSeat;
  return typeof activeSeat === "number" && Number.isInteger(activeSeat)
    ? activeSeat
    : null;
}

export function isResultPhase(state: GameplayPhaseState): boolean {
  return state.phase === "hand_result" || state.phase === "match_complete";
}

export function automationSeatIndex(state: GameplayTurnState): number | null {
  if (isResultPhase(state)) return null;
  return activeSeatIndex(state);
}

export function completedTrickWinner(
  state: GameplayDynamicState,
): number | null {
  const currentTrick = state.currentTrick;
  if (!currentTrick || typeof currentTrick !== "object") return null;
  const winnerSeat = (currentTrick as Record<string, unknown>).winnerSeat;
  return typeof winnerSeat === "number" && Number.isInteger(winnerSeat)
    ? winnerSeat
    : null;
}

export function phaseTimeoutMs(state: GameplayPhaseState): number {
  if (state.phase === "trump_choice") return 15_000;
  if (state.phase === "hand_result") return 20_000;
  return 30_000;
}
