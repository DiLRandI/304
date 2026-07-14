import type {
  CreateRoomRequest,
  GameCommand,
  JoinRoomRequest,
  LeaveRoomRequest,
  RoomExitResponse,
  RoomProjection,
  RuleProfileId,
  StartRoomRequest,
} from "@three-zero-four/contracts";
import { RoomExitResponseSchema } from "@three-zero-four/contracts";
import {
  type EngineSeat,
  type EngineState,
  GameEngine,
} from "@three-zero-four/game-engine";
import { projectRoomForPlayer } from "../contexts/gameplay/adapters/delivery/gameplay-room-presenter.js";
import type { AuthenticatedSession } from "../contexts/player-access/application/player-session-ports.js";
import { projectLobbyForViewer } from "../contexts/rooms/adapters/delivery/lobby-room-presenter.js";
import type { RoomIdentityProvider } from "../contexts/rooms/application/room-identity-provider.js";
import type { RoomInviteCodeProvider } from "../contexts/rooms/application/room-invite-code-provider.js";
import type { Presence, RoomLease } from "../infra/redis-coordination.js";
import { DomainError } from "./errors.js";
import type {
  ClaimedAutomationJob,
  PostgresRoomStore,
  Queryable,
  RoomSettings,
  RoomStatus,
  StoredRoom,
  StoredSeat,
} from "./room-store.js";

class RecoveryError extends Error {
  constructor(readonly roomId: string) {
    super("Room recovery failed");
  }
}

interface RoomCoordinatorDependencies {
  identities: RoomIdentityProvider;
  inviteCodes: RoomInviteCodeProvider;
  store: PostgresRoomStore;
  lease: RoomLease;
  presence: Presence;
  automation?: {
    botActionDelayMs: number;
    disconnectGraceSeconds?: number;
    trickRevealDelayMs?: number;
  };
}

type CommandRequest = JoinRoomRequest | StartRoomRequest | GameCommand;
type ActiveRoomStatus = Extract<
  RoomStatus,
  "lobby" | "in_hand" | "hand_result"
>;

const DEFAULT_AUTOMATION = {
  botActionDelayMs: 900,
  turnTimeoutMs: 30_000,
  disconnectGraceSeconds: 120,
};

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

function seatCountForProfile(ruleProfileId: RuleProfileId): number {
  return ruleProfileId === "six_304_36" ? 6 : 4;
}

function tableModeForProfile(
  ruleProfileId: RuleProfileId,
): "classic_4" | "six_6" {
  return ruleProfileId === "six_304_36" ? "six_6" : "classic_4";
}

function activeSeatIndex(engine: GameEngine): number | null {
  const activeSeat = engine.state.activeSeat;
  return typeof activeSeat === "number" && Number.isInteger(activeSeat)
    ? activeSeat
    : null;
}

function isResultPhase(engine: GameEngine): boolean {
  return (
    engine.state.phase === "hand_result" ||
    engine.state.phase === "match_complete"
  );
}

function automationSeatIndex(engine: GameEngine): number | null {
  if (isResultPhase(engine)) return null;
  return activeSeatIndex(engine);
}

function completedTrickWinner(engine: GameEngine): number | null {
  const currentTrick = engine.state.currentTrick;
  if (!currentTrick || typeof currentTrick !== "object") return null;
  const winnerSeat = (currentTrick as Record<string, unknown>).winnerSeat;
  return typeof winnerSeat === "number" && Number.isInteger(winnerSeat)
    ? winnerSeat
    : null;
}

function phaseTimeoutMs(engine: GameEngine): number {
  if (engine.state.phase === "trump_choice") return 15_000;
  if (engine.state.phase === "hand_result") return 20_000;
  return DEFAULT_AUTOMATION.turnTimeoutMs;
}

function isBotDifficulty(
  value: unknown,
): value is RoomSettings["botDifficulty"] {
  return value === "easy" || value === "normal" || value === "strong";
}

function engineSeat(seat: StoredSeat): EngineSeat {
  const result: EngineSeat = {
    index: seat.seatIndex,
    type: seat.occupantType,
    connectionStatus:
      seat.connectionStatus ??
      (seat.occupantType === "bot" ? "online" : "disconnected"),
  };
  if (seat.displayName) result.displayName = seat.displayName;
  if (seat.playerId) result.userId = seat.playerId;
  if (seat.botDifficulty) result.difficulty = seat.botDifficulty;
  if (seat.connectionStatus === "autopilot") result.autopilot = true;
  return result;
}

function createLobbyEngine(
  host: AuthenticatedSession,
  seats: readonly StoredSeat[],
  ruleProfileId: RuleProfileId,
  settings: RoomSettings,
): GameEngine {
  return new GameEngine({
    playerName: host.displayName,
    humanCount: seats.filter((seat) => seat.occupantType === "human").length,
    tableMode: tableModeForProfile(ruleProfileId),
    ruleProfile: ruleProfileId,
    botDifficulty: settings.botDifficulty,
    enableSecondBidding: settings.enableSecondBidding,
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
    tableMode: tableModeForProfile(room.ruleProfileId),
    ruleProfile: room.ruleProfileId,
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
  target.displayName =
    seat.displayName ?? (seat.occupantType === "bot" ? "Bot" : "Open seat");
  if (seat.playerId) target.userId = seat.playerId;
  else delete target.userId;
  if (seat.botDifficulty) target.difficulty = seat.botDifficulty;
  else delete target.difficulty;
  target.connectionStatus = seat.connectionStatus ?? "online";
  target.autopilot = seat.connectionStatus === "autopilot";
  engine.state.humanCount = engine.state.seats.filter(
    (candidate) => candidate.type === "human",
  ).length;
}

function applyConnectionState(
  engine: GameEngine,
  seatIndex: number,
  connectionStatus: "online" | "disconnected" | "autopilot",
): void {
  const target = engine.state.seats[seatIndex];
  if (!target) throw new RecoveryError("unknown");
  target.connectionStatus = connectionStatus;
  target.autopilot = connectionStatus === "autopilot";
}

function roomNotFound(): DomainError {
  return new DomainError("ROOM_NOT_FOUND", 404, "Room was not found");
}

function ensureAvailable(room: StoredRoom, allowClosed = false): void {
  if (room.status === "recovery_failed") {
    throw new DomainError("ROOM_RECOVERY_FAILED", 503, "Room is unavailable");
  }
  if (room.status === "closed" && !allowClosed) {
    throw new DomainError("ROOM_UNAVAILABLE", 409, "Room is unavailable");
  }
}

export class RoomCoordinator {
  private readonly store: PostgresRoomStore;
  private readonly lease: RoomLease;
  private readonly presence: Presence;
  private readonly automation: RoomCoordinatorDependencies["automation"];
  private readonly identities: RoomIdentityProvider;
  private readonly inviteCodes: RoomInviteCodeProvider;

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
    this.automation = automation;
    this.identities = identities;
    this.inviteCodes = inviteCodes;
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
    await this.markRealtimePresence(session, roomId);
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
        await this.scheduleNextAutomation(transaction, updatedRoom, engine);
        return projectRoomForPlayer(updatedRoom, engine, viewerSeatIndex);
      },
    );
    return projection;
  }

  async getSnapshot(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<RoomProjection> {
    await this.markRealtimePresence(session, roomId);
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
    return projection;
  }

  async getRoom(
    session: AuthenticatedSession,
    roomReference: string,
  ): Promise<RoomProjection> {
    const referencedRoom = await this.store.loadRoomByReference(roomReference);
    if (!referencedRoom) throw roomNotFound();
    const projection = await this.withRoomLease(
      referencedRoom.id,
      async (transaction, room) => {
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
      },
    );
    if (projection.viewerSeatIndex != null) {
      return this.getSnapshot(session, projection.roomId);
    }
    return projection;
  }

  async submitCommand(
    session: AuthenticatedSession,
    command: GameCommand,
  ): Promise<RoomProjection> {
    await this.markRealtimePresence(session, command.roomId);
    const projection = await this.withRoomCommand(
      command.roomId,
      session,
      command,
      async (transaction, room, viewerSeatIndex) => {
        if (room.status !== "in_hand" && room.status !== "hand_result") {
          throw new DomainError("ROOM_NOT_ACTIVE", 409, "Room is not active");
        }
        if (
          command.action.type === "ACK_RESULT" &&
          room.hostPlayerId !== session.playerId
        ) {
          throw new DomainError(
            "HOST_REQUIRED",
            403,
            "Only the host can continue",
          );
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
            ruleProfileId: room.ruleProfileId,
          },
        );
        const updatedRoom = { ...room, eventVersion, status };
        await this.scheduleNextAutomation(transaction, updatedRoom, engine);
        return projectRoomForPlayer(updatedRoom, engine, viewerSeatIndex);
      },
    );
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
            throw new DomainError(
              "ROOM_DATA_INVALID",
              500,
              "Invalid room leave response",
            );
          }
          return parsed.data;
        }
        if (room.status === "closed") {
          throw new DomainError("ROOM_UNAVAILABLE", 409, "Room is unavailable");
        }
        if (room.status !== "lobby" && room.status !== "hand_result") {
          throw new DomainError(
            "ROOM_LEAVE_NOT_ALLOWED",
            409,
            "You can leave only before or after a hand",
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
        const seats = await this.store.loadSeats(room.id, transaction);
        const isLastHuman =
          seats.filter((seat) => seat.occupantType === "human").length === 1;
        const engine = await this.recoverLockedRoom(transaction, room);
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
          await this.scheduleNextAutomation(
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

  async runAutomation(
    job: ClaimedAutomationJob,
  ): Promise<"completed" | "stale"> {
    return this.withRoomLease(job.roomId, async (transaction, room) => {
      if (room.eventVersion !== job.expectedEventVersion) return "stale";
      if (room.status !== "in_hand" && room.status !== "hand_result") {
        return "stale";
      }

      const engine = await this.recoverLockedRoom(transaction, room);
      if (job.kind === "TRICK_ADVANCE") {
        const winnerSeat = completedTrickWinner(engine);
        if (
          engine.state.phase !== "trick_result" ||
          winnerSeat == null ||
          winnerSeat !== job.targetSeatIndex
        ) {
          return "stale";
        }
        const result = engine.advanceTrick();
        if (!result.ok) {
          throw new DomainError(
            "AUTOMATION_ACTION_REJECTED",
            500,
            "Trick advancement was rejected",
          );
        }
        const status = activeStatusForEngine(engine);
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: job.id,
            actorPlayerId: null,
            eventType: "TRICK_ADVANCED",
            payload: { winnerSeat },
            snapshot: engine.getSnapshot(),
            status,
            ruleProfileId: room.ruleProfileId,
          },
        );
        await this.scheduleNextAutomation(
          transaction,
          { ...room, eventVersion, status },
          engine,
        );
        return "completed";
      }
      if (isResultPhase(engine)) return "stale";
      const activeSeat = activeSeatIndex(engine);
      if (
        job.kind !== "DISCONNECT_GRACE" &&
        activeSeat !== job.targetSeatIndex
      ) {
        return "stale";
      }
      const seat = engine.state.seats[job.targetSeatIndex];
      if (!seat) return "stale";

      if (job.kind === "TURN_TIMEOUT" || job.kind === "DISCONNECT_GRACE") {
        if (job.kind === "DISCONNECT_GRACE") {
          const seats = await this.store.loadSeats(room.id, transaction);
          const storedSeat = seats.find(
            (candidate) => candidate.seatIndex === job.targetSeatIndex,
          );
          if (!storedSeat?.playerId) return "stale";
          const onlinePlayerIds = await this.presence.onlinePlayerIds(room.id, [
            storedSeat.playerId,
          ]);
          if (onlinePlayerIds.has(storedSeat.playerId)) return "stale";
        }
        if (seat.type !== "human" || seat.autopilot) return "stale";
        seat.autopilot = true;
        seat.connectionStatus = "autopilot";
        await this.store.markSeatAutopilot(
          transaction,
          room.id,
          job.targetSeatIndex,
        );
        const eventVersion = await this.store.appendEventAndSnapshot(
          transaction,
          {
            roomId: room.id,
            expectedVersion: room.eventVersion,
            commandId: job.id,
            actorPlayerId: null,
            eventType: "AUTOPILOT_ENABLED",
            payload: { seatIndex: job.targetSeatIndex, reason: job.kind },
            snapshot: engine.getSnapshot(),
            status: activeStatusForEngine(engine),
            ruleProfileId: room.ruleProfileId,
          },
        );
        const updatedRoom = {
          ...room,
          eventVersion,
          status: activeStatusForEngine(engine),
        };
        await this.scheduleNextAutomation(transaction, updatedRoom, engine);
        return "completed";
      }

      if (job.kind !== "BOT_ACTION") return "stale";
      if (seat.type !== "bot" && !seat.autopilot) return "stale";
      const action = engine.getBotAction(job.targetSeatIndex);
      if (!action) return "stale";
      const result = engine.applyAutomationAction(action, job.targetSeatIndex);
      if (!result.ok) {
        throw new DomainError(
          "AUTOMATION_ACTION_REJECTED",
          500,
          "Automation action was rejected",
        );
      }
      const status = activeStatusForEngine(engine);
      const eventVersion = await this.store.appendEventAndSnapshot(
        transaction,
        {
          roomId: room.id,
          expectedVersion: room.eventVersion,
          commandId: job.id,
          actorPlayerId: null,
          eventType: seat.autopilot ? "AUTOPILOT_ACTION" : "BOT_ACTION",
          payload: { seatIndex: job.targetSeatIndex, action },
          snapshot: engine.getSnapshot(),
          status,
          ruleProfileId: room.ruleProfileId,
        },
      );
      const updatedRoom = { ...room, eventVersion, status };
      await this.scheduleNextAutomation(transaction, updatedRoom, engine);
      return "completed";
    });
  }

  async markRealtimePresence(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<void> {
    await this.withRoomLease(roomId, async (transaction, room) => {
      const viewerSeatIndex = await this.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      const seats = await this.store.loadSeats(room.id, transaction);
      const storedSeat = seats.find(
        (seat) => seat.seatIndex === viewerSeatIndex,
      );
      if (!storedSeat) throw new RecoveryError(room.id);
      await this.presence.touch(room.id, session.playerId);
      if (storedSeat.connectionStatus === "online") {
        await this.store.markSeatOnline(transaction, room.id, session.playerId);
        return;
      }

      const engine = await this.recoverLockedRoom(transaction, room);
      applyConnectionState(engine, viewerSeatIndex, "online");
      await this.store.markSeatOnline(transaction, room.id, session.playerId);
      const status = activeStatusForEngine(engine);
      const eventVersion = await this.store.appendEventAndSnapshot(
        transaction,
        {
          roomId: room.id,
          expectedVersion: room.eventVersion,
          commandId: this.identities.nextCommandId(),
          actorPlayerId: session.playerId,
          eventType:
            storedSeat.connectionStatus === "autopilot"
              ? "AUTOPILOT_CANCELLED"
              : "PLAYER_RECONNECTED",
          payload: { seatIndex: viewerSeatIndex },
          snapshot: engine.getSnapshot(),
          status,
          ruleProfileId: room.ruleProfileId,
        },
      );
      await this.scheduleNextAutomation(
        transaction,
        { ...room, eventVersion, status },
        engine,
      );
    });
  }

  async markRealtimeDisconnected(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<void> {
    await this.withRoomLease(roomId, async (transaction, room) => {
      const viewerSeatIndex = await this.store.requireHumanSeat(
        transaction,
        room.id,
        session.playerId,
      );
      const seats = await this.store.loadSeats(room.id, transaction);
      const storedSeat = seats.find(
        (seat) => seat.seatIndex === viewerSeatIndex,
      );
      if (storedSeat?.connectionStatus !== "online") return;

      const engine = await this.recoverLockedRoom(transaction, room);
      applyConnectionState(engine, viewerSeatIndex, "disconnected");
      await this.store.markSeatOffline(transaction, room.id, session.playerId);
      const status = activeStatusForEngine(engine);
      const eventVersion = await this.store.appendEventAndSnapshot(
        transaction,
        {
          roomId: room.id,
          expectedVersion: room.eventVersion,
          commandId: this.identities.nextCommandId(),
          actorPlayerId: session.playerId,
          eventType: "PLAYER_DISCONNECTED",
          payload: { seatIndex: viewerSeatIndex },
          snapshot: engine.getSnapshot(),
          status,
          ruleProfileId: room.ruleProfileId,
        },
      );
      const updatedRoom = { ...room, eventVersion, status };
      await this.scheduleNextAutomation(transaction, updatedRoom, engine);
    });
    await this.presence.remove(roomId, session.playerId);
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

  private async withRoomLease<T>(
    roomId: string,
    work: (transaction: Queryable, room: StoredRoom) => Promise<T>,
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
        throw new DomainError(
          "ROOM_RECOVERY_FAILED",
          503,
          "Room is unavailable",
        );
      }
      throw error;
    }
  }

  private async scheduleNextAutomation(
    transaction: Queryable,
    room: StoredRoom,
    engine: GameEngine,
  ): Promise<void> {
    await this.store.cancelAutomationForRoom(transaction, room.id, [
      "BOT_ACTION",
      "TURN_TIMEOUT",
      "TRICK_ADVANCE",
    ]);
    await this.store.cancelAutomationForRoom(transaction, room.id, [
      "DISCONNECT_GRACE",
    ]);
    if (room.status === "in_hand") {
      await this.scheduleDisconnectGraceJobs(transaction, room);
    }
    if (engine.state.phase === "trick_result") {
      const winnerSeat = completedTrickWinner(engine);
      if (winnerSeat == null) return;
      await this.store.scheduleAutomation(transaction, {
        id: this.identities.nextAutomationJobId(),
        roomId: room.id,
        expectedEventVersion: room.eventVersion,
        kind: "TRICK_ADVANCE",
        targetSeatIndex: winnerSeat,
        dueAt: new Date(
          Date.now() + (this.automation?.trickRevealDelayMs ?? 2_000),
        ),
      });
      return;
    }
    const targetSeatIndex = automationSeatIndex(engine);
    if (targetSeatIndex == null) return;
    const seat = engine.state.seats[targetSeatIndex];
    if (!seat) return;
    const isAutomated = seat.type === "bot" || Boolean(seat.autopilot);
    if (seat.type !== "human" && seat.type !== "bot") return;
    if (seat.type === "human" && seat.connectionStatus === "disconnected") {
      return;
    }
    const botActionDelayMs =
      this.automation?.botActionDelayMs ?? DEFAULT_AUTOMATION.botActionDelayMs;
    await this.store.scheduleAutomation(transaction, {
      id: this.identities.nextAutomationJobId(),
      roomId: room.id,
      expectedEventVersion: room.eventVersion,
      kind: isAutomated ? "BOT_ACTION" : "TURN_TIMEOUT",
      targetSeatIndex,
      dueAt: new Date(
        Date.now() + (isAutomated ? botActionDelayMs : phaseTimeoutMs(engine)),
      ),
    });
  }

  private async scheduleDisconnectGraceJobs(
    transaction: Queryable,
    room: StoredRoom,
  ): Promise<void> {
    const disconnectGraceSeconds =
      this.automation?.disconnectGraceSeconds ??
      DEFAULT_AUTOMATION.disconnectGraceSeconds;
    const seats = await this.store.loadSeats(room.id, transaction);
    for (const seat of seats) {
      if (
        seat.occupantType !== "human" ||
        !seat.playerId ||
        seat.connectionStatus !== "disconnected"
      ) {
        continue;
      }
      await this.store.scheduleAutomation(transaction, {
        id: this.identities.nextAutomationJobId(),
        roomId: room.id,
        expectedEventVersion: room.eventVersion,
        kind: "DISCONNECT_GRACE",
        targetSeatIndex: seat.seatIndex,
        dueAt: new Date(
          (seat.disconnectedAt?.getTime() ?? Date.now()) +
            disconnectGraceSeconds * 1_000,
        ),
      });
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
    if (snapshot.ruleProfileId !== room.ruleProfileId) {
      throw new RecoveryError(room.id);
    }
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
    if (snapshot.ruleProfileId !== room.ruleProfileId) {
      throw new RecoveryError(room.id);
    }
    let engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const events = await this.store.loadEventsAfter(
      room.id,
      snapshot.eventVersion,
      transaction,
    );
    try {
      for (const event of events) {
        if (event.eventType === "ROOM_STARTED") {
          const payload = event.payload as Record<string, unknown>;
          const state = payload.state;
          if (!state || typeof state !== "object" || Array.isArray(state)) {
            throw new RecoveryError(room.id);
          }
          const started = GameEngine.hydrate(
            structuredClone(state) as EngineState,
          );
          const profile = started.state.profile;
          if (
            !profile ||
            typeof profile !== "object" ||
            Array.isArray(profile) ||
            (profile as Record<string, unknown>).id !== room.ruleProfileId
          ) {
            throw new RecoveryError(room.id);
          }
          engine = started;
          continue;
        }
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
        if (event.eventType === "ROOM_CLOSED") {
          const payload = event.payload as Record<string, unknown>;
          if (
            payload.reason === "LOBBY_IDLE" ||
            payload.reason === "TERMINAL_RETENTION"
          ) {
            continue;
          }
        }
        if (
          event.eventType === "PLAYER_LEFT" ||
          event.eventType === "ROOM_CLOSED"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const replacement =
            payload.replacement ??
            (event.eventType === "ROOM_CLOSED" ? "empty" : null);
          const botDifficulty = isBotDifficulty(payload.botDifficulty)
            ? payload.botDifficulty
            : null;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            (replacement !== "empty" && replacement !== "bot") ||
            (replacement === "bot" && !botDifficulty)
          ) {
            throw new RecoveryError(room.id);
          }
          applyLobbySeat(engine, {
            seatIndex,
            playerId: null,
            occupantType: replacement,
            botDifficulty: replacement === "bot" ? botDifficulty : null,
            displayName: null,
            connectionStatus: replacement === "bot" ? "online" : "disconnected",
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
        if (event.eventType === "TRICK_ADVANCED") {
          const result = engine.advanceTrick();
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (
          event.eventType === "PLAYER_DISCONNECTED" ||
          event.eventType === "PLAYER_RECONNECTED" ||
          event.eventType === "AUTOPILOT_ENABLED" ||
          event.eventType === "AUTOPILOT_CANCELLED"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          if (typeof seatIndex !== "number" || !Number.isInteger(seatIndex)) {
            throw new RecoveryError(room.id);
          }
          applyConnectionState(
            engine,
            seatIndex,
            event.eventType === "PLAYER_DISCONNECTED"
              ? "disconnected"
              : event.eventType === "AUTOPILOT_ENABLED"
                ? "autopilot"
                : "online",
          );
          continue;
        }
        if (
          event.eventType === "BOT_ACTION" ||
          event.eventType === "AUTOPILOT_ACTION"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const action = payload.action;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            !action ||
            typeof action !== "object" ||
            Array.isArray(action)
          ) {
            throw new RecoveryError(room.id);
          }
          const result = engine.applyAutomationAction(
            action as Record<string, unknown>,
            seatIndex,
          );
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (event.eventType !== "ROOM_CREATED") {
          throw new RecoveryError(room.id);
        }
      }
      const seats = await this.store.loadSeats(room.id, transaction);
      for (const seat of seats) {
        applyConnectionState(
          engine,
          seat.seatIndex,
          seat.connectionStatus ?? "disconnected",
        );
      }
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError(room.id);
    }
    return engine;
  }
}
