import {
  applyGameplayCommand,
  bidAmount,
  type Card,
  cardId,
  type GameplayCommand,
  type GameplayHand,
  getRuleProfile,
  type RuleProfile,
  type RuleProfileId,
  type Suit,
  seatIndex,
} from "@three-zero-four/gameplay";
import { z } from "zod";
import { GameplaySnapshotCodecError } from "./gameplay-snapshot-codec-error.js";

export interface LegacyGameplaySnapshotRecord {
  readonly ruleProfileId: RuleProfileId;
  readonly schemaVersion: number;
  readonly state: unknown;
}

export interface LegacyGameplayCompatibilityMetadata {
  readonly command: GameplayCommand;
  readonly source: LegacyGameplaySnapshotRecord;
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
const legacyTokenSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const legacyCancelledResultSchema = z.object({
  noScore: z.literal(true),
  reason: z.literal("All players passed. No score movement this hand."),
  tokens: legacyTokenSchema,
});
const legacyScoredResultSchema = z.object({
  bid: z.number().int().min(160).max(304),
  bidderTeam: z.enum(["A", "B"]),
  bidderTeamPoints: z.number().int().nonnegative(),
  matchComplete: z.boolean(),
  movement: z.number().int().positive(),
  otherTeamPoints: z.number().int().nonnegative(),
  success: z.boolean(),
  tokens: legacyTokenSchema,
  winningTeam: z.enum(["A", "B"]),
});
const legacyBiddingSchema = z.object({
  actedInRound: z.array(z.boolean().nullish()),
  actions: z.array(legacyBidActionSchema),
  activeOrderIndex: z.number().int().nonnegative(),
  currentBid: z.number().int().nonnegative(),
  currentBidSeat: z.number().int().nonnegative().nullable(),
  initialMakerSeat: z.number().int().nonnegative().nullable(),
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
  handResult: z
    .union([legacyCancelledResultSchema, legacyScoredResultSchema])
    .nullable(),
  phase: z.enum([
    "four_bidding",
    "trump_selection",
    "second_bidding",
    "trump_choice",
    "trick_play",
    "trick_result",
    "hand_result",
    "match_complete",
  ]),
  profile: z.object({ id: z.string() }),
  profileId: z.string(),
  seatCount: z.union([z.literal(4), z.literal(6)]),
  seats: z.array(legacySeatSchema),
  tokens: legacyTokenSchema,
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

function cardToLegacy(card: Card): z.infer<typeof legacyCardSchema> {
  return {
    cardId: card.id,
    points: card.points,
    rank: card.rank,
    suit: card.suit,
  };
}

function trickToLegacy(
  trick: NonNullable<GameplayHand["currentTrick"]>,
): z.infer<typeof legacyTrickSchema> {
  return {
    leaderSeat: trick.leaderSeat,
    openedTrumpThisTrick: trick.openedTrump,
    plays: trick.plays.map((play) => ({
      card: cardToLegacy(play.card),
      faceDown: play.faceDown,
      fromIndicator: play.fromIndicator,
      seatIndex: play.actor,
    })),
    points: trick.points,
    winnerSeat: trick.winnerSeat,
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
    header.data.phase !== "trick_result" &&
    header.data.phase !== "hand_result" &&
    header.data.phase !== "match_complete"
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
    const isHandResult = state.phase === "hand_result";
    const isMatchComplete = state.phase === "match_complete";
    const isTerminal = isHandResult || isMatchComplete;
    const isSecondRound = state.bidding.phase === "second";
    const isCancelledResult =
      state.handResult !== null && "noScore" in state.handResult;
    const resultMatchComplete =
      state.handResult !== null &&
      "matchComplete" in state.handResult &&
      state.handResult.matchComplete;
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
      (isSecondBidding && state.bidding.phase !== "second") ||
      ((isSecondBidding || isTrumpChoice) &&
        (state.activeSeat === null ||
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
              state.currentTrick.winnerSeat === undefined)))) ||
      (isTerminal &&
        (state.handResult === null ||
          (!isCancelledResult && state.activeSeat !== null) ||
          isMatchComplete !== resultMatchComplete ||
          state.tokens[0] !== state.handResult.tokens[0] ||
          state.tokens[1] !== state.handResult.tokens[1]))
    ) {
      throw invalidSnapshot();
    }
    const actor = (value: number) => seatIndex(value, profile.seatCount);
    const activeSeat =
      isTerminal || state.activeSeat === null ? null : actor(state.activeSeat);
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
    const openingActions = state.bidding.actions.slice(
      0,
      state.bidding.actions.length - state.bidding.secondRound.actionsTaken,
    );
    const openingBid = openingActions
      .toReversed()
      .find((action) => action.type === "bid");
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
    const biddingWasCancelled =
      isTerminal && state.handResult !== null && "noScore" in state.handResult;
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
        previousBid: isSecondRound ? bidAmount(openingBid?.amount ?? 0) : null,
        round: biddingRound,
        seatCount: profile.seatCount,
        secondBiddingEnabled: state.bidding.secondRound.enabled,
        status: biddingIsActive
          ? "active"
          : biddingWasCancelled
            ? "cancelled"
            : "complete",
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
                : isTrickResult
                  ? "trick-result"
                  : isHandResult
                    ? "hand-result"
                    : "match-complete",
      profile,
      result:
        state.handResult === null
          ? null
          : "noScore" in state.handResult
            ? {
                noScore: true,
                reason: state.handResult.reason,
                tokens: state.handResult.tokens,
              }
            : {
                bid: bidAmount(state.handResult.bid),
                bidderTeam: state.handResult.bidderTeam,
                bidderTeamPoints: state.handResult.bidderTeamPoints,
                matchComplete: state.handResult.matchComplete,
                movement: state.handResult.movement,
                otherTeamPoints: state.handResult.otherTeamPoints,
                success: state.handResult.success,
                tokens: state.handResult.tokens,
                winningTeam: state.handResult.winningTeam,
              },
      tokens: state.tokens,
      trump: {
        indicator:
          !state.trump.isOpen && state.trump.card
            ? cardFromLegacy(state.trump.card, profile)
            : null,
        maker: trumpMaker,
        mode:
          isTrickPhase || (isTerminal && trumpMaker !== null)
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

export function encodeGameplayHand(
  hand: GameplayHand,
  metadata: LegacyGameplayCompatibilityMetadata,
): LegacyGameplaySnapshotRecord {
  const before = decodeGameplayHand(metadata.source);
  const isOpeningTransition =
    before.phase === "four-bidding" &&
    (hand.phase === "four-bidding" || hand.phase === "trump-selection") &&
    (metadata.command.type === "BID" || metadata.command.type === "PASS_BID");
  const isIndicatorSelection =
    before.phase === "trump-selection" &&
    (hand.phase === "second-bidding" || hand.phase === "trump-choice") &&
    metadata.command.type === "SELECT_TRUMP";
  const isSecondBiddingTransition =
    before.phase === "second-bidding" &&
    (hand.phase === "second-bidding" ||
      hand.phase === "trump-choice" ||
      hand.phase === "trump-selection") &&
    (metadata.command.type === "BID" || metadata.command.type === "PASS_BID");
  const isTrumpChoiceTransition =
    before.phase === "trump-choice" &&
    hand.phase === "trick-play" &&
    (metadata.command.type === "TRUMP_OPEN" ||
      metadata.command.type === "TRUMP_CLOSE");
  const isCardPlayTransition =
    before.phase === "trick-play" &&
    (hand.phase === "trick-play" || hand.phase === "trick-result") &&
    metadata.command.type === "PLAY_CARD";
  if (
    !isOpeningTransition &&
    !isIndicatorSelection &&
    !isSecondBiddingTransition &&
    !isTrumpChoiceTransition &&
    !isCardPlayTransition
  ) {
    throw new GameplaySnapshotCodecError(
      "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
      "Gameplay compatibility snapshot transition is not supported",
    );
  }
  const expected = applyGameplayCommand(before, metadata.command);
  if (!expected.ok || JSON.stringify(expected.hand) !== JSON.stringify(hand)) {
    throw invalidSnapshot();
  }

  const state = structuredClone(metadata.source.state) as z.infer<
    typeof openingGameplaySchema
  >;
  openingGameplaySchema.parse(state);
  const compatibilityState = state as typeof state & {
    bidding: z.infer<typeof legacyBiddingSchema> & {
      secondRound: z.infer<typeof legacyBiddingSchema>["secondRound"] & {
        anyBid: boolean;
      };
    };
    currentLedSuit: Suit | null;
    trump: z.infer<typeof openingGameplaySchema>["trump"] & {
      indicatorVisible: boolean;
    };
    trumpCard: z.infer<typeof legacyCardSchema> | null;
    trumpSuit: Suit | null;
  };
  const activeSeat = hand.activeSeat;
  if (activeSeat === null && hand.phase !== "trick-result") {
    throw invalidSnapshot();
  }
  state.activeSeat = activeSeat;
  if (metadata.command.type === "BID" || metadata.command.type === "PASS_BID") {
    state.bidding.actions.push(
      metadata.command.type === "BID"
        ? {
            amount: metadata.command.amount,
            seatIndex: metadata.command.actor,
            type: "bid",
          }
        : { seatIndex: metadata.command.actor, type: "pass" },
    );
  }
  state.bidding.currentBid = hand.bidding.currentBid ?? 0;
  state.bidding.currentBidSeat = hand.bidding.currentBidder;
  if (isOpeningTransition) {
    state.bidding.initialMakerSeat = hand.trump.maker;
  }
  state.bidding.phase = hand.bidding.round;
  state.bidding.secondRound.enabled = hand.bidding.secondBiddingEnabled;
  if (hand.bidding.round === "four") {
    state.bidding.actedInRound = [...hand.bidding.actedInRound];
    state.bidding.activeOrderIndex = hand.bidding.activeOrderIndex;
    state.bidding.noBidPasses = hand.bidding.noBidPasses;
    state.bidding.order = [...hand.bidding.order];
    state.bidding.passesAfterBid = hand.bidding.passesAfterBid;
  } else {
    state.bidding.secondRound.actionsTaken = hand.bidding.actionsTaken;
    state.bidding.secondRound.activeOrderIndex = hand.bidding.activeOrderIndex;
    state.bidding.secondRound.order = [...hand.bidding.order];
    state.bidding.secondRound.previousBid = hand.bidding.currentBid ?? 0;
    if (isIndicatorSelection) {
      state.bidding.secondRound.previousBidSeat = hand.bidding.currentBidder;
    }
    compatibilityState.bidding.secondRound.anyBid =
      hand.bidding.currentBid !== hand.bidding.previousBid;
  }
  state.deck = hand.deal.deck.map(cardToLegacy);
  state.completedTricks = hand.completedTricks.map(trickToLegacy);
  state.currentTrick = hand.currentTrick
    ? trickToLegacy(hand.currentTrick)
    : null;
  state.dealerSeat = hand.dealer;
  state.handNumber = hand.handNumber;
  state.phase =
    hand.phase === "four-bidding"
      ? "four_bidding"
      : hand.phase === "trump-selection"
        ? "trump_selection"
        : hand.phase === "second-bidding"
          ? "second_bidding"
          : hand.phase === "trump-choice"
            ? "trump_choice"
            : hand.phase === "trick-play"
              ? "trick_play"
              : "trick_result";
  state.seats = state.seats.map((seat, index) => ({
    ...seat,
    firstHand: (hand.deal.firstHands[index] ?? []).map(cardToLegacy),
    hand: (hand.deal.hands[index] ?? []).map(cardToLegacy),
    wonCards: (hand.capturedCards[index] ?? []).map(cardToLegacy),
  }));
  state.tokens = [...hand.tokens];
  state.trump.card = hand.trump.indicator
    ? cardToLegacy(hand.trump.indicator)
    : null;
  state.trump.isOpen = hand.trump.open;
  state.trump.maker = hand.trump.maker;
  state.trump.suit = hand.trump.suit;
  if (hand.trump.mode !== null) {
    state.trumpClosed = hand.trump.mode === "closed";
  }
  compatibilityState.currentLedSuit =
    hand.currentTrick?.plays[0]?.card.suit ?? null;
  compatibilityState.trump.indicatorVisible = hand.trump.open;
  compatibilityState.trumpCard = hand.trump.indicator
    ? cardToLegacy(hand.trump.indicator)
    : null;
  compatibilityState.trumpSuit = hand.trump.suit;

  return {
    ruleProfileId: hand.profile.id,
    schemaVersion: 1,
    state,
  };
}
