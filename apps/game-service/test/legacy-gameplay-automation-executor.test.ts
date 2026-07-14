import type { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { LegacyGameplayAutomationExecutor } from "../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-automation-executor.js";
import type { RoomLease } from "../src/contexts/rooms/application/room-coordination-ports.js";
import type { RoomCoordinatorStore } from "../src/contexts/rooms/application/room-coordinator-store.js";
import type {
  ClaimedAutomationJob,
  StoredRoom,
} from "../src/contexts/rooms/application/room-persistence-model.js";

const room: StoredRoom = {
  eventVersion: 7,
  hostPlayerId: "player-1",
  id: "room-1",
  inviteCode: "304-room",
  recoveryError: null,
  ruleProfileId: "classic_304_4p",
  settings: { botDifficulty: "easy", enableSecondBidding: true },
  status: "in_hand",
  updatedAt: new Date(0),
};
const job: ClaimedAutomationJob = {
  attempts: 1,
  dueAt: new Date(0),
  expectedEventVersion: room.eventVersion,
  id: "job-1",
  kind: "BOT_ACTION",
  roomId: room.id,
  targetSeatIndex: 1,
};

function harness(storedRoom = room) {
  const transaction = Symbol("transaction");
  const appendEventAndSnapshot = vi.fn(async () => room.eventVersion + 1);
  const store = {
    appendEventAndSnapshot,
    loadRoomForUpdate: vi.fn(async () => storedRoom),
    markRecoveryFailed: vi.fn(async () => undefined),
    transaction: async <Result>(
      work: (value: unknown) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  } as unknown as RoomCoordinatorStore;
  const lease: RoomLease = {
    async withLease<Result>(
      _roomId: string,
      work: () => Promise<Result>,
    ): Promise<Result> {
      return work();
    },
  };
  const action = { cardId: "card-1", type: "PLAY_CARD" as const };
  const engine = {
    applyAutomationAction: vi.fn(() => ({ ok: true })),
    getBotAction: vi.fn(() => action),
    getSnapshot: vi.fn(() => ({ phase: "trick_play" })),
    state: {
      activeSeat: 1,
      phase: "trick_play",
      seats: [{ type: "human" }, { autopilot: false, type: "bot" }],
    },
  } as unknown as GameEngine;
  const recover = vi.fn(async () => engine);
  const schedule = vi.fn(async () => undefined);
  return {
    appendEventAndSnapshot,
    engine,
    executor: new LegacyGameplayAutomationExecutor({
      automation: { schedule },
      lease,
      presence: { onlinePlayerIds: vi.fn(async () => new Set<string>()) },
      recovery: { recover },
      store,
    }),
    recover,
    schedule,
  };
}

describe("LegacyGameplayAutomationExecutor", () => {
  it("rejects a stale job before recovering gameplay", async () => {
    const { executor, recover } = harness({ ...room, eventVersion: 8 });

    await expect(executor.run(job)).resolves.toBe("stale");
    expect(recover).not.toHaveBeenCalled();
  });

  it("applies and persists a current bot action", async () => {
    const { appendEventAndSnapshot, engine, executor, schedule } = harness();

    await expect(executor.run(job)).resolves.toBe("completed");

    expect(engine.applyAutomationAction).toHaveBeenCalledWith(
      { cardId: "card-1", type: "PLAY_CARD" },
      job.targetSeatIndex,
    );
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(expect.any(Symbol), {
      actorPlayerId: null,
      commandId: job.id,
      eventType: "BOT_ACTION",
      expectedVersion: room.eventVersion,
      payload: {
        action: { cardId: "card-1", type: "PLAY_CARD" },
        seatIndex: job.targetSeatIndex,
      },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshot: { phase: "trick_play" },
      status: "in_hand",
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: room.eventVersion + 1 }),
      engine,
    );
  });
});
