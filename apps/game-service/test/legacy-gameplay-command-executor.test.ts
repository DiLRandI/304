import type { GameCommand } from "@three-zero-four/contracts";
import type { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { LegacyGameplayCommandExecutor } from "../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-command-executor.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import type { RoomLease } from "../src/contexts/rooms/application/room-coordination-ports.js";
import type { StoredRoom } from "../src/contexts/rooms/application/room-persistence-model.js";
import type { RoomPersistenceStore } from "../src/contexts/rooms/application/room-persistence-store.js";

const room: StoredRoom = {
  eventVersion: 2,
  hostPlayerId: "player-1",
  id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
  inviteCode: "304-AbCdEfGhIjKl_123",
  recoveryError: null,
  ruleProfileId: "classic_304_4p",
  settings: { botDifficulty: "easy", enableSecondBidding: true },
  status: "in_hand",
  updatedAt: new Date(0),
};
const session: AuthenticatedSession = {
  displayName: "Asha",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: room.hostPlayerId,
  sessionId: "session-1",
};
const command: GameCommand = {
  action: { type: "PASS_BID" },
  commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
  expectedVersion: room.eventVersion,
  roomId: room.id,
};

describe("LegacyGameplayCommandExecutor", () => {
  it("applies and atomically persists a versioned gameplay command", async () => {
    const snapshot = { phase: "four_bidding" };
    const applyAction = vi.fn(() => ({ ok: true }));
    const engine = {
      applyAction,
      getLegalActions: vi.fn(() => []),
      getPrompt: vi.fn(() => null),
      getPublicState: vi.fn(() => ({ phase: "four_bidding" })),
      getSeatView: vi.fn(() => ({ displayName: "Asha", type: "human" })),
      getSnapshot: vi.fn(() => snapshot),
      state: {
        phase: "four_bidding",
        seats: [{ type: "human", userId: session.playerId }],
      },
    } as unknown as GameEngine;
    const appendEventAndSnapshot = vi.fn(async () => 3);
    const store = {
      appendEventAndSnapshot,
      findDuplicate: vi.fn(async () => null),
      loadRoomForUpdate: vi.fn(async () => room),
      markRecoveryFailed: vi.fn(async () => undefined),
      requireHumanSeat: vi.fn(async () => 0),
      transaction: async <Result>(
        work: (transaction: unknown) => Promise<Result>,
      ): Promise<Result> => work(Symbol("transaction")),
    } as unknown as RoomPersistenceStore;
    const lease: RoomLease = {
      async withLease<Result>(
        _roomId: string,
        work: () => Promise<Result>,
      ): Promise<Result> {
        return work();
      },
    };
    const schedule = vi.fn(async () => undefined);
    const executor = new LegacyGameplayCommandExecutor({
      automation: { schedule },
      lease,
      recovery: { recover: vi.fn(async () => engine) },
      store,
    });

    await expect(
      executor.submitCommand(session, command),
    ).resolves.toMatchObject({
      eventVersion: 3,
      roomId: room.id,
      status: "in_hand",
      viewerSeatIndex: 0,
      view: { isHost: true },
    });
    expect(applyAction).toHaveBeenCalledWith({
      actorSeatIndex: 0,
      seatIndex: 0,
      type: "PASS_BID",
    });
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(expect.any(Symbol), {
      actorPlayerId: session.playerId,
      commandId: command.commandId,
      eventType: "GAME_ACTION",
      expectedVersion: 2,
      payload: { action: command.action },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshot,
      status: "in_hand",
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: 3 }),
      engine,
    );
  });
});
