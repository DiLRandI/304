import type { RoomProjection } from "@three-zero-four/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildApp, loadConfig } from "../src/app.js";
import type { GameRuntime } from "../src/delivery/http/v1-routes.js";

const config = loadConfig({
  CORS_ORIGINS: "http://127.0.0.1:3000",
  DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
  NODE_ENV: "test",
  PORT: "4100",
  REDIS_URL: "redis://127.0.0.1:6379",
  SESSION_COOKIE_NAME: "g304_session",
  SESSION_SECRET_PEPPER: "test-only-session-pepper-must-be-32-chars",
});
const session = {
  displayName: "Asha",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  playerId: "9c9c7530-224f-4d5e-b354-1c78df2f063b",
  sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
};
const projection = {
  eventVersion: 3,
  inviteCode: "304-AbCdEfGhIjKl_123",
  roomId: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
  status: "in_hand",
  viewerSeatIndex: 0,
  view: { isHost: true },
} satisfies RoomProjection;

describe("gameplay command route cutover", () => {
  it("uses the Gameplay application command handler", async () => {
    const execute = vi.fn().mockResolvedValue(projection);
    const game = {
      gameplayUseCases: { submit: { execute } },
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
      roomUseCases: {},
      sessions: { require: vi.fn().mockResolvedValue(session) },
    } as unknown as GameRuntime;
    const app = await buildApp({
      config,
      game,
      readiness: { database: async () => true, redis: async () => true },
    });
    const command = {
      action: { type: "PASS_BID" },
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      expectedVersion: 2,
      roomId: projection.roomId,
    };

    const response = await app.inject({
      body: command,
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
      url: `/v1/rooms/${projection.roomId}/commands`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(projection);
    expect(execute).toHaveBeenCalledWith({ command, session });
    await app.close();
  });
});
