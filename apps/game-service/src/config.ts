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
});

export type ServiceConfig = z.infer<typeof EnvironmentSchema> & {
  corsOrigins: ReadonlySet<string>;
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
  return {
    ...parsed.data,
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGINS),
  };
}
