/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoomController } from "../src/features/room/hooks/use-room-controller.js";
import {
  activeProjection,
  lobbyProjection,
  passBidAction,
  ROOM_ID,
} from "./browser-fixtures.js";

function socket() {
  return {
    close: vi.fn(),
    onclose: null as ((event: CloseEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onopen: null as ((event: Event) => void) | null,
    readyState: 1,
    send: vi.fn(),
  };
}

describe("useRoomController", () => {
  afterEach(cleanup);

  it("retries a transient WebSocket constructor failure", async () => {
    const initial = lobbyProjection();
    const recoveredSocket = socket();
    const client = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getSnapshot: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      roomSocketUrl: vi
        .fn()
        .mockReturnValue("wss://api.example.test/v1/realtime/rooms/room"),
      startRoom: vi.fn(),
      submitCommand: vi.fn(),
    };
    const createSocket = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("transient constructor failure");
      })
      .mockReturnValueOnce(recoveredSocket);
    const { result } = renderHook(() =>
      useRoomController("304-abcdefghijkl", client, { createSocket }),
    );

    await waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    expect(result.current.error).toBe(
      "The live table could not connect. Retrying shortly.",
    );
    await waitFor(() => expect(createSocket).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });

    act(() => recoveredSocket.onopen?.(new Event("open")));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(result.current.error).toBeNull();
  });

  it("retries the initial room bootstrap after a transient load failure", async () => {
    const initial = lobbyProjection();
    const roomSocket = socket();
    let resolveRetry: ((projection: typeof initial) => void) | undefined;
    const retryRequest = new Promise<typeof initial>((resolve) => {
      resolveRetry = resolve;
    });
    const client = {
      getRoom: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockReturnValueOnce(retryRequest),
      getSnapshot: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      roomSocketUrl: vi
        .fn()
        .mockReturnValue("wss://api.example.test/v1/realtime/rooms/room"),
      startRoom: vi.fn(),
      submitCommand: vi.fn(),
    };
    const createSocket = vi.fn().mockReturnValue(roomSocket);
    const { result } = renderHook(() =>
      useRoomController("304-abcdefghijkl", client, { createSocket }),
    );

    await waitFor(() =>
      expect(result.current.error).toBe(
        "The table could not be updated. Please try again.",
      ),
    );
    expect(result.current.projection).toBeNull();
    expect(client.getRoom).toHaveBeenCalledOnce();

    await act(async () => {
      const firstRetry = result.current.retry();
      const duplicateRetry = result.current.retry();
      expect(client.getRoom).toHaveBeenCalledTimes(2);
      resolveRetry?.(initial);
      await Promise.all([firstRetry, duplicateRetry]);
    });

    await waitFor(() => expect(result.current.projection).toEqual(initial));
    expect(client.getRoom).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(createSocket).toHaveBeenCalledOnce();
  });

  it("submits a legal action at the current server version", async () => {
    const initial = activeProjection(1);
    const updated = activeProjection(2);
    const roomSocket = socket();
    const client = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getSnapshot: vi.fn().mockResolvedValue(updated),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      roomSocketUrl: vi
        .fn()
        .mockReturnValue("wss://api.example.test/v1/realtime/rooms/room"),
      startRoom: vi.fn(),
      submitCommand: vi.fn().mockResolvedValue(updated),
    };
    const createSocket = vi.fn().mockReturnValue(roomSocket);

    const { result } = renderHook(() =>
      useRoomController("304-abcdefghijkl", client, { createSocket }),
    );

    await waitFor(() => expect(result.current.projection).toEqual(initial));
    act(() => roomSocket.onopen?.(new Event("open")));
    await waitFor(() => expect(result.current.connection).toBe("live"));

    await act(async () => result.current.submit(passBidAction));

    expect(client.submitCommand).toHaveBeenCalledWith(
      ROOM_ID,
      1,
      passBidAction,
    );
    expect(result.current.projection?.eventVersion).toBe(2);
  });

  it("sends a resync request and refreshes after a version gap", async () => {
    const initial = activeProjection(1);
    const gapProjection = activeProjection(3);
    const roomSocket = socket();
    const client = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getSnapshot: vi.fn().mockResolvedValue(gapProjection),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      roomSocketUrl: vi
        .fn()
        .mockReturnValue("wss://api.example.test/v1/realtime/rooms/room"),
      startRoom: vi.fn(),
      submitCommand: vi.fn(),
    };

    renderHook(() =>
      useRoomController("304-abcdefghijkl", client, {
        createSocket: vi.fn().mockReturnValue(roomSocket),
      }),
    );
    await waitFor(() => expect(roomSocket.onmessage).not.toBeNull());

    act(() =>
      roomSocket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "SNAPSHOT", projection: gapProjection }),
        }),
      ),
    );

    await waitFor(() =>
      expect(client.getSnapshot).toHaveBeenCalledWith(ROOM_ID),
    );
    expect(roomSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "RESYNC", roomId: ROOM_ID }),
    );
  });

  it("does not join a room after the controller effect has been cleaned up", async () => {
    const initial = { ...lobbyProjection(), viewerSeatIndex: null };
    let resolveRoom: ((value: typeof initial) => void) | undefined;
    const roomRequest = new Promise<typeof initial>((resolve) => {
      resolveRoom = resolve;
    });
    const client = {
      getRoom: vi.fn().mockReturnValue(roomRequest),
      getSnapshot: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      roomSocketUrl: vi.fn(),
      startRoom: vi.fn(),
      submitCommand: vi.fn(),
    };

    const { unmount } = renderHook(() =>
      useRoomController("304-abcdefghijkl", client, {
        createSocket: vi.fn().mockReturnValue(socket()),
      }),
    );
    await waitFor(() => expect(client.getRoom).toHaveBeenCalledOnce());
    unmount();

    await act(async () => {
      resolveRoom?.(initial);
      await Promise.resolve();
    });

    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  it("leaves only after a safe exit response, then clears private state without reconnecting", async () => {
    const initial = activeProjection(1);
    const roomSocket = socket();
    const client = {
      getRoom: vi.fn().mockResolvedValue(initial),
      getSnapshot: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn().mockResolvedValue({
        eventVersion: 2,
        roomId: ROOM_ID,
        status: "left",
      }),
      roomSocketUrl: vi
        .fn()
        .mockReturnValue("wss://api.example.test/v1/realtime/rooms/room"),
      startRoom: vi.fn(),
      submitCommand: vi.fn(),
    };
    const createSocket = vi.fn().mockReturnValue(roomSocket);
    const { result } = renderHook(() =>
      useRoomController("304-abcdefghijkl", client, { createSocket }),
    );

    await waitFor(() => expect(result.current.projection).toEqual(initial));
    await act(async () => result.current.leave());
    act(() => roomSocket.onclose?.(new Event("close")));

    expect(client.leaveRoom).toHaveBeenCalledWith(ROOM_ID, 1);
    expect(roomSocket.close).toHaveBeenCalledOnce();
    expect(client.getSnapshot).not.toHaveBeenCalled();
    expect(createSocket).toHaveBeenCalledOnce();
    expect(result.current.connection).toBe("offline");
    expect(result.current.projection).toBeNull();
  });
});
