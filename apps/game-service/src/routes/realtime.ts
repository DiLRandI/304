import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServiceConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { AuthenticatedSession } from "../domain/session-service.js";
import type { RoomSocketHub } from "../realtime/room-socket-hub.js";
import type { GameRuntime } from "./v1.js";

async function validateRealtimeSeat(
  runtime: GameRuntime,
  session: AuthenticatedSession,
  roomId: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runtime.coordinator.getSnapshot(session, roomId);
      return;
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
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
  runtime: GameRuntime,
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
          throw new DomainError(
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
