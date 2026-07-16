import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/delivery/http/http-app.js";
import type { GameRuntime } from "../src/delivery/http/v1-routes.js";
import { loadConfig } from "../src/platform/config/service-config.js";

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "4100",
  DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGINS: "http://127.0.0.1:3000",
  SESSION_COOKIE_NAME: "g304_session",
  SESSION_SECRET_PEPPER: "test-only-session-pepper-must-be-32-chars",
});
const playerId = "28fc47b6-e8ef-4de7-8c43-7e027a41d70f";
const roomId = "12f8e3e8-6729-4c46-b78a-d1a0e804c55a";

function runtime(execute: ReturnType<typeof vi.fn>) {
  return {
    coordinator: {},
    rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
    roomUseCases: { join: { execute: vi.fn() }, leave: { execute } },
    sessions: {
      require: vi.fn().mockResolvedValue({
        displayName: "Bimal",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        playerId,
        sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
      }),
    },
  } as unknown as GameRuntime;
}

describe("leave room route cutover", () => {
  it("uses the DDD leave use case and preserves the exit response", async () => {
    const execute = vi.fn().mockResolvedValue({
      eventVersion: 3,
      roomId,
      status: "left",
    });
    const app = await buildApp({
      config,
      game: runtime(execute),
      readiness: { database: async () => true, redis: async () => true },
    });

    const response = await app.inject({
      body: {
        commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
        expectedVersion: 2,
      },
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
      url: `/v1/rooms/${roomId}/leave`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      eventVersion: 3,
      roomId,
      status: "left",
    });
    expect(execute).toHaveBeenCalledWith({
      actor: playerId,
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      expectedVersion: 2,
      roomId,
    });
    await app.close();
  });

  it("rejects a malformed room id at the delivery boundary", async () => {
    const execute = vi.fn();
    const app = await buildApp({
      config,
      game: runtime(execute),
      readiness: { database: async () => true, redis: async () => true },
    });

    const response = await app.inject({
      body: {
        commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
        expectedVersion: 2,
      },
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
      url: "/v1/rooms/not-a-uuid/leave",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Request is invalid" },
    });
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });
});
