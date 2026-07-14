import type { RoomProjection } from "@three-zero-four/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildApp, loadConfig } from "../src/app.js";
import type { GameRuntime } from "../src/routes/v1.js";

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
const lobbyProjection: RoomProjection = {
  eventVersion: 1,
  inviteCode: "304-AbCdEfGhIjKl_123",
  roomId: "12f8e3e8-6729-4c46-b78a-d1a0e804c55a",
  status: "lobby",
  viewerSeatIndex: 0,
  view: {
    isHost: true,
    lobby: { ruleProfileId: "classic_304_4p", seats: [] },
  },
};

describe("room query route cutover", () => {
  it("uses application query handlers for reference and snapshot reads", async () => {
    const get = vi.fn().mockResolvedValue(lobbyProjection);
    const snapshot = vi.fn().mockResolvedValue(lobbyProjection);
    const game = {
      coordinator: {},
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
      roomUseCases: {
        get: { execute: get },
        snapshot: { execute: snapshot },
      },
      sessions: { require: vi.fn().mockResolvedValue(session) },
    } as unknown as GameRuntime;
    const app = await buildApp({
      config,
      game,
      readiness: { database: async () => true, redis: async () => true },
    });

    const byReference = await app.inject({
      headers: { origin: "http://127.0.0.1:3000" },
      method: "GET",
      url: `/v1/rooms/${lobbyProjection.inviteCode}`,
    });
    const byId = await app.inject({
      headers: { origin: "http://127.0.0.1:3000" },
      method: "GET",
      url: `/v1/rooms/${lobbyProjection.roomId}/snapshot`,
    });

    expect(byReference.statusCode).toBe(200);
    expect(byId.statusCode).toBe(200);
    expect(get).toHaveBeenCalledWith({
      roomReference: lobbyProjection.inviteCode,
      session,
    });
    expect(snapshot).toHaveBeenCalledWith({
      roomId: lobbyProjection.roomId,
      session,
    });
    await app.close();
  });
});
