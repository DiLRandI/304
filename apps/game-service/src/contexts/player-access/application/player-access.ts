import type {
  AuthenticatedSession,
  CreatedSession,
} from "./player-session-ports.js";

export interface PlayerAccess {
  create(displayName: string): Promise<CreatedSession>;
  require(cookieValue: string | undefined): Promise<AuthenticatedSession>;
}
