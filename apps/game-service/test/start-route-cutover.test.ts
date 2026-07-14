import {
  createLobby,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
  startRoom,
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
const aggregateId = roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a");

describe("start room route cutover", () => {
  it("uses the DDD start use case and returns the active gameplay projection", async () => {
    const lobby = createLobby({
      host: { displayName: "Asha", playerId: hostId },
      id: aggregateId,
      inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
      profileId: "classic_304_4p",
      settings: { botDifficulty: "normal", enableSecondBidding: true },
    });
    const started = startRoom(lobby, hostId);
    if (!started.ok) throw new Error("Expected room start to succeed");
    const execute = vi
      .fn()
      .mockResolvedValue(projectRoom(started.room, hostId));
    const activeProjection = {
      eventVersion: 2,
      inviteCode: lobby.inviteCode,
      roomId: lobby.id,
      status: "in_hand",
      view: { isHost: true, legalActions: [], publicState: {} },
      viewerSeatIndex: 0,
    };
    const getSnapshot = vi.fn().mockResolvedValue(activeProjection);
    const session = {
      displayName: "Asha",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      playerId: hostId,
      sessionId: "b8fc339d-ee47-45f9-826c-b3477bdb8d51",
    };
    const game = {
      coordinator: { getSnapshot },
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) },
      roomUseCases: { start: { execute } },
      sessions: { require: vi.fn().mockResolvedValue(session) },
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
      url: `/v1/rooms/${aggregateId}/start`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(activeProjection);
    expect(execute).toHaveBeenCalledWith({
      actor: hostId,
      commandId: "d7c60215-243f-4599-80cb-e8ad78c6ae1f",
      expectedVersion: 1,
      roomId: aggregateId,
    });
    expect(getSnapshot).toHaveBeenCalledWith(session, aggregateId);
    await app.close();
  });
});
