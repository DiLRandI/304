import { randomBytes, randomUUID } from "node:crypto";
import type {
  CreateRoomRequest,
  GameCommand,
  JoinRoomRequest,
  RoomProjection,
  StartRoomRequest,
} from "@three-zero-four/contracts";
import {
  type EngineSeat,
  type EngineState,
  GameEngine,
} from "@three-zero-four/game-engine";
import type { Presence, RoomLease } from "../infra/redis-coordination.js";
import { DomainError } from "./errors.js";
import {
  projectLobbyForViewer,
  projectRoomForPlayer,
} from "./room-projector.js";
import type {
  PostgresRoomStore,
  Queryable,
  RoomStatus,
  StoredRoom,
  StoredSeat,
} from "./room-store.js";
import type { AuthenticatedSession } from "./session-service.js";

class RecoveryError extends Error {
  constructor(readonly roomId: string) {
    super("Room recovery failed");
  }
}

interface RoomCoordinatorDependencies {
  store: PostgresRoomStore;
  lease: RoomLease;
  presence: Presence;
}

type CommandRequest = JoinRoomRequest | StartRoomRequest | GameCommand;
type ActiveRoomStatus = Extract<
  RoomStatus,
  "lobby" | "in_hand" | "hand_result"
>;

function createInviteCode(): string {
  return `304-${randomBytes(16).toString("base64url")}`;
}

function activeStatusForEngine(engine: GameEngine): ActiveRoomStatus {
  if (engine.state.phase === "setup") return "lobby";
  if (
    engine.state.phase === "hand_result" ||
    engine.state.phase === "match_complete"
  ) {
    return "hand_result";
  }
  return "in_hand";
}

function engineSeat(seat: StoredSeat): EngineSeat {
  const result: EngineSeat = {
    index: seat.seatIndex,
    type: seat.occupantType,
    connectionStatus: "online",
  };
  if (seat.displayName) result.displayName = seat.displayName;
  if (seat.playerId) result.userId = seat.playerId;
  if (seat.botDifficulty) result.difficulty = seat.botDifficulty;
  return result;
}

function createLobbyEngine(
  host: AuthenticatedSession,
  seats: readonly StoredSeat[],
): GameEngine {
  return new GameEngine({
    playerName: host.displayName,
    humanCount: seats.filter((seat) => seat.occupantType === "human").length,
    tableMode: "classic_4",
    ruleProfile: "classic_304_4p",
    botDifficulty: "easy",
    initialSeats: seats.map(engineSeat),
  });
}

function createStartedEngine(
  room: StoredRoom,
  seats: readonly StoredSeat[],
): GameEngine {
  const host = seats.find((seat) => seat.playerId === room.hostPlayerId);
  const engine = new GameEngine({
    playerName: host?.displayName ?? "Host",
    humanCount: seats.filter((seat) => seat.occupantType === "human").length,
    tableMode: "classic_4",
    ruleProfile: "classic_304_4p",
    botDifficulty: room.settings.botDifficulty,
    enableSecondBidding: room.settings.enableSecondBidding,
    initialSeats: seats.map(engineSeat),
  });
  engine.startMatch();
  return engine;
}

function applyLobbySeat(engine: GameEngine, seat: StoredSeat): void {
  const target = engine.state.seats[seat.seatIndex];
  if (!target) throw new RecoveryError("unknown");
  target.type = seat.occupantType;
  target.displayName = seat.displayName ?? "Guest";
  if (seat.playerId) target.userId = seat.playerId;
  else delete target.userId;
  if (seat.botDifficulty) target.difficulty = seat.botDifficulty;
  else delete target.difficulty;
  target.connectionStatus = "online";
  engine.state.humanCount = engine.state.seats.filter(
    (candidate) => candidate.type === "human",
  ).length;
}

function roomNotFound(): DomainError {
  return new DomainError("ROOM_NOT_FOUND", 404, "Room was not found");
}

function ensureAvailable(room: StoredRoom): void {
  if (room.status === "recovery_failed") {
    throw new DomainError("ROOM_RECOVERY_FAILED", 503, "Room is unavailable");
  }
  if (room.status === "closed") {
    throw new DomainError("ROOM_UNAVAILABLE", 409, "Room is unavailable");
  }
}

export class RoomCoordinator {
  private readonly store: PostgresRoomStore;
  private readonly lease: RoomLease;
  private readonly presence: Presence;

  constructor({ store, lease, presence }: RoomCoordinatorDependencies) {
    this.store = store;
    this.lease = lease;
    this.presence = presence;
  }

  async createRoom(
    session: AuthenticatedSession,
    request: CreateRoomRequest,
  ): Promise<RoomProjection> {
    const duplicate = await this.store.findSessionDuplicate(
      session.sessionId,
      request.commandId,
    );
    if (duplicate) return this.getSnapshot(session, duplicate.roomId);

    const seats: StoredSeat[] = [
      {
        seatIndex: 0,
        playerId: session.playerId,
        occupantType: "human",
        botDifficulty: null,
        displayName: session.displayName,
      },
      ...[1, 2, 3].map((seatIndex) => ({
        seatIndex,
        playerId: null,
        occupantType: "empty" as const,
        botDifficulty: null,
        displayName: null,
      })),
    ];
    const roomId = randomUUID();
    const engine = createLobbyEngine(session, seats);
    const room = await this.store.createRoom({
      id: roomId,
      inviteCode: createInviteCode(),
      hostPlayerId: session.playerId,
      sessionId: session.sessionId,
      commandId: request.commandId,
      ruleProfileId: request.ruleProfileId,
      settings: { botDifficulty: "easy", enableSecondBidding: true },
      seats,
      snapshot: engine.getSnapshot(),
    });
    await this.presence.touch(room.id, session.playerId);
    return projectLobbyForViewer(room, seats, 0);
  }

  async joinRoom(
    session: AuthenticatedSession,
    roomReference: string,
    request: JoinRoomRequest,
  ): Promise<RoomProjection> {
    const referencedRoom = await this.store.loadRoomByReference(roomReference);
    if (!referencedRoom) throw roomNotFound();
    const projection = await this.withRoomLease(
      referencedRoom.id,
      async (transaction, room) => {
        const duplicate = await this.store.findDuplicate(
          room.id,
          request.commandId,
          session.playerId,
          transaction,
        );
        if (duplicate) {
          return this.projectAtVersion(
            transaction,
            room,
            session,
            duplicate.eventVersion,
          );
        }
        const existingSeatIndex = await this.store.findSeatIndex(
          transaction,
          room.id,
          session.playerId,
        );
        if (existingSeatIndex != null) {
          return this.projectCurrent(transaction, room, existingSeatIndex);
        }
        if (room.status !== "lobby") {
          throw new DomainError(
            "ROOM_NOT_JOINABLE",
            409,
            "Room is not accepting joins",
          );
        }
        if (room.eventVersion !== request.expectedVersion) {
          throw new DomainError(
            "VERSION_CONFLICT",
            409,
            "Room state changed; refresh and retry",
          );
        }
        const assignedSeat = await this.store.assignHumanSeat(
          transaction,
          room.id,
          session.playerId,
        );
        const engine = await this.recoverLockedRoom(transaction, room);
        applyLobbySeat(engine, assignedSeat);
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: request.commandId,
            actorPlayerId: session.playerId,
            eventType: "PLAYER_JOINED",
            payload: {
              seatIndex: assignedSeat.seatIndex,
              displayName: assignedSeat.displayName,
            },
            snapshot: engine.getSnapshot(),
            status: "lobby",
          },
        );
        const updatedRoom = { ...room, eventVersion };
        const seats = await this.store.loadSeats(room.id, transaction);
        return projectLobbyForViewer(
          updatedRoom,
          seats,
          assignedSeat.seatIndex,
        );
      },
    );
    await this.presence.touch(projection.roomId, session.playerId);
    return projection;
  }

  async startRoom(
    session: AuthenticatedSession,
    roomId: string,
    request: StartRoomRequest,
  ): Promise<RoomProjection> {
    const projection = await this.withRoomCommand(
      roomId,
      session,
      request,
      async (transaction, room, viewerSeatIndex) => {
        if (room.status !== "lobby") {
          throw new DomainError(
            "ROOM_ALREADY_STARTED",
            409,
            "Room has already started",
          );
        }
        if (room.hostPlayerId !== session.playerId) {
          throw new DomainError(
            "HOST_REQUIRED",
            403,
            "Only the host can start the room",
          );
        }
        await this.store.fillEmptySeatsWithBots(
          transaction,
          room.id,
          room.settings.botDifficulty,
        );
        const seats = await this.store.loadSeats(room.id, transaction);
        const engine = createStartedEngine(room, seats);
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: request.commandId,
            actorPlayerId: session.playerId,
            eventType: "ROOM_STARTED",
            payload: { ruleProfileId: room.ruleProfileId },
            snapshot: engine.getSnapshot(),
            status: "in_hand",
          },
        );
        return projectRoomForPlayer(
          { ...room, eventVersion, status: "in_hand" },
          engine,
          viewerSeatIndex,
        );
      },
    );
    await this.presence.touch(roomId, session.playerId);
    return projection;
  }

  async getSnapshot(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<RoomProjection> {
    const projection = await this.withRoomLease(
      roomId,
      async (transaction, room) => {
        const viewerSeatIndex = await this.store.requireHumanSeat(
          transaction,
          room.id,
          session.playerId,
        );
        return this.projectCurrent(transaction, room, viewerSeatIndex);
      },
    );
    await this.presence.touch(roomId, session.playerId);
    return projection;
  }

  async getRoom(
    session: AuthenticatedSession,
    roomReference: string,
  ): Promise<RoomProjection> {
    const referencedRoom = await this.store.loadRoomByReference(roomReference);
    if (!referencedRoom) throw roomNotFound();
    return this.withRoomLease(referencedRoom.id, async (transaction, room) => {
      const viewerSeatIndex = await this.store.findSeatIndex(
        transaction,
        room.id,
        session.playerId,
      );
      if (viewerSeatIndex != null) {
        return this.projectCurrent(transaction, room, viewerSeatIndex);
      }
      if (room.status !== "lobby") {
        throw new DomainError(
          "SEAT_REQUIRED",
          403,
          "You are not seated in this room",
        );
      }
      return projectLobbyForViewer(
        room,
        await this.store.loadSeats(room.id, transaction),
        null,
      );
    });
  }

  async submitCommand(
    session: AuthenticatedSession,
    command: GameCommand,
  ): Promise<RoomProjection> {
    const projection = await this.withRoomCommand(
      command.roomId,
      session,
      command,
      async (transaction, room, viewerSeatIndex) => {
        if (room.status !== "in_hand" && room.status !== "hand_result") {
          throw new DomainError("ROOM_NOT_ACTIVE", 409, "Room is not active");
        }
        const engine = await this.recoverLockedRoom(transaction, room);
        const result = engine.applyAction({
          ...command.action,
          seatIndex: viewerSeatIndex,
          actorSeatIndex: viewerSeatIndex,
        });
        if (!result.ok) {
          throw new DomainError(
            "ACTION_REJECTED",
            409,
            result.reason ?? "Action was rejected",
          );
        }
        const status = activeStatusForEngine(engine);
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: command.commandId,
            actorPlayerId: session.playerId,
            eventType: "GAME_ACTION",
            payload: { action: command.action },
            snapshot: engine.getSnapshot(),
            status,
          },
        );
        return projectRoomForPlayer(
          { ...room, eventVersion, status },
          engine,
          viewerSeatIndex,
        );
      },
    );
    await this.presence.touch(command.roomId, session.playerId);
    return projection;
  }

  private async withRoomCommand(
    roomId: string,
    session: AuthenticatedSession,
    request: CommandRequest,
    apply: (
      transaction: Queryable,
      room: StoredRoom,
      viewerSeatIndex: number,
    ) => Promise<RoomProjection>,
  ): Promise<RoomProjection> {
    return this.withRoomLease(roomId, async (transaction, room) => {
      const duplicate = await this.store.findDuplicate(
        room.id,
        request.commandId,
        session.playerId,
        transaction,
      );
      if (duplicate) {
        return this.projectAtVersion(
          transaction,
          room,
          session,
          duplicate.eventVersion,
        );
      }
      if (room.eventVersion !== request.expectedVersion) {
        throw new DomainError(
          "VERSION_CONFLICT",
          409,
          "Room state changed; refresh and retry",
        );
      }
      const viewerSeatIndex = await this.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      return apply(transaction, room, viewerSeatIndex);
    });
  }

  private async withRoomLease(
    roomId: string,
    work: (transaction: Queryable, room: StoredRoom) => Promise<RoomProjection>,
  ): Promise<RoomProjection> {
    try {
      return await this.lease.withLease(roomId, () =>
        this.store.transaction(async (transaction) => {
          const room = await this.store.loadRoomForUpdate(transaction, roomId);
          if (!room) throw roomNotFound();
          ensureAvailable(room);
          return work(transaction, room);
        }),
      );
    } catch (error) {
      if (error instanceof RecoveryError) {
        await this.store.markRecoveryFailed(roomId, "Snapshot replay failed");
        throw new DomainError(
          "ROOM_RECOVERY_FAILED",
          503,
          "Room is unavailable",
        );
      }
      throw error;
    }
  }

  private async projectCurrent(
    transaction: Queryable,
    room: StoredRoom,
    viewerSeatIndex: number,
  ): Promise<RoomProjection> {
    if (room.status === "lobby") {
      return projectLobbyForViewer(
        room,
        await this.store.loadSeats(room.id, transaction),
        viewerSeatIndex,
      );
    }
    const engine = await this.recoverLockedRoom(transaction, room);
    return projectRoomForPlayer(room, engine, viewerSeatIndex);
  }

  private async projectAtVersion(
    transaction: Queryable,
    room: StoredRoom,
    session: AuthenticatedSession,
    eventVersion: number,
  ): Promise<RoomProjection> {
    const viewerSeatIndex = await this.store.requireHumanSeat(
      transaction,
      room.id,
      session.playerId,
    );
    const snapshot = await this.store.loadSnapshotAt(
      transaction,
      room.id,
      eventVersion,
    );
    if (!snapshot) throw new RecoveryError(room.id);
    const engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const status = activeStatusForEngine(engine);
    const snapshotRoom = { ...room, eventVersion, status };
    if (status === "lobby") {
      return projectLobbyForViewer(
        snapshotRoom,
        await this.store.loadSeats(room.id, transaction),
        viewerSeatIndex,
      );
    }
    return projectRoomForPlayer(snapshotRoom, engine, viewerSeatIndex);
  }

  private async recoverLockedRoom(
    transaction: Queryable,
    room: StoredRoom,
  ): Promise<GameEngine> {
    const snapshot = await this.store.loadSnapshot(room.id, transaction);
    if (!snapshot || snapshot.eventVersion > room.eventVersion) {
      throw new RecoveryError(room.id);
    }
    const engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const events = await this.store.loadEventsAfter(
      room.id,
      snapshot.eventVersion,
      transaction,
    );
    try {
      for (const event of events) {
        if (event.eventType === "PLAYER_JOINED") {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const displayName = payload.displayName;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            typeof displayName !== "string" ||
            !event.actorPlayerId
          ) {
            throw new RecoveryError(room.id);
          }
          applyLobbySeat(engine, {
            seatIndex,
            playerId: event.actorPlayerId,
            occupantType: "human",
            botDifficulty: null,
            displayName,
          });
          continue;
        }
        if (event.eventType === "GAME_ACTION") {
          if (!event.actorPlayerId) throw new RecoveryError(room.id);
          const payload = event.payload as Record<string, unknown>;
          const action = payload.action;
          if (!action || typeof action !== "object" || Array.isArray(action)) {
            throw new RecoveryError(room.id);
          }
          const seatIndex = await this.store.findSeatIndex(
            transaction,
            room.id,
            event.actorPlayerId,
          );
          if (seatIndex == null) throw new RecoveryError(room.id);
          const result = engine.applyAction({
            ...(action as Record<string, unknown>),
            seatIndex,
            actorSeatIndex: seatIndex,
          });
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (event.eventType !== "ROOM_CREATED") {
          throw new RecoveryError(room.id);
        }
      }
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError(room.id);
    }
    return engine;
  }
}
