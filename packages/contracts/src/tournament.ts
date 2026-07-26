import { z } from "zod";

const Uuid = z.string().uuid();
const Version = z.number().int().nonnegative();
const TeamName = z.string().trim().min(2).max(32);
const TournamentName = z.string().trim().min(2).max(80);
const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Timestamp = z.string().datetime({ offset: true });

export const TournamentStatusSchema = z.enum([
  "registration",
  "group_stage",
  "knockout",
  "completed",
  "cancelled",
]);
export const TournamentProfileSchema = z.enum(["classic_304_4p", "six_304_36"]);
export const TournamentSeriesFormatSchema = z.enum(["bo1", "bo3"]);
export const TournamentBotSettingsSchema = z
  .object({
    allowed: z.boolean(),
    difficulty: z.enum(["easy", "normal", "strong"]),
  })
  .strict();

export const CreateTournamentRequestSchema = z
  .object({
    commandId: Uuid,
    name: TournamentName,
    profile: TournamentProfileSchema,
    teamCount: z
      .number()
      .int()
      .min(6)
      .max(32)
      .refine((count) => count % 2 === 0),
    seriesFormat: TournamentSeriesFormatSchema,
    bots: TournamentBotSettingsSchema,
    thirdPlace: z.boolean(),
  })
  .strict();

export const JoinTournamentInviteRequestSchema = z
  .object({
    commandId: Uuid,
    token: Token,
    teamName: TeamName.optional(),
  })
  .strict();

const TeamAction = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("NAME_TEAM"), teamId: Uuid, name: TeamName })
    .strict(),
  z
    .object({ type: z.literal("REMOVE_MEMBER"), teamId: Uuid, playerId: Uuid })
    .strict(),
  z.object({ type: z.literal("ROTATE_INVITE"), teamId: Uuid }).strict(),
  z
    .object({
      type: z.literal("TRANSFER_CAPTAIN"),
      teamId: Uuid,
      playerId: Uuid,
    })
    .strict(),
]);
const CompetitionAction = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("DRAW"), seed: z.string().min(1).max(128) })
    .strict(),
  z
    .object({ type: z.literal("REDRAW"), seed: z.string().min(1).max(128) })
    .strict(),
  z.object({ type: z.literal("LOCK") }).strict(),
  z.object({ type: z.literal("OPEN_ROUND"), roundId: Uuid }).strict(),
  z.object({ type: z.literal("CHECK_IN"), fixtureId: Uuid }).strict(),
  z
    .object({
      type: z.literal("LOCK_LINEUP"),
      fixtureId: Uuid,
      botPositions: z.array(z.number().int().min(0).max(5)).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("POSTPONE"),
      fixtureId: Uuid,
      reason: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("FORFEIT"),
      fixtureId: Uuid,
      side: z.enum(["A", "B", "both"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("RECOVER_ROOM"),
      fixtureId: Uuid,
      replacementRoomId: Uuid,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL"),
      reason: z.string().trim().min(1).max(160),
    })
    .strict(),
]);

export const TournamentActionSchema = z.union([TeamAction, CompetitionAction]);
export const TournamentCommandRequestSchema = z
  .object({
    commandId: Uuid,
    expectedVersion: Version,
    action: TournamentActionSchema,
  })
  .strict();

const PublicTeam = z.object({ id: Uuid, name: TeamName }).strict();
const PublicRound = z
  .object({
    id: Uuid,
    stage: z.enum(["group", "knockout"]),
    number: z.number().int().positive(),
    status: z.enum(["scheduled", "open", "complete"]),
  })
  .strict();
const PublicStanding = z
  .object({
    teamId: Uuid,
    groupId: Uuid,
    rank: z.number().int().positive(),
    played: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    matchDifferential: z.number().int(),
    tokenDifferential: z.number().int(),
  })
  .strict();
const PublicActivity = z
  .object({
    kind: z.string().min(1).max(64),
    teamName: TeamName.optional(),
    at: Timestamp,
  })
  .strict();

export const PublicTournamentBoardSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{4,80}$/),
    name: TournamentName,
    status: TournamentStatusSchema,
    profile: TournamentProfileSchema,
    drawSeed: z.string().min(1).max(128).nullable(),
    teams: z.array(PublicTeam),
    rounds: z.array(PublicRound),
    standings: z.array(PublicStanding),
    bracket: z.record(z.string(), z.unknown()).nullable(),
    championTeamId: Uuid.nullable(),
    activity: z.array(PublicActivity),
    updatedAt: Timestamp,
  })
  .strict();

export type CreateTournamentRequest = z.infer<
  typeof CreateTournamentRequestSchema
>;
export type JoinTournamentInviteRequest = z.infer<
  typeof JoinTournamentInviteRequestSchema
>;
export type PublicTournamentBoard = z.infer<typeof PublicTournamentBoardSchema>;
export type TournamentAction = z.infer<typeof TournamentActionSchema>;
export type TournamentCommandRequest = z.infer<
  typeof TournamentCommandRequestSchema
>;
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;
