import type { GameAction } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { DomainGameplayAutomationExecutor } from "../src/contexts/automation/adapters/integration/domain-gameplay-automation-executor.js";
import type {
  AutomationJobLease,
  AutomationJobRoom,
  AutomationJobSeat,
  AutomationJobStore,
  ClaimedDomainAutomationJob,
} from "../src/contexts/automation/application/automation-job-store.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.js";
import {
  hydrateGameplaySnapshot,
  serializeGameplaySnapshot,
} from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";

function startedSnapshot() {
  const engine = new GameEngine({
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  return engine.getSnapshot();
}

function pausedTrickSnapshot() {
  const engine = new GameEngine({
    enableSecondBidding: false,
    humanCount: 4,
    ruleProfile: "classic_304_4p",
  });
  engine.startMatch();
  const apply = (action: GameAction): void => {
    const actor = engine.getSnapshot().activeSeat;
    if (actor === null) throw new Error("Expected an active gameplay seat");
    expect(
      engine.applyAction({
        ...action,
        actorSeatIndex: actor,
        seatIndex: actor,
      }),
    ).toEqual({ ok: true });
  };
  apply({ amount: 160, type: "BID" });
  while (engine.getSnapshot().phase === "four_bidding") {
    apply({ type: "PASS_BID" });
  }
  const maker = engine.getSnapshot().activeSeat;
  const indicator =
    maker === null
      ? undefined
      : engine
          .getLegalActions(maker)
          .find((candidate) => candidate.type === "SELECT_TRUMP");
  if (!indicator) throw new Error("Expected a trump indicator action");
  apply(indicator);
  apply({ type: "TRUMP_OPEN" });
  while (engine.getSnapshot().phase === "trick_play") {
    const actor = engine.getSnapshot().activeSeat;
    const action =
      actor === null
        ? undefined
        : engine
            .getLegalActions(actor)
            .find((candidate) => candidate.type === "PLAY_CARD");
    if (!action) throw new Error("Expected a legal card play");
    apply(action);
  }
  return engine.getSnapshot();
}

const room: AutomationJobRoom = {
  eventVersion: 7,
  id: "room-1",
  ruleProfileId: "classic_304_4p",
  status: "in_hand",
};

function seats(
  targetSeatIndex: number,
  target: Partial<AutomationJobSeat> = {},
) {
  return Array.from(
    { length: 4 },
    (_, seatIndex): AutomationJobSeat => ({
      connectionStatus: "online",
      occupantType: seatIndex === targetSeatIndex ? "bot" : "human",
      playerId: `player-${seatIndex}`,
      seatIndex,
      ...target,
    }),
  );
}

function job(
  targetSeatIndex: number,
  kind: ClaimedDomainAutomationJob["kind"] = "BOT_ACTION",
): ClaimedDomainAutomationJob {
  return {
    attempts: 1,
    dueAt: new Date(0),
    expectedEventVersion: room.eventVersion,
    id: "job-1",
    kind,
    roomId: room.id,
    targetSeatIndex,
  };
}

function harness(options: {
  readonly room?: AutomationJobRoom;
  readonly seats: AutomationJobSeat[];
  readonly snapshot: ReturnType<typeof startedSnapshot>;
}) {
  const transaction = Symbol("transaction");
  const appendEventAndSnapshot = vi.fn(async () => room.eventVersion + 1);
  const markSeatAutopilot = vi.fn(async () => undefined);
  const store = {
    appendEventAndSnapshot,
    loadRoomForUpdate: vi.fn(async () => options.room ?? room),
    loadSeats: vi.fn(async () => options.seats),
    markRecoveryFailed: vi.fn(async () => undefined),
    markSeatAutopilot,
    transaction: async <Result>(
      work: (value: unknown) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  } as AutomationJobStore;
  const lease: AutomationJobLease = {
    async withLease<Result>(
      _roomId: string,
      work: () => Promise<Result>,
    ): Promise<Result> {
      return work();
    },
  };
  const recovered = decodeGameplayHand({
    ruleProfileId: room.ruleProfileId,
    schemaVersion: 1,
    state: options.snapshot,
  });
  const recover = vi.fn(async () => recovered);
  const schedule = vi.fn(async () => undefined);
  return {
    appendEventAndSnapshot,
    executor: new DomainGameplayAutomationExecutor({
      automation: { schedule },
      lease,
      presence: { onlinePlayerIds: vi.fn(async () => new Set<string>()) },
      random: { next: vi.fn(() => 0) },
      recovery: { recover },
      store,
    }),
    markSeatAutopilot,
    recover,
    schedule,
  };
}

describe("DomainGameplayAutomationExecutor", () => {
  it("rejects a stale job before recovering gameplay", async () => {
    const snapshot = startedSnapshot();
    const hand = decodeGameplayHand({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 1,
      state: snapshot,
    });
    if (hand.activeSeat === null) throw new Error("Expected an active seat");
    const { executor, recover } = harness({
      room: { ...room, eventVersion: room.eventVersion + 1 },
      seats: seats(hand.activeSeat),
      snapshot,
    });

    await expect(executor.run(job(hand.activeSeat))).resolves.toBe("stale");
    expect(recover).not.toHaveBeenCalled();
  });

  it("chooses, applies, and persists a current domain bot command", async () => {
    const snapshot = startedSnapshot();
    const before = decodeGameplayHand({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 1,
      state: snapshot,
    });
    if (before.activeSeat === null) throw new Error("Expected an active seat");
    const targetSeats = seats(before.activeSeat);
    const { appendEventAndSnapshot, executor, schedule } = harness({
      seats: targetSeats,
      snapshot,
    });

    await expect(executor.run(job(before.activeSeat))).resolves.toBe(
      "completed",
    );

    expect(appendEventAndSnapshot).toHaveBeenCalledOnce();
    const input = appendEventAndSnapshot.mock.calls[0]?.[1];
    expect(input).toMatchObject({
      actorPlayerId: null,
      commandId: "job-1",
      eventType: "BOT_ACTION",
      expectedVersion: room.eventVersion,
      payload: {
        action: expect.not.objectContaining({ actor: expect.anything() }),
        seatIndex: before.activeSeat,
      },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshotSchemaVersion: 2,
      status: "in_hand",
    });
    const after = hydrateGameplaySnapshot({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 2,
      state: input?.snapshot,
    });
    expect(after).not.toEqual(before);
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: room.eventVersion + 1 }),
      expect.objectContaining({
        state: expect.objectContaining({ seats: expect.any(Array) }),
      }),
    );
  });

  it("enables autopilot without mutating the Gameplay aggregate", async () => {
    const snapshot = startedSnapshot();
    const hand = decodeGameplayHand({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 1,
      state: snapshot,
    });
    if (hand.activeSeat === null) throw new Error("Expected an active seat");
    const targetSeats = seats(hand.activeSeat, { occupantType: "human" });
    const { appendEventAndSnapshot, executor, markSeatAutopilot, schedule } =
      harness({ seats: targetSeats, snapshot });

    await expect(
      executor.run(job(hand.activeSeat, "TURN_TIMEOUT")),
    ).resolves.toBe("completed");

    expect(markSeatAutopilot).toHaveBeenCalledWith(
      expect.any(Symbol),
      room.id,
      hand.activeSeat,
    );
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({
        eventType: "AUTOPILOT_ENABLED",
        snapshot: serializeGameplaySnapshot(hand).state,
        snapshotSchemaVersion: 2,
      }),
    );
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.any(Object),
      expect.objectContaining({
        state: expect.objectContaining({
          seats: expect.arrayContaining([
            expect.objectContaining({
              autopilot: true,
              connectionStatus: "autopilot",
              type: "human",
            }),
          ]),
        }),
      }),
    );
  });

  it("persists domain trick advancement as its dedicated event", async () => {
    const snapshot = pausedTrickSnapshot();
    const hand = decodeGameplayHand({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 1,
      state: snapshot,
    });
    const winnerSeat = hand.currentTrick?.winnerSeat;
    if (winnerSeat === null || winnerSeat === undefined) {
      throw new Error("Expected a completed trick winner");
    }
    const { appendEventAndSnapshot, executor } = harness({
      seats: seats(winnerSeat),
      snapshot,
    });

    await expect(executor.run(job(winnerSeat, "TRICK_ADVANCE"))).resolves.toBe(
      "completed",
    );

    expect(appendEventAndSnapshot).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({
        eventType: "TRICK_ADVANCED",
        payload: { winnerSeat },
        snapshotSchemaVersion: 2,
      }),
    );
    const persisted = appendEventAndSnapshot.mock.calls[0]?.[1];
    const after = hydrateGameplaySnapshot({
      ruleProfileId: room.ruleProfileId,
      schemaVersion: 2,
      state: persisted?.snapshot,
    });
    expect(after.phase).toBe("trick-play");
    expect(after.activeSeat).toBe(winnerSeat);
  });
});
