import type { GameCommand } from "@three-zero-four/contracts";
import { describe, expect, it, vi } from "vitest";
import { DomainGameplayCommandExecutor } from "../src/contexts/gameplay/adapters/integration/domain-gameplay-command-executor.js";
import { hydrateGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type {
  GameplayCommandRoom,
  GameplayCommandStore,
} from "../src/contexts/gameplay/application/gameplay-command-store.js";
import type { GameplayActor } from "../src/contexts/gameplay/application/submit-gameplay-command.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

describe("DomainGameplayCommandExecutor", () => {
  it("applies and atomically persists a versioned domain command", async () => {
    const hand = startedGameplayHand();
    const actorSeatIndex = hand.activeSeat;
    if (actorSeatIndex === null) {
      throw new Error("Expected an active bidding seat");
    }
    const room: GameplayCommandRoom = {
      eventVersion: 2,
      hostPlayerId: "player-1",
      id: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
      inviteCode: "304-AbCdEfGhIjKl_123",
      recoveryError: null,
      ruleProfileId: "classic_304_4p",
      status: "in_hand",
    };
    const session: GameplayActor = { playerId: room.hostPlayerId };
    const command: GameCommand = {
      action: { type: "PASS_BID" },
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      expectedVersion: room.eventVersion,
      roomId: room.id,
    };
    const seats = Array.from({ length: 4 }, (_, seatIndex) => ({
      botDifficulty: seatIndex === actorSeatIndex ? null : "easy",
      connectionStatus: "online" as const,
      disconnectedAt: null,
      displayName: seatIndex === actorSeatIndex ? "Asha" : `Bot ${seatIndex}`,
      occupantType:
        seatIndex === actorSeatIndex ? ("human" as const) : ("bot" as const),
      playerId: seatIndex === actorSeatIndex ? session.playerId : null,
      seatIndex,
    }));
    const appendEventAndSnapshot = vi.fn(async () => 3);
    const store = {
      appendEventAndSnapshot,
      findDuplicate: vi.fn(async () => null),
      loadRoomForUpdate: vi.fn(async () => room),
      loadSeats: vi.fn(async () => seats),
      markRecoveryFailed: vi.fn(async () => undefined),
      requireHumanSeat: vi.fn(async () => actorSeatIndex),
      transaction: async <Result>(
        work: (transaction: unknown) => Promise<Result>,
      ): Promise<Result> => work(Symbol("transaction")),
    } as unknown as GameplayCommandStore;
    const schedule = vi.fn(async () => undefined);
    const executor = new DomainGameplayCommandExecutor({
      automation: { schedule },
      lease: {
        withLease: async <Result>(
          _roomId: string,
          work: () => Promise<Result>,
        ): Promise<Result> => work(),
      },
      recovery: { recover: vi.fn(async () => hand) },
      shuffler: {
        prepare: () => {
          throw new Error("Did not expect a new hand");
        },
      },
      store,
    });

    await expect(
      executor.submitCommand(session, command),
    ).resolves.toMatchObject({
      eventVersion: 3,
      roomId: room.id,
      status: "in_hand",
      viewerSeatIndex: actorSeatIndex,
      view: { isHost: true },
    });
    expect(hand.bidding.actionsTaken).toBe(0);
    const persisted = appendEventAndSnapshot.mock.calls[0]?.[1];
    expect(persisted).toMatchObject({
      actorPlayerId: session.playerId,
      commandId: command.commandId,
      eventType: "GAME_ACTION",
      expectedVersion: 2,
      payload: { action: command.action, seatIndex: actorSeatIndex },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshotSchemaVersion: 3,
      status: "in_hand",
    });
    expect(
      hydrateGameplaySnapshot({
        ruleProfileId: room.ruleProfileId,
        schemaVersion: 3,
        state: persisted?.snapshot,
      }).bidding.actionsTaken,
    ).toBe(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: 3 }),
      expect.objectContaining({
        state: expect.objectContaining({ phase: "four_bidding" }),
      }),
    );
  });
});
