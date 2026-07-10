"use client";

import {
  type GameAction,
  RealtimeClientMessageSchema,
  type RealtimeServerMessage,
  type RoomProjection,
} from "@three-zero-four/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GameServiceError,
  parseRealtimeServerMessage,
} from "../lib/game-client";
import { applyProjection } from "../lib/room-state";

const OPEN_SOCKET = 1;
const PING_INTERVAL_MS = 15_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

export type RoomConnection = "connecting" | "live" | "offline" | "reconnecting";

export interface RoomSocket {
  close(): void;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
  readyState: number;
  send(data: string): void;
}

export interface RoomClient {
  getRoom(roomReference: string): Promise<RoomProjection>;
  getSnapshot(roomId: string): Promise<RoomProjection>;
  joinRoom(
    roomReference: string,
    expectedVersion: number,
  ): Promise<RoomProjection>;
  roomSocketUrl(roomId: string): string;
  startRoom(roomId: string, expectedVersion: number): Promise<RoomProjection>;
  submitCommand(
    roomId: string,
    expectedVersion: number,
    action: GameAction,
  ): Promise<RoomProjection>;
}

export interface RoomControllerOptions {
  createSocket?(url: string): RoomSocket;
}

function browserSocket(url: string): RoomSocket {
  return new WebSocket(url);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GameServiceError) return error.message;
  return "The table could not be updated. Please try again.";
}

export function useRoomController(
  roomReference: string | undefined,
  client: RoomClient,
  options: RoomControllerOptions = {},
) {
  const [connection, setConnection] = useState<RoomConnection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(roomReference));
  const [projection, setProjection] = useState<RoomProjection | null>(null);
  const projectionRef = useRef<RoomProjection | null>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createSocket = options.createSocket ?? browserSocket;

  const commitProjection = useCallback((next: RoomProjection): boolean => {
    const transition = applyProjection(projectionRef.current, next);
    if (transition.projection !== projectionRef.current) {
      projectionRef.current = transition.projection;
      setProjection(transition.projection);
    }
    return transition.needsResync;
  }, []);

  const refreshSnapshot = useCallback(
    async (roomId: string): Promise<void> => {
      try {
        const next = await client.getSnapshot(roomId);
        commitProjection(next);
      } catch (caught) {
        setError(safeErrorMessage(caught));
      }
    },
    [client, commitProjection],
  );

  const sendRealtime = useCallback(
    (
      message: { roomId: string; type: "RESYNC" } | { type: "PING" },
    ): boolean => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== OPEN_SOCKET) return false;
      socket.send(JSON.stringify(RealtimeClientMessageSchema.parse(message)));
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!roomReference) {
      setConnection("offline");
      setLoading(false);
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    const socketFactory = createSocket;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const requestSnapshot = (roomId: string) => {
      void refreshSnapshot(roomId);
    };

    const handleRealtimeMessage = (event: MessageEvent<string>) => {
      let message: RealtimeServerMessage;
      try {
        message = parseRealtimeServerMessage(JSON.parse(event.data));
      } catch {
        setError("A realtime update could not be read. Refreshing the table.");
        const roomId = projectionRef.current?.roomId;
        if (roomId) requestSnapshot(roomId);
        return;
      }

      if (message.type === "SNAPSHOT") {
        const needsResync = commitProjection(message.projection);
        if (needsResync) {
          sendRealtime({ roomId: message.projection.roomId, type: "RESYNC" });
          requestSnapshot(message.projection.roomId);
        }
        return;
      }
      if (message.type === "RESYNC_REQUIRED") {
        requestSnapshot(message.roomId);
        return;
      }
      setError(message.message);
    };

    const openSocket = (roomId: string) => {
      if (disposed) return;
      clearReconnectTimer();
      setConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
      let socket: RoomSocket;
      try {
        socket = socketFactory(client.roomSocketUrl(roomId));
      } catch {
        setConnection("offline");
        setError("The live table could not connect. Retrying shortly.");
        return;
      }
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        setConnection("live");
      };
      socket.onmessage = handleRealtimeMessage;
      socket.onerror = () => {
        setConnection("offline");
      };
      socket.onclose = () => {
        if (disposed) return;
        if (socketRef.current === socket) socketRef.current = null;
        reconnectAttempt += 1;
        setConnection("reconnecting");
        const delay =
          RECONNECT_DELAYS_MS[
            Math.min(reconnectAttempt - 1, RECONNECT_DELAYS_MS.length - 1)
          ] ?? RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
        reconnectTimerRef.current = setTimeout(() => openSocket(roomId), delay);
      };
    };

    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        let initial = await client.getRoom(roomReference);
        if (disposed) return;
        if (initial.viewerSeatIndex === null && initial.status === "lobby") {
          initial = await client.joinRoom(roomReference, initial.eventVersion);
          if (disposed) return;
        }
        commitProjection(initial);
        if (initial.viewerSeatIndex === null) {
          setConnection("offline");
          setError("This private room cannot be joined from this session.");
          return;
        }
        openSocket(initial.roomId);
      } catch (caught) {
        if (!disposed) {
          setConnection("offline");
          setError(safeErrorMessage(caught));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    const ping = () => {
      if (document.visibilityState === "visible")
        sendRealtime({ type: "PING" });
    };
    const visibilityChange = () => ping();
    const pingTimer = setInterval(ping, PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", visibilityChange);
    void bootstrap();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", visibilityChange);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [
    client,
    commitProjection,
    createSocket,
    refreshSnapshot,
    roomReference,
    sendRealtime,
  ]);

  const submit = useCallback(
    async (action: GameAction): Promise<void> => {
      const current = projectionRef.current;
      if (!current) return;
      setError(null);
      try {
        const next = await client.submitCommand(
          current.roomId,
          current.eventVersion,
          action,
        );
        const needsResync = commitProjection(next);
        if (needsResync) {
          sendRealtime({ roomId: next.roomId, type: "RESYNC" });
          await refreshSnapshot(next.roomId);
        }
      } catch (caught) {
        setError(safeErrorMessage(caught));
        await refreshSnapshot(current.roomId);
      }
    },
    [client, commitProjection, refreshSnapshot, sendRealtime],
  );

  const start = useCallback(async (): Promise<void> => {
    const current = projectionRef.current;
    if (!current) return;
    setError(null);
    try {
      const next = await client.startRoom(current.roomId, current.eventVersion);
      commitProjection(next);
    } catch (caught) {
      setError(safeErrorMessage(caught));
      await refreshSnapshot(current.roomId);
    }
  }, [client, commitProjection, refreshSnapshot]);

  const refresh = useCallback(async (): Promise<void> => {
    const current = projectionRef.current;
    if (current) await refreshSnapshot(current.roomId);
  }, [refreshSnapshot]);

  return {
    connection,
    error,
    loading,
    projection,
    refresh,
    start,
    submit,
  };
}
