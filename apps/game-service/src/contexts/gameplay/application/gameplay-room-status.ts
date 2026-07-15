export type ActiveRoomStatus = "lobby" | "in_hand" | "hand_result";

interface GameplayPhaseState {
  readonly phase: unknown;
}

export function activeRoomStatus(state: GameplayPhaseState): ActiveRoomStatus {
  if (state.phase === "setup") return "lobby";
  if (state.phase === "hand_result" || state.phase === "match_complete") {
    return "hand_result";
  }
  return "in_hand";
}
