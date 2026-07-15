import type {
  CreateRoomRequest,
  JoinRoomRequest,
  RoomProjection,
  StartRoomRequest,
} from "@three-zero-four/contracts";
import {
  commandId,
  eventVersion,
  playerId,
  roomId,
} from "@three-zero-four/room-domain";
import type { RedisClientType } from "redis";
import { LegacyGameplayAutomationExecutor } from "../../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-automation-executor.js";
import { LegacyGameplayAutomationScheduler } from "../../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-automation-scheduler.js";
import { LegacyGameplayCommandExecutor } from "../../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-command-executor.js";
import { LegacyGameplayConnections } from "../../src/contexts/gameplay/adapters/orchestration/legacy-gameplay-connections.js";
import { LegacyGameplayRecovery } from "../../src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.js";
import type { AuthenticatedSession } from "../../src/contexts/player-access/application/player-session-ports.js";
import { presentLobbyRoom } from "../../src/contexts/rooms/adapters/delivery/room-projection-presenter.js";
import { GameplayRoomProjectionReader } from "../../src/contexts/rooms/adapters/integration/gameplay-room-projection-reader.js";
import { LegacyRoomCreationRepository } from "../../src/contexts/rooms/adapters/orchestration/legacy-room-creation-repository.js";
import { LegacyStartedRoomAutomationFactory } from "../../src/contexts/rooms/adapters/orchestration/legacy-started-room-automation-factory.js";
import { LegacyStartedRoomSnapshotFactory } from "../../src/contexts/rooms/adapters/orchestration/legacy-started-room-snapshot-factory.js";
import { RoomProjectionQueryAdapter } from "../../src/contexts/rooms/adapters/orchestration/room-projection-query-adapter.js";
import { PostgresRoomCommandRepository } from "../../src/contexts/rooms/adapters/persistence/postgres-room-command-repository.js";
import { PostgresRoomStore } from "../../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import { NodeRoomIdentityProvider } from "../../src/contexts/rooms/adapters/security/node-room-identity-provider.js";
import { NodeRoomInviteCodeProvider } from "../../src/contexts/rooms/adapters/security/node-room-invite-code-provider.js";
import { CreateRoomHandler } from "../../src/contexts/rooms/application/create-room.js";
import { ExecuteRoomCommandHandler } from "../../src/contexts/rooms/application/execute-room-command.js";
import { GetRoomSnapshotHandler } from "../../src/contexts/rooms/application/get-room-projection.js";
import { JoinRoomHandler } from "../../src/contexts/rooms/application/join-room.js";
import { StartRoomHandler } from "../../src/contexts/rooms/application/start-room.js";
import type { Database } from "../../src/infra/database.js";
import { Presence, RoomLease } from "../../src/infra/redis-coordination.js";

export interface RoomTestRuntimeOptions {
  readonly automation?: {
    readonly botActionDelayMs: number;
    readonly disconnectGraceSeconds?: number;
    readonly trickRevealDelayMs?: number;
  };
  readonly leaseTtlMs?: number;
  readonly presenceTtlSeconds?: number;
}

export class RoomTestRuntime {
  readonly automation: LegacyGameplayAutomationExecutor;
  readonly connections: LegacyGameplayConnections;
  readonly gameplayCommands: LegacyGameplayCommandExecutor;
  readonly scheduler: LegacyGameplayAutomationScheduler;
  readonly store: PostgresRoomStore;
  private readonly create: CreateRoomHandler;
  private readonly join: JoinRoomHandler;
  private readonly snapshot: GetRoomSnapshotHandler;
  private readonly start: StartRoomHandler;

  constructor(
    database: Database,
    redis: RedisClientType,
    options: RoomTestRuntimeOptions = {},
  ) {
    this.store = new PostgresRoomStore(database);
    const identities = new NodeRoomIdentityProvider();
    const inviteCodes = new NodeRoomInviteCodeProvider();
    const lease = new RoomLease(redis, options.leaseTtlMs ?? 5_000);
    const presence = new Presence(redis, options.presenceTtlSeconds ?? 60);
    const recovery = new LegacyGameplayRecovery(this.store);
    this.scheduler = new LegacyGameplayAutomationScheduler({
      ...(options.automation ? { config: options.automation } : {}),
      identities,
      store: this.store,
    });
    this.connections = new LegacyGameplayConnections({
      automation: this.scheduler,
      identities,
      lease,
      presence,
      recovery,
      store: this.store,
    });
    this.automation = new LegacyGameplayAutomationExecutor({
      automation: this.scheduler,
      lease,
      presence,
      recovery,
      store: this.store,
    });
    const commands = new ExecuteRoomCommandHandler(
      new PostgresRoomCommandRepository(
        database,
        new LegacyStartedRoomSnapshotFactory(),
        new LegacyStartedRoomAutomationFactory(
          identities,
          () => new Date(),
          options.automation?.botActionDelayMs,
        ),
      ),
    );
    const queries = new RoomProjectionQueryAdapter({
      activeRoomProjection: new GameplayRoomProjectionReader(recovery),
      lease,
      store: this.store,
    });
    const roomPresence = {
      refresh: this.connections.markRealtimePresence.bind(this.connections),
    };
    this.create = new CreateRoomHandler(
      new LegacyRoomCreationRepository(this.store),
      presence,
      identities,
      inviteCodes,
    );
    this.join = new JoinRoomHandler(commands, presence);
    this.snapshot = new GetRoomSnapshotHandler(queries, roomPresence);
    this.start = new StartRoomHandler(commands, presence);
    this.gameplayCommands = new LegacyGameplayCommandExecutor({
      automation: this.scheduler,
      lease,
      recovery,
      store: this.store,
    });
  }

  async createRoom(
    session: AuthenticatedSession,
    request: CreateRoomRequest,
  ): Promise<RoomProjection> {
    return presentLobbyRoom(
      await this.create.execute({
        commandId: commandId(request.commandId),
        host: {
          displayName: session.displayName,
          playerId: playerId(session.playerId),
        },
        profileId: request.ruleProfileId,
        sessionId: session.sessionId,
        settings: {
          botDifficulty: request.botDifficulty ?? "easy",
          enableSecondBidding: true,
        },
      }),
    );
  }

  async joinRoom(
    session: AuthenticatedSession,
    roomReference: string,
    request: JoinRoomRequest,
  ): Promise<RoomProjection> {
    return presentLobbyRoom(
      await this.join.execute({
        actor: {
          displayName: session.displayName,
          playerId: playerId(session.playerId),
        },
        commandId: commandId(request.commandId),
        expectedVersion: eventVersion(request.expectedVersion),
        roomReference,
      }),
    );
  }

  async startRoom(
    session: AuthenticatedSession,
    targetRoomId: string,
    request: StartRoomRequest,
  ): Promise<RoomProjection> {
    await this.start.execute({
      actor: playerId(session.playerId),
      commandId: commandId(request.commandId),
      expectedVersion: eventVersion(request.expectedVersion),
      roomId: roomId(targetRoomId),
    });
    return this.getSnapshot(session, targetRoomId);
  }

  getSnapshot(
    session: AuthenticatedSession,
    targetRoomId: string,
  ): Promise<RoomProjection> {
    return this.snapshot.execute({ roomId: targetRoomId, session });
  }
}
