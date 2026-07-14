import {
  createLobby,
  inviteCode,
  joinLobby,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it, vi } from "vitest";
import { buildApp, loadConfig } from "../src/app.js";
import type { GameRuntime } from "../src/routes/v1.js";

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
const guestId = playerId("28fc47b6-e8ef-4de7-8c43-7e027a41d70f");

describe("join room route cutover", () => {
  it("uses the DDD join use case and preserves the existing wire contract", async () => {
    const lobby = createLobby({
      host: { displayName: "Asha", playerId: hostId },
      id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: { botDifficulty: "easy", enableSecondBidding: true },
    });
    const joined = joinLobby(lobby, {
      displayName: "Bimal",
      playerId: guestId,
    });
    if (!joined.ok) throw new Error("Expected guest join to succeed");
    const execute = vi
      .fn()
      .mockResolvedValue(projectRoom(joined.room, guestId));
    const game = {
      coordinator: {},
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
      roomUseCases: { join: { execute } },
      sessions: {
        require: vi.fn().mockResolvedValue({
          displayName: "Bimal",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          playerId: guestId,
          sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
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
        commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
        expectedVersion: 1,
      },
      headers: { origin: "http://127.0.0.1:3000" },
      method: "POST",
      url: "/v1/rooms/304-AbCdEfGhIjKl_123/join",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      eventVersion: 2,
      roomId: lobby.id,
      status: "lobby",
      viewerSeatIndex: 1,
      view: { isHost: false },
    });
    expect(execute).toHaveBeenCalledWith({
      actor: { displayName: "Bimal", playerId: guestId },
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      expectedVersion: 1,
      roomReference: "304-AbCdEfGhIjKl_123",
    });
    await app.close();
  });
});
