import {
  CreateRoomRequestSchema,
  GameCommandSchema,
  GuestSessionRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  StartRoomRequestSchema,
} from "@three-zero-four/contracts";
import {
  commandId,
  eventVersion,
  playerId,
  roomId,
} from "@three-zero-four/room-domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ServiceConfig } from "../config.js";
import type {
  AuthenticatedSession,
  PlayerAccessService,
} from "../contexts/player-access/adapters/delivery/player-access-service.js";
import { presentLobbyRoom } from "../contexts/rooms/adapters/delivery/room-projection-presenter.js";
import type { JoinRoomHandler } from "../contexts/rooms/application/join-room.js";
import type { LeaveRoomHandler } from "../contexts/rooms/application/leave-room.js";
import { DomainError } from "../domain/errors.js";
import type { RoomCoordinator } from "../domain/room-coordinator.js";
import type { RateLimiter } from "../infra/redis-coordination.js";

export interface GameRuntime {
  coordinator: RoomCoordinator;
  roomUseCases?: {
    readonly join: Pick<JoinRoomHandler, "execute">;
    readonly leave: Pick<LeaveRoomHandler, "execute">;
  };
  sessions: PlayerAccessService;
  rateLimiter: RateLimiter;
}

const RoomIdPathSchema = z.uuid();

async function requireSession(
  request: FastifyRequest,
  config: ServiceConfig,
  runtime: GameRuntime,
): Promise<AuthenticatedSession> {
  return runtime.sessions.require(request.cookies[config.SESSION_COOKIE_NAME]);
}

async function consumeMutationLimit(
  request: FastifyRequest,
  runtime: GameRuntime,
  session: AuthenticatedSession,
  scope: string,
  identityLimit: number,
  windowSeconds: number,
): Promise<void> {
  await runtime.rateLimiter.consume(
    `${scope}:identity`,
    session.playerId,
    identityLimit,
    windowSeconds,
  );
  await runtime.rateLimiter.consume(
    `${scope}:ip`,
    request.ip,
    identityLimit * 2,
    windowSeconds,
  );
}

export async function registerV1Routes(
  app: FastifyInstance,
  config: ServiceConfig,
  runtime: GameRuntime,
): Promise<void> {
  app.post("/v1/guest-sessions", async (request, reply) => {
    await runtime.rateLimiter.consume("guest-session:ip", request.ip, 20, 60);
    const input = GuestSessionRequestSchema.parse(request.body);
    const created = await runtime.sessions.create(input.displayName);
    reply.setCookie(config.SESSION_COOKIE_NAME, created.cookieValue, {
      httpOnly: true,
      maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
    });
    return reply.code(201).send({
      player: { id: created.playerId, displayName: created.displayName },
      expiresAt: created.expiresAt.toISOString(),
    });
  });

  app.get("/v1/session", async (request) => {
    const session = await requireSession(request, config, runtime);
    return {
      player: { id: session.playerId, displayName: session.displayName },
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.post("/v1/rooms", async (request, reply) => {
    const session = await requireSession(request, config, runtime);
    await consumeMutationLimit(request, runtime, session, "room-create", 5, 60);
    const input = CreateRoomRequestSchema.parse(request.body);
    return reply
      .code(201)
      .send(await runtime.coordinator.createRoom(session, input));
  });

  app.get<{ Params: { roomRef: string } }>(
    "/v1/rooms/:roomRef",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      return runtime.coordinator.getRoom(session, request.params.roomRef);
    },
  );

  app.post<{ Params: { roomRef: string } }>(
    "/v1/rooms/:roomRef/join",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      await consumeMutationLimit(
        request,
        runtime,
        session,
        "room-join",
        12,
        60,
      );
      const input = JoinRoomRequestSchema.parse(request.body);
      if (runtime.roomUseCases) {
        const projection = await runtime.roomUseCases.join.execute({
          actor: {
            displayName: session.displayName,
            playerId: playerId(session.playerId),
          },
          commandId: commandId(input.commandId),
          expectedVersion: eventVersion(input.expectedVersion),
          roomReference: request.params.roomRef,
        });
        return presentLobbyRoom(projection);
      }
      return runtime.coordinator.joinRoom(
        session,
        request.params.roomRef,
        input,
      );
    },
  );

  app.post<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/start",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      await consumeMutationLimit(
        request,
        runtime,
        session,
        "room-start",
        5,
        60,
      );
      const input = StartRoomRequestSchema.parse(request.body);
      return runtime.coordinator.startRoom(
        session,
        request.params.roomId,
        input,
      );
    },
  );

  app.post<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/leave",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      await consumeMutationLimit(
        request,
        runtime,
        session,
        "room-leave",
        12,
        60,
      );
      const input = LeaveRoomRequestSchema.parse(request.body);
      if (runtime.roomUseCases?.leave) {
        return runtime.roomUseCases.leave.execute({
          actor: playerId(session.playerId),
          commandId: commandId(input.commandId),
          expectedVersion: eventVersion(input.expectedVersion),
          roomId: roomId(RoomIdPathSchema.parse(request.params.roomId)),
        });
      }
      return runtime.coordinator.leaveRoom(
        session,
        request.params.roomId,
        input,
      );
    },
  );

  app.get<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/snapshot",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      return runtime.coordinator.getSnapshot(session, request.params.roomId);
    },
  );

  app.post<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/commands",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      await consumeMutationLimit(
        request,
        runtime,
        session,
        "room-command",
        30,
        10,
      );
      const input = GameCommandSchema.parse(request.body);
      if (input.roomId !== request.params.roomId) {
        throw new DomainError(
          "ROOM_ID_MISMATCH",
          400,
          "Room id does not match request path",
        );
      }
      return runtime.coordinator.submitCommand(session, input);
    },
  );
}
