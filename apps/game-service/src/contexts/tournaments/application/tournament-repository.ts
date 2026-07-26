export interface NewTournament {
  id: string;
  publicSlug: string;
  organizerPlayerId: string;
  name: string;
  profile: "classic_304_4p" | "six_304_36";
  teamCount: number;
  seriesFormat: "bo1" | "bo3";
  botsAllowed: boolean;
  botDifficulty: "easy" | "normal" | "strong";
  thirdPlace: boolean;
}

export interface CreateTournamentCommit {
  tournament: NewTournament;
  commandId: string;
  inviteDigests: string[];
  response: Record<string, unknown>;
}

export interface TournamentRepository {
  create(input: CreateTournamentCommit): Promise<void>;
}
