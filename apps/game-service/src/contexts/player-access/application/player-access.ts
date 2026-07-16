import type {
  AuthenticatedSession,
  CreatedSession,
} from "./player-session-ports.js";

export type PlayerAccessErrorCode = "INVALID_DISPLAY_NAME" | "SESSION_REQUIRED";

export class PlayerAccessError extends Error {
  constructor(readonly code: PlayerAccessErrorCode) {
    super(
      code === "INVALID_DISPLAY_NAME"
        ? "Display name is invalid"
        : "A guest session is required",
    );
    this.name = "PlayerAccessError";
  }
}

export interface PlayerAccess {
  create(displayName: string): Promise<CreatedSession>;
  require(cookieValue: string | undefined): Promise<AuthenticatedSession>;
}
