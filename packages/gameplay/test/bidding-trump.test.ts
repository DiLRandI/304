import { describe, expect, it } from "vitest";
import {
  type BiddingState,
  bidAmount,
  buildDeck,
  chooseTrumpMode,
  createFourCardBidding,
  decideBidding,
  evolveBidding,
  type GameplayCommand,
  getRuleProfile,
  legalBidAmounts,
  seatIndex,
  selectTrumpIndicator,
  startSecondBidding,
} from "../src/index.js";

function apply(state: BiddingState, command: GameplayCommand): BiddingState {
  const decision = decideBidding(
    getRuleProfile("classic_304_4p"),
    state,
    command,
  );
  expect(decision.ok).toBe(true);
  if (!decision.ok) return state;
  return evolveBidding(state, decision.events);
}

describe("four-card bidding", () => {
  const profile = getRuleProfile("classic_304_4p");

  it("starts left of the dealer and applies partner bid restrictions", () => {
    let state = createFourCardBidding(profile, seatIndex(3, 4), true);
    expect(state.order).toEqual([0, 1, 2, 3]);
    expect(legalBidAmounts(profile, state, seatIndex(0, 4))).toEqual([
      160, 170, 180, 190, 200, 210,
    ]);

    state = apply(state, {
      actor: seatIndex(0, 4),
      amount: bidAmount(160),
      type: "BID",
    });
    state = apply(state, { actor: seatIndex(1, 4), type: "PASS_BID" });

    expect(state.activeSeat).toBe(2);
    expect(legalBidAmounts(profile, state, seatIndex(2, 4))).toEqual([
      200, 210, 220,
    ]);
  });

  it("completes immediately at the effective maximum bid", () => {
    const state = createFourCardBidding(profile, seatIndex(3, 4), true);
    const nearMaximum = {
      ...state,
      currentBid: bidAmount(290),
      currentBidder: seatIndex(3, 4),
    };
    const completed = apply(nearMaximum, {
      actor: seatIndex(0, 4),
      amount: bidAmount(300),
      type: "BID",
    });

    expect(completed.status).toBe("complete");
    expect(completed.currentBid).toBe(300);
    expect(completed.currentBidder).toBe(0);
  });

  it("cancels a hand after every seat passes without a bid", () => {
    let state = createFourCardBidding(profile, seatIndex(3, 4), true);
    for (const actor of [0, 1, 2, 3]) {
      state = apply(state, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }

    expect(state.status).toBe("cancelled");
    expect(state.activeSeat).toBeNull();
  });
});

describe("second bidding and trump", () => {
  const profile = getRuleProfile("classic_304_4p");

  it("starts with the first-round maker and requires at least 250", () => {
    const state = startSecondBidding(
      profile,
      seatIndex(2, 4),
      bidAmount(160),
      seatIndex(2, 4),
    );

    expect(state.order).toEqual([2, 3, 0, 1]);
    expect(state.activeSeat).toBe(2);
    expect(legalBidAmounts(profile, state, seatIndex(2, 4))).toEqual([
      250, 260, 270, 280, 290, 300,
    ]);
  });

  it("gives every seat one action before an all-pass second round ends", () => {
    let state = startSecondBidding(
      profile,
      seatIndex(0, 4),
      bidAmount(160),
      seatIndex(0, 4),
    );
    for (const actor of [0, 1, 2]) {
      state = apply(state, {
        actor: seatIndex(actor, 4),
        type: "PASS_BID",
      });
    }
    expect(state.status).toBe("active");
    expect(state.activeSeat).toBe(3);

    state = apply(state, {
      actor: seatIndex(3, 4),
      type: "PASS_BID",
    });
    expect(state.status).toBe("complete");
  });

  it("selects an eligible indicator and enforces maker-only trump mode", () => {
    const hand = buildDeck(profile).slice(0, 4);
    const selected = selectTrumpIndicator(
      hand,
      hand.slice(0, 2).map((card) => card.id),
      hand[1]?.id,
    );
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.indicator.id).toBe(hand[1]?.id);
    expect(selected.hand.map((card) => card.id)).not.toContain(hand[1]?.id);

    expect(
      chooseTrumpMode(profile, seatIndex(1, 4), seatIndex(1, 4), "closed"),
    ).toEqual({ mode: "closed", ok: true });
    expect(
      chooseTrumpMode(profile, seatIndex(1, 4), seatIndex(2, 4), "open"),
    ).toEqual({
      error: {
        code: "NOT_TRUMP_MAKER",
        message: "Only trump maker can choose trump mode",
      },
      ok: false,
    });
  });
});
