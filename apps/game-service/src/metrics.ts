import { Counter, collectDefaultMetrics, Gauge, Registry } from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "three_zero_four_" });
  const requests = new Counter({
    name: "three_zero_four_http_requests_total",
    help: "Completed HTTP requests by route and status code",
    labelNames: ["route", "status_code"] as const,
    registers: [registry],
  });
  const activeWebsocketConnections = new Gauge({
    name: "three_zero_four_websocket_connections",
    help: "Current authenticated room WebSocket connections",
    registers: [registry],
  });
  const pendingRoomOutbox = new Gauge({
    name: "three_zero_four_room_outbox_pending",
    help: "Durable room notifications awaiting publication",
    registers: [registry],
  });
  const pendingAutomationJobs = new Gauge({
    name: "three_zero_four_automation_jobs_pending",
    help: "Durable automation jobs awaiting completion",
    registers: [registry],
  });
  const automationJobOutcomes = new Gauge({
    name: "three_zero_four_automation_job_outcomes",
    help: "Durable automation job outcomes recorded across workers",
    labelNames: ["outcome"] as const,
    registers: [registry],
  });
  activeWebsocketConnections.set(0);
  pendingRoomOutbox.set(0);
  pendingAutomationJobs.set(0);
  for (const outcome of ["completed", "stale", "failed"]) {
    automationJobOutcomes.set({ outcome }, 0);
  }
  return {
    registry,
    requests,
    activeWebsocketConnections,
    pendingRoomOutbox,
    pendingAutomationJobs,
    automationJobOutcomes,
  };
}

export type ServiceMetrics = ReturnType<typeof createMetrics>;
