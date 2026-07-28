import { randomUUID } from "node:crypto";
import type { Database } from "../../../../platform/postgres/database.js";
import type {
  CreateTournamentCommit,
  TournamentRepository,
} from "../../application/tournament-repository.js";

export class PostgresTournamentRepository implements TournamentRepository {
  constructor(private readonly database: Database) {}

  async create(input: CreateTournamentCommit): Promise<void> {
    if (input.inviteDigests.length !== input.tournament.teamCount) {
      throw new Error("Every tournament team slot requires an invite digest");
    }
    const { tournament } = input;
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO tournaments (
           id, public_slug, organizer_player_id, name, rule_profile_id,
           team_count, series_format, bots_allowed, bot_difficulty, third_place,
           event_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`,
        [
          tournament.id,
          tournament.publicSlug,
          tournament.organizerPlayerId,
          tournament.name,
          tournament.profile,
          tournament.teamCount,
          tournament.seriesFormat,
          tournament.botsAllowed,
          tournament.botDifficulty,
          tournament.thirdPlace,
        ],
      );
      for (const [index, digest] of input.inviteDigests.entries()) {
        const teamId = randomUUID();
        await transaction.query(
          `INSERT INTO tournament_teams (id, tournament_id, slot_number)
           VALUES ($1, $2, $3)`,
          [teamId, tournament.id, index + 1],
        );
        await transaction.query(
          `INSERT INTO tournament_invite_digests (team_id, digest)
           VALUES ($1, $2)`,
          [teamId, digest],
        );
      }
      const eventPayload = {
        name: tournament.name,
        profile: tournament.profile,
        teamCount: tournament.teamCount,
        seriesFormat: tournament.seriesFormat,
      };
      await transaction.query(
        `INSERT INTO tournament_events (
           tournament_id, event_version, command_id, actor_player_id, event_type, payload
         ) VALUES ($1, 1, $2, $3, 'TOURNAMENT_CREATED', $4::jsonb)`,
        [
          tournament.id,
          input.commandId,
          tournament.organizerPlayerId,
          JSON.stringify(eventPayload),
        ],
      );
      await transaction.query(
        `INSERT INTO tournament_command_deduplications (
           tournament_id, command_id, actor_player_id, request, response
         ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          tournament.id,
          input.commandId,
          tournament.organizerPlayerId,
          JSON.stringify(eventPayload),
          JSON.stringify(input.response),
        ],
      );
      await transaction.query(
        `INSERT INTO tournament_outbox (
           tournament_id, event_version, audience, payload
         ) VALUES ($1, 1, 'private', $2::jsonb), ($1, 1, 'public', $3::jsonb)`,
        [
          tournament.id,
          JSON.stringify({
            type: "TOURNAMENT_CHANGED",
            tournamentId: tournament.id,
          }),
          JSON.stringify({
            type: "TOURNAMENT_BOARD_CHANGED",
            slug: tournament.publicSlug,
          }),
        ],
      );
    });
  }
}
