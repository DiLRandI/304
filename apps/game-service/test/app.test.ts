import { describe, expect, it } from "vitest";
import { buildApp, loadConfig } from "../src/app.js";

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "4100",
  DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGINS: "http://127.0.0.1:3000",
  SESSION_COOKIE_NAME: "g304_session",
});

describe("game service configuration", () => {
  it("rejects an origin list with a path instead of a browser origin", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
        REDIS_URL: "redis://127.0.0.1:6379",
        CORS_ORIGINS: "http://127.0.0.1:3000/not-an-origin",
        SESSION_COOKIE_NAME: "g304_session",
      }),
    ).toThrow("Invalid CORS origin");
  });
});

describe("game service bootstrap", () => {
  it("does not emit a deprecated Fastify logging warning", async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);

    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();
    process.off("warning", onWarning);

    expect(
      warnings.map((warning) => (warning as Error & { code?: string }).code),
    ).not.toContain("FSTDEP023");
  });
});

describe("game service health surface", () => {
  it("reports live while a dependency is unavailable and becomes ready only when all are ready", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => false },
    });
    const live = await app.inject("/livez");
    const ready = await app.inject("/readyz");
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "not_ready",
      dependencies: { database: true, redis: false },
    });
    await app.close();
  });

  it("emits a request id and rejects unrecognized routes as JSON", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
    });
    const response = await app.inject("/unknown");
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    await app.close();
  });
});
