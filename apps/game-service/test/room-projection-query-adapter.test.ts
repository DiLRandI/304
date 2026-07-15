import { GameEngine } from "@three-zero-four/game-engine";
import { describe, expect, it, vi } from "vitest";
import { RecoveryError } from "../src/contexts/gameplay/application/gameplay-recovery-error.js";
import type { AuthenticatedSession } from "../src/contexts/player-access/application/player-session-ports.js";
import { LobbyRoomProjectionPresenter } from "../src/contexts/rooms/adapters/delivery/lobby-room-presenter.js";
import { GameplayRoomProjectionReader } from "../src/contexts/rooms/adapters/integration/gameplay-room-projection-reader.js";
import { RoomProjectionQueryAdapter } from "../src/contexts/rooms/adapters/orchestration/room-projection-query-adapter.js";
import type { RoomLease } from "../src/contexts/rooms/application/room-coordination-ports.js";
import type {
  StoredRoom,
  StoredSeat,
} from "../src/contexts/rooms/application/room-persistence-model.js";
import type { RoomPersistenceStore } from "../src/contexts/rooms/application/room-persistence-store.js";

const room: StoredRoom = {
  eventVersion: 5,
  hostPlayerId: "host-player",
  id: "room-1",
  inviteCode: "304-room",
  recoveryError: null,
  ruleProfileId: "classic_304_4p",
  settings: { botDifficulty: "easy", enableSecondBidding: true },
  status: "lobby",
  updatedAt: new Date(0),
};
const seats: StoredSeat[] = [
  {
    botDifficulty: null,
    connectionStatus: "online",
    displayName: "Host",
    occupantType: "human",
    playerId: room.hostPlayerId,
    seatIndex: 0,
  },
  ...[1, 2, 3].map((seatIndex) => ({
    botDifficulty: "easy",
    connectionStatus: "online" as const,
    displayName: null,
    occupantType: "bot" as const,
    playerId: null,
    seatIndex,
  })),
];
const session: AuthenticatedSession = {
  displayName: "Host",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: room.hostPlayerId,
  sessionId: "session-1",
};

function harness(
  overrides: {
    recovery?: () => Promise<GameEngine>;
    room?: StoredRoom;
    viewerSeatIndex?: number | null;
  } = {},
) {
  const storedRoom = overrides.room ?? room;
  const transaction = Symbol("transaction");
  const markRecoveryFailed = vi.fn(async () => undefined);
  const store = {
    findSeatIndex: vi.fn(async () => overrides.viewerSeatIndex ?? 0),
    loadRoomByReference: vi.fn(async () => storedRoom),
    loadRoomForUpdate: vi.fn(async () => storedRoom),
    loadSeats: vi.fn(async () => seats),
    markRecoveryFailed,
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
  const recover = vi.fn(overrides.recovery ?? (async () => new GameEngine()));
  return {
    markRecoveryFailed,
    queries: new RoomProjectionQueryAdapter({
      activeRoomProjection: new GameplayRoomProjectionReader({ recover }),
      lease,
      lobbyProjection: new LobbyRoomProjectionPresenter(),
      store,
    }),
    recover,
  };
}

describe("RoomProjectionQueryAdapter", () => {
  it("projects a lobby snapshot without invoking gameplay recovery", async () => {
    const { queries, recover } = harness();

    await expect(queries.getSnapshot(session, room.id)).resolves.toMatchObject({
      eventVersion: room.eventVersion,
      roomId: room.id,
      status: "lobby",
      viewerSeatIndex: 0,
      view: { isHost: true },
    });
    expect(recover).not.toHaveBeenCalled();
  });

  it("recovers and projects an active room for its seated viewer", async () => {
    const engine = new GameEngine({
      botDifficulty: "easy",
      enableSecondBidding: true,
      humanCount: 1,
      initialSeats: [
        {
          connectionStatus: "online",
          displayName: "Host",
          type: "human",
          userId: room.hostPlayerId,
        },
        ...[1, 2, 3].map((index) => ({
          botDifficulty: "easy" as const,
          displayName: `Bot ${index}`,
          type: "bot" as const,
        })),
      ],
      playerName: "Host",
      ruleProfile: "classic_304_4p",
      tableMode: "classic_4",
    });
    engine.startMatch();
    const activeRoom = { ...room, status: "in_hand" as const };
    const { queries, recover } = harness({
      recovery: async () => engine,
      room: activeRoom,
    });

    await expect(
      queries.getSnapshot(session, activeRoom.id),
    ).resolves.toMatchObject({
      roomId: activeRoom.id,
      status: "in_hand",
      viewerSeatIndex: 0,
      view: {
        isHost: true,
        privateSeat: { displayName: "Host", type: "human" },
      },
    });
    expect(recover).toHaveBeenCalledOnce();
  });

  it("quarantines a room when gameplay recovery fails", async () => {
    const activeRoom = { ...room, status: "in_hand" as const };
    const { markRecoveryFailed, queries } = harness({
      recovery: async () => {
        throw new RecoveryError(activeRoom.id);
      },
      room: activeRoom,
    });

    await expect(
      queries.getSnapshot(session, activeRoom.id),
    ).rejects.toMatchObject({ code: "ROOM_RECOVERY_FAILED" });
    expect(markRecoveryFailed).toHaveBeenCalledWith(
      activeRoom.id,
      "Snapshot replay failed",
    );
  });
});
