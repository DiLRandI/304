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
import type { SubmitGameplayCommandHandler } from "../../contexts/gameplay/application/submit-gameplay-command.js";
import type { PlayerAccess } from "../../contexts/player-access/application/player-access.js";
import type { AuthenticatedSession } from "../../contexts/player-access/application/player-session-ports.js";
import { presentLobbyRoom } from "../../contexts/rooms/adapters/delivery/room-projection-presenter.js";
import type { CreateRoomHandler } from "../../contexts/rooms/application/create-room.js";
import type {
  GetRoomHandler,
  GetRoomSnapshotHandler,
} from "../../contexts/rooms/application/get-room-projection.js";
import type { JoinRoomHandler } from "../../contexts/rooms/application/join-room.js";
import type { LeaveRoomHandler } from "../../contexts/rooms/application/leave-room.js";
import type { StartRoomHandler } from "../../contexts/rooms/application/start-room.js";
import type { ServiceConfig } from "../../platform/config/service-config.js";
import { DeliveryError } from "../delivery-error.js";
import type { RequestRateLimiter } from "./request-rate-limiter.js";

export interface GameRuntime {
  gameplayUseCases: {
    readonly submit: Pick<SubmitGameplayCommandHandler, "execute">;
  };
  roomUseCases: {
    readonly create: Pick<CreateRoomHandler, "execute">;
    readonly get: Pick<GetRoomHandler, "execute">;
    readonly join: Pick<JoinRoomHandler, "execute">;
    readonly leave: Pick<LeaveRoomHandler, "execute">;
    readonly snapshot: Pick<GetRoomSnapshotHandler, "execute">;
    readonly start: Pick<StartRoomHandler, "execute">;
  };
  sessions: PlayerAccess;
  rateLimiter: RequestRateLimiter;
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
    const projection = await runtime.roomUseCases.create.execute({
      commandId: commandId(input.commandId),
      host: {
        displayName: session.displayName,
        playerId: playerId(session.playerId),
      },
      profileId: input.ruleProfileId,
      sessionId: session.sessionId,
      settings: {
        botDifficulty: input.botDifficulty,
        enableSecondBidding: true,
      },
    });
    return reply.code(201).send(presentLobbyRoom(projection));
  });

  app.get<{ Params: { roomRef: string } }>(
    "/v1/rooms/:roomRef",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      return runtime.roomUseCases.get.execute({
        roomReference: request.params.roomRef,
        session,
      });
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
      const parsedRoomId = roomId(
        RoomIdPathSchema.parse(request.params.roomId),
      );
      await runtime.roomUseCases.start.execute({
        actor: playerId(session.playerId),
        commandId: commandId(input.commandId),
        expectedVersion: eventVersion(input.expectedVersion),
        roomId: parsedRoomId,
      });
      return runtime.roomUseCases.snapshot.execute({
        roomId: parsedRoomId,
        session,
      });
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
      return runtime.roomUseCases.leave.execute({
        actor: playerId(session.playerId),
        commandId: commandId(input.commandId),
        expectedVersion: eventVersion(input.expectedVersion),
        roomId: roomId(RoomIdPathSchema.parse(request.params.roomId)),
      });
    },
  );

  app.get<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/snapshot",
    async (request) => {
      const session = await requireSession(request, config, runtime);
      return runtime.roomUseCases.snapshot.execute({
        roomId: request.params.roomId,
        session,
      });
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
        throw new DeliveryError(
          "ROOM_ID_MISMATCH",
          400,
          "Room id does not match request path",
        );
      }
      return runtime.gameplayUseCases.submit.execute({
        command: input,
        session,
      });
    },
  );
}
