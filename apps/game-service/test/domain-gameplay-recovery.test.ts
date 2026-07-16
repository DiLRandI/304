import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { DomainGameplayRecovery } from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-recovery.js";
import type { GameplayHandRecoveryStore } from "../src/contexts/gameplay/application/gameplay-hand-recovery.js";

describe("DomainGameplayRecovery", () => {
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

  it("rejects a snapshot from a different rule profile", async () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();
    const store = {
      loadSnapshot: vi.fn(async () => ({
        eventVersion: 1,
        ruleProfileId: "classic_304_4p",
        schemaVersion: 1,
        state: engine.getSnapshot(),
      })),
    } as unknown as GameplayHandRecoveryStore;

    await expect(
      new DomainGameplayRecovery(store).recover(Symbol("transaction"), {
        eventVersion: 1,
        id: "room-1",
        ruleProfileId: "six_304_36",
      }),
    ).rejects.toMatchObject({ roomId: "room-1" });
  });
});
