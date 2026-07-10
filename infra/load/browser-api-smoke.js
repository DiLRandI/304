const { randomUUID } = require("node:crypto");

const MAX_CONCURRENCY = 2;
const MAX_DURATION_MS = 10_000;
const MAX_ITERATIONS = 6;
const MAX_REQUEST_LATENCY_MS = 4_000;
const REQUEST_TIMEOUT_MS = 5_000;

const baseUrl = new URL(process.env.LOAD_BASE_URL ?? "http://127.0.0.1:4100");
const origin = process.env.LOAD_ORIGIN ?? "http://127.0.0.1:3000";
const latencySamples = [];

function sessionCookie(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookie = values.find((value) => value.startsWith("g304_session="));
  if (!cookie)
    throw new Error("Guest session response did not set a session cookie");
  return cookie.split(";", 1)[0];
}

async function request(path, { body, cookie, method = "GET" } = {}) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } finally {
    latencySamples.push(performance.now() - startedAt);
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}`);
  }
  return { body: await response.json(), response };
}

async function createGuest(label) {
  const { response } = await request("/v1/guest-sessions", {
    method: "POST",
    body: { displayName: `Release smoke ${label}` },
  });
  return sessionCookie(response);
}

async function exercisePublicApi(iteration) {
  const hostCookie = await createGuest(`host ${iteration}`);
  const { body: room } = await request("/v1/rooms", {
    method: "POST",
    cookie: hostCookie,
    body: {
      commandId: randomUUID(),
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
    },
  });
  const guestCookie = await createGuest(`guest ${iteration}`);
  const { body: roomForGuest } = await request(
    `/v1/rooms/${encodeURIComponent(room.inviteCode)}`,
    { cookie: guestCookie },
  );
  await request(`/v1/rooms/${encodeURIComponent(room.roomId)}/join`, {
    method: "POST",
    cookie: guestCookie,
    body: {
      commandId: randomUUID(),
      expectedVersion: roomForGuest.eventVersion,
    },
  });
  await request(`/v1/rooms/${encodeURIComponent(room.roomId)}/snapshot`, {
    cookie: guestCookie,
  });
}

function percentile(samples, percentileValue) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index] ?? 0;
}

async function main() {
  const startedAt = performance.now();
  let nextIteration = 0;
  const workers = Array.from({ length: MAX_CONCURRENCY }, async () => {
    while (
      nextIteration < MAX_ITERATIONS &&
      performance.now() - startedAt < MAX_DURATION_MS
    ) {
      const iteration = nextIteration;
      nextIteration += 1;
      await exercisePublicApi(iteration);
    }
  });

  await Promise.all(workers);
  if (nextIteration === 0) throw new Error("Load smoke did not start any work");
  const p95 = percentile(latencySamples, 0.95);
  const maximum = Math.max(...latencySamples);
  if (maximum > MAX_REQUEST_LATENCY_MS) {
    throw new Error(
      `Load smoke exceeded ${MAX_REQUEST_LATENCY_MS}ms request latency (max ${maximum.toFixed(0)}ms)`,
    );
  }
  console.log(
    JSON.stringify({
      completedIterations: nextIteration,
      maxRequestLatencyMs: Math.round(maximum),
      p95RequestLatencyMs: Math.round(p95),
      requestCount: latencySamples.length,
    }),
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "unknown load smoke failure";
  console.error(`Release load smoke failed: ${message}`);
  process.exitCode = 1;
});
