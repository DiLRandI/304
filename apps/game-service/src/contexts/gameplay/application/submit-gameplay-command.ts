import type { GameCommand, RoomProjection } from "@three-zero-four/contracts";

export interface GameplayActor {
  readonly playerId: string;
}

export interface GameplayCommandExecutor {
  submitCommand(
    session: GameplayActor,
    command: GameCommand,
  ): Promise<RoomProjection>;
}

export interface GameplayCommandPresence {
  refresh(session: GameplayActor, roomId: string): Promise<void>;
}

export interface SubmitGameplayCommandInput {
  readonly command: GameCommand;
  readonly session: GameplayActor;
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
