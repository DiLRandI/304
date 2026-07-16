import { isIP } from "node:net";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  TRUSTED_PROXY_IPS: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  SESSION_SECRET_PEPPER: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ROOM_LEASE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30_000)
    .default(5_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(75),
  WS_HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(60).default(20),
  WS_MAX_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(32 * 1_024)
    .default(8 * 1_024),
  OUTBOX_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(5_000)
    .default(250),
  AUTOMATION_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(5_000)
    .default(500),
  DISCONNECT_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .min(90)
    .max(900)
    .default(120),
  BOT_ACTION_DELAY_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(10_000)
    .default(900),
  MAINTENANCE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(300_000),
  MAINTENANCE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  ROOM_LOBBY_IDLE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  ROOM_TERMINAL_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .default(14),
  ROOM_CLOSED_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30),
  EXPIRED_SESSION_REVOKE_HOURS: z.coerce
    .number()
    .int()
    .min(0)
    .max(168)
    .default(24),
});

/** Validated runtime configuration shared by bootstrap and delivery adapters. */
export type ServiceConfig = z.infer<typeof EnvironmentSchema> & {
  corsOrigins: ReadonlySet<string>;
  trustedProxyIps: readonly string[];
};

function parseCorsOrigins(rawOrigins: string): ReadonlySet<string> {
  const origins = new Set(
    rawOrigins
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (origins.size === 0) {
    throw new Error("Invalid CORS origin list");
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }

  return origins;
}

function parseTrustedProxyIps(rawProxyIps?: string): readonly string[] {
  if (!rawProxyIps) {
    return [];
  }

  const proxyIps = rawProxyIps
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    proxyIps.length === 0 ||
    proxyIps.some((address) => isIP(address) === 0)
  ) {
    throw new Error("Invalid trusted proxy IP");
  }

  return proxyIps;
}

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): ServiceConfig {
  const parsed = EnvironmentSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid service configuration: ${fields}`);
  }
  if (
    parsed.data.DISCONNECT_GRACE_SECONDS <= parsed.data.PRESENCE_TTL_SECONDS
  ) {
    throw new Error(
      "DISCONNECT_GRACE_SECONDS must exceed PRESENCE_TTL_SECONDS",
    );
  }
  return {
    ...parsed.data,
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGINS),
    trustedProxyIps: parseTrustedProxyIps(parsed.data.TRUSTED_PROXY_IPS),
  };
}
