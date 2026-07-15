import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServiceConfig } from "../../config.js";
import type { PlayerAccess } from "../../contexts/player-access/application/player-access.js";
import type { AuthenticatedSession } from "../../contexts/player-access/application/player-session-ports.js";
import type { GetRoomSnapshotHandler } from "../../contexts/rooms/application/get-room-projection.js";
import { ServiceError } from "../../shared/service-error.js";
import type { RoomSocketHub } from "./room-socket-hub.js";

export interface RealtimeGameRuntime {
  readonly roomUseCases: {
    readonly snapshot: Pick<GetRoomSnapshotHandler, "execute">;
  };
  readonly sessions: PlayerAccess;
}

async function validateRealtimeSeat(
  runtime: RealtimeGameRuntime,
  session: AuthenticatedSession,
  roomId: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runtime.roomUseCases.snapshot.execute({ roomId, session });
      return;
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        error.code !== "ROOM_BUSY" ||
        attempt >= 3
      ) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, [25, 75, 150, 250][attempt] ?? 250);
      });
    }
  }
}

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  runtime: RealtimeGameRuntime,
  hub: RoomSocketHub,
): Promise<void> {
  const authenticatedSessions = new WeakMap<
    FastifyRequest,
    AuthenticatedSession
  >();

  app.get<{ Params: { roomId: string } }>(
    "/v1/realtime/rooms/:roomId",
    {
      websocket: true,
      preValidation: async (request) => {
        const origin = request.headers.origin;
        if (!origin || !config.corsOrigins.has(origin)) {
          throw new ServiceError(
            "ORIGIN_DENIED",
            403,
            "Request origin is not allowed",
          );
        }
        const session = await runtime.sessions.require(
          request.cookies[config.SESSION_COOKIE_NAME],
        );
        await validateRealtimeSeat(runtime, session, request.params.roomId);
        authenticatedSessions.set(request, session);
      },
    },
    (socket, request) => {
      const session = authenticatedSessions.get(request);
      if (!session) {
        socket.close(1008, "Realtime authentication required");
        return;
      }
      const connection = hub.attach(socket, session, request.params.roomId);
      socket.on("message", (message) => {
        void hub.handleClientMessage(connection, message);
      });
      socket.on("close", () => {
        void hub.detach(connection);
      });
      socket.on("error", () => {
        void hub.detach(connection);
      });
      setImmediate(() => {
        void hub.sendInitialSnapshot(connection);
      });
    },
  );
}
