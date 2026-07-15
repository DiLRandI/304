import { describe, expect, it, vi } from "vitest";
import { buildApp, loadConfig, redactSensitiveRequestUrl } from "../src/app.js";
import { RoomApplicationError } from "../src/contexts/rooms/application/execute-room-command.js";
import type { GameRuntime } from "../src/delivery/http/v1-routes.js";
import type { RoomSocketHub } from "../src/delivery/realtime/room-socket-hub.js";

const baseConfig = {
  NODE_ENV: "test",
  PORT: "4100",
  DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGINS: "http://127.0.0.1:3000",
  SESSION_COOKIE_NAME: "g304_session",
  SESSION_SECRET_PEPPER: "test-only-session-pepper-must-be-32-chars",
};
const config = loadConfig(baseConfig);

describe("game service configuration", () => {
  it("rejects an origin list with a path instead of a browser origin", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        DATABASE_URL: "postgres://game:game@127.0.0.1:5432/game",
        REDIS_URL: "redis://127.0.0.1:6379",
        CORS_ORIGINS: "http://127.0.0.1:3000/not-an-origin",
        SESSION_COOKIE_NAME: "g304_session",
        SESSION_SECRET_PEPPER: "test-only-session-pepper-must-be-32-chars",
      }),
    ).toThrow("Invalid CORS origin");
  });

  it("requires a sufficiently long session secret pepper", () => {
    expect(() =>
      loadConfig({
        ...baseConfig,
        SESSION_SECRET_PEPPER: "short",
      }),
    ).toThrow("Invalid service configuration: SESSION_SECRET_PEPPER");
  });

  it("requires a disconnect grace period longer than the presence lease", () => {
    expect(() =>
      loadConfig({
        ...baseConfig,
        PRESENCE_TTL_SECONDS: "100",
        DISCONNECT_GRACE_SECONDS: "100",
      }),
    ).toThrow("DISCONNECT_GRACE_SECONDS must exceed PRESENCE_TTL_SECONDS");
  });

  it("defaults realtime timing to a grace period after presence expires", () => {
    expect(config.DISCONNECT_GRACE_SECONDS).toBeGreaterThan(
      config.PRESENCE_TTL_SECONDS,
    );
    expect(config.WS_HEARTBEAT_SECONDS).toBeGreaterThanOrEqual(10);
    expect(config.OUTBOX_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(100);
    expect(config.AUTOMATION_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(100);
  });

  it("uses bounded room-maintenance defaults and rejects invalid retention values", () => {
    expect(config).toMatchObject({
      EXPIRED_SESSION_REVOKE_HOURS: 24,
      MAINTENANCE_BATCH_SIZE: 100,
      MAINTENANCE_POLL_INTERVAL_MS: 300_000,
      ROOM_CLOSED_RETENTION_DAYS: 30,
      ROOM_LOBBY_IDLE_HOURS: 24,
      ROOM_TERMINAL_RETENTION_DAYS: 14,
    });
    expect(() =>
      loadConfig({ ...baseConfig, MAINTENANCE_POLL_INTERVAL_MS: "59999" }),
    ).toThrow("Invalid service configuration: MAINTENANCE_POLL_INTERVAL_MS");
    expect(() =>
      loadConfig({ ...baseConfig, MAINTENANCE_BATCH_SIZE: "501" }),
    ).toThrow("Invalid service configuration: MAINTENANCE_BATCH_SIZE");
    expect(() =>
      loadConfig({ ...baseConfig, ROOM_LOBBY_IDLE_HOURS: "0" }),
    ).toThrow("Invalid service configuration: ROOM_LOBBY_IDLE_HOURS");
    expect(() =>
      loadConfig({ ...baseConfig, ROOM_TERMINAL_RETENTION_DAYS: "91" }),
    ).toThrow("Invalid service configuration: ROOM_TERMINAL_RETENTION_DAYS");
    expect(() =>
      loadConfig({ ...baseConfig, ROOM_CLOSED_RETENTION_DAYS: "366" }),
    ).toThrow("Invalid service configuration: ROOM_CLOSED_RETENTION_DAYS");
    expect(() =>
      loadConfig({ ...baseConfig, EXPIRED_SESSION_REVOKE_HOURS: "169" }),
    ).toThrow("Invalid service configuration: EXPIRED_SESSION_REVOKE_HOURS");
  });

  it("accepts only concrete IP addresses as trusted proxy sources", () => {
    expect(() =>
      loadConfig({ ...baseConfig, TRUSTED_PROXY_IPS: "not-an-address" }),
    ).toThrow("Invalid trusted proxy IP");
  });
});

describe("game service bootstrap", () => {
  it("redacts private invite codes from request logs without suppressing route logs", async () => {
    const inviteCode = "304-TestInviteCode_1234";
    const redactedInvite = "[redacted-invite]";
    const encodedInviteCode = [...inviteCode]
      .map(
        (character) =>
          `%${character.codePointAt(0)?.toString(16).padStart(2, "0")}`,
      )
      .join("");
    const doubleEncodedInviteCode = encodeURIComponent(encodedInviteCode);
    const embeddedEncodedInviteCode = `prefix${inviteCode.replace(
      "-",
      "%2D",
    )}suffix`;
    const entries: string[] = [];
    expect(redactSensitiveRequestUrl(`/malformed/${inviteCode}%2G`)).toBe(
      `/malformed/${redactedInvite}%2G`,
    );
    const app = await buildApp({
      config: loadConfig({ ...baseConfig, NODE_ENV: "production" }),
      readiness: { database: async () => true, redis: async () => true },
      logStream: { write: (entry) => entries.push(entry) },
    });

    await app.inject(`/v1/rooms/${inviteCode}/join`);
    await app.inject(`/v1/rooms/${encodedInviteCode}/join`);
    await app.inject(`/v1/rooms/${doubleEncodedInviteCode}/join`);
    await app.inject(`/v1/rooms/${embeddedEncodedInviteCode}/join`);
    await app.inject(
      `/lookup?primary=${inviteCode}&fallback=${doubleEncodedInviteCode}`,
    );
    await app.inject("/v1/rooms/304-too-short");
    await app.inject("/unknown");
    await app.close();

    const logs = entries.join("");
    expect(logs).not.toContain(inviteCode);
    expect(logs).not.toContain(encodedInviteCode);
    expect(logs).not.toContain(doubleEncodedInviteCode);

    const records = entries.flatMap((entry) =>
      entry
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
    const incoming = records.filter(
      (record) => record.msg === "incoming request",
    );
    const completed = records.filter(
      (record) => record.msg === "request completed",
    );
    expect(incoming).toHaveLength(7);
    expect(completed).toHaveLength(7);

    const incomingUrls = incoming.map(
      (record) => (record.req as { url?: string }).url,
    );
    expect(incomingUrls).toContain("/v1/rooms/[redacted-invite]/join");
    expect(incomingUrls).toContain("/v1/rooms/304-too-short");
    expect(incomingUrls).toContain("/unknown");
    expect(
      incomingUrls.filter((url) => url?.includes(redactedInvite)),
    ).toHaveLength(5);

    const ordinary = incoming.find(
      (record) => (record.req as { url?: string }).url === "/unknown",
    );
    expect(ordinary?.req).toMatchObject({
      host: "localhost:80",
      method: "GET",
      remoteAddress: "127.0.0.1",
      url: "/unknown",
    });
    expect(
      completed.find((record) => record.reqId === ordinary?.reqId)?.res,
    ).toEqual({ statusCode: 404 });
  });

  it("does not emit a deprecated Fastify logging warning", async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);

    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();
    process.off("warning", onWarning);

    expect(
      warnings.map((warning) => (warning as Error & { code?: string }).code),
    ).not.toContain("FSTDEP023");
  });

  it("stops injected realtime resources when the app closes", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
      game: {} as GameRuntime,
      realtime: { hub: {} as RoomSocketHub, stop },
    });

    await app.close();

    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("game service health surface", () => {
  it("presents room application errors through the public error contract", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
    });
    app.get("/room-application-error", async () => {
      throw new RoomApplicationError(
        "VERSION_CONFLICT",
        "Room state changed; refresh and retry",
      );
    });

    const response = await app.inject("/room-application-error");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "Room state changed; refresh and retry",
      },
    });
    await app.close();
  });

  it("uses forwarded client IPs only from the configured Caddy gateway", async () => {
    const app = await buildApp({
      config: loadConfig({
        ...baseConfig,
        TRUSTED_PROXY_IPS: "172.31.240.1",
      }),
      readiness: { database: async () => true, redis: async () => true },
    });
    app.get("/client-ip", async (request) => ({ ip: request.ip }));

    const trusted = await app.inject({
      url: "/client-ip",
      remoteAddress: "172.31.240.1",
      headers: { "x-forwarded-for": "198.51.100.8" },
    });
    const untrusted = await app.inject({
      url: "/client-ip",
      remoteAddress: "192.0.2.10",
      headers: { "x-forwarded-for": "198.51.100.8" },
    });

    expect(trusted.json()).toEqual({ ip: "198.51.100.8" });
    expect(untrusted.json()).toEqual({ ip: "192.0.2.10" });
    await app.close();
  });

  it("reports live while a dependency is unavailable and becomes ready only when all are ready", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => false },
    });
    const live = await app.inject("/livez");
    const ready = await app.inject("/readyz");
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "not_ready",
      dependencies: { database: true, redis: false },
    });
    await app.close();
  });

  it("emits a request id and rejects unrecognized routes as JSON", async () => {
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
    });
    const response = await app.inject("/unknown");
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    await app.close();
  });

  it("exports realtime and automation gauges from the metrics surface", async () => {
    const refreshMetrics = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp({
      config,
      readiness: { database: async () => true, redis: async () => true },
      refreshMetrics,
    });

    const metrics = await app.inject("/metrics");

    expect(metrics.payload).toContain("three_zero_four_websocket_connections");
    expect(metrics.payload).toContain("three_zero_four_room_outbox_pending");
    expect(metrics.payload).toContain(
      "three_zero_four_automation_jobs_pending",
    );
    expect(metrics.payload).toContain(
      "three_zero_four_automation_job_outcomes",
    );
    expect(metrics.payload).toContain(
      "three_zero_four_worker_heartbeat_age_seconds",
    );
    expect(metrics.payload).toContain(
      "three_zero_four_maintenance_sessions_revoked_total",
    );
    expect(metrics.payload).toContain(
      "three_zero_four_maintenance_rooms_closed_total",
    );
    expect(metrics.payload).toContain(
      "three_zero_four_maintenance_rooms_purged_total",
    );
    expect(refreshMetrics).toHaveBeenCalledOnce();
    await app.close();
  });
});
