interface AutomationPhaseState {
  readonly phase: unknown;
}

type AutomationDynamicState = Readonly<Record<string, unknown>>;
type AutomationTurnState = AutomationPhaseState & AutomationDynamicState;

export function activeSeatIndex(state: AutomationDynamicState): number | null {
  const activeSeat = state.activeSeat;
  return typeof activeSeat === "number" && Number.isInteger(activeSeat)
    ? activeSeat
    : null;
}

export function isResultPhase(state: AutomationPhaseState): boolean {
  return state.phase === "hand_result" || state.phase === "match_complete";
}

export function automationSeatIndex(state: AutomationTurnState): number | null {
  if (isResultPhase(state)) return null;
  return activeSeatIndex(state);
}

export function completedTrickWinner(
  state: AutomationDynamicState,
): number | null {
  const currentTrick = state.currentTrick;
  if (!currentTrick || typeof currentTrick !== "object") return null;
  const winnerSeat = (currentTrick as Record<string, unknown>).winnerSeat;
  return typeof winnerSeat === "number" && Number.isInteger(winnerSeat)
    ? winnerSeat
    : null;
}

export function phaseTimeoutMs(state: AutomationPhaseState): number {
  if (state.phase === "trump_choice") return 15_000;
  if (state.phase === "hand_result") return 20_000;
  return 30_000;
}
