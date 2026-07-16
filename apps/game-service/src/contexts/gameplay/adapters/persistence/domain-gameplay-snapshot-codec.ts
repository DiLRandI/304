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
const legacyBidActionSchema = z.object({
  amount: z.number().int().nonnegative().optional(),
  seatIndex: z.number().int().nonnegative(),
  type: z.enum(["bid", "pass"]),
});
const legacyPlaySchema = z.object({
  card: legacyCardSchema,
  faceDown: z.boolean(),
  fromIndicator: z.boolean(),
  seatIndex: z.number().int().nonnegative(),
});
const legacyTrickSchema = z.object({
  leaderSeat: z.number().int().nonnegative(),
  openedTrumpThisTrick: z.boolean().optional(),
  plays: z.array(legacyPlaySchema),
  points: z.number().int().nonnegative(),
  winnerSeat: z.number().int().nonnegative().nullable().optional(),
});
const legacyBiddingSchema = z.object({
  actedInRound: z.array(z.boolean().nullish()),
  actions: z.array(legacyBidActionSchema),
  activeOrderIndex: z.number().int().nonnegative(),
  currentBid: z.number().int().nonnegative(),
  currentBidSeat: z.number().int().nonnegative().nullable(),
  noBidPasses: z.number().int().nonnegative(),
  order: z.array(z.number().int().nonnegative()),
  passesAfterBid: z.number().int().nonnegative(),
  phase: z.enum(["four", "second"]),
  secondRound: z.object({
    actionsTaken: z.number().int().nonnegative(),
    activeOrderIndex: z.number().int().nonnegative(),
    enabled: z.boolean(),
    order: z.array(z.number().int().nonnegative()),
    previousBid: z.number().int().nonnegative(),
    previousBidSeat: z.number().int().nonnegative().nullable(),
  }),
});
const openingGameplaySchema = z.object({
  activeSeat: z.number().int().nonnegative().nullable(),
  bidding: legacyBiddingSchema,
  completedTricks: z.array(legacyTrickSchema),
  currentTrick: legacyTrickSchema.nullable(),
  dealerSeat: z.number().int().nonnegative(),
  deck: z.array(legacyCardSchema),
  handNumber: z.number().int().positive(),
  phase: z.enum([
    "four_bidding",
    "trump_selection",
    "second_bidding",
    "trump_choice",
    "trick_play",
    "trick_result",
  ]),
  profile: z.object({ id: z.string() }),
  profileId: z.string(),
  seatCount: z.union([z.literal(4), z.literal(6)]),
  seats: z.array(legacySeatSchema),
  tokens: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  trumpClosed: z.boolean(),
  trump: z.object({
    card: legacyCardSchema.nullable(),
    isOpen: z.boolean(),
    maker: z.number().int().nonnegative().nullable(),
    suit: z.enum(["clubs", "diamonds", "hearts", "spades"]).nullable(),
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
  if (
    header.data.phase !== "four_bidding" &&
    header.data.phase !== "trump_selection" &&
    header.data.phase !== "second_bidding" &&
    header.data.phase !== "trump_choice" &&
    header.data.phase !== "trick_play" &&
    header.data.phase !== "trick_result"
  ) {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Gameplay compatibility snapshot phase is not supported",
    );
  }

  try {
    const state = openingGameplaySchema.parse(structuredClone(record.state));
    const profile = getRuleProfile(record.ruleProfileId);
    if (
      state.profileId !== record.ruleProfileId ||
      state.profile.id !== record.ruleProfileId ||
      state.seatCount !== profile.seatCount ||
      state.seats.length !== profile.seatCount ||
      state.bidding.order.length !== profile.seatCount ||
      (state.bidding.phase === "second" &&
        state.bidding.secondRound.order.length !== profile.seatCount)
    ) {
      throw invalidSnapshot();
    }
    const isFourBidding = state.phase === "four_bidding";
    const isTrumpSelection = state.phase === "trump_selection";
    const isSecondBidding = state.phase === "second_bidding";
    const isTrumpChoice = state.phase === "trump_choice";
    const isTrickPlay = state.phase === "trick_play";
    const isTrickResult = state.phase === "trick_result";
    const isTrickPhase = isTrickPlay || isTrickResult;
    const isSecondRound = state.bidding.phase === "second";
    const trumpMaker =
      state.trump.maker === null
        ? null
        : seatIndex(state.trump.maker, profile.seatCount);
    if (
      (isFourBidding &&
        (state.bidding.phase !== "four" ||
          state.activeSeat === null ||
          trumpMaker !== null ||
          state.trump.card !== null ||
          state.trump.suit !== null)) ||
      (isTrumpSelection &&
        (trumpMaker === null ||
          state.activeSeat === null ||
          state.activeSeat !== trumpMaker ||
          state.bidding.currentBid === 0 ||
          state.bidding.currentBidSeat !== trumpMaker ||
          state.trump.card !== null ||
          state.trump.suit !== null)) ||
      ((isSecondBidding || isTrumpChoice) &&
        (state.bidding.phase !== "second" ||
          state.activeSeat === null ||
          trumpMaker === null ||
          state.bidding.currentBid === 0 ||
          state.trump.card === null ||
          state.trump.suit === null ||
          state.trump.card.suit !== state.trump.suit)) ||
      (isTrickPhase &&
        (trumpMaker === null ||
          state.trump.suit === null ||
          state.currentTrick === null ||
          (isTrickPlay && state.activeSeat === null) ||
          (isTrickResult &&
            (state.activeSeat !== null ||
              state.currentTrick.winnerSeat === null ||
              state.currentTrick.winnerSeat === undefined))))
    ) {
      throw invalidSnapshot();
    }
    const actor = (value: number) => seatIndex(value, profile.seatCount);
    const activeSeat =
      state.activeSeat === null ? null : actor(state.activeSeat);
    const mapCards = (values: z.infer<typeof legacyCardSchema>[]) =>
      values.map((value) => cardFromLegacy(value, profile));
    const seats = state.seats.toSorted(
      (first, second) => first.index - second.index,
    );
    if (seats.some((seat, index) => seat.index !== index)) {
      throw invalidSnapshot();
    }
    const secondActions =
      state.bidding.secondRound.actionsTaken === 0
        ? []
        : state.bidding.actions.slice(-state.bidding.secondRound.actionsTaken);
    const secondActedInRound = Array.from(
      { length: profile.seatCount },
      () => false,
    );
    for (const action of secondActions) {
      secondActedInRound[actor(action.seatIndex)] = true;
    }
    const secondPassesAfterBid = secondActions
      .toReversed()
      .findIndex((action) => action.type === "bid");
    const biddingRound = isSecondRound ? "second" : "four";
    const biddingIsActive = isFourBidding || isSecondBidding;
    const mapTrick = (
      trick: z.infer<typeof legacyTrickSchema>,
      trickActiveSeat: ReturnType<typeof actor> | null,
    ) => ({
      activeSeat: trickActiveSeat,
      leaderSeat: actor(trick.leaderSeat),
      openedTrump: trick.openedTrumpThisTrick ?? false,
      plays: trick.plays.map((play) => ({
        actor: actor(play.seatIndex),
        card: cardFromLegacy(play.card, profile),
        faceDown: play.faceDown,
        fromIndicator: play.fromIndicator,
      })),
      points: trick.points,
      status:
        trick.winnerSeat == null ? ("active" as const) : ("complete" as const),
      winnerSeat: trick.winnerSeat == null ? null : actor(trick.winnerSeat),
    });

    return {
      activeSeat,
      bidding: {
        actedInRound: isSecondRound
          ? secondActedInRound
          : Array.from(
              { length: profile.seatCount },
              (_, index) => state.bidding.actedInRound[index] ?? false,
            ),
        actionsTaken: isSecondRound
          ? state.bidding.secondRound.actionsTaken
          : state.bidding.actions.length,
        activeOrderIndex: isSecondRound
          ? state.bidding.secondRound.activeOrderIndex % profile.seatCount
          : state.bidding.activeOrderIndex,
        activeSeat: biddingIsActive ? activeSeat : null,
        currentBid:
          state.bidding.currentBid === 0
            ? null
            : bidAmount(state.bidding.currentBid),
        currentBidder:
          state.bidding.currentBidSeat === null
            ? null
            : actor(state.bidding.currentBidSeat),
        noBidPasses: state.bidding.noBidPasses,
        order: (isSecondRound
          ? state.bidding.secondRound.order
          : state.bidding.order
        ).map(actor),
        passesAfterBid: isSecondRound
          ? secondPassesAfterBid === -1
            ? secondActions.length
            : secondPassesAfterBid
          : state.bidding.passesAfterBid,
        previousBid: isSecondRound
          ? bidAmount(state.bidding.secondRound.previousBid)
          : null,
        round: biddingRound,
        seatCount: profile.seatCount,
        secondBiddingEnabled: state.bidding.secondRound.enabled,
        status: biddingIsActive ? "active" : "complete",
      },
      capturedCards: seats.map((seat) => mapCards(seat.wonCards)),
      completedTricks: state.completedTricks.map((trick) =>
        mapTrick(trick, null),
      ),
      currentTrick: state.currentTrick
        ? mapTrick(
            state.currentTrick,
            state.currentTrick.winnerSeat == null ? activeSeat : null,
          )
        : null,
      deal: {
        deck: mapCards(state.deck),
        firstHands: seats.map((seat) => mapCards(seat.firstHand)),
        hands: seats.map((seat) => mapCards(seat.hand)),
        seatCount: profile.seatCount,
      },
      dealer: actor(state.dealerSeat),
      handNumber: state.handNumber,
      phase: isFourBidding
        ? "four-bidding"
        : isTrumpSelection
          ? "trump-selection"
          : isSecondBidding
            ? "second-bidding"
            : isTrumpChoice
              ? "trump-choice"
              : isTrickPlay
                ? "trick-play"
                : "trick-result",
      profile,
      result: null,
      tokens: state.tokens,
      trump: {
        indicator:
          !state.trump.isOpen && state.trump.card
            ? cardFromLegacy(state.trump.card, profile)
            : null,
        maker: trumpMaker,
        mode: isTrickPhase
          ? state.trump.isOpen
            ? "open"
            : state.trumpClosed
              ? "closed"
              : null
          : null,
        open: state.trump.isOpen,
        suit: state.trump.suit,
      },
    };
  } catch (error) {
    if (error instanceof GameplaySnapshotCodecError) throw error;
    throw invalidSnapshot();
  }
}
