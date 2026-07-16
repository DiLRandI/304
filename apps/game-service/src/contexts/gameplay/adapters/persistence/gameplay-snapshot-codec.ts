import {
  type GameplayHand,
  getRuleProfile,
  type RuleProfileId,
} from "@three-zero-four/gameplay";
import { z } from "zod";
import { GameplaySnapshotCodecError } from "./gameplay-snapshot-codec-error.js";
import { decodeGameplayHand } from "./legacy-gameplay-snapshot-codec.js";

export { GameplaySnapshotCodecError } from "./gameplay-snapshot-codec-error.js";

export interface GameplaySnapshotRecord {
  readonly ruleProfileId: RuleProfileId;
  readonly schemaVersion: number;
  readonly state: unknown;
}

export interface SerializedGameplaySnapshotRecord
  extends GameplaySnapshotRecord {
  readonly schemaVersion: 2;
}

const seatSchema = z.number().int().min(0).max(5);
const bidSchema = z.number().int().min(160).max(304);
const cardSchema = z.strictObject({
  id: z.string().regex(/^[CDHS]_(?:6|7|8|9|10|J|Q|K|A)$/),
  points: z.number().int().nonnegative(),
  rank: z.enum(["6", "7", "8", "9", "10", "J", "Q", "K", "A"]),
  suit: z.enum(["clubs", "diamonds", "hearts", "spades"]),
});
const biddingSchema = z.strictObject({
  actedInRound: z.array(z.boolean()),
  actionsTaken: z.number().int().nonnegative(),
  activeOrderIndex: z.number().int().nonnegative(),
  activeSeat: seatSchema.nullable(),
  currentBid: bidSchema.nullable(),
  currentBidder: seatSchema.nullable(),
  noBidPasses: z.number().int().nonnegative(),
  order: z.array(seatSchema),
  passesAfterBid: z.number().int().nonnegative(),
  previousBid: bidSchema.nullable(),
  round: z.enum(["four", "second"]),
  seatCount: z.union([z.literal(4), z.literal(6)]),
  secondBiddingEnabled: z.boolean(),
  status: z.enum(["active", "cancelled", "complete"]),
});
const dealSchema = z.strictObject({
  deck: z.array(cardSchema),
  firstHands: z.array(z.array(cardSchema)),
  hands: z.array(z.array(cardSchema)),
  seatCount: z.union([z.literal(4), z.literal(6)]),
});
const playSchema = z.strictObject({
  actor: seatSchema,
  card: cardSchema,
  faceDown: z.boolean(),
  fromIndicator: z.boolean(),
});
const trickSchema = z.strictObject({
  activeSeat: seatSchema.nullable(),
  leaderSeat: seatSchema,
  openedTrump: z.boolean(),
  plays: z.array(playSchema),
  points: z.number().int().nonnegative(),
  status: z.enum(["active", "complete"]),
  winnerSeat: seatSchema.nullable(),
});
const tokenBalanceSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const cancelledResultSchema = z.strictObject({
  noScore: z.literal(true),
  reason: z.literal("All players passed. No score movement this hand."),
  tokens: tokenBalanceSchema,
});
const scoredResultSchema = z.strictObject({
  bid: bidSchema,
  bidderTeam: z.enum(["A", "B"]),
  bidderTeamPoints: z.number().int().nonnegative(),
  matchComplete: z.boolean(),
  movement: z.number().int().positive(),
  otherTeamPoints: z.number().int().nonnegative(),
  success: z.boolean(),
  tokens: tokenBalanceSchema,
  winningTeam: z.enum(["A", "B"]),
});
const stateSchema = z.strictObject({
  activeSeat: seatSchema.nullable(),
  bidding: biddingSchema,
  capturedCards: z.array(z.array(cardSchema)),
  completedTricks: z.array(trickSchema),
  currentTrick: trickSchema.nullable(),
  deal: dealSchema,
  dealer: seatSchema,
  handNumber: z.number().int().positive(),
  phase: z.enum([
    "four-bidding",
    "trump-selection",
    "second-bidding",
    "trump-choice",
    "trick-play",
    "trick-result",
    "hand-result",
    "match-complete",
  ]),
  result: z.union([cancelledResultSchema, scoredResultSchema]).nullable(),
  tokens: tokenBalanceSchema,
  trump: z.strictObject({
    indicator: cardSchema.nullable(),
    maker: seatSchema.nullable(),
    mode: z.enum(["closed", "open"]).nullable(),
    open: z.boolean(),
    suit: z.enum(["clubs", "diamonds", "hearts", "spades"]).nullable(),
  }),
});

function validSeat(value: number | null, seatCount: number): boolean {
  return value === null || value < seatCount;
}

function assertAggregateConsistency(
  state: z.infer<typeof stateSchema>,
  profileId: RuleProfileId,
): void {
  const profile = getRuleProfile(profileId);
  const seatCount = profile.seatCount;
  const tricks = [
    ...state.completedTricks,
    ...(state.currentTrick ? [state.currentTrick] : []),
  ];
  const seatsAreValid =
    validSeat(state.activeSeat, seatCount) &&
    validSeat(state.dealer, seatCount) &&
    validSeat(state.trump.maker, seatCount) &&
    validSeat(state.bidding.activeSeat, seatCount) &&
    validSeat(state.bidding.currentBidder, seatCount) &&
    state.bidding.order.every((seat) => validSeat(seat, seatCount)) &&
    tricks.every(
      (trick) =>
        validSeat(trick.activeSeat, seatCount) &&
        validSeat(trick.leaderSeat, seatCount) &&
        validSeat(trick.winnerSeat, seatCount) &&
        trick.plays.every((play) => validSeat(play.actor, seatCount)),
    );
  const arraysMatchProfile =
    state.bidding.seatCount === seatCount &&
    state.bidding.actedInRound.length === seatCount &&
    state.bidding.order.length === seatCount &&
    state.deal.seatCount === seatCount &&
    state.deal.firstHands.length === seatCount &&
    state.deal.hands.length === seatCount &&
    state.capturedCards.length === seatCount;
  const cards = [
    ...state.deal.deck,
    ...state.deal.firstHands.flat(),
    ...state.deal.hands.flat(),
    ...state.capturedCards.flat(),
    ...tricks.flatMap((trick) => trick.plays.map((play) => play.card)),
    ...(state.trump.indicator ? [state.trump.indicator] : []),
  ];
  const cardsMatchProfile = cards.every(
    (card) =>
      profile.deckRanks.includes(card.rank) &&
      card.points === (profile.cardPoints[card.rank] ?? 0),
  );
  if (!seatsAreValid || !arraysMatchProfile || !cardsMatchProfile) {
    throw new Error("Gameplay aggregate invariants are invalid");
  }
}

export function serializeGameplaySnapshot(
  hand: GameplayHand,
): SerializedGameplaySnapshotRecord {
  const cloned = structuredClone(hand);
  const { profile, ...state } = cloned;
  return {
    ruleProfileId: profile.id,
    schemaVersion: 2,
    state,
  };
}

export function hydrateGameplaySnapshot(
  record: GameplaySnapshotRecord,
): GameplayHand {
  if (record.schemaVersion === 1) return decodeGameplayHand(record);
  if (record.schemaVersion !== 2) {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Gameplay snapshot version is not supported",
    );
  }
  try {
    const profile = getRuleProfile(record.ruleProfileId);
    const state = stateSchema.parse(structuredClone(record.state));
    assertAggregateConsistency(state, record.ruleProfileId);
    return { ...state, profile } as unknown as GameplayHand;
  } catch {
    throw new GameplaySnapshotCodecError(
      "INVALID_GAMEPLAY_SNAPSHOT",
      "Gameplay snapshot state is invalid",
    );
  }
}
