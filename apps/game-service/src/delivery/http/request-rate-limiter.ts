export type RequestRateLimitErrorCode =
  | "RATE_LIMITED"
  | "RATE_LIMIT_UNAVAILABLE";

export class RequestRateLimitError extends Error {
  constructor(readonly code: RequestRateLimitErrorCode) {
    super(
      code === "RATE_LIMITED"
        ? "Too many requests; retry shortly"
        : "Rate limit is unavailable",
    );
    this.name = "RequestRateLimitError";
  }
}

export interface RequestRateLimiter {
  consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void>;
}
