export interface GameplayOperationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface RecoveredGameplaySeat extends Record<string, unknown> {
  autopilot?: unknown;
  connectionStatus?: string;
  index: number;
  type: "bot" | "empty" | "human";
  userId?: string;
}

export interface RecoveredGameplayState extends Record<string, unknown> {
  humanCount: number;
  phase: string;
  seats: RecoveredGameplaySeat[];
}

export interface RecoveredGameplay {
  state: RecoveredGameplayState;
  advanceTrick(): GameplayOperationResult;
  applyAction(action: Record<string, unknown>): GameplayOperationResult;
  applyAutomationAction(
    action: Record<string, unknown>,
    seatIndex: number,
  ): GameplayOperationResult;
  getBotAction(seatIndex: number): Record<string, unknown> | null;
  getLegalActions(seatIndex: number): Array<Record<string, unknown>>;
  getPrompt(viewerSeatIndex?: number | null): string;
  getPublicState(viewerSeatIndex?: number | null): Record<string, unknown>;
  getSeatView(
    viewerSeatIndex: number,
    seatIndex?: number,
  ): Record<string, unknown> | null;
  getSnapshot(): RecoveredGameplayState;
  startMatch(): void;
}
