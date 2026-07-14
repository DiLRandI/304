"use client";

import type { RealtimeServerMessage } from "@three-zero-four/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRealtimeServerMessage } from "../api/room-realtime";
import {
  createBrowserRoomSocket,
  encodeRoomClientMessage,
  ROOM_SOCKET_OPEN,
  type RoomSocket,
  type RoomSocketFactory,
} from "../api/room-socket";

const PING_INTERVAL_MS = 15_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
export const ROOM_SOCKET_CONNECT_ERROR =
  "The live table could not connect. Retrying shortly.";

export type RoomConnection = "connecting" | "live" | "offline" | "reconnecting";

type RoomClientMessage = { roomId: string; type: "RESYNC" } | { type: "PING" };

export type RoomMessageSender = (message: RoomClientMessage) => boolean;

export interface RoomRealtimeOptions {
  createSocket?: RoomSocketFactory;
  onConnected(): void;
  onConnectionError(message: string): void;
  onMessage(message: RealtimeServerMessage, send: RoomMessageSender): void;
  onUnreadableMessage(roomId: string): void;
  roomId: string | null;
  socketUrl(roomId: string): string;
}

export function useRoomRealtime(options: RoomRealtimeOptions) {
  const [connection, setConnection] = useState<RoomConnection>(
    options.roomId ? "connecting" : "offline",
  );
  const socketRef = useRef<RoomSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const send = useCallback<RoomMessageSender>((message) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== ROOM_SOCKET_OPEN) return false;
    socket.send(encodeRoomClientMessage(message));
    return true;
  }, []);

  const disconnect = useCallback(() => {
    stoppedRef.current = true;
    clearReconnectTimer();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    setConnection("offline");
  }, [clearReconnectTimer]);

  useEffect(() => {
    const roomId = options.roomId;
    if (roomId === null) {
      disconnect();
      return;
    }
    const activeRoomId: string = roomId;

    let disposed = false;
    let reconnectAttempt = 0;
    stoppedRef.current = false;

    function scheduleReconnect(): void {
      if (disposed || stoppedRef.current) return;
      clearReconnectTimer();
      reconnectAttempt += 1;
      setConnection("reconnecting");
      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt - 1, RECONNECT_DELAYS_MS.length - 1)
        ] ?? RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
      reconnectTimerRef.current = setTimeout(openSocket, delay);
    }

    function openSocket(): void {
      if (disposed || stoppedRef.current) return;
      clearReconnectTimer();
      setConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
      let socket: RoomSocket;
      try {
        const current = optionsRef.current;
        socket = (current.createSocket ?? createBrowserRoomSocket)(
          current.socketUrl(activeRoomId),
        );
      } catch {
        socketRef.current = null;
        optionsRef.current.onConnectionError(ROOM_SOCKET_CONNECT_ERROR);
        scheduleReconnect();
        return;
      }

      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed || stoppedRef.current) {
          socket.close();
          return;
        }
        reconnectAttempt = 0;
        setConnection("live");
        optionsRef.current.onConnected();
      };
      socket.onmessage = (event) => {
        if (disposed || stoppedRef.current) return;
        try {
          const message = parseRealtimeServerMessage(JSON.parse(event.data));
          optionsRef.current.onMessage(message, send);
        } catch {
          optionsRef.current.onUnreadableMessage(activeRoomId);
        }
      };
      socket.onerror = () => {
        setConnection("offline");
      };
      socket.onclose = () => {
        if (disposed || stoppedRef.current) return;
        if (socketRef.current === socket) socketRef.current = null;
        scheduleReconnect();
      };
    }

    const ping = () => {
      if (document.visibilityState === "visible") send({ type: "PING" });
    };
    const visibilityChange = () => ping();
    const pingTimer = setInterval(ping, PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", visibilityChange);
    openSocket();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", visibilityChange);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [clearReconnectTimer, disconnect, options.roomId, send]);

  return { connection, disconnect, send };
}
