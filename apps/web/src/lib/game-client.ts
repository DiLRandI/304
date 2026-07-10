import {
  CreateRoomRequestSchema,
  type GameAction,
  GameCommandSchema,
  GuestSessionRequestSchema,
  JoinRoomRequestSchema,
  type RealtimeServerMessage,
  RealtimeServerMessageSchema,
  type RoomProjection,
  RoomProjectionSchema,
  type RuleProfileId,
  ServiceErrorResponseSchema,
  type SessionResponse,
  SessionResponseSchema,
  StartRoomRequestSchema,
} from "@three-zero-four/contracts";

export type GuestSession = SessionResponse;

export interface CreateRoomOptions {
  botDifficulty?: "easy" | "normal" | "strong";
  ruleProfileId: RuleProfileId;
}

export type ClientFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class GameServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GameServiceError";
  }
}

function serviceError(body: unknown, status: number): GameServiceError {
  const parsed = ServiceErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new GameServiceError(
      parsed.data.error.code,
      status,
      parsed.data.error.message,
    );
  }
  return new GameServiceError(
    "GAME_SERVICE_ERROR",
    status,
    "The game service could not complete this request.",
  );
}

export function parseRealtimeServerMessage(
  value: unknown,
): RealtimeServerMessage {
  return RealtimeServerMessageSchema.parse(value);
}

function serviceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Game service URL must use HTTP or HTTPS");
  }
  return url;
}

export function toRoomSocketUrl(serviceOrigin: string, roomId: string): string {
  const url = new URL(
    `/v1/realtime/rooms/${encodeURIComponent(roomId)}`,
    serviceUrl(serviceOrigin),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class GameClient {
  private readonly origin: URL;

  constructor(
    serviceOrigin: string,
    private readonly fetcher: ClientFetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.origin = serviceUrl(serviceOrigin);
  }

  async createGuest(displayName: string): Promise<GuestSession> {
    const input = GuestSessionRequestSchema.parse({ displayName });
    return this.request(
      "/v1/guest-sessions",
      "POST",
      input,
      SessionResponseSchema.parse,
    );
  }

  async getSession(): Promise<GuestSession> {
    return this.request(
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
    return this.request("/v1/rooms", "POST", input, RoomProjectionSchema.parse);
  }

  async getRoom(roomReference: string): Promise<RoomProjection> {
    return this.request(
      `/v1/rooms/${encodeURIComponent(roomReference)}`,
      "GET",
      undefined,
      RoomProjectionSchema.parse,
    );
  }

  async getSnapshot(roomId: string): Promise<RoomProjection> {
    return this.request(
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
    return this.request(
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
    return this.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/start`,
      "POST",
      input,
      RoomProjectionSchema.parse,
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
    return this.request(
      `/v1/rooms/${encodeURIComponent(roomId)}/commands`,
      "POST",
      input,
      RoomProjectionSchema.parse,
    );
  }

  roomSocketUrl(roomId: string): string {
    return toRoomSocketUrl(this.origin.toString(), roomId);
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    payload: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      credentials: "include",
    };
    if (payload !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(payload);
    }
    let response: Response;
    try {
      response = await this.fetcher(
        new URL(path, this.origin).toString(),
        init,
      );
    } catch {
      throw new GameServiceError(
        "NETWORK_ERROR",
        0,
        "The game service could not be reached. Please check your connection.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) throw serviceError(undefined, response.status);
      throw new Error("Game service returned an invalid response");
    }
    if (!response.ok) throw serviceError(body, response.status);
    return parse(body);
  }
}
