/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoomRealtime } from "../src/features/room/hooks/use-room-realtime.js";
import { ROOM_ID } from "./browser-fixtures.js";

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

describe("useRoomRealtime", () => {
  afterEach(cleanup);

  it("retries a transient socket construction failure", async () => {
    const recoveredSocket = socket();
    const createSocket = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("transient constructor failure");
      })
      .mockReturnValueOnce(recoveredSocket);
    const onConnectionError = vi.fn();
    const { result } = renderHook(() =>
      useRoomRealtime({
        createSocket,
        onConnected: vi.fn(),
        onConnectionError,
        onMessage: vi.fn(),
        onUnreadableMessage: vi.fn(),
        roomId: ROOM_ID,
        socketUrl: () => "wss://api.example.test/v1/realtime/rooms/room",
      }),
    );

    await waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    expect(onConnectionError).toHaveBeenCalledWith(
      "The live table could not connect. Retrying shortly.",
    );
    await waitFor(() => expect(createSocket).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });

    act(() => recoveredSocket.onopen?.(new Event("open")));
    await waitFor(() => expect(result.current.connection).toBe("live"));
  });

  it("uses current callbacks without reconnecting the socket", async () => {
    const activeSocket = socket();
    const createSocket = vi.fn(() => activeSocket);
    const firstConnected = vi.fn();
    const currentConnected = vi.fn();
    const { rerender } = renderHook(
      ({ onConnected }: { onConnected: () => void }) =>
        useRoomRealtime({
          createSocket,
          onConnected,
          onConnectionError: vi.fn(),
          onMessage: vi.fn(),
          onUnreadableMessage: vi.fn(),
          roomId: ROOM_ID,
          socketUrl: () => "wss://api.example.test/v1/realtime/rooms/room",
        }),
      { initialProps: { onConnected: firstConnected } },
    );

    await waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    rerender({ onConnected: currentConnected });
    expect(createSocket).toHaveBeenCalledOnce();

    act(() => activeSocket.onopen?.(new Event("open")));
    expect(firstConnected).not.toHaveBeenCalled();
    expect(currentConnected).toHaveBeenCalledOnce();
  });
});
