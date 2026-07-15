export type AutomationExecutionErrorCode =
  | "AUTOMATION_ACTION_REJECTED"
  | "ROOM_NOT_FOUND"
  | "ROOM_RECOVERY_FAILED"
  | "ROOM_UNAVAILABLE";

export class AutomationExecutionError extends Error {
  constructor(
    readonly code: AutomationExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AutomationExecutionError";
  }
}
