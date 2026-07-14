import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  RoomExitResponse,
  RoomProjection,
  StartRoomRequest,
} from "@three-zero-four/contracts";
import { RoomExitResponseSchema } from "@three-zero-four/contracts";
import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import { ServiceError } from "../../../../shared/service-error.js";
import { projectRoomForPlayer } from "../../../gameplay/adapters/delivery/gameplay-room-presenter.js";
import {
  createLobbyEngine,
  createStartedEngine,
  seatCountForProfile,
} from "../../../gameplay/adapters/engine/legacy-engine-factory.js";
import { applyLobbySeat } from "../../../gameplay/adapters/engine/legacy-engine-seat-mapper.js";
import { LegacyGameplayAutomationScheduler } from "../../../gameplay/adapters/orchestration/legacy-gameplay-automation-scheduler.js";
import { LegacyGameplayConnections } from "../../../gameplay/adapters/orchestration/legacy-gameplay-connections.js";
import { LegacyGameplayRecovery } from "../../../gameplay/adapters/persistence/legacy-gameplay-recovery.js";
import { activeRoomStatus } from "../../../gameplay/application/gameplay-automation-policy.js";
import { RecoveryError } from "../../../gameplay/application/gameplay-recovery-error.js";
import type { AuthenticatedSession } from "../../../player-access/application/player-session-ports.js";
import type {
  RoomLease,
  RoomPresence,
} from "../../application/room-coordination-ports.js";
import type {
  RoomCoordinatorStore,
  RoomTransaction,
} from "../../application/room-coordinator-store.js";
import type { RoomIdentityProvider } from "../../application/room-identity-provider.js";
import type { RoomInviteCodeProvider } from "../../application/room-invite-code-provider.js";
import type {
  RoomSettings,
  StoredRoom,
  StoredSeat,
} from "../../application/room-persistence-model.js";
import { projectLobbyForViewer } from "../delivery/lobby-room-presenter.js";
import { LegacyRoomProjectionQueries } from "./legacy-room-projection-queries.js";

interface RoomCoordinatorDependencies {
  identities: RoomIdentityProvider;
  inviteCodes: RoomInviteCodeProvider;
  store: RoomCoordinatorStore;
  lease: RoomLease;
  presence: RoomPresence;
  automation?: {
    botActionDelayMs: number;
    disconnectGraceSeconds?: number;
    trickRevealDelayMs?: number;
  };
}

type CommandRequest = JoinRoomRequest | StartRoomRequest;

function roomNotFound(): ServiceError {
  return new ServiceError("ROOM_NOT_FOUND", 404, "Room was not found");
}

function ensureAvailable(room: StoredRoom, allowClosed = false): void {
  if (room.status === "recovery_failed") {
    throw new ServiceError("ROOM_RECOVERY_FAILED", 503, "Room is unavailable");
  }
  if (room.status === "closed" && !allowClosed) {
    throw new ServiceError("ROOM_UNAVAILABLE", 409, "Room is unavailable");
  }
}

export class RoomCoordinator {
  private readonly store: RoomCoordinatorStore;
  private readonly lease: RoomLease;
  private readonly presence: RoomPresence;
  private readonly identities: RoomIdentityProvider;
  private readonly inviteCodes: RoomInviteCodeProvider;
  private readonly gameplayAutomation: LegacyGameplayAutomationScheduler;
  private readonly gameplayConnections: LegacyGameplayConnections;
  private readonly gameplayRecovery: LegacyGameplayRecovery;
  private readonly roomQueries: LegacyRoomProjectionQueries;

  constructor({
    store,
    lease,
    presence,
    automation,
    identities,
    inviteCodes,
  }: RoomCoordinatorDependencies) {
    this.store = store;
    this.lease = lease;
    this.presence = presence;
    this.identities = identities;
    this.inviteCodes = inviteCodes;
    this.gameplayAutomation = new LegacyGameplayAutomationScheduler({
      ...(automation ? { config: automation } : {}),
      identities,
      store,
    });
    this.gameplayRecovery = new LegacyGameplayRecovery(store);
    this.gameplayConnections = new LegacyGameplayConnections({
      automation: this.gameplayAutomation,
      identities,
      lease,
      presence,
      recovery: this.gameplayRecovery,
      store,
    });
    this.roomQueries = new LegacyRoomProjectionQueries({
      gameplayRecovery: this.gameplayRecovery,
      lease,
      store,
    });
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

    const settings: RoomSettings = {
      botDifficulty: request.botDifficulty ?? "easy",
      enableSecondBidding: true,
    };
    const seats: StoredSeat[] = Array.from(
      { length: seatCountForProfile(request.ruleProfileId) },
      (_, seatIndex) =>
        seatIndex === 0
          ? {
              seatIndex,
              playerId: session.playerId,
              occupantType: "human",
              botDifficulty: null,
              displayName: session.displayName,
              connectionStatus: "online",
            }
          : {
              seatIndex,
              playerId: null,
              occupantType: "empty" as const,
              botDifficulty: null,
              displayName: null,
              connectionStatus: "disconnected",
            },
    );
    const roomId = this.identities.nextRoomId();
    const engine = createLobbyEngine(
      session,
      seats,
      request.ruleProfileId,
      settings,
    );
    const room = await this.store.createRoom({
      id: roomId,
      inviteCode: this.inviteCodes.next(),
      hostPlayerId: session.playerId,
      sessionId: session.sessionId,
      commandId: request.commandId,
      ruleProfileId: request.ruleProfileId,
      settings,
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
          return this.roomQueries.projectCurrent(
            transaction,
            room,
            existingSeatIndex,
          );
        }
        if (room.status !== "lobby") {
          throw new ServiceError(
            "ROOM_NOT_JOINABLE",
            409,
            "Room is not accepting joins",
          );
        }
        if (room.eventVersion !== request.expectedVersion) {
          throw new ServiceError(
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
        const engine = await this.gameplayRecovery.recover(transaction, room);
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
            ruleProfileId: room.ruleProfileId,
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
    await this.gameplayConnections.markRealtimePresence(session, roomId);
    const projection = await this.withRoomCommand(
      roomId,
      session,
      request,
      async (transaction, room, viewerSeatIndex) => {
        if (room.status !== "lobby") {
          throw new ServiceError(
            "ROOM_ALREADY_STARTED",
            409,
            "Room has already started",
          );
        }
        if (room.hostPlayerId !== session.playerId) {
          throw new ServiceError(
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
            payload: {
              ruleProfileId: room.ruleProfileId,
              state: engine.getSnapshot(),
            },
            snapshot: engine.getSnapshot(),
            status: "in_hand",
            ruleProfileId: room.ruleProfileId,
          },
        );
        const updatedRoom = {
          ...room,
          eventVersion,
          status: "in_hand" as const,
        };
        await this.gameplayAutomation.schedule(
          transaction,
          updatedRoom,
          engine,
        );
        return projectRoomForPlayer(updatedRoom, engine, viewerSeatIndex);
      },
    );
    return projection;
  }

  async getSnapshot(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<RoomProjection> {
    await this.gameplayConnections.markRealtimePresence(session, roomId);
    return this.roomQueries.getSnapshot(session, roomId);
  }

  async getRoom(
    session: AuthenticatedSession,
    roomReference: string,
  ): Promise<RoomProjection> {
    const projection = await this.roomQueries.getRoom(session, roomReference);
    if (projection.viewerSeatIndex != null) {
      return this.getSnapshot(session, projection.roomId);
    }
    return projection;
  }

  async leaveRoom(
    session: AuthenticatedSession,
    roomId: string,
    request: LeaveRoomRequest,
  ): Promise<RoomExitResponse> {
    const exit = await this.withRoomLease(
      roomId,
      async (transaction, room) => {
        const duplicate = await this.store.findDuplicate(
          room.id,
          request.commandId,
          session.playerId,
          transaction,
        );
        if (duplicate) {
          const parsed = RoomExitResponseSchema.safeParse(duplicate.response);
          if (!parsed.success) {
            throw new ServiceError(
              "ROOM_DATA_INVALID",
              500,
              "Invalid room leave response",
            );
          }
          return parsed.data;
        }
        if (room.status === "closed") {
          throw new ServiceError(
            "ROOM_UNAVAILABLE",
            409,
            "Room is unavailable",
          );
        }
        if (room.status !== "lobby" && room.status !== "hand_result") {
          throw new ServiceError(
            "ROOM_LEAVE_NOT_ALLOWED",
            409,
            "You can leave only before or after a hand",
          );
        }
        if (room.eventVersion !== request.expectedVersion) {
          throw new ServiceError(
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
        const seats = await this.store.loadSeats(room.id, transaction);
        const isLastHuman =
          seats.filter((seat) => seat.occupantType === "human").length === 1;
        const engine = await this.gameplayRecovery.recover(transaction, room);
        const replacement =
          room.status === "hand_result" && !isLastHuman ? "bot" : "empty";
        const departedSeat =
          replacement === "bot"
            ? await this.store.replaceHumanSeatWithBot(
                transaction,
                room.id,
                viewerSeatIndex,
                room.settings.botDifficulty,
              )
            : await this.store.clearHumanSeat(
                transaction,
                room.id,
                viewerSeatIndex,
              );
        applyLobbySeat(engine, departedSeat);
        const nextHostPlayerId = await this.store.findLowestHumanPlayerId(
          transaction,
          room.id,
        );
        if (room.hostPlayerId === session.playerId && nextHostPlayerId) {
          await this.store.transferHost(transaction, room.id, nextHostPlayerId);
        }
        await this.store.cancelAutomationForRoom(transaction, room.id, [
          "BOT_ACTION",
          "TURN_TIMEOUT",
          "DISCONNECT_GRACE",
          "TRICK_ADVANCE",
        ]);
        const status = nextHostPlayerId ? room.status : "closed";
        const hostPlayerId =
          room.hostPlayerId === session.playerId && nextHostPlayerId
            ? nextHostPlayerId
            : room.hostPlayerId;
        const exit: RoomExitResponse = {
          roomId: room.id,
          eventVersion: room.eventVersion + 1,
          status: nextHostPlayerId ? "left" : "closed",
        };
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: request.commandId,
            actorPlayerId: session.playerId,
            eventType: nextHostPlayerId ? "PLAYER_LEFT" : "ROOM_CLOSED",
            payload: {
              botDifficulty:
                replacement === "bot" ? room.settings.botDifficulty : null,
              hostPlayerId: nextHostPlayerId ? hostPlayerId : null,
              reason: nextHostPlayerId ? null : "LAST_HUMAN_LEFT",
              replacement,
              seatIndex: viewerSeatIndex,
            },
            snapshot: engine.getSnapshot(),
            status,
            ruleProfileId: room.ruleProfileId,
            deduplicationResponse: exit,
          },
        );
        if (status !== "closed") {
          await this.gameplayAutomation.schedule(
            transaction,
            { ...room, eventVersion, hostPlayerId, status },
            engine,
          );
        }
        return exit;
      },
      { allowClosed: true },
    );
    await this.presence.remove(roomId, session.playerId);
    return exit;
  }

  private async withRoomCommand(
    roomId: string,
    session: AuthenticatedSession,
    request: CommandRequest,
    apply: (
      transaction: RoomTransaction,
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
        throw new ServiceError(
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

  private async withRoomLease<T>(
    roomId: string,
    work: (transaction: RoomTransaction, room: StoredRoom) => Promise<T>,
    options: { allowClosed?: boolean } = {},
  ): Promise<T> {
    try {
      return await this.lease.withLease(roomId, () =>
        this.store.transaction(async (transaction) => {
          const room = await this.store.loadRoomForUpdate(transaction, roomId);
          if (!room) throw roomNotFound();
          ensureAvailable(room, options.allowClosed);
          return work(transaction, room);
        }),
      );
    } catch (error) {
      if (error instanceof RecoveryError) {
        await this.store.markRecoveryFailed(roomId, "Snapshot replay failed");
        throw new ServiceError(
          "ROOM_RECOVERY_FAILED",
          503,
          "Room is unavailable",
        );
      }
      throw error;
    }
  }

  private async projectAtVersion(
    transaction: RoomTransaction,
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
    if (snapshot.ruleProfileId !== room.ruleProfileId) {
      throw new RecoveryError(room.id);
    }
    const engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const status = activeRoomStatus(engine.state);
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
}
