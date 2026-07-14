import { describe, expect, it, vi } from "vitest";
import {
  type GameServiceError,
  GameServiceTransport,
} from "../src/features/room/api/game-service-transport.js";

describe("GameServiceTransport", () => {
  it("maps network failures to a stable public error", async () => {
    const transport = new GameServiceTransport(
      "https://api.example.test",
      vi.fn().mockRejectedValue(new Error("connection details")),
    );

    await expect(
      transport.request("/v1/session", "GET", undefined, String),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message:
        "The game service could not be reached. Please check your connection.",
      status: 0,
    } satisfies Partial<GameServiceError>);
  });

  it("does not expose malformed service errors", async () => {
    const transport = new GameServiceTransport(
      "https://api.example.test",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "database details" }), {
          status: 500,
        }),
      ),
    );

    await expect(
      transport.request("/v1/session", "GET", undefined, String),
    ).rejects.toMatchObject({
      code: "GAME_SERVICE_ERROR",
      message: "The game service could not complete this request.",
      status: 500,
    } satisfies Partial<GameServiceError>);
  });
});
