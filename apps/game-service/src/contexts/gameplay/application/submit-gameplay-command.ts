import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";
import type { AuthenticatedSession } from "../../player-access/application/player-session-ports.js";

export interface GameplayCommandExecutor {
  submitCommand(
    session: AuthenticatedSession,
    command: GameCommand,
  ): Promise<RoomProjection>;
}

export interface SubmitGameplayCommandInput {
  readonly command: GameCommand;
  readonly session: AuthenticatedSession;
}

export class SubmitGameplayCommandHandler {
  constructor(private readonly executor: GameplayCommandExecutor) {}

  execute(input: SubmitGameplayCommandInput): Promise<RoomProjection> {
    return this.executor.submitCommand(input.session, input.command);
  }
}
