import type { CreateTournamentRequest } from "@three-zero-four/contracts";
import type { TournamentRepository } from "./tournament-repository.js";

export interface TournamentInviteSecurity {
  createToken(): string;
  digest(token: string): string;
  verify(token: string, digest: string): boolean;
}

export interface TournamentIdentityProvider {
  id(): string;
  slug(name: string): string;
}

export interface CreateTournamentInput
  extends Omit<CreateTournamentRequest, "commandId"> {
  actorPlayerId: string;
  commandId: string;
}

export interface CreateTournamentResult {
  tournamentId: string;
  publicSlug: string;
  eventVersion: 1;
  invites: Array<{ slotNumber: number; token: string }>;
}

export class CreateTournamentHandler {
  constructor(
    private readonly dependencies: {
      identities: TournamentIdentityProvider;
      invites: TournamentInviteSecurity;
      repository: TournamentRepository;
    },
  ) {}

  async execute(input: CreateTournamentInput): Promise<CreateTournamentResult> {
    const tournamentId = this.dependencies.identities.id();
    const publicSlug = this.dependencies.identities.slug(input.name);
    const tokens = Array.from({ length: input.teamCount }, () =>
      this.dependencies.invites.createToken(),
    );
    const result: CreateTournamentResult = {
      tournamentId,
      publicSlug,
      eventVersion: 1,
      invites: tokens.map((token, index) => ({ slotNumber: index + 1, token })),
    };
    await this.dependencies.repository.create({
      tournament: {
        id: tournamentId,
        publicSlug,
        organizerPlayerId: input.actorPlayerId,
        name: input.name,
        profile: input.profile,
        teamCount: input.teamCount,
        seriesFormat: input.seriesFormat,
        botsAllowed: input.bots.allowed,
        botDifficulty: input.bots.difficulty,
        thirdPlace: input.thirdPlace,
      },
      commandId: input.commandId,
      inviteDigests: tokens.map((token) =>
        this.dependencies.invites.digest(token),
      ),
      response: {
        tournamentId,
        publicSlug,
        eventVersion: 1,
      },
    });
    return result;
  }
}
