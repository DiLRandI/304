import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import type { ServiceConfig } from "./config.js";
import { DomainError } from "./domain/errors.js";
import { createMetrics } from "./metrics.js";
import { type GameRuntime, registerV1Routes } from "./routes/v1.js";

export { loadConfig } from "./config.js";

export interface ReadinessChecks {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
}

export async function buildApp({
  config,
  readiness,
  game,
}: {
  config: ServiceConfig;
  readiness: ReadinessChecks;
  game?: GameRuntime;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "warn",
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    requestIdHeader: "x-request-id",
    bodyLimit: 32 * 1024,
    trustProxy: false,
    logController: new LogController({
      disableRequestLogging: (request) =>
        request.url === "/livez" ||
        request.url === "/readyz" ||
        request.url === "/metrics",
    }),
  });
  const metrics = createMetrics();

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
        throw new DomainError(
          "ORIGIN_DENIED",
          403,
          "Request origin is not allowed",
        );
      }
    });
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
    return reply
      .type(metrics.registry.contentType)
      .send(await metrics.registry.metrics());
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
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
