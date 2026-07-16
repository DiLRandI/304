import {
  applyGameplayCommand,
  bidAmount,
  type GameplayCommand,
  legalGameplayCommands,
  type SeatIndex,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  decodeGameplayHand,
  encodeGameplayHand,
  type LegacyGameplaySnapshotRecord,
} from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";
import { legacyStartedGameplaySnapshot } from "./support/legacy-gameplay-snapshot-fixture.js";

function transition(
  source: LegacyGameplaySnapshotRecord,
  command: GameplayCommand,
) {
  const before = decodeGameplayHand(source);
  const decision = applyGameplayCommand(before, command);
  if (!decision.ok) throw new Error(decision.error.message);
  return {
    hand: decision.hand,
    snapshot: encodeGameplayHand(decision.hand, { command, source }),
  };
}

function startTrumpChoice(): {
  readonly indicatorId: string;
  readonly maker: SeatIndex;
  readonly snapshot: LegacyGameplaySnapshotRecord;
} {
  let snapshot = legacyStartedGameplaySnapshot({
    secondBiddingEnabled: false,
  });
  while (decodeGameplayHand(snapshot).phase === "four-bidding") {
    const before = decodeGameplayHand(snapshot);
    const actor = before.activeSeat;
    if (actor === null) throw new Error("Expected an active bidding seat");
    const command: GameplayCommand =
      before.bidding.currentBid === null
        ? { actor, amount: bidAmount(200), type: "BID" }
        : { actor, type: "PASS_BID" };
    snapshot = transition(snapshot, command).snapshot;
  }
  const before = decodeGameplayHand(snapshot);
  const maker = before.activeSeat;
  const indicator = maker === null ? null : before.deal.firstHands[maker]?.[0];
  if (maker === null || !indicator) {
    throw new Error("Expected a trump indicator candidate");
  }
  return {
    indicatorId: indicator.id,
    maker,
    snapshot: transition(snapshot, {
      actor: maker,
      cardId: indicator.id,
      type: "SELECT_TRUMP",
    }).snapshot,
  };
}

describe("legacy gameplay trump choice", () => {
  it.each([
    { commandType: "TRUMP_OPEN", mode: "open" },
    { commandType: "TRUMP_CLOSE", mode: "closed" },
  ] as const)("encodes $mode trump choice into trick play", (scenario) => {
    const started = startTrumpChoice();

    const result = transition(started.snapshot, {
      actor: started.maker,
      type: scenario.commandType,
    });
    const state = result.snapshot.state as {
      activeSeat: number | null;
      currentTrick: {
        leaderSeat: number;
        plays: unknown[];
        points: number;
      } | null;
      phase: string;
      seats: Array<{ hand: Array<{ cardId: string }> }>;
      trump: { card: { cardId: string } | null };
      trumpClosed: boolean;
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(result.hand.currentTrick).toMatchObject({
      activeSeat: started.maker,
      leaderSeat: started.maker,
      plays: [],
      status: "active",
    });
    expect(result.hand.trump).toMatchObject({
      maker: started.maker,
      mode: scenario.mode,
      open: scenario.mode === "open",
    });
    expect(state.phase).toBe("trick_play");
    expect(state.activeSeat).toBe(started.maker);
    expect(state.currentTrick).toMatchObject({
      leaderSeat: started.maker,
      plays: [],
      points: 0,
    });
    expect(state.trumpClosed).toBe(scenario.mode === "closed");
    expect(state.trump.card?.cardId ?? null).toBe(
      scenario.mode === "closed" ? started.indicatorId : null,
    );
    expect(
      state.seats[started.maker]?.hand.some(
        (card) => card.cardId === started.indicatorId,
      ),
    ).toBe(scenario.mode === "open");
    expect(legalGameplayCommands(result.hand, started.maker)).toContainEqual(
      expect.objectContaining({ type: "PLAY_CARD" }),
    );
  });
});
