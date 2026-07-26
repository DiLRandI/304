import { ServiceErrorResponseSchema } from "@three-zero-four/contracts";
import { RoomGatewayError } from "../application/room-gateway-error";

export type ClientFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function serviceError(body: unknown, status: number): RoomGatewayError {
  const parsed = ServiceErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new RoomGatewayError(
      parsed.data.error.code,
      status,
      parsed.data.error.message,
    );
  }
  return new RoomGatewayError(
    "GAME_SERVICE_ERROR",
    status,
    "The game service could not complete this request.",
  );
}

export function parseGameServiceOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Game service URL must use HTTP or HTTPS");
  }
  return url;
}

export class GameServiceTransport {
  readonly origin: URL;
  private csrfToken?: string;

  constructor(
    serviceOrigin: string,
    private readonly fetcher: ClientFetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.origin = parseGameServiceOrigin(serviceOrigin);
  }

  setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  async request<T>(
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
      init.headers = {
        "content-type": "application/json",
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {}),
      };
      init.body = JSON.stringify(payload);
    }

    let response: Response;
    try {
      response = await this.fetcher(
        new URL(path, this.origin).toString(),
        init,
      );
    } catch {
      throw new RoomGatewayError(
        "NETWORK_ERROR",
        0,
        "The game service could not be reached. Please check your connection.",
      );
    }
    const responseCsrfToken = response.headers.get("x-csrf-token");
    if (responseCsrfToken && CSRF_TOKEN_PATTERN.test(responseCsrfToken)) {
      this.csrfToken = responseCsrfToken;
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
