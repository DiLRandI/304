import type {
  GameplayCommand,
  GameplayDecision,
  GameplayEvent,
} from "./messages.js";
import type { RuleProfile } from "./profile.js";
import { type BidAmount, bidAmount, type SeatIndex } from "./values.js";

export interface BiddingState {
  readonly actedInRound: readonly boolean[];
  readonly actionsTaken: number;
  readonly activeOrderIndex: number;
  readonly activeSeat: SeatIndex | null;
  readonly currentBid: BidAmount | null;
  readonly currentBidder: SeatIndex | null;
  readonly noBidPasses: number;
  readonly order: readonly SeatIndex[];
  readonly passesAfterBid: number;
  readonly previousBid: BidAmount | null;
  readonly round: "four" | "second";
  readonly seatCount: 4 | 6;
  readonly secondBiddingEnabled: boolean;
  readonly status: "active" | "cancelled" | "complete";
}

function seatOrder(
  seatCount: 4 | 6,
  firstSeat: SeatIndex,
): readonly SeatIndex[] {
  return Array.from(
    { length: seatCount },
    (_, offset) => ((firstSeat + offset) % seatCount) as SeatIndex,
  );
}

export function createFourCardBidding(
  profile: RuleProfile,
  dealer: SeatIndex,
  secondBiddingEnabled: boolean,
): BiddingState {
  const firstSeat = ((dealer + 1) % profile.seatCount) as SeatIndex;
  const order = seatOrder(profile.seatCount, firstSeat);
  return {
    actedInRound: Array.from({ length: profile.seatCount }, () => false),
    actionsTaken: 0,
    activeOrderIndex: 0,
    activeSeat: order[0] ?? null,
    currentBid: null,
    currentBidder: null,
    noBidPasses: 0,
    order,
    passesAfterBid: 0,
    previousBid: null,
    round: "four",
    seatCount: profile.seatCount,
    secondBiddingEnabled,
    status: "active",
  };
}

export function startSecondBidding(
  profile: RuleProfile,
  maker: SeatIndex,
  previousBid: BidAmount,
  previousBidder: SeatIndex,
): BiddingState {
  const order = seatOrder(profile.seatCount, maker);
  return {
    actedInRound: Array.from({ length: profile.seatCount }, () => false),
    actionsTaken: 0,
    activeOrderIndex: 0,
    activeSeat: order[0] ?? null,
    currentBid: previousBid,
    currentBidder: previousBidder,
    noBidPasses: 0,
    order,
    passesAfterBid: 0,
    previousBid,
    round: "second",
    seatCount: profile.seatCount,
    secondBiddingEnabled: true,
    status: "active",
  };
}

export function legalBidAmounts(
  profile: RuleProfile,
  state: BiddingState,
  actor: SeatIndex,
): readonly BidAmount[] {
  if (state.status !== "active" || state.activeSeat !== actor) return [];

  const step =
    state.round === "four" ? profile.fourCardBidStep : profile.eightCardBidStep;
  const minimum =
    state.round === "four" ? profile.minFourCardBid : profile.minEightCardBid;
  const nextMinimum =
    state.currentBid === null
      ? minimum
      : Math.max(minimum, state.currentBid + step);

  const amounts: BidAmount[] = [];
  for (let offset = 0; offset < 6; offset += 1) {
    const amount = nextMinimum + offset * step;
    const partnerIsHighBidder =
      state.currentBidder !== null &&
      (actor + 2) % profile.seatCount === state.currentBidder;
    const restrictedFourCardBid =
      state.round === "four" &&
      amount < 200 &&
      (state.actedInRound[actor] || partnerIsHighBidder);
    if (amount <= profile.maxBid && !restrictedFourCardBid) {
      amounts.push(bidAmount(amount));
    }
  }
  return amounts;
}

function rejected(
  code: "INVALID_BID" | "INVALID_STATE" | "NOT_ACTIVE_SEAT" | "RULE_VIOLATION",
  message: string,
): GameplayDecision {
  return { error: { code, message }, ok: false };
}

function biddingEndsAfter(
  profile: RuleProfile,
  state: BiddingState,
  event: Extract<GameplayEvent, { type: "BID_PLACED" | "BID_PASSED" }>,
): GameplayEvent | null {
  if (event.type === "BID_PLACED") {
    const step =
      state.round === "four"
        ? profile.fourCardBidStep
        : profile.eightCardBidStep;
    if (event.amount + step > profile.maxBid) {
      return { type: "BIDDING_COMPLETED" };
    }
  }

  const nextActionCount = state.actionsTaken + 1;
  if (state.round === "second" && nextActionCount >= state.seatCount) {
    return { type: "BIDDING_COMPLETED" };
  }
  if (event.type === "BID_PASSED" && state.currentBid === null) {
    if (state.noBidPasses + 1 >= state.seatCount) {
      return { type: "BIDDING_CANCELLED" };
    }
  } else if (
    event.type === "BID_PASSED" &&
    state.passesAfterBid + 1 >= state.seatCount - 1
  ) {
    return { type: "BIDDING_COMPLETED" };
  }
  return null;
}

export function decideBidding(
  profile: RuleProfile,
  state: BiddingState,
  command: GameplayCommand,
): GameplayDecision {
  if (state.status !== "active") {
    return rejected("INVALID_STATE", "Bidding is not active");
  }
  if (command.type !== "BID" && command.type !== "PASS_BID") {
    return rejected("RULE_VIOLATION", "Command is not a bidding action");
  }
  if (state.activeSeat !== command.actor) {
    return rejected("NOT_ACTIVE_SEAT", "Only the active seat can bid");
  }

  const event: Extract<GameplayEvent, { type: "BID_PLACED" | "BID_PASSED" }> =
    command.type === "BID"
      ? { actor: command.actor, amount: command.amount, type: "BID_PLACED" }
      : { actor: command.actor, type: "BID_PASSED" };

  if (
    command.type === "BID" &&
    !legalBidAmounts(profile, state, command.actor).includes(command.amount)
  ) {
    return rejected("INVALID_BID", "Bid amount is not legal");
  }

  const terminalEvent = biddingEndsAfter(profile, state, event);
  return {
    events: terminalEvent === null ? [event] : [event, terminalEvent],
    ok: true,
  };
}

function advance(
  state: BiddingState,
): Pick<BiddingState, "activeOrderIndex" | "activeSeat"> {
  const activeOrderIndex = (state.activeOrderIndex + 1) % state.order.length;
  return {
    activeOrderIndex,
    activeSeat: state.order[activeOrderIndex] ?? null,
  };
}

function applyBiddingEvent(
  state: BiddingState,
  event: GameplayEvent,
): BiddingState {
  if (event.type === "BID_PLACED") {
    const actedInRound = [...state.actedInRound];
    actedInRound[event.actor] = true;
    return {
      ...state,
      ...advance(state),
      actedInRound,
      actionsTaken: state.actionsTaken + 1,
      currentBid: event.amount,
      currentBidder: event.actor,
      passesAfterBid: 0,
    };
  }
  if (event.type === "BID_PASSED") {
    const actedInRound = [...state.actedInRound];
    actedInRound[event.actor] = true;
    return {
      ...state,
      ...advance(state),
      actedInRound,
      actionsTaken: state.actionsTaken + 1,
      noBidPasses:
        state.currentBid === null ? state.noBidPasses + 1 : state.noBidPasses,
      passesAfterBid:
        state.currentBid === null
          ? state.passesAfterBid
          : state.passesAfterBid + 1,
    };
  }
  if (event.type === "BIDDING_CANCELLED") {
    return { ...state, activeSeat: null, status: "cancelled" };
  }
  if (event.type === "BIDDING_COMPLETED") {
    return { ...state, activeSeat: null, status: "complete" };
  }
  return state;
}

export function evolveBidding(
  initialState: BiddingState,
  events: readonly GameplayEvent[],
): BiddingState {
  let state = initialState;
  for (const event of events) {
    state = applyBiddingEvent(state, event);
  }
  return state;
}
