export interface RequestRateLimiter {
  consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void>;
}
