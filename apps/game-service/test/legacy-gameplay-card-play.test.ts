import {
  applyGameplayCommand,
  bidAmount,
  type GameplayCommand,
  legalGameplayCommands,
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

function startTrickPlay(
  trumpChoice: "TRUMP_CLOSE" | "TRUMP_OPEN",
): LegacyGameplaySnapshotRecord {
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
  const selection = decodeGameplayHand(snapshot);
  const maker = selection.activeSeat;
  const indicator =
    maker === null ? null : selection.deal.firstHands[maker]?.[0];
  if (maker === null || !indicator) {
    throw new Error("Expected a trump indicator candidate");
  }
  snapshot = transition(snapshot, {
    actor: maker,
    cardId: indicator.id,
    type: "SELECT_TRUMP",
  }).snapshot;
  return transition(snapshot, { actor: maker, type: trumpChoice }).snapshot;
}

describe("legacy gameplay card play", () => {
  it.each([
    "TRUMP_OPEN",
    "TRUMP_CLOSE",
  ] as const)("encodes an in-progress card play after %s", (trumpChoice) => {
    const source = startTrickPlay(trumpChoice);
    const before = decodeGameplayHand(source);
    const actor = before.activeSeat;
    const command =
      actor === null
        ? null
        : legalGameplayCommands(before, actor).find(
            (candidate) => candidate.type === "PLAY_CARD",
          );
    if (actor === null || !command || command.type !== "PLAY_CARD") {
      throw new Error("Expected a legal opening card play");
    }

    const result = transition(source, command);
    const sourceState = source.state as {
      currentTrick: { plays: unknown[] } | null;
    };
    const state = result.snapshot.state as {
      activeSeat: number | null;
      currentLedSuit: string | null;
      currentTrick: {
        plays: Array<{
          card: { cardId: string };
          faceDown: boolean;
          fromIndicator: boolean;
          seatIndex: number;
        }>;
      } | null;
      phase: string;
    };

    expect(decodeGameplayHand(result.snapshot)).toEqual(result.hand);
    expect(state.phase).toBe("trick_play");
    expect(state.currentLedSuit).toBe(
      result.hand.currentTrick?.plays[0]?.card.suit,
    );
    expect(state.currentTrick?.plays).toHaveLength(1);
    expect(state.currentTrick?.plays[0]).toMatchObject({
      card: { cardId: command.cardId },
      faceDown: command.faceDown,
      fromIndicator: command.fromIndicator,
      seatIndex: actor,
    });
    expect(state.activeSeat).toBe(result.hand.activeSeat);
    expect(sourceState.currentTrick?.plays).toHaveLength(0);
  });
});
