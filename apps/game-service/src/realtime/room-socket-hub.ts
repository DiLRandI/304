import {
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
  type RoomProjection,
} from "@three-zero-four/contracts";
import type WebSocket from "ws";
import { DomainError } from "../domain/errors.js";
import type { RoomCoordinator } from "../domain/room-coordinator.js";
import type { AuthenticatedSession } from "../domain/session-service.js";
import type { RoomChangedNotice } from "./room-change-bus.js";

interface RoomSocketConnection {
  detached: boolean;
  lastSentEventVersion: number;
  roomId: string;
  session: AuthenticatedSession;
  socket: WebSocket;
}

function rawMessageToString(message: WebSocket.RawData): string {
  if (Array.isArray(message)) return Buffer.concat(message).toString("utf8");
  if (Buffer.isBuffer(message)) return message.toString("utf8");
  return Buffer.from(new Uint8Array(message)).toString("utf8");
}

function retryDelayMs(attempt: number): number {
  return [25, 75, 150, 250][attempt] ?? 250;
}

export class RoomSocketHub {
  private readonly connectionsByRoom = new Map<
    string,
    Set<RoomSocketConnection>
  >();

  constructor(
    private readonly dependencies: { coordinator: RoomCoordinator },
  ) {}

  attach(
    socket: WebSocket,
    session: AuthenticatedSession,
    roomId: string,
  ): RoomSocketConnection {
    const connection: RoomSocketConnection = {
      detached: false,
      lastSentEventVersion: -1,
      roomId,
      session,
      socket,
    };
    const connections = this.connectionsByRoom.get(roomId) ?? new Set();
    connections.add(connection);
    this.connectionsByRoom.set(roomId, connections);
    return connection;
  }

  async sendInitialSnapshot(connection: RoomSocketConnection): Promise<void> {
    try {
      await this.sendSnapshot(connection);
    } catch {
      this.fail(connection, "ROOM_SYNC_FAILED", "Unable to synchronize room");
    }
  }

  async handleClientMessage(
    connection: RoomSocketConnection,
    rawMessage: WebSocket.RawData,
  ): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(rawMessageToString(rawMessage)) as unknown;
    } catch {
      this.fail(connection, "INVALID_MESSAGE", "Realtime message is invalid");
      return;
    }
    const parsed = RealtimeClientMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.fail(connection, "INVALID_MESSAGE", "Realtime message is invalid");
      return;
    }
    try {
      if (parsed.data.type === "PING") {
        await this.dependencies.coordinator.markRealtimePresence(
          connection.session,
          connection.roomId,
        );
        return;
      }
      if (parsed.data.roomId !== connection.roomId) {
        this.fail(connection, "ROOM_MISMATCH", "Realtime room does not match");
        return;
      }
      await this.sendSnapshot(connection);
    } catch {
      this.fail(connection, "ROOM_SYNC_FAILED", "Unable to synchronize room");
    }
  }

  async handleRoomChanged(notice: RoomChangedNotice): Promise<void> {
    const connections = this.connectionsByRoom.get(notice.roomId);
    if (!connections) return;
    for (const connection of connections) {
      if (
        connection.detached ||
        connection.lastSentEventVersion >= notice.eventVersion
      ) {
        continue;
      }
      try {
        await this.sendSnapshot(connection);
      } catch {
        this.fail(connection, "ROOM_SYNC_FAILED", "Unable to synchronize room");
      }
    }
  }

  async detach(connection: RoomSocketConnection): Promise<void> {
    if (connection.detached) return;
    connection.detached = true;
    const connections = this.connectionsByRoom.get(connection.roomId);
    connections?.delete(connection);
    if (connections?.size === 0)
      this.connectionsByRoom.delete(connection.roomId);
    const hasPlayerConnection = [...(connections ?? [])].some(
      (candidate) => candidate.session.playerId === connection.session.playerId,
    );
    if (!hasPlayerConnection) {
      try {
        await this.dependencies.coordinator.markRealtimeDisconnected(
          connection.session,
          connection.roomId,
        );
      } catch {
        // The presence key naturally expires if the process is stopping or Redis is unavailable.
      }
    }
  }

  async close(): Promise<void> {
    const connections = [...this.connectionsByRoom.values()].flatMap(
      (roomConnections) => [...roomConnections],
    );
    for (const connection of connections) {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.close(1001, "Service shutting down");
      }
      await this.detach(connection);
    }
  }

  private async sendSnapshot(connection: RoomSocketConnection): Promise<void> {
    if (
      connection.detached ||
      connection.socket.readyState !== connection.socket.OPEN
    ) {
      return;
    }
    const projection = await this.loadSnapshot(connection);
    if (
      connection.detached ||
      connection.socket.readyState !== connection.socket.OPEN
    ) {
      return;
    }
    this.sendProjection(connection, projection);
  }

  private async loadSnapshot(
    connection: RoomSocketConnection,
  ): Promise<RoomProjection> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.dependencies.coordinator.getSnapshot(
          connection.session,
          connection.roomId,
        );
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          error.code !== "ROOM_BUSY" ||
          attempt >= 3
        ) {
          throw error;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, retryDelayMs(attempt));
        });
      }
    }
  }

  private sendProjection(
    connection: RoomSocketConnection,
    projection: RoomProjection,
  ): void {
    if (
      connection.detached ||
      connection.socket.readyState !== connection.socket.OPEN
    ) {
      return;
    }
    const message = RealtimeServerMessageSchema.parse({
      type: "SNAPSHOT",
      projection,
    });
    connection.socket.send(JSON.stringify(message));
    connection.lastSentEventVersion = projection.eventVersion;
  }

  private fail(
    connection: RoomSocketConnection,
    code: string,
    message: string,
  ): void {
    if (connection.socket.readyState === connection.socket.OPEN) {
      const envelope = RealtimeServerMessageSchema.parse({
        type: "ERROR",
        code: code.slice(0, 64),
        message: message.slice(0, 160),
      });
      connection.socket.send(JSON.stringify(envelope));
      connection.socket.close(1008, "Realtime policy violation");
    }
  }
}
