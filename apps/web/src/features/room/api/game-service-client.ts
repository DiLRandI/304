import {
  CreateRoomRequestSchema,
  type GameAction,
  GameCommandSchema,
  GuestSessionRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  type RoomExitResponse,
  RoomExitResponseSchema,
  type RoomProjection,
  RoomProjectionSchema,
  type RuleProfileId,
  type SessionResponse,
  SessionResponseSchema,
  StartRoomRequestSchema,
} from "@three-zero-four/contracts";
import {
  type ClientFetcher,
  GameServiceTransport,
} from "./game-service-transport";
import { toRoomSocketUrl } from "./room-realtime";

export type GuestSession = SessionResponse;

export interface CreateRoomOptions {
  botDifficulty?: "easy" | "normal" | "strong";
  endHandWhenOutcomeCertain?: boolean;
  ruleProfileId: RuleProfileId;
}

export class GameClient {
  private readonly transport: GameServiceTransport;

  constructor(serviceOrigin: string, fetcher?: ClientFetcher) {
    this.transport = new GameServiceTransport(serviceOrigin, fetcher);
  }

  async createGuest(displayName: string): Promise<GuestSession> {
    const input = GuestSessionRequestSchema.parse({ displayName });
    return this.transport.request(
      "/v1/guest-sessions",
      "POST",
      input,
      SessionResponseSchema.parse,
    );
  }

  async getSession(): Promise<GuestSession> {
    return this.transport.request(
      "/v1/session",
      "GET",
      undefined,
      SessionResponseSchema.parse,
    );
  }

  async createRoom(options: CreateRoomOptions): Promise<RoomProjection> {
    const input = CreateRoomRequestSchema.parse({
      commandId: crypto.randomUUID(),
      ...options,
    });
    return this.transport.request(
      "/v1/rooms",
      "POST",
      input,
      RoomProjectionSchema.parse,
    );
  }

  async getRoom(roomReference: string): Promise<RoomProjection> {
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomReference)}`,
      "GET",
      undefined,
      RoomProjectionSchema.parse,
    );
  }

  async getSnapshot(roomId: string): Promise<RoomProjection> {
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/snapshot`,
      "GET",
      undefined,
      RoomProjectionSchema.parse,
    );
  }

  async joinRoom(
    roomReference: string,
    expectedVersion: number,
  ): Promise<RoomProjection> {
    const input = JoinRoomRequestSchema.parse({
      commandId: crypto.randomUUID(),
      expectedVersion,
    });
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomReference)}/join`,
      "POST",
      input,
      RoomProjectionSchema.parse,
    );
  }

  async startRoom(
    roomId: string,
    expectedVersion: number,
  ): Promise<RoomProjection> {
    const input = StartRoomRequestSchema.parse({
      commandId: crypto.randomUUID(),
      expectedVersion,
    });
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/start`,
      "POST",
      input,
      RoomProjectionSchema.parse,
    );
  }

  async leaveRoom(
    roomId: string,
    expectedVersion: number,
  ): Promise<RoomExitResponse> {
    const input = LeaveRoomRequestSchema.parse({
      commandId: crypto.randomUUID(),
      expectedVersion,
    });
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/leave`,
      "POST",
      input,
      RoomExitResponseSchema.parse,
    );
  }

  async submitCommand(
    roomId: string,
    expectedVersion: number,
    action: GameAction,
  ): Promise<RoomProjection> {
    const input = GameCommandSchema.parse({
      action,
      commandId: crypto.randomUUID(),
      expectedVersion,
      roomId,
    });
    return this.transport.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/commands`,
      "POST",
      input,
      RoomProjectionSchema.parse,
    );
  }

  roomSocketUrl(roomId: string): string {
    return toRoomSocketUrl(this.transport.origin.toString(), roomId);
  }
}
