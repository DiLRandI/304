import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { DomainGameplayRecovery } from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-recovery.js";
import type { GameplayHandRecoveryStore } from "../src/contexts/gameplay/application/gameplay-hand-recovery.js";

describe("DomainGameplayRecovery schema-v1 compatibility", () => {
  it("hydrates a compatibility snapshot and replays newer domain events", async () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const actorSeatIndex = engine.getSnapshot().activeSeat;
    if (actorSeatIndex === null) throw new Error("Expected an active seat");
    const transaction = Symbol("transaction");
    const store: GameplayHandRecoveryStore = {
      findSeatIndex: vi.fn(async () => actorSeatIndex),
      loadEventsAfter: vi.fn(async () => [
        {
          actorPlayerId: "player-1",
          eventType: "GAME_ACTION",
          payload: {
            action: { type: "PASS_BID" },
            seatIndex: actorSeatIndex,
          },
        },
      ]),
      loadSnapshot: vi.fn(async () => ({
        eventVersion: 4,
        ruleProfileId: "classic_304_4p",
        schemaVersion: 1,
        state: engine.getSnapshot(),
      })),
    };

    const hand = await new DomainGameplayRecovery(store).recover(transaction, {
      eventVersion: 5,
      id: "room-1",
      ruleProfileId: "classic_304_4p",
    });

    expect(hand.bidding.actionsTaken).toBe(1);
    expect(store.loadEventsAfter).toHaveBeenCalledWith(
      "room-1",
      4,
      transaction,
    );
  });

  it("falls back from a lobby snapshot to the authoritative start event", async () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    const lobbySnapshot = engine.getSnapshot();
    engine.startMatch();
    const transaction = Symbol("transaction");
    const store: GameplayHandRecoveryStore = {
      findSeatIndex: vi.fn(async () => null),
      loadEventsAfter: vi.fn(async () => [
        {
          actorPlayerId: "player-1",
          eventType: "ROOM_STARTED",
          payload: {
            ruleProfileId: "classic_304_4p",
            state: engine.getSnapshot(),
          },
        },
      ]),
      loadSnapshot: vi.fn(async () => ({
        eventVersion: 4,
        ruleProfileId: "classic_304_4p",
        schemaVersion: 1,
        state: lobbySnapshot,
      })),
    };

    const hand = await new DomainGameplayRecovery(store).recover(transaction, {
      eventVersion: 5,
      id: "room-1",
      ruleProfileId: "classic_304_4p",
    });

    expect(hand.phase).toBe("four-bidding");
    expect(hand.deal.hands).toHaveLength(4);
  });
});
