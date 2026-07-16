import type { RedisClientType } from "redis";
import { RequestRateLimitError } from "../../delivery/http/request-rate-limiter.js";

const FIXED_WINDOW_INCREMENT_SCRIPT =
  "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return count";

function redisKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export class RateLimiter {
  constructor(
    private readonly redis: RedisClientType,
    private readonly keyPrefix = "g304",
  ) {}

  async consume(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `${this.keyPrefix}:rate:${redisKeyPart(scope)}:${redisKeyPart(subject)}`;
    const count = Number(
      await this.redis.eval(FIXED_WINDOW_INCREMENT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      }),
    );
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RequestRateLimitError("RATE_LIMIT_UNAVAILABLE");
    }
    if (count > limit) {
      throw new RequestRateLimitError("RATE_LIMITED");
    }
  }
}
