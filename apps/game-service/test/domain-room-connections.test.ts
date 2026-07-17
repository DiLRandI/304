import { describe, expect, it, vi } from "vitest";
import { serializeGameplaySnapshot } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import { DomainRoomConnections } from "../src/contexts/rooms/adapters/integration/domain-room-connections.js";
import type {
  RoomLease,
  RoomPresence,
} from "../src/contexts/rooms/application/room-coordination-ports.js";
import type {
  StoredRoom,
  StoredSeat,
} from "../src/contexts/rooms/application/room-persistence-model.js";
import type { RoomPersistenceStore } from "../src/contexts/rooms/application/room-persistence-store.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

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
const session: AuthenticatedSession = {
  displayName: "Asha",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: room.hostPlayerId,
  sessionId: "session-1",
};

function harness(connectionStatus: StoredSeat["connectionStatus"]) {
  const hand = startedGameplayHand(room.ruleProfileId);
  const seats: StoredSeat[] = Array.from({ length: 4 }, (_, seatIndex) => ({
    botDifficulty: seatIndex === 0 ? null : "easy",
    connectionStatus: seatIndex === 0 ? connectionStatus : "online",
    displayName: seatIndex === 0 ? session.displayName : `Bot ${seatIndex}`,
    occupantType: seatIndex === 0 ? "human" : "bot",
    playerId: seatIndex === 0 ? session.playerId : null,
    seatIndex,
  }));
  const transaction = Symbol("transaction");
  const appendEventAndSnapshot = vi.fn(async () => room.eventVersion + 1);
  const markSeatOffline = vi.fn(async () => undefined);
  const markSeatOnline = vi.fn(async () => 0);
  const store = {
    appendEventAndSnapshot,
    loadRoomForUpdate: vi.fn(async () => room),
    loadSeats: vi.fn(async () => seats),
    markRecoveryFailed: vi.fn(async () => undefined),
    markSeatOffline,
    markSeatOnline,
    requireHumanSeat: vi.fn(async () => 0),
    transaction: async <Result>(
      work: (value: unknown) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  } as unknown as RoomPersistenceStore;
  const lease: RoomLease = {
    withLease: async <Result>(
      _roomId: string,
      work: () => Promise<Result>,
    ): Promise<Result> => work(),
  };
  const presence: RoomPresence = {
    remove: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
  };
  const recover = vi.fn(async () => hand);
  const schedule = vi.fn(async () => undefined);
  const connections = new DomainRoomConnections({
    automation: { schedule },
    identities: { nextCommandId: () => "connection-command-1" },
    lease,
    presence,
    recovery: { recover },
    store,
  });
  return {
    appendEventAndSnapshot,
    connections,
    markSeatOffline,
    markSeatOnline,
    presence,
    recover,
    schedule,
    hand,
  };
}

describe("DomainRoomConnections", () => {
  it("refreshes an already-online seat without recovering gameplay", async () => {
    const { connections, markSeatOnline, presence, recover, schedule } =
      harness("online");

    await connections.markRealtimePresence(session, room.id);

    expect(presence.touch).toHaveBeenCalledWith(room.id, session.playerId);
    expect(markSeatOnline).toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("persists room-owned disconnection without mutating gameplay", async () => {
    const {
      appendEventAndSnapshot,
      connections,
      hand,
      markSeatOffline,
      presence,
      schedule,
    } = harness("online");

    await connections.markRealtimeDisconnected(session, room.id);

    expect(markSeatOffline).toHaveBeenCalled();
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(expect.any(Symbol), {
      actorPlayerId: session.playerId,
      commandId: "connection-command-1",
      eventType: "PLAYER_DISCONNECTED",
      expectedVersion: room.eventVersion,
      payload: { seatIndex: 0 },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshot: serializeGameplaySnapshot(hand).state,
      snapshotSchemaVersion: 2,
      status: "in_hand",
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: room.eventVersion + 1 }),
      expect.objectContaining({
        state: expect.objectContaining({
          seats: expect.arrayContaining([
            expect.objectContaining({
              connectionStatus: "disconnected",
              type: "human",
            }),
          ]),
        }),
      }),
    );
    expect(presence.remove).toHaveBeenCalledWith(room.id, session.playerId);
  });
});
