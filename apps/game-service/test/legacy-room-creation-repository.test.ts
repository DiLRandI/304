import {
  commandId,
  createLobby,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import {
  LegacyRoomCreationRepository,
  type LegacyRoomCreationStore,
} from "../src/contexts/rooms/adapters/orchestration/legacy-room-creation-repository.js";
import type { RoomCreationCommit } from "../src/contexts/rooms/application/create-room.js";
import type {
  RoomCreationInput,
  RoomSessionCommandDuplicate,
} from "../src/contexts/rooms/application/room-coordinator-store.js";
import type {
  StoredRoom,
  StoredSeat,
} from "../src/contexts/rooms/application/room-persistence-model.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const aggregate = createLobby({
  host: { displayName: "Asha", playerId: hostId },
  id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
  inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
  profileId: "classic_304_4p",
  settings: { botDifficulty: "easy", enableSecondBidding: true },
});
const commit: RoomCreationCommit = {
  commandId: commandId("d7c60215-243f-4599-80cb-e8ad78c6ae1f"),
  response: projectRoom(aggregate, hostId),
  room: aggregate,
  sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
};
const winningResponse = {
  ...commit.response,
  id: roomId("f63f4748-bf45-488e-a09e-c47c27b26df5"),
  inviteCode: inviteCode("304-ZyXwVuTsRqPo_987"),
};

class CreationStore implements LegacyRoomCreationStore {
  readonly creations: RoomCreationInput[] = [];
  duplicate: RoomSessionCommandDuplicate | null = null;
  room: StoredRoom | null = null;
  seats: StoredSeat[] = [];

  async createRoom(input: RoomCreationInput): Promise<StoredRoom> {
    this.creations.push(input);
    if (!this.duplicate) {
      this.duplicate = {
        deduplicationResponse: input.deduplicationResponse,
        roomId: input.id,
      };
    }
    return {
      eventVersion: 1,
      hostPlayerId: input.hostPlayerId,
      id: this.duplicate.roomId,
      inviteCode: input.inviteCode,
      recoveryError: null,
      ruleProfileId: input.ruleProfileId,
      settings: input.settings,
      status: "lobby",
      updatedAt: new Date(0),
    };
  }

  async findSessionDuplicate(): Promise<RoomSessionCommandDuplicate | null> {
    return this.duplicate;
  }

  async loadRoomByReference(): Promise<StoredRoom | null> {
    return this.room;
  }

  async loadSeats(): Promise<StoredSeat[]> {
    return this.seats;
  }
}

describe("LegacyRoomCreationRepository", () => {
  it("maps a room aggregate to durable records and a legacy lobby snapshot", async () => {
    const store = new CreationStore();
    const repository = new LegacyRoomCreationRepository(store);

    await expect(repository.create(commit)).resolves.toEqual(commit.response);

    expect(store.creations).toHaveLength(1);
    expect(store.creations[0]).toMatchObject({
      commandId: commit.commandId,
      deduplicationResponse: commit.response,
      hostPlayerId: hostId,
      id: aggregate.id,
      inviteCode: aggregate.inviteCode,
      ruleProfileId: aggregate.profileId,
      sessionId: commit.sessionId,
      settings: aggregate.settings,
      snapshot: { phase: "setup" },
    });
    expect(store.creations[0]?.seats).toMatchObject([
      {
        connectionStatus: "online",
        displayName: "Asha",
        occupantType: "human",
        playerId: hostId,
        seatIndex: 0,
      },
      ...[1, 2, 3].map((seatIndex) => ({
        connectionStatus: "disconnected",
        occupantType: "empty",
        seatIndex,
      })),
    ]);
  });

  it("returns the persistence winner when another create commits first", async () => {
    const store = new CreationStore();
    store.duplicate = {
      deduplicationResponse: winningResponse,
      roomId: winningResponse.id,
    };
    const repository = new LegacyRoomCreationRepository(store);

    await expect(repository.create(commit)).resolves.toEqual(winningResponse);
  });

  it("replays a validated response without loading the room", async () => {
    const store = new CreationStore();
    store.duplicate = {
      deduplicationResponse: commit.response,
      roomId: aggregate.id,
    };
    const repository = new LegacyRoomCreationRepository(store);

    await expect(
      repository.findDuplicate(commit.sessionId, commit.commandId),
    ).resolves.toEqual(commit.response);
  });

  it("reconstructs replay for rooms created before response persistence", async () => {
    const store = new CreationStore();
    store.duplicate = { roomId: aggregate.id };
    store.room = {
      eventVersion: 1,
      hostPlayerId: hostId,
      id: aggregate.id,
      inviteCode: aggregate.inviteCode,
      recoveryError: null,
      ruleProfileId: aggregate.profileId,
      settings: aggregate.settings,
      status: "lobby",
      updatedAt: new Date(0),
    };
    store.seats = [
      {
        botDifficulty: null,
        connectionStatus: "online",
        displayName: "Asha",
        occupantType: "human",
        playerId: hostId,
        seatIndex: 0,
      },
      ...[1, 2, 3].map((seatIndex) => ({
        botDifficulty: null,
        connectionStatus: "disconnected" as const,
        displayName: null,
        occupantType: "empty" as const,
        playerId: null,
        seatIndex,
      })),
    ];
    const repository = new LegacyRoomCreationRepository(store);

    await expect(
      repository.findDuplicate(commit.sessionId, commit.commandId),
    ).resolves.toEqual(commit.response);
  });
});
