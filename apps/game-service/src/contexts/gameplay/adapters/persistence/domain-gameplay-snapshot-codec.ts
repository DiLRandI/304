import {
  bidAmount,
  type Card,
  cardId,
  type GameplayHand,
  getRuleProfile,
  type RuleProfile,
  type RuleProfileId,
  seatIndex,
} from "@three-zero-four/gameplay";
import { z } from "zod";
import { GameplaySnapshotCodecError } from "./gameplay-snapshot-codec.js";

export interface LegacyGameplaySnapshotRecord {
  readonly ruleProfileId: RuleProfileId;
  readonly schemaVersion: number;
  readonly state: unknown;
}

const legacyCardSchema = z.object({
  cardId: z.string(),
  points: z.number().int().nonnegative(),
  rank: z.enum(["6", "7", "8", "9", "10", "J", "Q", "K", "A"]),
  suit: z.enum(["clubs", "diamonds", "hearts", "spades"]),
});
const legacySeatSchema = z.object({
  firstHand: z.array(legacyCardSchema),
  hand: z.array(legacyCardSchema),
  index: z.number().int().nonnegative(),
  wonCards: z.array(legacyCardSchema),
});
const legacyBiddingSchema = z.object({
  actedInRound: z.array(z.boolean().nullish()),
  actions: z.array(z.unknown()),
  activeOrderIndex: z.number().int().nonnegative(),
  currentBid: z.number().int().nonnegative(),
  currentBidSeat: z.number().int().nonnegative().nullable(),
  noBidPasses: z.number().int().nonnegative(),
  order: z.array(z.number().int().nonnegative()),
  passesAfterBid: z.number().int().nonnegative(),
  phase: z.literal("four"),
  secondRound: z.object({ enabled: z.boolean() }),
});
const startedFourBiddingSchema = z.object({
  activeSeat: z.number().int().nonnegative(),
  bidding: legacyBiddingSchema,
  dealerSeat: z.number().int().nonnegative(),
  deck: z.array(legacyCardSchema),
  handNumber: z.number().int().positive(),
  phase: z.literal("four_bidding"),
  profile: z.object({ id: z.string() }),
  profileId: z.string(),
  seatCount: z.union([z.literal(4), z.literal(6)]),
  seats: z.array(legacySeatSchema),
  tokens: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  trump: z.object({
    card: z.null(),
    isOpen: z.literal(false),
    maker: z.null(),
    suit: z.null(),
  }),
});

function invalidSnapshot(): GameplaySnapshotCodecError {
  return new GameplaySnapshotCodecError(
    "INVALID_GAMEPLAY_SNAPSHOT",
    "Gameplay compatibility snapshot state is invalid",
  );
}

function cardFromLegacy(
  value: z.infer<typeof legacyCardSchema>,
  profile: RuleProfile,
): Card {
  if (
    !profile.deckRanks.includes(value.rank) ||
    value.points !== (profile.cardPoints[value.rank] ?? 0)
  ) {
    throw invalidSnapshot();
  }
  return {
    id: cardId(value.cardId),
    points: value.points,
    rank: value.rank,
    suit: value.suit,
  };
}

export function decodeGameplayHand(
  record: LegacyGameplaySnapshotRecord,
): GameplayHand {
  if (record.schemaVersion !== 1) {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Gameplay compatibility snapshot version is not supported",
    );
  }
  const header = z.object({ phase: z.string() }).safeParse(record.state);
  if (!header.success) throw invalidSnapshot();
  if (header.data.phase === "setup") {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Lobby snapshots do not contain a gameplay hand",
    );
  }
  if (header.data.phase !== "four_bidding") {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Gameplay compatibility snapshot phase is not supported",
    );
  }

  try {
    const state = startedFourBiddingSchema.parse(structuredClone(record.state));
    const profile = getRuleProfile(record.ruleProfileId);
    if (
      state.profileId !== record.ruleProfileId ||
      state.profile.id !== record.ruleProfileId ||
      state.seatCount !== profile.seatCount ||
      state.seats.length !== profile.seatCount ||
      state.bidding.order.length !== profile.seatCount
    ) {
      throw invalidSnapshot();
    }
    const actor = (value: number) => seatIndex(value, profile.seatCount);
    const mapCards = (values: z.infer<typeof legacyCardSchema>[]) =>
      values.map((value) => cardFromLegacy(value, profile));
    const seats = state.seats.toSorted(
      (first, second) => first.index - second.index,
    );
    if (seats.some((seat, index) => seat.index !== index)) {
      throw invalidSnapshot();
    }

    return {
      activeSeat: actor(state.activeSeat),
      bidding: {
        actedInRound: Array.from(
          { length: profile.seatCount },
          (_, index) => state.bidding.actedInRound[index] ?? false,
        ),
        actionsTaken: state.bidding.actions.length,
        activeOrderIndex: state.bidding.activeOrderIndex,
        activeSeat: actor(state.activeSeat),
        currentBid:
          state.bidding.currentBid === 0
            ? null
            : bidAmount(state.bidding.currentBid),
        currentBidder:
          state.bidding.currentBidSeat === null
            ? null
            : actor(state.bidding.currentBidSeat),
        noBidPasses: state.bidding.noBidPasses,
        order: state.bidding.order.map(actor),
        passesAfterBid: state.bidding.passesAfterBid,
        previousBid: null,
        round: "four",
        seatCount: profile.seatCount,
        secondBiddingEnabled: state.bidding.secondRound.enabled,
        status: "active",
      },
      capturedCards: seats.map((seat) => mapCards(seat.wonCards)),
      completedTricks: [],
      currentTrick: null,
      deal: {
        deck: mapCards(state.deck),
        firstHands: seats.map((seat) => mapCards(seat.firstHand)),
        hands: seats.map((seat) => mapCards(seat.hand)),
        seatCount: profile.seatCount,
      },
      dealer: actor(state.dealerSeat),
      handNumber: state.handNumber,
      phase: "four-bidding",
      profile,
      result: null,
      tokens: state.tokens,
      trump: {
        indicator: null,
        maker: null,
        mode: null,
        open: false,
        suit: null,
      },
    };
  } catch (error) {
    if (error instanceof GameplaySnapshotCodecError) throw error;
    throw invalidSnapshot();
  }
}
