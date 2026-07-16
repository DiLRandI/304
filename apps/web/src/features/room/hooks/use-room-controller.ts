"use client";

import type {
  GameAction,
  RealtimeServerMessage,
  RoomExitResponse,
  RoomProjection,
} from "@three-zero-four/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSocketFactory } from "../api/room-socket";
import type { RoomGateway } from "../application/room-gateway";
import { RoomGatewayError } from "../application/room-gateway-error";
import { applyProjection } from "../model/room-state";
import {
  ROOM_SOCKET_CONNECT_ERROR,
  type RoomMessageSender,
  useRoomRealtime,
} from "./use-room-realtime";

export interface RoomControllerOptions {
  createSocket?: RoomSocketFactory;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof RoomGatewayError) return error.message;
  return "The table could not be updated. Please try again.";
}

export function useRoomController(
  roomReference: string | undefined,
  client: RoomGateway,
  options: RoomControllerOptions = {},
) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(roomReference));
  const [projection, setProjection] = useState<RoomProjection | null>(null);
  const [realtimeRoomId, setRealtimeRoomId] = useState<string | null>(null);
  const projectionRef = useRef<RoomProjection | null>(null);
  const leftRoomRef = useRef(false);
  const bootstrapRef = useRef<(() => Promise<void>) | null>(null);

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
      if (leftRoomRef.current) return;
      try {
        const next = await client.getSnapshot(roomId);
        if (leftRoomRef.current) return;
        commitProjection(next);
      } catch (caught) {
        if (leftRoomRef.current) return;
        setError(safeErrorMessage(caught));
      }
    },
    [client, commitProjection],
  );

  const handleRealtimeMessage = useCallback(
    (message: RealtimeServerMessage, send: RoomMessageSender): void => {
      if (leftRoomRef.current) return;
      if (message.type === "SNAPSHOT") {
        const needsResync = commitProjection(message.projection);
        if (needsResync) {
          send({ roomId: message.projection.roomId, type: "RESYNC" });
          void refreshSnapshot(message.projection.roomId);
        }
        return;
      }
      if (message.type === "RESYNC_REQUIRED") {
        void refreshSnapshot(message.roomId);
        return;
      }
      setError(message.message);
    },
    [commitProjection, refreshSnapshot],
  );

  const handleUnreadableMessage = useCallback(
    (roomId: string): void => {
      if (leftRoomRef.current) return;
      setError("A realtime update could not be read. Refreshing the table.");
      void refreshSnapshot(roomId);
    },
    [refreshSnapshot],
  );

  const socketUrl = useCallback(
    (roomId: string): string => client.roomSocketUrl(roomId),
    [client],
  );

  const {
    connection,
    disconnect: disconnectRealtime,
    send: sendRealtime,
  } = useRoomRealtime({
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
    onConnected: () =>
      setError((current) =>
        current === ROOM_SOCKET_CONNECT_ERROR ? null : current,
      ),
    onConnectionError: setError,
    onMessage: handleRealtimeMessage,
    onUnreadableMessage: handleUnreadableMessage,
    roomId: realtimeRoomId,
    socketUrl,
  });

  useEffect(() => {
    if (!roomReference) {
      leftRoomRef.current = true;
      setRealtimeRoomId(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    let bootstrapInFlight = false;
    leftRoomRef.current = false;
    setRealtimeRoomId(null);

    const bootstrap = async () => {
      if (bootstrapInFlight || disposed || leftRoomRef.current) return;
      bootstrapInFlight = true;
      setLoading(true);
      setError(null);
      try {
        let initial = await client.getRoom(roomReference);
        if (disposed || leftRoomRef.current) return;
        if (initial.viewerSeatIndex === null && initial.status === "lobby") {
          initial = await client.joinRoom(roomReference, initial.eventVersion);
          if (disposed || leftRoomRef.current) return;
        }
        commitProjection(initial);
        if (initial.viewerSeatIndex === null) {
          setRealtimeRoomId(null);
          setError("This private room cannot be joined from this session.");
          return;
        }
        setRealtimeRoomId(initial.roomId);
      } catch (caught) {
        if (!disposed) {
          setRealtimeRoomId(null);
          setError(safeErrorMessage(caught));
        }
      } finally {
        bootstrapInFlight = false;
        if (!disposed) setLoading(false);
      }
    };

    bootstrapRef.current = bootstrap;
    void bootstrap();

    return () => {
      disposed = true;
      if (bootstrapRef.current === bootstrap) bootstrapRef.current = null;
    };
  }, [client, commitProjection, roomReference]);

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

  const leave = useCallback(async (): Promise<RoomExitResponse | undefined> => {
    const current = projectionRef.current;
    if (!current) return undefined;
    setError(null);
    try {
      const exit = await client.leaveRoom(current.roomId, current.eventVersion);
      leftRoomRef.current = true;
      setRealtimeRoomId(null);
      disconnectRealtime();
      projectionRef.current = null;
      setProjection(null);
      setLoading(false);
      return exit;
    } catch (caught) {
      setError(safeErrorMessage(caught));
      await refreshSnapshot(current.roomId);
      return undefined;
    }
  }, [client, disconnectRealtime, refreshSnapshot]);

  const refresh = useCallback(async (): Promise<void> => {
    const current = projectionRef.current;
    if (current) await refreshSnapshot(current.roomId);
  }, [refreshSnapshot]);

  const retry = useCallback(async (): Promise<void> => {
    if (projectionRef.current) return;
    await bootstrapRef.current?.();
  }, []);

  return {
    connection,
    error,
    leave,
    loading,
    projection,
    refresh,
    retry,
    start,
    submit,
  };
}
