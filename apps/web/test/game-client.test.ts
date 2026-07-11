import { describe, expect, it, vi } from "vitest";
import {
  GameClient,
  type GameServiceError,
  parseRealtimeServerMessage,
  toRoomSocketUrl,
} from "../src/lib/game-client.js";

const roomProjection = {
  roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
  inviteCode: "304-abcdefghijkl",
  eventVersion: 1,
  status: "lobby",
  viewerSeatIndex: 0,
  view: {},
};

describe("GameClient", () => {
  it("creates an idempotent room request with cookies and validates its projection", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(roomProjection), { status: 201 }),
      );
    const client = new GameClient("https://api.example.test", fetcher);

    await expect(
      client.createRoom({
        botDifficulty: "strong",
        ruleProfileId: "classic_304_4p",
      }),
    ).resolves.toEqual(roomProjection);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/rooms",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
    expect(
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      botDifficulty: "strong",
      commandId: expect.any(String),
      ruleProfileId: "classic_304_4p",
    });
  });

  it("binds the browser fetch implementation before using the default transport", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    const browserFetch = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            expiresAt: "2026-08-09T22:43:21.429Z",
            player: {
              displayName: "Asha",
              id: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
            },
          }),
          { status: 201 },
        ),
      );
    });
    vi.stubGlobal("fetch", browserFetch);

    try {
      const client = new GameClient("https://api.example.test");
      await client.createGuest("Asha");

      expect(receiver).toBe(globalThis);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("derives a WebSocket room URL from an HTTPS game-service origin", () => {
    expect(
      toRoomSocketUrl(
        "https://api.example.test",
        "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      ),
    ).toBe(
      "wss://api.example.test/v1/realtime/rooms/a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
    );
  });

  it("submits versioned room commands without accepting a client actor identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...roomProjection, eventVersion: 2 }), {
        status: 200,
      }),
    );
    const client = new GameClient("https://api.example.test", fetcher);

    await client.submitCommand(roomProjection.roomId, 1, { type: "PASS_BID" });

    expect(
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      action: { type: "PASS_BID" },
      commandId: expect.any(String),
      expectedVersion: 1,
      roomId: roomProjection.roomId,
    });
  });

  it("leaves a room with a versioned command and accepts only its safe exit response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          eventVersion: 2,
          roomId: roomProjection.roomId,
          status: "left",
        }),
        { status: 200 },
      ),
    );
    const client = new GameClient("https://api.example.test", fetcher);

    await expect(client.leaveRoom(roomProjection.roomId, 1)).resolves.toEqual({
      eventVersion: 2,
      roomId: roomProjection.roomId,
      status: "left",
    });
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test/v1/rooms/${roomProjection.roomId}/leave`,
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      commandId: expect.any(String),
      expectedVersion: 1,
    });
  });

  it("rejects an overbroad successful leave response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          eventVersion: 2,
          roomId: roomProjection.roomId,
          status: "left",
          view: {},
        }),
        { status: 200 },
      ),
    );
    const client = new GameClient("https://api.example.test", fetcher);

    await expect(client.leaveRoom(roomProjection.roomId, 1)).rejects.toThrow();
  });

  it("refuses malformed successful payloads before they can enter client state", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ roomId: "not-a-uuid" }), {
        status: 201,
      }),
    );
    const client = new GameClient("https://api.example.test", fetcher);

    await expect(
      client.createRoom({ ruleProfileId: "classic_304_4p" }),
    ).rejects.toThrow();
  });

  it("maps only known public service errors to a user-safe error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "ROOM_FULL", message: "Room is full" },
        }),
        { status: 409 },
      ),
    );
    const client = new GameClient("https://api.example.test", fetcher);

    await expect(client.getRoom("304-abcdefghijkl")).rejects.toMatchObject({
      code: "ROOM_FULL",
      message: "Room is full",
      status: 409,
    } satisfies Partial<GameServiceError>);
  });

  it("validates every realtime server message before it reaches the room reducer", () => {
    expect(
      parseRealtimeServerMessage({
        type: "SNAPSHOT",
        projection: roomProjection,
      }),
    ).toMatchObject({ type: "SNAPSHOT", projection: roomProjection });
    expect(() =>
      parseRealtimeServerMessage({
        type: "SNAPSHOT",
        projection: { roomId: "not-a-uuid" },
      }),
    ).toThrow();
  });
});
