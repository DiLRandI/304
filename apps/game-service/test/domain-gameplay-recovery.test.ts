import { describe, expect, it, vi } from "vitest";
import { DomainGameplayRecovery } from "../src/contexts/gameplay/adapters/persistence/domain-gameplay-recovery.js";
import { serializeGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type { GameplayHandRecoveryStore } from "../src/contexts/gameplay/application/gameplay-hand-recovery.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

describe("DomainGameplayRecovery", () => {
  it("hydrates a domain snapshot and replays newer domain events", async () => {
    const started = startedGameplayHand("classic_304_4p", true, true);
    const actorSeatIndex = started.activeSeat;
    if (actorSeatIndex === null) throw new Error("Expected an active seat");
    const snapshot = serializeGameplaySnapshot(started);
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
        ...snapshot,
      })),
    };

    const hand = await new DomainGameplayRecovery(store).recover(transaction, {
      eventVersion: 5,
      id: "room-1",
      ruleProfileId: "classic_304_4p",
    });

    expect(hand.bidding.actionsTaken).toBe(1);
    expect(hand.endHandWhenOutcomeCertain).toBe(true);
    expect(store.loadEventsAfter).toHaveBeenCalledWith(
      "room-1",
      4,
      transaction,
    );
  });

  it("recovers from the authoritative start event without a lobby snapshot", async () => {
    const started = serializeGameplaySnapshot(startedGameplayHand());
    const transaction = Symbol("transaction");
    const store: GameplayHandRecoveryStore = {
      findSeatIndex: vi.fn(async () => null),
      loadEventsAfter: vi.fn(async () => [
        {
          actorPlayerId: "player-1",
          eventType: "ROOM_CREATED",
          payload: { ruleProfileId: "classic_304_4p" },
        },
        {
          actorPlayerId: "player-1",
          eventType: "ROOM_STARTED",
          payload: started,
        },
      ]),
      loadSnapshot: vi.fn(async () => null),
    };

    const hand = await new DomainGameplayRecovery(store).recover(transaction, {
      eventVersion: 2,
      id: "room-1",
      ruleProfileId: "classic_304_4p",
    });

    expect(hand.phase).toBe("four-bidding");
    expect(hand.deal.hands).toHaveLength(4);
    expect(store.loadEventsAfter).toHaveBeenCalledWith(
      "room-1",
      0,
      transaction,
    );
  });

  it("rejects a snapshot from a different rule profile", async () => {
    const snapshot = serializeGameplaySnapshot(startedGameplayHand());
    const store = {
      loadSnapshot: vi.fn(async () => ({
        eventVersion: 1,
        ...snapshot,
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
