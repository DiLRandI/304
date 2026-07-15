import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyInstance,
  type FastifyLoggerOptions,
  type FastifyRequest,
  LogController,
} from "fastify";
import { ZodError } from "zod";
import type { ServiceConfig } from "./config.js";
import { RoomApplicationError } from "./contexts/rooms/application/execute-room-command.js";
import {
  type GameRuntime,
  registerV1Routes,
} from "./delivery/http/v1-routes.js";
import { registerRealtimeRoutes } from "./delivery/realtime/realtime-routes.js";
import type { RoomSocketHub } from "./delivery/realtime/room-socket-hub.js";
import { createMetrics, type ServiceMetrics } from "./metrics.js";
import { ServiceError } from "./shared/service-error.js";

export { loadConfig } from "./config.js";

export interface ReadinessChecks {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
}

export interface RealtimeRuntime {
  hub: RoomSocketHub;
  stop(): Promise<void>;
}

const REDACTED_INVITE = "[redacted-invite]";
const PLAIN_INVITE_CODE = /304-[A-Za-z0-9_-]{12,32}/g;
const URL_TOKEN = /(?:[A-Za-z0-9_-]|%[0-9A-Fa-f]{2})+/g;
const MAX_URL_DECODE_PASSES = 3;

interface SerializedRequestLog {
  [key: string]: unknown;
  host: string;
  method: string;
  remoteAddress: string;
  remotePort?: number;
  url: string;
  version?: string;
}

export function redactSensitiveRequestUrl(url: string): string {
  return url.replace(URL_TOKEN, (token) => {
    let candidate = token;
    for (let pass = 0; pass <= MAX_URL_DECODE_PASSES; pass += 1) {
      const redacted = candidate.replace(PLAIN_INVITE_CODE, REDACTED_INVITE);
      if (redacted !== candidate) return redacted;
      if (pass === MAX_URL_DECODE_PASSES) return token;
      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded === candidate) return token;
        candidate = decoded;
      } catch {
        return token;
      }
    }
    return token;
  });
}

function serializeRequestForLog(request: FastifyRequest): SerializedRequestLog {
  const acceptVersion = request.headers["accept-version"];
  const serialized: SerializedRequestLog = {
    method: request.method,
    url: redactSensitiveRequestUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
  };
  if (typeof acceptVersion === "string") serialized.version = acceptVersion;
  if (typeof request.socket?.remotePort === "number") {
    serialized.remotePort = request.socket.remotePort;
  }
  return serialized;
}

export async function buildApp({
  config,
  readiness,
  game,
  realtime,
  metrics: injectedMetrics,
  refreshMetrics,
  logStream,
}: {
  config: ServiceConfig;
  readiness: ReadinessChecks;
  game?: GameRuntime;
  realtime?: RealtimeRuntime;
  metrics?: ServiceMetrics;
  refreshMetrics?: () => Promise<void>;
  logStream?: NonNullable<FastifyLoggerOptions["stream"]>;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "warn",
      redact: ["req.headers.cookie", "req.headers.authorization"],
      serializers: { req: serializeRequestForLog },
      ...(logStream ? { stream: logStream } : {}),
    },
    requestIdHeader: "x-request-id",
    bodyLimit: 32 * 1024,
    trustProxy:
      config.trustedProxyIps.length === 0 ? false : [...config.trustedProxyIps],
    logController: new LogController({
      disableRequestLogging: (request) =>
        request.url === "/livez" ||
        request.url === "/readyz" ||
        request.url === "/metrics",
    }),
  });
  const metrics = injectedMetrics ?? createMetrics();

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: (origin, done) =>
      done(null, !origin || config.corsOrigins.has(origin)),
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    metrics.requests.inc({
      route: request.routeOptions.url ?? "unmatched",
      status_code: String(reply.statusCode),
    });
  });

  if (game) {
    app.addHook("onRequest", async (request) => {
      if (request.method !== "POST" || !request.url.startsWith("/v1/")) {
        return;
      }
      const origin = request.headers.origin;
      if (!origin || !config.corsOrigins.has(origin)) {
        throw new ServiceError(
          "ORIGIN_DENIED",
          403,
          "Request origin is not allowed",
        );
      }
    });
    if (realtime) {
      await app.register(websocket, {
        options: { maxPayload: config.WS_MAX_PAYLOAD_BYTES },
      });
      await registerRealtimeRoutes(app, config, game, realtime.hub);
      app.addHook("onClose", async () => realtime.stop());
    }
    await registerV1Routes(app, config, game);
  }

  app.get("/livez", async () => ({ status: "live" }));
  app.get("/readyz", async (_request, reply) => {
    const [database, redis] = await Promise.all([
      readiness.database(),
      readiness.redis(),
    ]);
    if (!database || !redis) {
      return reply
        .code(503)
        .send({ status: "not_ready", dependencies: { database, redis } });
    }
    return { status: "ready", dependencies: { database, redis } };
  });
  app.get("/metrics", async (_request, reply) => {
    try {
      await refreshMetrics?.();
    } catch (error) {
      app.log.warn({ err: error }, "metrics refresh failed");
    }
    return reply
      .type(metrics.registry.contentType)
      .send(await metrics.registry.metrics());
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RoomApplicationError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ServiceError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "Request is invalid" },
      });
    }
    request.log.error({ err: error }, "unhandled game service error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Route not found" } }),
  );

  return app;
}
