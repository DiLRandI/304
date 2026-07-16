export interface AutomatableRoom {
  readonly eventVersion: number;
  readonly id: string;
  readonly status: string;
}

export interface AutomatableGameplaySeat
  extends Readonly<Record<string, unknown>> {
  readonly autopilot?: unknown;
  readonly connectionStatus?: string;
  readonly type: "bot" | "empty" | "human";
}

export interface AutomatableGameplayState
  extends Readonly<Record<string, unknown>> {
  readonly phase: string;
  readonly seats: readonly AutomatableGameplaySeat[];
}

export interface AutomatableGameplay {
  readonly state: AutomatableGameplayState;
}

export interface AutomationScheduler {
  schedule(
    transaction: unknown,
    room: AutomatableRoom,
    gameplay: AutomatableGameplay,
  ): Promise<void>;
}
