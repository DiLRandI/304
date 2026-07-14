import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";
import type { AuthenticatedSession } from "../../player-access/application/player-session-ports.js";

export interface GameplayCommandExecutor {
  submitCommand(
    session: AuthenticatedSession,
    command: GameCommand,
  ): Promise<RoomProjection>;
}

export interface GameplayCommandPresence {
  refresh(session: AuthenticatedSession, roomId: string): Promise<void>;
}

export interface SubmitGameplayCommandInput {
  readonly command: GameCommand;
  readonly session: AuthenticatedSession;
}

export class SubmitGameplayCommandHandler {
  constructor(
    private readonly executor: GameplayCommandExecutor,
    private readonly presence: GameplayCommandPresence,
  ) {}

  async execute(input: SubmitGameplayCommandInput): Promise<RoomProjection> {
    await this.presence.refresh(input.session, input.command.roomId);
    return this.executor.submitCommand(input.session, input.command);
  }
}
