import { z } from "zod";

const Uuid = z.string().uuid();
const EventVersion = z.number().int().nonnegative();

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

export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommand = z.infer<typeof GameCommandSchema>;
export type VersionedPrivateView = z.infer<typeof VersionedPrivateViewSchema>;
