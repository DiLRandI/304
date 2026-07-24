import { z } from "zod";

const Uuid = z.string().uuid();
const EventVersion = z.number().int().nonnegative();
const DisplayName = z.string().trim().min(1).max(48);
const InviteCode = z.string().regex(/^304-[A-Za-z0-9_-]{12,32}$/);
const BotDifficulty = z.enum(["easy", "normal", "strong"]);

export const RuleProfileIdSchema = z.enum(["classic_304_4p", "six_304_36"]);

export const GameActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BID"),
    amount: z.number().int().min(160).max(304),
  }),
  z.object({ type: z.literal("PASS_BID") }),
  z.object({
    type: z.literal("SELECT_TRUMP"),
    cardId: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal("TRUMP_OPEN") }),
  z.object({ type: z.literal("TRUMP_CLOSE") }),
  z.object({
    type: z.literal("PLAY_CARD"),
    cardId: z.string().min(1).max(64),
    faceDown: z.boolean(),
    fromIndicator: z.boolean(),
  }),
  z.object({ type: z.literal("ACK_RESULT") }),
]);

export const GameCommandSchema = z
  .object({
    commandId: Uuid,
    roomId: Uuid,
    expectedVersion: EventVersion,
    action: GameActionSchema,
  })
  .strict();

export const VersionedPrivateViewSchema = z
  .object({
    roomId: Uuid,
    eventVersion: EventVersion,
    view: z.record(z.string(), z.unknown()),
  })
  .strict();

export const GuestSessionRequestSchema = z
  .object({ displayName: DisplayName })
  .strict();

export const SessionResponseSchema = z
  .object({
    player: z.object({ id: Uuid, displayName: DisplayName }).strict(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const ServiceErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export const CreateRoomRequestSchema = z
  .object({
    commandId: Uuid,
    ruleProfileId: RuleProfileIdSchema.default("classic_304_4p"),
    botDifficulty: BotDifficulty.default("easy"),
    endHandWhenOutcomeCertain: z.boolean().default(true),
  })
  .strict();

export const JoinRoomRequestSchema = z
  .object({ commandId: Uuid, expectedVersion: EventVersion })
  .strict();

export const StartRoomRequestSchema = JoinRoomRequestSchema;

export const LeaveRoomRequestSchema = z
  .object({ commandId: Uuid, expectedVersion: EventVersion })
  .strict();

export const RoomExitResponseSchema = z
  .object({
    roomId: Uuid,
    eventVersion: EventVersion,
    status: z.enum(["left", "closed"]),
  })
  .strict();

export const RoomProjectionSchema = z
  .object({
    roomId: Uuid,
    inviteCode: InviteCode,
    eventVersion: EventVersion,
    status: z.enum(["lobby", "in_hand", "hand_result"]),
    viewerSeatIndex: z.number().int().min(0).max(5).nullable(),
    view: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PING") }).strict(),
  z.object({ type: z.literal("RESYNC"), roomId: Uuid }).strict(),
]);

export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("SNAPSHOT"), projection: RoomProjectionSchema })
    .strict(),
  z
    .object({
      type: z.literal("RESYNC_REQUIRED"),
      roomId: Uuid,
      eventVersion: EventVersion,
    })
    .strict(),
  z
    .object({
      type: z.literal("ERROR"),
      code: z.string().min(1).max(64),
      message: z.string().min(1).max(160),
    })
    .strict(),
]);

export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommand = z.infer<typeof GameCommandSchema>;
export type GuestSessionRequest = z.infer<typeof GuestSessionRequestSchema>;
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;
export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>;
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>;
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessageSchema>;
export type RuleProfileId = z.infer<typeof RuleProfileIdSchema>;
export type RoomExitResponse = z.infer<typeof RoomExitResponseSchema>;
export type RoomProjection = z.infer<typeof RoomProjectionSchema>;
export type ServiceErrorResponse = z.infer<typeof ServiceErrorResponseSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type StartRoomRequest = z.infer<typeof StartRoomRequestSchema>;
export type VersionedPrivateView = z.infer<typeof VersionedPrivateViewSchema>;
