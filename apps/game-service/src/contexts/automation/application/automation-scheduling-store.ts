import type { DomainAutomationJobKind } from "./automation-job-store.js";

export interface AutomationSchedulingSeat {
  readonly connectionStatus?: "autopilot" | "disconnected" | "online";
  readonly disconnectedAt?: Date | null;
  readonly occupantType: "bot" | "empty" | "human";
  readonly playerId: string | null;
  readonly seatIndex: number;
}

export interface ScheduledAutomationJob {
  readonly dueAt: Date;
  readonly expectedEventVersion: number;
  readonly id: string;
  readonly kind: DomainAutomationJobKind;
  readonly roomId: string;
  readonly targetSeatIndex: number;
}

export interface AutomationSchedulingStore {
  cancelAutomationForRoom(
    transaction: unknown,
    roomId: string,
    kinds: readonly DomainAutomationJobKind[],
  ): Promise<void>;
  loadSeats(
    roomId: string,
    transaction: unknown,
  ): Promise<AutomationSchedulingSeat[]>;
  scheduleAutomation(
    transaction: unknown,
    job: ScheduledAutomationJob,
  ): Promise<void>;
}

export interface AutomationJobIdentityProvider {
  nextAutomationJobId(): string;
}
