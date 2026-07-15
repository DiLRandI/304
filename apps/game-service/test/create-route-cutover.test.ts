import {
  createLobby,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
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
const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");
const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";

describe("create room route cutover", () => {
  it("uses the DDD create use case and preserves the existing wire contract", async () => {
    const lobby = createLobby({
      host: { displayName: "Asha", playerId: hostId },
      id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: { botDifficulty: "normal", enableSecondBidding: true },
    });
    const execute = vi.fn().mockResolvedValue(projectRoom(lobby, hostId));
    const game = {
      coordinator: {},
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
      roomUseCases: { create: { execute } },
      sessions: {
        require: vi.fn().mockResolvedValue({
          displayName: "Asha",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          playerId: hostId,
          sessionId,
        }),
      },
    } as unknown as GameRuntime;
    const app = await buildApp({
      config,
      game,
      readiness: { database: async () => true, redis: async () => true },
    });

    const response = await app.inject({
      body: {
        botDifficulty: "normal",
        commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
        ruleProfileId: "classic_304_4p",
      },
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
      url: "/v1/rooms",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      eventVersion: 1,
      roomId: lobby.id,
      status: "lobby",
      viewerSeatIndex: 0,
      view: { isHost: true },
    });
    expect(execute).toHaveBeenCalledWith({
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      host: { displayName: "Asha", playerId: hostId },
      profileId: "classic_304_4p",
      sessionId,
      settings: { botDifficulty: "normal", enableSecondBidding: true },
    });
    await app.close();
  });
});
