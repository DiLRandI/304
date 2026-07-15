import type { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { LegacyGameplayConnections } from "../src/contexts/gameplay/adapters/integration/legacy-gameplay-connections.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import type {
  RoomLease,
  RoomPresence,
} from "../src/contexts/rooms/application/room-coordination-ports.js";
import type {
  StoredRoom,
  StoredSeat,
} from "../src/contexts/rooms/application/room-persistence-model.js";
import type { RoomPersistenceStore } from "../src/contexts/rooms/application/room-persistence-store.js";

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

function seat(connectionStatus: StoredSeat["connectionStatus"]): StoredSeat {
  return {
    botDifficulty: null,
    connectionStatus,
    displayName: session.displayName,
    occupantType: "human",
    playerId: session.playerId,
    seatIndex: 0,
  };
}

function harness(connectionStatus: StoredSeat["connectionStatus"]) {
  const transaction = Symbol("transaction");
  const appendEventAndSnapshot = vi.fn(async () => room.eventVersion + 1);
  const markSeatOffline = vi.fn(async () => undefined);
  const markSeatOnline = vi.fn(async () => 0);
  const store = {
    appendEventAndSnapshot,
    loadRoomForUpdate: vi.fn(async () => room),
    loadSeats: vi.fn(async () => [seat(connectionStatus)]),
    markRecoveryFailed: vi.fn(async () => undefined),
    markSeatOffline,
    markSeatOnline,
    requireHumanSeat: vi.fn(async () => 0),
    transaction: async <Result>(
      work: (value: unknown) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  } as unknown as RoomPersistenceStore;
  const lease: RoomLease = {
    async withLease<Result>(
      _roomId: string,
      work: () => Promise<Result>,
    ): Promise<Result> {
      return work();
    },
  };
  const presence: RoomPresence = {
    remove: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
  };
  const engine = {
    getSnapshot: vi.fn(() => ({ phase: "four_bidding" })),
    state: {
      phase: "four_bidding",
      seats: [
        {
          connectionStatus,
          type: "human",
          userId: session.playerId,
        },
      ],
    },
  } as unknown as GameEngine;
  const recover = vi.fn(async () => engine);
  const schedule = vi.fn(async () => undefined);
  const connections = new LegacyGameplayConnections({
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
    engine,
    markSeatOffline,
    markSeatOnline,
    presence,
    recover,
    schedule,
  };
}

describe("LegacyGameplayConnections", () => {
  it("refreshes an already-online seat without recovering gameplay", async () => {
    const { connections, markSeatOnline, presence, recover, schedule } =
      harness("online");

    await connections.markRealtimePresence(session, room.id);

    expect(presence.touch).toHaveBeenCalledWith(room.id, session.playerId);
    expect(markSeatOnline).toHaveBeenCalledWith(
      expect.any(Symbol),
      room.id,
      session.playerId,
    );
    expect(recover).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("persists and schedules a disconnected seat transition", async () => {
    const {
      appendEventAndSnapshot,
      connections,
      engine,
      markSeatOffline,
      presence,
      schedule,
    } = harness("online");

    await connections.markRealtimeDisconnected(session, room.id);

    expect(engine.state.seats[0]?.connectionStatus).toBe("disconnected");
    expect(markSeatOffline).toHaveBeenCalledWith(
      expect.any(Symbol),
      room.id,
      session.playerId,
    );
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(expect.any(Symbol), {
      actorPlayerId: session.playerId,
      commandId: "connection-command-1",
      eventType: "PLAYER_DISCONNECTED",
      expectedVersion: room.eventVersion,
      payload: { seatIndex: 0 },
      roomId: room.id,
      ruleProfileId: room.ruleProfileId,
      snapshot: { phase: "four_bidding" },
      status: "in_hand",
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.objectContaining({ eventVersion: room.eventVersion + 1 }),
      engine,
    );
    expect(presence.remove).toHaveBeenCalledWith(room.id, session.playerId);
  });
});
